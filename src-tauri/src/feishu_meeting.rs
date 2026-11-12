use crate::{
    error::{AppError, AppResult},
    storage::Repository,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

const CALLBACK: &str = "http://127.0.0.1:18473/feishu/callback";
const MEETING_SCOPE: &str = "vc:meeting.meetingevent:read";

#[derive(Default)]
pub(crate) struct FeishuUser(tokio::sync::Mutex<Option<UserToken>>);

#[derive(Default)]
pub(crate) struct FeishuReads(
    std::sync::Mutex<std::collections::HashMap<uuid::Uuid, tokio::sync::oneshot::Sender<()>>>,
);

impl FeishuReads {
    async fn run<T>(
        &self,
        request_id: uuid::Uuid,
        request: impl std::future::Future<Output = AppResult<T>>,
    ) -> AppResult<T> {
        let (cancel, cancelled) = tokio::sync::oneshot::channel();
        {
            let mut jobs = self.0.lock().map_err(|_| AppError::Poisoned)?;
            if jobs.contains_key(&request_id) {
                return Err(error("飞书读取请求 ID 重复"));
            }
            jobs.insert(request_id, cancel);
        }
        let result = tokio::select! {
            result = request => result,
            _ = cancelled => Err(error("已取消飞书消息读取")),
        };
        self.0
            .lock()
            .map_err(|_| AppError::Poisoned)?
            .remove(&request_id);
        result
    }
}

#[tauri::command]
pub(crate) fn cancel_feishu_read(
    window: WebviewWindow,
    reads: State<'_, FeishuReads>,
    request_id: String,
) -> AppResult<()> {
    crate::commands::main_only(&window)?;
    let id = uuid::Uuid::parse_str(&request_id).map_err(|_| error("飞书读取请求 ID 无效"))?;
    let mut jobs = reads.0.lock().map_err(|_| AppError::Poisoned)?;
    if let Some(cancel) = jobs.remove(&id) {
        let _ = cancel.send(());
    }
    Ok(())
}

struct UserToken {
    app_id: String,
    access: String,
    refresh: Option<String>,
    expires: Instant,
}

fn error(message: impl Into<String>) -> AppError {
    AppError::Invalid(message.into())
}

fn secret(window: &WebviewWindow) -> AppResult<String> {
    crate::commands::main_only(window)?;
    window
        .state::<Repository>()
        .secret("feishu")?
        .ok_or_else(|| error("请先保存飞书应用的 App Secret"))
}

fn client() -> AppResult<reqwest::Client> {
    crate::providers::feishu_client()
}

async fn exchange(
    app_id: &str,
    body: Value,
    previous_refresh: Option<String>,
) -> AppResult<UserToken> {
    let response = client()?
        .post("https://open.feishu.cn/open-apis/authen/v2/oauth/token")
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            crate::providers::feishu_network_error("飞书账号授权", "open.feishu.cn", &error)
        })?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|_| error("飞书授权返回格式异常"))?;
    let code = body["code"].as_i64().unwrap_or(-1);
    if !status.is_success() || code != 0 {
        if matches!(code, 20024 | 20026 | 20037 | 20064 | 20073) {
            return Err(AppError::FeishuUserAuthorization(format!(
                "请使用参会账号重新授权（错误码 {code}）"
            )));
        }
        return Err(error(format!(
            "飞书授权请求失败（HTTP {status}，错误码 {code}）"
        )));
    }
    if !body["scope"].as_str().is_some_and(|scopes| {
        scopes
            .split_whitespace()
            .any(|scope| scope == MEETING_SCOPE)
    }) {
        return Err(AppError::FeishuUserAuthorization(format!(
            "本次用户授权未包含 {MEETING_SCOPE}"
        )));
    }
    Ok(UserToken {
        app_id: app_id.to_owned(),
        access: body["access_token"]
            .as_str()
            .filter(|token| !token.is_empty())
            .ok_or_else(|| error("飞书未返回用户令牌"))?
            .to_owned(),
        refresh: body["refresh_token"]
            .as_str()
            .map(str::to_owned)
            .or(previous_refresh),
        expires: Instant::now()
            + Duration::from_secs(body["expires_in"].as_u64().unwrap_or(0).saturating_sub(30)),
    })
}

