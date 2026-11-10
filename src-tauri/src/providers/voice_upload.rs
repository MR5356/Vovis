use super::{audio_mime, invalid, read_bytes, AppResult, Provider};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashSet;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum UploadEncoding {
    Multipart,
    Base64,
    DataUrl,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceUpload {
    path: String,
    encoding: UploadEncoding,
    audio_field: String,
    model_field: String,
    name_field: String,
    text_field: String,
    id_pointer: String,
}

impl Provider {
    pub async fn create_voice(
        &self,
        bytes: Vec<u8>,
        format: &str,
        name: &str,
        transcript: &str,
    ) -> AppResult<String> {
        if self.config.capability != "TTS" {
            return Err(invalid("请选择 TTS 连接"));
        }
        let upload = self
            .config
            .voice_upload
            .as_ref()
            .ok_or_else(|| invalid("请先配置音色创建接口"))?;
        let mime = audio_mime(format)?;
        if bytes.is_empty() || bytes.len() > 12 * 1024 * 1024 {
            return Err(invalid("请选择 12 MB 以内的录音"));
        }
        if name.trim().is_empty() {
            return Err(invalid("请填写音色名称"));
        }
        if !upload.text_field.trim().is_empty() && transcript.trim().is_empty() {
            return Err(invalid("请填写录音对应的文字"));
        }
        let path = upload.path.trim();
        if path.is_empty() || !upload.id_pointer.starts_with('/') {
            return Err(invalid("请填写创建接口路径和音色 ID 的 JSON Pointer"));
        }
        let url = self
            .base
            .join(path)
            .map_err(|_| invalid("音色创建接口地址无效"))?;
        if url.origin() != self.base.origin()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid(
                "音色创建接口须位于当前连接的同一服务地址，路径中不能包含凭据、查询参数或片段",
            ));
        }
        let audio_field = upload.audio_field.trim();
        let fields = [
            (upload.name_field.trim(), name.trim()),
            (upload.model_field.trim(), self.config.model.trim()),
            (upload.text_field.trim(), transcript.trim()),
        ];
        let keys = std::iter::once(audio_field).chain(
            fields
                .iter()
                .map(|(key, _)| *key)
                .filter(|key| !key.is_empty()),
        );
        let mut unique = HashSet::new();
        if audio_field.is_empty()
            || !keys
                .into_iter()
                .all(|k| !k.chars().any(char::is_control) && unique.insert(k))
        {
            return Err(invalid("请填写录音字段名，各字段名必须唯一且不含控制字符"));
        }
        let request = self.client.post(url.clone()).bearer_auth(&self.key);
        let fields = fields.into_iter().filter(|(key, _)| !key.is_empty());
        let request = match upload.encoding {
            UploadEncoding::Multipart => {
                let file = Part::bytes(bytes)
                    .file_name(format!("recording.{format}"))
                    .mime_str(mime)
                    .map_err(|_| invalid("音频类型无效"))?;
                let mut form = Form::new().part(audio_field.to_owned(), file);
                for (key, value) in fields {
                    form = form.text(key.to_owned(), value.to_owned());
                }
                request.multipart(form)
            }
            UploadEncoding::Base64 | UploadEncoding::DataUrl => {
                let mut body: Map<String, Value> = fields
                    .map(|(k, v)| (k.to_owned(), Value::from(v)))
                    .collect();
                let mut audio = STANDARD.encode(bytes);
                if matches!(upload.encoding, UploadEncoding::DataUrl) {
                    audio = format!("data:{mime};base64,{audio}");
                }
                body.insert(audio_field.to_owned(), Value::String(audio));
                request.json(&body)
            }
        };
        let response = self.send_at(request, url.path()).await?;
        let result: Value = serde_json::from_slice(&read_bytes(response, 1024 * 1024).await?)?;
        result
            .pointer(&upload.id_pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| {
                invalid(
                    "服务已响应，但指定位置没有音色 ID。请先在服务商控制台核对创建结果与返回字段",
                )
            })
    }
}
