//! SSE records can cross arbitrary HTTP chunk boundaries, including UTF-8 and CRLF.
use crate::error::{AppError, AppResult};
use serde_json::Value;

const MAX_EVENT: usize = 4 * 1024 * 1024;

pub(super) async fn read(
    mut response: reqwest::Response,
    mut event: impl FnMut(&Value) -> AppResult<bool>,
) -> AppResult<()> {
    let mut parser = Parser::default();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| invalid("流式响应中断"))?
    {
        if parser.push(&chunk, &mut event)? {
            return Ok(());
        }
    }
    // Some gateways terminate with EOF rather than [DONE].
    parser.push(b"\n\n", &mut event)?;
    Ok(())
}

#[derive(Default)]
struct Parser {
    line: Vec<u8>,
    data: Vec<u8>,
    error_event: bool,
}

impl Parser {
    fn push(
        &mut self,
        bytes: &[u8],
        event: &mut impl FnMut(&Value) -> AppResult<bool>,
    ) -> AppResult<bool> {
        for part in bytes.split_inclusive(|b| *b == b'\n') {
            if self.line.len() + self.data.len() + part.len() > MAX_EVENT {
                return Err(invalid("单个流事件超过大小限制"));
            }
            self.line.extend_from_slice(part);
            if !part.ends_with(b"\n") {
                continue;
            }
            let line = self.line.strip_suffix(b"\n").unwrap_or(&self.line);
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.is_empty() {
                if self.error_event {
                    return Err(super::stream_error(
                        &serde_json::from_slice(&self.data).unwrap_or(Value::Null),
                    ));
                }
                if self.data == b"[DONE]\n" {
                    return Ok(true);
                }
                if !self.data.is_empty() {
                    let value: Value = serde_json::from_slice(&self.data)
                        .map_err(|_| invalid("SSE 事件不是有效 JSON"))?;
                    if value.get("error").is_some_and(|error| !error.is_null()) {
                        return Err(super::stream_error(&value));
                    }
                    if event(&value)? {
                        return Ok(true);
                    }
                    self.data.clear();
                }
            } else if let Some(data) = line.strip_prefix(b"data:") {
                self.data
                    .extend_from_slice(data.strip_prefix(b" ").unwrap_or(data));
                self.data.push(b'\n');
            } else if let Some(kind) = line.strip_prefix(b"event:") {
                self.error_event = kind.strip_prefix(b" ").unwrap_or(kind) == b"error";
            }
            self.line.clear();
        }
        Ok(false)
    }
}

fn invalid(message: &str) -> AppError {
    AppError::Invalid(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_split_crlf_utf8_and_multiline_events() {
        let mut parser = Parser::default();
        let mut events = Vec::new();
        let mut done = false;
        for byte in "data: {\"text\":\r\ndata: \"你好\"}\r\n\r\ndata: [DONE]\n\n".bytes() {
            done |= parser
                .push(&[byte], &mut |v| {
                    events.push(v.clone());
                    Ok(false)
                })
                .unwrap();
        }
        assert!(done);
        assert_eq!(events, [serde_json::json!({"text":"你好"})]);
    }
}