async fn receive_code(listener: tokio::net::TcpListener, state: &str) -> AppResult<String> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    loop {
        let (mut stream, _) = listener.accept().await?;
        let mut line = String::new();
        let mut request = BufReader::new((&mut stream).take(8192));
        if !matches!(
            tokio::time::timeout(Duration::from_secs(2), request.read_line(&mut line)).await,
            Ok(Ok(_))
        ) {
            continue;
        }
        let Some(target) = line
            .strip_prefix("GET ")
            .and_then(|line| line.split_whitespace().next())
        else {
            continue;
        };
        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
            continue;
        };
        let valid = url.path() == "/feishu/callback"
            && url
                .query_pairs()
                .any(|(key, value)| key == "state" && value == state);
        let code = url
            .query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.into_owned());
        let (status, text) = if valid && code.is_some() {
            ("200 OK", "Authorization received. Return to Vovis.")
        } else {
            (
                "400 Bad Request",
                "Authorization rejected. Return to Vovis.",
            )
        };
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{text}", text.len());
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            stream.write_all(response.as_bytes()),
        )
        .await;
        if valid {
            return code.ok_or_else(|| error("飞书用户取消或拒绝了授权"));
        }
    }
}

#[tauri::command]
pub(crate) async fn feishu_user_login(
    window: WebviewWindow,
    user: State<'_, FeishuUser>,
    reads: State<'_, FeishuReads>,
    request_id: String,
    app_id: String,
    read_group: bool,
) -> AppResult<()> {
    let secret = secret(&window)?;
    let id = uuid::Uuid::parse_str(&request_id).map_err(|_| error("授权请求 ID 无效"))?;
    let login = async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:18473")
            .await
            .map_err(|_| error("无法打开飞书授权回调端口 18473"))?;
        let state = uuid::Uuid::new_v4().to_string();
        let mut url =
            url::Url::parse("https://accounts.feishu.cn/open-apis/authen/v1/authorize").unwrap();
        url.query_pairs_mut().extend_pairs([
        ("client_id", app_id.as_str()),
        ("redirect_uri", CALLBACK),
        ("response_type", "code"),
        ("scope", if read_group {
            "vc:meeting.meetingevent:read offline_access im:message:readonly im:message.group_msg:get_as_user"
        } else {
            "vc:meeting.meetingevent:read offline_access"
        }),
        ("state", &state),
    ]);
        window
            .opener()
            .open_url(url.to_string(), None::<&str>)
            .map_err(|_| error("无法打开飞书授权页面"))?;
        let code = tokio::time::timeout(Duration::from_secs(120), receive_code(listener, &state))
            .await
            .map_err(|_| error("飞书授权超时，请重试"))??;
        let token = exchange(
            &app_id,
            json!({
                "grant_type": "authorization_code", "client_id": app_id, "client_secret": secret,
                "code": code, "redirect_uri": CALLBACK,
            }),
            None,
        )
        .await?;
        let mut state = user.0.lock().await;
        save_refresh(&window, &token)?;
        *state = Some(token);
        Ok(())
    };
    reads.run(id, login).await
}

fn refresh_key(app_id: &str) -> String {
    format!("feishu-user-{app_id}")
}

fn save_refresh(window: &WebviewWindow, token: &UserToken) -> AppResult<()> {
    window.state::<Repository>().set_secret(
        &refresh_key(&token.app_id),
        token.refresh.as_deref().unwrap_or_default(),
    )
}

#[tauri::command]
pub(crate) async fn feishu_user_logout(
    window: WebviewWindow,
    user: State<'_, FeishuUser>,
    app_id: String,
) -> AppResult<()> {
    crate::commands::main_only(&window)?;
    let mut state = user.0.lock().await;
    window
        .state::<Repository>()
        .set_secret(&refresh_key(&app_id), "")?;
    if state.as_ref().is_some_and(|token| token.app_id == app_id) {
        *state = None;
    }
    Ok(())
}

