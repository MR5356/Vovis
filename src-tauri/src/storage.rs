use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tempfile::NamedTempFile;

const MAX_WORKSPACE_BYTES: usize = 24 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 100 * 1024 * 1024;

#[derive(serde::Serialize)]
pub struct WorkspaceSnapshot {
    pub workspace: Option<Value>,
    pub revision: String,
}

fn revision(body: Option<&str>) -> String {
    body.map(|text| format!("{:x}", Sha256::digest(text.as_bytes())))
        .unwrap_or_default()
}

fn workspace_body(db: &Connection) -> AppResult<Option<String>> {
    Ok(db
        .query_row("SELECT body FROM workspace WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()?)
}

pub struct Repository {
    database: Mutex<Connection>,
    config: Mutex<()>,
    data_dir: PathBuf,
    config_dir: PathBuf,
}

impl Repository {
    pub fn open(data_dir: PathBuf, config_dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(&config_dir)?;
        restrict_directory(&config_dir)?;
        fs::create_dir_all(data_dir.join("pdf"))?;
        let mut database = Connection::open(data_dir.join("workspace.sqlite3"))?;
        database.busy_timeout(std::time::Duration::from_secs(5))?;
        database.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let version: i64 = database.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > 1 {
            return Err(AppError::Invalid(
                "此工作空间由较新版本创建，请更新应用后打开".into(),
            ));
        }
        if version == 0 {
            let migration = database.transaction()?;
            migration.execute_batch("CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id = 1), body TEXT NOT NULL); PRAGMA user_version=1;")?;
            migration.commit()?;
        }
        Ok(Self {
            database: Mutex::new(database),
            config: Mutex::new(()),
            data_dir,
            config_dir,
        })
    }

    pub fn load_workspace(&self) -> AppResult<Option<Value>> {
        let database = self.database.lock().map_err(|_| AppError::Poisoned)?;
        let body = workspace_body(&database)?;
        body.map(|body| serde_json::from_str(&body).map_err(AppError::from))
            .transpose()
    }

    pub fn workspace_snapshot(&self) -> AppResult<WorkspaceSnapshot> {
        let db = self.database.lock().map_err(|_| AppError::Poisoned)?;
        let body = workspace_body(&db)?;
        Ok(WorkspaceSnapshot {
            revision: revision(body.as_deref()),
            workspace: body.map(|text| serde_json::from_str(&text)).transpose()?,
        })
    }

    pub fn save_workspace(&self, workspace: Value, expected_revision: &str) -> AppResult<String> {
        if !workspace.is_object() {
            return Err(AppError::Invalid("工作空间必须为对象".into()));
        }
        let body = serde_json::to_string(&workspace)?;
        if body.len() > MAX_WORKSPACE_BYTES {
            return Err(AppError::Invalid("工作空间过大，请清理历史记录".into()));
        }
        let mut db = self.database.lock().map_err(|_| AppError::Poisoned)?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous = workspace_body(&tx)?;
        if previous.as_deref() == Some(&body) {
            return Ok(revision(Some(&body)));
        }
        if revision(previous.as_deref()) != expected_revision {
            return Err(AppError::Invalid(
                "工作区已在其他窗口更新，本次修改尚未保存。请重新打开应用以加载最新数据".into(),
            ));
        }
        tx.execute("INSERT INTO workspace(id,body) VALUES (1,?1) ON CONFLICT(id) DO UPDATE SET body=excluded.body", params![body])?;
        tx.commit()?;
        Ok(revision(Some(&body)))
    }

    pub fn put_pdf(&self, id: &str, bytes: &[u8]) -> AppResult<()> {
        validate_id(id)?;
        if bytes.len() > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
            return Err(AppError::Invalid("PDF 无效或超过 100 MB".into()));
        }
        atomic_write(&self.data_dir.join("pdf").join(format!("{id}.pdf")), bytes)
    }

    pub fn get_pdf(&self, id: &str) -> AppResult<Vec<u8>> {
        validate_id(id)?;
        Ok(fs::read(
            self.data_dir.join("pdf").join(format!("{id}.pdf")),
        )?)
    }

    pub fn set_secret(&self, key: &str, secret: &str) -> AppResult<()> {
        validate_id(key)?;
        if secret.len() > 16_384 {
            return Err(AppError::Invalid("凭据长度无效".into()));
        }
        let _guard = self.config.lock().map_err(|_| AppError::Poisoned)?;
        let path = self.config_dir.join("credentials.json");
        let mut secrets = read_secrets(&path)?;
        if secret.is_empty() {
            secrets.remove(key);
        } else {
            secrets.insert(key.into(), Value::String(secret.into()));
        }
        atomic_write(&path, &serde_json::to_vec_pretty(&secrets)?)
    }

    pub fn secret(&self, key: &str) -> AppResult<Option<String>> {
        validate_id(key)?;
        let _guard = self.config.lock().map_err(|_| AppError::Poisoned)?;
        Ok(read_secrets(&self.config_dir.join("credentials.json"))?
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned))
    }
}

