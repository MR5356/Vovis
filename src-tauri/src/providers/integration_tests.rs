use super::*;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
};

struct Request {
    headers: String,
    body: Vec<u8>,
}

fn fixture(
    capability: &str,
    protocol: Option<Protocol>,
    reply: impl FnOnce(&mut TcpStream) + Send + 'static,
) -> (ConnectionConfig, thread::JoinHandle<Request>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(&mut socket);
        let mut headers = String::new();
        loop {
            let mut line = String::new();
            assert_ne!(reader.read_line(&mut line).unwrap(), 0);
            if line == "\r\n" {
                break;
            }
            headers.push_str(&line);
        }
        let size = headers
            .lines()
            .find_map(|line| {
                let (key, value) = line.split_once(':')?;
                key.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse().unwrap())
            })
            .unwrap();
        let mut body = vec![0; size];
        reader.read_exact(&mut body).unwrap();
        reply(&mut socket);
        Request { headers, body }
    });
    (
        ConnectionConfig {
            id: "saved-connection".into(),
            url: format!("http://{address}/custom/gateway/v1"),
            model: "my-model-alias".into(),
            capability: capability.into(),
            protocol,
            voice: Some("my-voice-alias".into()),
            audio_format: None,
            voice_encoding: None,
            voice_upload: None,
            asr_stream: None,
            input_audio_encoding: None,
        },
        server,
    )
}

fn response(socket: &mut TcpStream, status: &str, kind: &str, bytes: &[u8]) {
    write!(socket, "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).unwrap();
    socket.write_all(bytes).unwrap();
}

fn connect(config: ConnectionConfig) -> Provider {
    Provider::new(config, "test-only-key".into()).unwrap()
}

fn request_json(request: Request, path: &str) -> Value {
    assert!(request
        .headers
        .starts_with(&format!("POST /custom/gateway/v1/{path} ")));
    assert!(request
        .headers
        .to_lowercase()
        .contains("authorization: bearer test-only-key"));
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["model"], "my-model-alias");
    body
}

#[test]
fn legacy_llm_and_speech_use_saved_endpoint() {
    let (config, server) = fixture("LLM", None, |socket| {
        response(
            socket,
            "200 OK",
            "application/json",
            br#"{"choices":[{"message":{"content":"verified"}}],"usage":{"prompt_tokens":42,"completion_tokens":8,"total_tokens":50}}"#,
        );
    });
    let result = tauri::async_runtime::block_on(connect(config).complete(vec![Message {
        role: "user".into(),
        content: "test".into(),
    }]))
    .unwrap();
    assert_eq!(result.text, "verified");
    assert_eq!(result.usage.unwrap().total, Some(50));
    request_json(server.join().unwrap(), "chat/completions");

    let (config, server) = fixture("TTS", None, |socket| {
        response(socket, "200 OK", "audio/mpeg", b"ID3\x00\x00");
    });
    let mut packets = Vec::new();
    tauri::async_runtime::block_on(connect(config).speech("合成测试", "", false, |data| {
        packets.push(data);
        Ok(())
    }))
    .unwrap();
    assert_eq!(STANDARD.decode(&packets[0]).unwrap(), b"ID3\x00\x00");
    let body = request_json(server.join().unwrap(), "audio/speech");
    assert_eq!(body["voice"], "my-voice-alias");
    assert_eq!(body["response_format"], "mp3");
    assert_eq!(body["input"], "合成测试");
    assert!(body.get("speed").is_none());
}

#[test]
fn audio_speech_sends_the_configured_voice_format_without_rewriting_the_id() {
    for (encoding, expected) in [
        ("string", json!("studio:model:voice-7")),
        ("object", json!({"id": "studio:model:voice-7"})),
    ] {
        let (mut config, server) = fixture("TTS", Some(Protocol::AudioSpeech), |socket| {
            response(socket, "200 OK", "audio/mpeg", b"ID3\x00\x00");
        });
        config.voice_encoding = Some(encoding.into());
        tauri::async_runtime::block_on(connect(config).speech(
            "试听",
            "studio:model:voice-7",
            false,
            |_| Ok(()),
        ))
        .unwrap();
        assert_eq!(
            request_json(server.join().unwrap(), "audio/speech")["voice"],
            expected
        );
    }
}

