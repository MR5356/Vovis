use crate::{
    error::{AppError, AppResult},
    providers,
    storage::Repository,
    window, Presentation,
};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
pub(crate) fn main_only(window: &WebviewWindow) -> AppResult<()> {
    if window.label() != crate::window::MAIN_LABEL {
        return Err(AppError::Invalid("此操作只允许在主窗口执行".into()));
    }
    Ok(())
}
async fn repository_task<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&Repository) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(move || action(app.state::<Repository>().inner()))
        .await
        .map_err(|_| AppError::Invalid("本地任务执行失败，请重试".into()))?
}
#[tauri::command]
pub(crate) async fn load_workspace(
    app: AppHandle,
    window: WebviewWindow,
) -> AppResult<crate::storage::WorkspaceSnapshot> {
    main_only(&window)?;
    repository_task(app, |repo| repo.workspace_snapshot()).await
}
#[tauri::command]
pub(crate) async fn save_workspace(
    app: AppHandle,
    window: WebviewWindow,
    workspace: Value,
    expected_revision: String,
) -> AppResult<String> {
    main_only(&window)?;
    repository_task(app, move |repo| {
        repo.save_workspace(workspace, &expected_revision)
    })
    .await
}
#[tauri::command]
pub(crate) async fn save_pdf(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    main_only(&window)?;
    repository_task(app, move |repo| repo.put_pdf(&id, &bytes)).await
}
#[tauri::command]
pub(crate) async fn load_pdf(app: AppHandle, id: String) -> AppResult<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(
        repository_task(app, move |repo| repo.get_pdf(&id)).await?,
    ))
}
#[tauri::command]
pub(crate) async fn save_credential(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    secret: String,
) -> AppResult<()> {
    main_only(&window)?;
    repository_task(app, move |repo| repo.set_secret(&id, &secret)).await
}
#[tauri::command]
pub(crate) async fn has_credential(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> AppResult<bool> {
    main_only(&window)?;
    repository_task(app, move |repo| Ok(repo.secret(&id)?.is_some())).await
}
#[tauri::command]
pub(crate) fn open_presentation(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    main_only(&window)?;
    Ok(window::open_presentation(&app)?)
}
#[tauri::command]
pub(crate) fn update_presentation(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Presentation>,
    payload: Value,
) -> AppResult<()> {
    main_only(&window)?;
    if serde_json::to_vec(&payload)?.len() > 4 * 1024 * 1024 {
        return Err(AppError::Invalid("演示内容过大".into()));
    }
    *state.0.lock().map_err(|_| AppError::Poisoned)? = Some(payload.clone());
    if let Some(window) = app.get_webview_window(window::PRESENTATION_LABEL) {
        window.emit("presentation:update", payload)?;
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn get_presentation(state: State<'_, Presentation>) -> AppResult<Option<Value>> {
    Ok(state.0.lock().map_err(|_| AppError::Poisoned)?.clone())
}

async fn saved_provider(app: AppHandle, connection_id: String) -> AppResult<providers::Provider> {
    repository_task(app, move |repo| {
        let workspace = repo
            .load_workspace()?
            .ok_or_else(|| AppError::Invalid("请先保存模型连接".into()))?;
        let config = workspace["connections"]
            .as_array()
            .and_then(|connections| {
                connections
                    .iter()
                    .find(|item| item["id"].as_str() == Some(&connection_id))
            })
            .ok_or_else(|| AppError::Invalid("找不到已保存的模型连接".into()))?;
        let config: providers::ConnectionConfig = serde_json::from_value(config.clone())?;
        let key = repo
            .secret(&config.id)?
            .ok_or_else(|| AppError::Invalid("请先保存此连接的 API Key".into()))?;
        providers::Provider::new(config, key)
    })
    .await
}

#[tauri::command]
pub(crate) async fn complete_text(
    window: WebviewWindow,
    app: AppHandle,
    connection_id: String,
    messages: Vec<providers::Message>,
) -> AppResult<providers::Completion> {
    main_only(&window)?;
    saved_provider(app, connection_id)
        .await?
        .complete(messages)
        .await
}

#[derive(Default)]
pub(crate) struct SpeechJobs(
    std::sync::Mutex<std::collections::HashMap<uuid::Uuid, tokio::sync::oneshot::Sender<()>>>,
);

#[derive(serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SpeechEvent {
    Audio {
        data: String,
    },
    Done {
        first_chunk_ms: u64,
        usage: Option<providers::TokenUsage>,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
pub(crate) fn start_speech(
    window: WebviewWindow,
    connection_id: String,
    request_id: String,
    verify_script: Option<bool>,
    text: String,
    voice: String,
    events: tauri::ipc::Channel<SpeechEvent>,
) -> AppResult<()> {
    main_only(&window)?;
    let app = window.app_handle().clone();
    let id = parse_job_id(&request_id)?;
    let (cancel, cancelled) = tokio::sync::oneshot::channel();
    {
        let state = app.state::<SpeechJobs>();
        let mut jobs = state.0.lock().map_err(|_| AppError::Poisoned)?;
        if jobs.len() >= 4 || jobs.contains_key(&id) {
            return Err(AppError::Invalid("语音任务过多，请先结束其他播放".into()));
        }
        jobs.insert(id, cancel);
    }
    tauri::async_runtime::spawn(async move {
        let result = tokio::select! {
            biased;
            _ = cancelled => None,
            result = async {
                let provider = saved_provider(app.clone(), connection_id).await?;
                provider.speech(&text, &voice, verify_script.unwrap_or(false), |data| {
                    events.send(SpeechEvent::Audio { data })?;
                    Ok(())
                }).await
            } => Some(result),
        };
        if let Ok(mut jobs) = app.state::<SpeechJobs>().0.lock() {
            jobs.remove(&id);
        }
        let event = match result {
            Some(Ok((first_chunk_ms, usage))) => SpeechEvent::Done {
                first_chunk_ms,
                usage,
            },
            Some(Err(error)) => SpeechEvent::Error {
                message: error.to_string(),
            },
            None => return,
        };
        let _ = events.send(event);
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_speech(
    window: WebviewWindow,
    state: State<'_, SpeechJobs>,
    request_id: String,
) -> AppResult<()> {
    main_only(&window)?;
    if let Some(cancel) = state
        .0
        .lock()
        .map_err(|_| AppError::Poisoned)?
        .remove(&parse_job_id(&request_id)?)
    {
        let _ = cancel.send(());
    }
    Ok(())
}

fn parse_job_id(id: &str) -> AppResult<uuid::Uuid> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::Invalid("语音任务标识无效".into()))
}

fn decode_recording(audio: &str) -> AppResult<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if audio.len() > 16 * 1024 * 1024 {
        return Err(AppError::Invalid("请选择 12 MB 以内的音频文件".into()));
    }
    STANDARD
        .decode(audio)
        .map_err(|_| AppError::Invalid("音频数据无效".into()))
}

#[tauri::command]
pub(crate) async fn create_custom_voice(
    window: WebviewWindow,
    app: AppHandle,
    connection_id: String,
    format: String,
    audio: String,
    name: String,
    transcript: String,
) -> AppResult<String> {
    main_only(&window)?;
    let bytes = decode_recording(&audio)?;
    saved_provider(app, connection_id)
        .await?
        .create_voice(bytes, &format, &name, &transcript)
        .await
}

#[tauri::command]
pub(crate) async fn transcribe_audio(
    window: WebviewWindow,
    app: AppHandle,
    connection_id: String,
    format: String,
    audio: String,
) -> AppResult<String> {
    main_only(&window)?;
    let bytes = decode_recording(&audio)?;
    saved_provider(app, connection_id)
        .await?
        .transcribe(bytes, &format)
        .await
}

#[tauri::command]
pub(crate) async fn test_feishu_credentials(
    window: WebviewWindow,
    app: AppHandle,
    app_id: String,
) -> AppResult<()> {
    main_only(&window)?;
    let secret = app
        .state::<Repository>()
        .secret("feishu")?
        .ok_or_else(|| AppError::Invalid("请先保存 App Secret".into()))?;
    providers::test_feishu(&app_id, &secret).await
}

#[tauri::command]
pub(crate) async fn save_session_video(
    window: WebviewWindow,
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<String> {
    main_only(&window)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Invalid("缺少视频数据".into()));
    };
    if bytes.get(4..8) != Some(b"ftyp") {
        return Err(AppError::Invalid("无效的 MP4 视频".into()));
    }
    let header = request
        .headers()
        .get("x-vovis-title")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Vovis");
    let query = format!("title={header}");
    let title: String = url::form_urlencoded::parse(query.as_bytes())
        .next()
        .map(|(_, v)| {
            v.chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' '))
                .take(60)
                .collect()
        })
        .unwrap_or_default();
    let bytes = bytes.clone();
    let directory = app.path().download_dir()?;
    tauri::async_runtime::spawn_blocking(move || -> AppResult<String> {
        use std::io::Write;
        std::fs::create_dir_all(&directory)?;
        let mut file = tempfile::NamedTempFile::new_in(&directory)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        let destination = directory.join(format!("{title}-{}.mp4", uuid::Uuid::new_v4().simple()));
        file.persist_noclobber(&destination).map_err(|e| e.error)?;
        Ok(destination.display().to_string())
    })
    .await
    .map_err(|_| AppError::Invalid("保存导出视频失败".into()))?
}