fn read_secrets(path: &Path) -> AppResult<Map<String, Value>> {
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(error.into()),
    }
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(AppError::Invalid("资源标识无效".into()));
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("配置路径无效".into()))?;
    let mut file = NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path)
        .map_err(|error| AppError::Io(error.error))?;
    Ok(())
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}
#[cfg(not(unix))]
fn restrict_directory(_path: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repository() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::open(dir.path().join("data"), dir.path().join("config")).unwrap();
        (dir, repo)
    }
    #[test]
    fn rejects_path_traversal() {
        let (_dir, repo) = repository();
        assert!(repo.put_pdf("../escape", b"%PDF-1.4").is_err());
        assert!(repo.secret("../../etc").is_err());
    }
    #[test]
    fn workspace_survives_reopening() {
        let (dir, repo) = repository();
        repo.save_workspace(serde_json::json!({"projects":[{"id":"one"}]}), "")
            .unwrap();
        drop(repo);
        let reopened =
            Repository::open(dir.path().join("data"), dir.path().join("config")).unwrap();
        assert_eq!(
            reopened.load_workspace().unwrap().unwrap()["projects"][0]["id"],
            "one"
        );
    }
    #[test]
    fn stale_or_uninitialized_window_cannot_replace_existing_configuration() {
        let (dir, first) = repository();
        let other = Repository::open(dir.path().join("data"), dir.path().join("config")).unwrap();
        let empty = other.workspace_snapshot().unwrap();
        let original = serde_json::json!({"connections": [{"model": "saved-model"}]});
        let rev = first
            .save_workspace(original.clone(), &empty.revision)
            .unwrap();
        let stale = other.workspace_snapshot().unwrap();
        assert_eq!(rev, stale.revision);
        let changed = serde_json::json!({"connections": [{"model": "updated-model"}]});
        first.save_workspace(changed.clone(), &rev).unwrap();
        assert!(other
            .save_workspace(original.clone(), &empty.revision)
            .is_err());
        assert!(other.save_workspace(original, &stale.revision).is_err());
        assert_eq!(other.load_workspace().unwrap(), Some(changed));
    }

    #[test]
    fn secrets_are_replaced_and_removed_without_touching_workspace() {
        let (_dir, repo) = repository();
        repo.set_secret("feishu", "first").unwrap();
        repo.set_secret("feishu", "second").unwrap();
        assert_eq!(repo.secret("feishu").unwrap().as_deref(), Some("second"));
        assert!(repo.load_workspace().unwrap().is_none());
        repo.set_secret("feishu", "").unwrap();
        assert_eq!(repo.secret("feishu").unwrap(), None);
    }
    #[test]
    fn invalid_pdf_does_not_create_an_asset() {
        let (_dir, repo) = repository();
        assert!(repo.put_pdf("asset", b"not a PDF").is_err());
        assert!(repo.get_pdf("asset").is_err());
    }
}