async fn access(window: &WebviewWindow, user: &FeishuUser, app_id: &str) -> AppResult<String> {
    crate::commands::main_only(window)?;
    let mut state = user.0.lock().await;
    let current = state.as_ref().filter(|token| token.app_id == app_id);
    if let Some(token) = current.filter(|token| Instant::now() < token.expires) {
        return Ok(token.access.clone());
    }
    let refresh = match current {
        Some(token) => token.refresh.clone(),
        None => window.state::<Repository>().secret(&refresh_key(app_id))?,
    }
    .ok_or_else(|| AppError::FeishuUserAuthorization("请使用参会账号授权".into()))?;
    let token = exchange(
        app_id,
        json!({
            "grant_type": "refresh_token", "client_id": app_id,
            "client_secret": secret(window)?, "refresh_token": refresh,
        }),
        Some(refresh),
    )
    .await?;
    save_refresh(window, &token)?;
    let access = token.access.clone();
    *state = Some(token);
    Ok(access)
}

async fn get(
    client: &reqwest::Client,
    resource: &str,
    token: &str,
    params: &[(&str, &str)],
) -> AppResult<Value> {
    let response = client
        .get(format!(
            "https://open.feishu.cn/open-apis/vc/v1/bots/{resource}"
        ))
        .query(params)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| {
            crate::providers::feishu_network_error("重试中：飞书会议读取", "open.feishu.cn", &error)
        })?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|_| error(format!("飞书响应格式异常（HTTP {status}）")))?;
    let code = body["code"].as_i64().unwrap_or(-1);
    if status.is_success() && code == 0 {
        return Ok(body["data"].clone());
    }
    eprintln!("Feishu vc/bots/{resource}: HTTP {status}, code {code}");
    if matches!(code, 99991663 | 99991668 | 99991677 | 99991679) {
        return Err(AppError::FeishuUserAuthorization(format!(
            "请使用参会账号重新授权（错误码 {code}）"
        )));
    }
    let reason = meeting_error_hint(resource, code, status.as_u16());
    Err(error(format!("{reason}（HTTP {status}，错误码 {code}）")))
}

fn meeting_error_hint(resource: &str, code: i64, http_status: u16) -> &'static str {
    match (resource, code, http_status) {
        ("events", 120002, _) | ("user_active_meeting", 121009, _) =>
            "请让会议主持人开启「AI 总结」后重试。如果已开启，请在本场会议的「安全」设置中打开「允许智能体加入会议」",
        ("events", 120003, _) | ("user_active_meeting", 121010, _) =>
            "请使用已授权的飞书账号加入这场会议，然后重试",
        ("events", 120004, _) | ("user_active_meeting", 121011, _) =>
            "请先将应用机器人加入这场会议，然后重试",
        ("user_active_meeting", 121004, _) => "找不到会议，请确认会议仍在进行并刷新会议列表",
        ("user_active_meeting", 121002, _) => "当前应用或租户暂不支持查询活跃会议",
        ("user_active_meeting", 121005, _) => "请核对应用的会议权限，并确认参会账号和会议属于同一租户",
        (_, 99991672, _) => "飞书报告应用缺少接口权限，请在已发布版本中核对用户身份权限",
        (_, _, 401) => "飞书身份验证失败",
        (_, _, 403) => "飞书拒绝了本次会议读取请求",
        (_, _, 404) => "当前应用或会议的会中事件能力不可用",
        (_, _, 429 | 500..=599) => "重试中：飞书限流或服务异常",
        _ => "飞书会议读取失败",
    }
}

#[derive(Deserialize, Serialize)]
pub(crate) struct Meeting {
    meeting_id: String,
    #[serde(default)]
    meeting_no: String,
    #[serde(default)]
    meeting_title: String,
}

#[tauri::command]
pub(crate) async fn feishu_active_meetings(
    window: WebviewWindow,
    user: State<'_, FeishuUser>,
    app_id: String,
) -> AppResult<Vec<Meeting>> {
    let token = access(&window, &user, &app_id).await?;
    let data = get(&client()?, "user_active_meeting", &token, &[]).await?;
    if data["meetings"].is_null() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_value(data["meetings"].clone())?)
}

#[derive(Serialize)]
pub(crate) struct MeetingChat {
    source: &'static str,
    meeting_id: String,
    event_id: String,
    message_id: String,
    speaker_id: String,
    speaker_name: String,
    text: String,
    timestamp: u64,
}

