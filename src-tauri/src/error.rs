use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("本地数据读写失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据库操作失败：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("配置格式无效：{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("飞书账号授权失效或尚未完成：{0}")]
    FeishuUserAuthorization(String),
    #[error("内部状态不可用，请重启应用")]
    Poisoned,
    #[error("窗口操作失败：{0}")]
    Window(#[from] tauri::Error),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