#[test]
fn chat_speech_delivers_first_audio_before_server_finishes() {
    let (heard, first_packet) = mpsc::channel();
    let (config, server) = fixture("TTS", Some(Protocol::ChatAudioOutput), move |socket| {
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"test\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"audio\":{\"data\":\"AQ").unwrap();
        socket.write_all(b"\"}}}]}\n\n").unwrap();
        first_packet.recv_timeout(Duration::from_secs(3)).unwrap();
        socket
            .write_all(b"data: {\"choices\":[],\"usage\":{}}\n\ndata: [DONE]\n\n")
            .unwrap();
    });
    let mut packet = None;
    let (ms, _) = tauri::async_runtime::block_on(connect(config).speech(
        "合成测试",
        "override",
        false,
        |data| {
            packet = Some(data);
            heard.send(()).unwrap();
            Ok(())
        },
    ))
    .unwrap();
    println!("fixture chat audio first chunk: {ms} ms");
    assert_eq!(packet.as_deref(), Some("AQ"));
    let body = request_json(server.join().unwrap(), "chat/completions");
    assert_eq!(body["stream"], true);
    assert_eq!(body["audio"], json!({"voice":"override","format":"wav"}));
    assert_eq!(body["modalities"], json!(["text", "audio"]));
}

#[test]
fn transcription_protocols_submit_audio_and_parse_text() {
    let (config, server) = fixture("ASR", None, |socket| {
        response(
            socket,
            "200 OK",
            "application/json",
            br#"{"text":"multipart transcript"}"#,
        );
    });
    let bytes = b"RIFFtestWAVE".to_vec();
    let text =
        tauri::async_runtime::block_on(connect(config).transcribe(bytes.clone(), "wav")).unwrap();
    assert_eq!(text, "multipart transcript");
    let request = server.join().unwrap();
    assert!(request
        .headers
        .starts_with("POST /custom/gateway/v1/audio/transcriptions "));
    assert!(request
        .headers
        .to_lowercase()
        .contains("multipart/form-data"));
    let multipart = String::from_utf8(request.body).unwrap();
    assert!(multipart.contains("my-model-alias") && multipart.contains("RIFFtestWAVE"));

    let (mut config, server) = fixture("ASR", Some(Protocol::ChatAudioInput), |socket| {
        response(socket, "200 OK", "text/event-stream",
            b"data: {\"choices\":[{\"delta\":{\"content\":\"audio \"}}]}\n\ndata: {\"choices\":[]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"transcript\"}}]}\n\ndata: [DONE]\n\n");
    });
    config.input_audio_encoding = Some("data-url".into());
    let text =
        tauri::async_runtime::block_on(connect(config).transcribe(bytes.clone(), "wav")).unwrap();
    assert_eq!(text, "audio transcript");
    let body = request_json(server.join().unwrap(), "chat/completions");
    assert_eq!(body["modalities"], json!(["text"]));
    assert_eq!(body["stream"], true);
    assert_eq!(
        body["messages"][0]["content"][0]["input_audio"]["data"],
        format!("data:audio/wav;base64,{}", STANDARD.encode(bytes))
    );
}

#[test]
fn route_and_sse_errors_report_safe_diagnostics() {
    let (config, server) = fixture("TTS", Some(Protocol::AudioSpeech), |socket| {
        response(
            socket,
            "404 Not Found",
            "text/plain",
            b"Route Not Found private content",
        );
    });
    let error =
        tauri::async_runtime::block_on(connect(config).speech("test", "", false, |_| Ok(())))
            .unwrap_err()
            .to_string();
    assert!(error.contains("HTTP 404") && error.contains("/audio/speech"));
    assert!(!error.contains("private content"));
    server.join().unwrap();

    let (config, server) = fixture("TTS", Some(Protocol::ChatAudioOutput), |socket| {
        response(socket, "200 OK", "text/event-stream",
            b"event: error\ndata: {\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"private content\"}}\n\n");
    });
    let error =
        tauri::async_runtime::block_on(connect(config).speech("test", "", false, |_| Ok(())))
            .unwrap_err()
            .to_string();
    assert!(error.contains("流中错误") && error.contains("rate_limited"));
    assert!(!error.contains("private content"));
    server.join().unwrap();
}