fn parse_event(meeting: &str, event: &Value, messages: &mut Vec<MeetingChat>) {
    let decoded;
    let payload = match &event["payload"] {
        Value::String(value) => {
            let Ok(value) = serde_json::from_str::<Value>(value) else {
                return;
            };
            decoded = value;
            &decoded
        }
        value => value,
    };
    let Some(items) = payload["chat_received_items"].as_array() else {
        return;
    };
    let event_id = event["event_id"].as_str().unwrap_or_default();
    for (index, item) in items.iter().enumerate() {
        let content = &item["content"];
        let decoded = content
            .as_str()
            .and_then(|value| serde_json::from_str::<Value>(value).ok());
        let text = content["text"]
            .as_str()
            .or_else(|| decoded.as_ref().and_then(|value| value["text"].as_str()))
            .or_else(|| {
                (!matches!(decoded, Some(Value::Object(_) | Value::Array(_))))
                    .then(|| content.as_str())
                    .flatten()
            })
            .unwrap_or_default()
            .trim();
        if text.is_empty() {
            continue;
        }
        let timestamp = item["send_time"]
            .as_u64()
            .or_else(|| item["send_time"].as_str()?.parse().ok())
            .unwrap_or(0);
        let message_id = match item["message_id"].as_str().filter(|id| !id.is_empty()) {
            Some(id) => id.to_owned(),
            None if !event_id.is_empty() => format!("event:{event_id}:{index}"),
            None => continue,
        };
        messages.push(MeetingChat {
            source: "会中聊天",
            meeting_id: meeting.into(),
            event_id: event_id.into(),
            message_id,
            speaker_id: item["operator"]["id"].as_str().unwrap_or_default().into(),
            speaker_name: item["operator"]["user_name"]
                .as_str()
                .unwrap_or_default()
                .into(),
            text: text.into(),
            timestamp: if timestamp < 100_000_000_000 {
                timestamp * 1000
            } else {
                timestamp
            },
        });
    }
}

#[derive(Serialize)]
pub(crate) struct MeetingBatch {
    messages: Vec<MeetingChat>,
    ended: bool,
    event_count: usize,
}

#[tauri::command]
pub(crate) async fn feishu_meeting_events(
    window: WebviewWindow,
    user: State<'_, FeishuUser>,
    app_id: String,
    meeting_id: String,
    since: u64,
    until: u64,
    request_id: String,
) -> AppResult<MeetingBatch> {
    crate::commands::main_only(&window)?;
    let id = uuid::Uuid::parse_str(&request_id).map_err(|_| error("飞书读取请求 ID 无效"))?;
    window
        .state::<FeishuReads>()
        .run(id, async {
            let token = access(&window, &user, &app_id).await?;
            meeting_events(&token, meeting_id, since, until).await
        })
        .await
}

async fn meeting_events(
    token: &str,
    meeting_id: String,
    since: u64,
    until: u64,
) -> AppResult<MeetingBatch> {
    let client = client()?;
    let mut batch = MeetingBatch {
        messages: Vec::new(),
        ended: false,
        event_count: 0,
    };
    let mut page = String::new();
    let since = since.to_string();
    let until = until.to_string();
    for _ in 0..50 {
        let mut params = vec![
            ("meeting_id", meeting_id.as_str()),
            ("start_time", since.as_str()),
            ("end_time", until.as_str()),
            ("page_size", "20"),
            ("user_id_type", "open_id"),
        ];
        if !page.is_empty() {
            params.push(("page_token", &page));
        }
        let data = get(&client, "events", token, &params).await?;
        if let Some(events) = data["events"].as_array() {
            batch.event_count += events.len();
            for event in events {
                batch.ended |= matches!(
                    event["event_type"].as_str(),
                    Some("meeting_ended" | "meeting_end" | "vc.meeting.meeting_ended_v1")
                );
                parse_event(&meeting_id, event, &mut batch.messages);
            }
        }
        if data["has_more"] != true {
            batch.messages.sort_by_key(|message| message.timestamp);
            return Ok(batch);
        }
        page = data["page_token"]
            .as_str()
            .filter(|next| !next.is_empty() && *next != page)
            .ok_or_else(|| error("飞书会议事件分页游标无效"))?
            .to_owned();
    }
    Err(error("飞书会中事件积压超过读取上限，请重新连接"))
}

