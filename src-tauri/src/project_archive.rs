use crate::error::{AppError, AppResult};
use tauri::{AppHandle, Manager, WebviewWindow};

const MAGIC: &[u8] = b"VOVIS-PROJECT/1\n";
const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;

#[tauri::command]
pub(crate) async fn save_project_package(
    app: AppHandle,
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> AppResult<String> {
    crate::commands::main_only(&window)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Invalid("缺少项目包数据".into()));
    };
    if !bytes.starts_with(MAGIC) || bytes.len() > MAX_PACKAGE_BYTES {
        return Err(AppError::Invalid("项目包无效或超过 512 MB".into()));
    }
    let header = request
        .headers()
        .get("x-vovis-title")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("Vovis");
    let query = format!("title={header}");
    let title: String = url::form_urlencoded::parse(query.as_bytes())
        .next()
        .map(|(_, value)| {
            value
                .chars()
                .filter(|character| {
                    character.is_alphanumeric() || matches!(character, '-' | '_' | ' ')
                })
                .take(60)
                .collect()
        })
        .unwrap_or_else(|| "Vovis".into());
    let bytes = bytes.clone();
    let directory = app.path().download_dir()?;
    tauri::async_runtime::spawn_blocking(move || -> AppResult<String> {
        use std::io::Write;
        std::fs::create_dir_all(&directory)?;
        let mut file = tempfile::NamedTempFile::new_in(&directory)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        let destination =
            directory.join(format!("{title}-{}.vovis", uuid::Uuid::new_v4().simple()));
        file.persist_noclobber(&destination)
            .map_err(|error| error.error)?;
        Ok(destination.display().to_string())
    })
    .await
    .map_err(|_| AppError::Invalid("保存项目包失败".into()))?
}

#[tauri::command]
pub(crate) async fn remove_imported_pdf(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> AppResult<()> {
    crate::commands::main_only(&window)?;
    let id =
        uuid::Uuid::parse_str(&id).map_err(|_| AppError::Invalid("导入资源标识无效".into()))?;
    let path = app
        .path()
        .app_data_dir()?
        .join("pdf")
        .join(format!("{id}.pdf"));
    tauri::async_runtime::spawn_blocking(move || match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::Io(error)),
    })
    .await
    .map_err(|_| AppError::Invalid("清理导入资源失败".into()))?
}