#[test]
fn cancelling_an_active_stream_closes_http_body_without_waiting_for_done() {
    let (disconnected_tx, disconnected_rx) = mpsc::channel();
    let (config, server) = fixture("TTS", Some(Protocol::ChatAudioOutput), move |socket| {
        socket.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"audio\":{\"data\":\"AAA=\"}}}]}\n\n",
        ).unwrap();
        disconnected_tx
            .send(socket.read(&mut [0u8; 1]).unwrap() == 0)
            .unwrap();
    });
    tauri::async_runtime::block_on(async {
        let provider = connect(config);
        let (first_tx, first_rx) = tokio::sync::oneshot::channel();
        let mut first_tx = Some(first_tx);
        tokio::select! {
            result = provider.speech("test", "", false, |_| {
                if let Some(tx) = first_tx.take() { let _ = tx.send(()); }
                Ok(())
            }) => panic!("stream ended before cancellation: {result:?}"),
            result = first_rx => result.unwrap(),
        }
    });
    assert!(disconnected_rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap());
    server.join().unwrap();
}

#[test]
fn voice_creation_maps_fields_for_multipart_and_json_and_reads_the_returned_id() {
    for encoding in ["multipart", "data-url", "base64"] {
        let (mut config, server) = fixture("TTS", None, |socket| {
            response(
                socket,
                "201 Created",
                "application/json",
                br#"{"result":{"voice_id":"user:voice-42"}}"#,
            );
        });
        config.voice_upload = Some(serde_json::from_value(json!({
            "path":"voices/enroll", "encoding":encoding, "audioField":"sample",
            "nameField":"label", "modelField":"engine", "textField":"transcript", "idPointer":"/result/voice_id"
        })).unwrap());
        let id = tauri::async_runtime::block_on(connect(config).create_voice(
            b"sample-audio".to_vec(),
            "wav",
            "Presenter",
            "Example",
        ))
        .unwrap();
        assert_eq!(id, "user:voice-42");
        let request = server.join().unwrap();
        assert!(request
            .headers
            .starts_with("POST /custom/gateway/v1/voices/enroll "));
        assert!(request
            .headers
            .to_lowercase()
            .contains("authorization: bearer test-only-key"));
        if encoding == "multipart" {
            let body = String::from_utf8(request.body).unwrap();
            for field in ["sample", "label", "engine", "transcript"] {
                assert!(body.contains(&format!("name=\"{field}\"")));
            }
            for value in ["sample-audio", "Presenter", "my-model-alias", "Example"] {
                assert!(body.contains(value));
            }
        } else {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            assert_eq!(body["label"], "Presenter");
            assert_eq!(body["engine"], "my-model-alias");
            assert_eq!(body["transcript"], "Example");
            let encoded = STANDARD.encode(b"sample-audio");
            assert_eq!(
                body["sample"],
                if encoding == "data-url" {
                    format!("data:audio/wav;base64,{encoded}")
                } else {
                    encoded
                }
            );
        }
    }
}

#[test]
fn voice_creation_rejects_cross_origin_uploads_before_sending_audio_or_credentials() {
    let config = serde_json::from_value(json!({
        "id":"tts", "type":"TTS", "url":"https://example.com/v1", "model":"test",
        "voiceUpload":{"path":"//other.example.net/voice","encoding":"multipart","audioField":"sample","nameField":"","modelField":"","textField":"","idPointer":"/id"}
    })).unwrap();
    let err =
        tauri::async_runtime::block_on(connect(config).create_voice(vec![1], "wav", "name", ""))
            .unwrap_err();
    assert!(err.to_string().contains("同一服务地址"));
}

#[test]
fn narrated_chat_audio_checks_transcript_before_emitting_audio() {
    for (second, should_play) in [
        ("增长了 3.5 倍", true),
        ("增长了 35 倍", false),
        ("另一个问题", false),
    ] {
        let (config, server) = fixture("TTS", Some(Protocol::ChatAudioOutput), move |socket| {
            let mut body = String::new();
            for (data, transcript) in [("AQ", "本月"), ("AA", second)] {
                let event =
                    json!({"choices":[{"delta":{"audio":{"data":data,"transcript":transcript}}}]});
                body.push_str(&format!("data: {event}\n\n"));
            }
            body.push_str("data: [DONE]\n\n");
            response(socket, "200 OK", "text/event-stream", body.as_bytes());
        });
        let mut packets = Vec::new();
        let script = "本月，增长了 3.5 倍。";
        let result =
            tauri::async_runtime::block_on(connect(config).speech(script, "", true, |data| {
                packets.push(data);
                Ok(())
            }));
        let body = request_json(server.join().unwrap(), "chat/completions");
        assert_eq!(body["messages"][1]["content"], script);
        assert_eq!(result.is_ok(), should_play);
        assert_eq!(packets.len(), if should_play { 2 } else { 0 });
    }
}