#[tauri::command]
pub(crate) async fn read_feishu_chat(
    window: WebviewWindow,
    user: State<'_, FeishuUser>,
    app_id: String,
    group_id: String,
    since: u64,
    until: u64,
    request_id: String,
) -> AppResult<Vec<crate::providers::FeishuChatMessage>> {
    crate::commands::main_only(&window)?;
    let id = uuid::Uuid::parse_str(&request_id).map_err(|_| error("飞书读取请求 ID 无效"))?;
    window
        .state::<FeishuReads>()
        .run(id, async {
            let token = access(&window, &user, &app_id).await?;
            crate::providers::feishu_chat_messages(&token, &group_id, since, until).await
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meeting_setting_errors_point_to_host_controls() {
        for (resource, code) in [("events", 120002), ("user_active_meeting", 121009)] {
            let hint = meeting_error_hint(resource, code, 403);
            assert!(hint.contains("AI 总结") && hint.contains("允许智能体加入会议"));
        }
        assert!(!meeting_error_hint("events", 99991672, 403).contains("AI 总结"));
        assert!(meeting_error_hint("events", 120003, 403).contains("账号加入"));
    }

    #[test]
    fn parses_object_and_string_payloads_with_stable_message_ids() {
        let payload = json!({"activity_event_type": "chat_received", "chat_received_items": [
            {"message_id": "msg-1", "send_time": "1700000000123", "content": "{\"text\":\"请问可以演示吗？\"}", "operator": {"id": "ou_example", "user_name": "测试者"}},
            {"send_time": "1700000000", "content": "补充问题"},
            {"send_time": "1700000000", "content": "{\"image_key\":\"example\"}"}
        ]});
        for payload in [payload.clone(), json!(payload.to_string())] {
            let mut messages = Vec::new();
            parse_event(
                "meeting-1",
                &json!({"event_id": "evt", "payload": payload}),
                &mut messages,
            );
            assert_eq!(messages.len(), 2);
            assert_eq!(messages[0].message_id, "msg-1");
            assert_eq!(messages[0].speaker_name, "测试者");
            assert_eq!(messages[0].timestamp, 1700000000123);
            assert_eq!(messages[1].message_id, "event:evt:1");
            assert_eq!(messages[1].timestamp, 1700000000000);
        }
    }

    #[tokio::test]
    async fn cancelling_login_releases_the_callback_port() {
        let reads = FeishuReads::default();
        let id = uuid::Uuid::new_v4();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let result = tokio::join!(reads.run(id, receive_code(listener, "old-state")), async {
            let sender = reads.0.lock().unwrap().remove(&id).unwrap();
            sender.send(()).unwrap();
        })
        .0;
        assert!(result.is_err());
        assert!(reads.0.lock().unwrap().is_empty());
        let rebound = tokio::net::TcpListener::bind(address).await.unwrap();
        let client = async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            for (state, status) in [("old-state", "400"), ("new-state", "200")] {
                let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
                stream
                    .write_all(
                        format!("GET /feishu/callback?state={state}&code=ok HTTP/1.1\r\n\r\n")
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).await.unwrap();
                assert!(response.starts_with(&format!("HTTP/1.1 {status}")));
            }
        };
        let (result, _) = tokio::join!(receive_code(rebound, "new-state"), client);
        assert_eq!(result.unwrap(), "ok");
    }
}

#[tauri::command]
pub(crate) async fn check_feishu_meeting_permission(
    window: WebviewWindow,
    user: State<'_, FeishuUser>,
    app_id: String,
) -> AppResult<bool> {
    crate::commands::main_only(&window)?;
    let result = async {
        let token = access(&window, &user, &app_id).await?;
        get(&client()?, "user_active_meeting", &token, &[]).await
    }
    .await;
    match result {
        Ok(_) => Ok(true),
        Err(AppError::FeishuUserAuthorization(_)) => Ok(false),
        Err(error) => Err(error),
    }
}
