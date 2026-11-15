//! Validate returned audio bytes and complete frames before delivery to the player.
use super::{invalid, ConnectionConfig, Protocol};
use crate::error::AppResult;
use base64::{engine::general_purpose::STANDARD, Engine};

const MAX_AUDIO_BYTES: usize = 36 * 1024 * 1024;

pub(super) fn validate(packets: &[String], config: &ConnectionConfig) -> AppResult<()> {
    let mut bytes = Vec::new();
    for packet in packets {
        // Each event is independently encoded, including its own padding.
        let chunk = STANDARD
            .decode(packet)
            .map_err(|_| invalid("语音数据编码无效"))?;
        if bytes.len() + chunk.len() > MAX_AUDIO_BYTES {
            return Err(invalid("音频超过大小限制"));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(invalid("音频为空"));
    }
    let streaming = config.protocol()? == Protocol::ChatAudioOutput;
    let format = if streaming {
        config
            .stream_encoding
            .as_deref()
            .or(config.audio_format.as_deref())
            .unwrap_or("wav")
    } else {
        config.audio_format.as_deref().unwrap_or("mp3")
    };
    match format {
        "mp3"
            if bytes.starts_with(b"ID3")
                || bytes
                    .get(0..2)
                    .is_some_and(|b| b[0] == 0xff && b[1] & 0xe0 == 0xe0) =>
        {
            Ok(())
        }
        "wav" => finalize_wave(bytes).map(|_| ()),
        "pcm16" => wrap_pcm16(bytes, config.sample_rate, config.channels).map(|_| ()),
        _ => Err(invalid("音频解码失败：响应与所选音频格式不符")),
    }
}

fn wrap_pcm16(pcm: Vec<u8>, rate: Option<u32>, channels: Option<u16>) -> AppResult<Vec<u8>> {
    let (Some(rate), Some(channels)) = (rate, channels) else {
        return Err(invalid("PCM16 缺少采样率或声道数"));
    };
    if !(8000..=192000).contains(&rate)
        || !(1..=8).contains(&channels)
        || pcm.len() % (channels as usize * 2) != 0
    {
        return Err(invalid("PCM16 采样格式或帧长度无效"));
    }
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
    wav.extend_from_slice(&(channels * 2).to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);
    Ok(wav)
}

fn finalize_wave(mut wav: Vec<u8>) -> AppResult<Vec<u8>> {
    if wav.len() < 12 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err(invalid("WAV 文件头无效"));
    }
    let mut cursor = 12;
    let mut block_align = None;
    while cursor + 8 <= wav.len() && cursor < 64 * 1024 {
        let size = u32::from_le_bytes(wav[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
        let start = cursor + 8;
        if &wav[cursor..cursor + 4] == b"data" {
            let align = block_align.ok_or_else(|| invalid("WAV 缺少采样格式"))?;
            let available = wav.len() - start;
            let length = if size == 0 || size == u32::MAX as usize {
                available
            } else {
                size
            };
            if length == 0 || length > available || align == 0 || length % align != 0 {
                return Err(invalid("WAV 采样帧不完整"));
            }
            // Streaming services often use zero/0xffffffff sizes. Validate actual
            // available frames rather than treating these placeholders as lengths.
            wav.truncate(start + length);
            wav[cursor + 4..cursor + 8].copy_from_slice(&(length as u32).to_le_bytes());
            if length % 2 != 0 {
                wav.push(0);
            }
            let riff_length = wav.len() as u32 - 8;
            wav[4..8].copy_from_slice(&riff_length.to_le_bytes());
            return Ok(wav);
        }
        let end = start
            .checked_add(size)
            .ok_or_else(|| invalid("WAV 分块长度无效"))?;
        if end > wav.len() {
            return Err(invalid("WAV 分块不完整"));
        }
        if &wav[cursor..cursor + 4] == b"fmt " {
            if size < 16 {
                return Err(invalid("WAV 采样格式不完整"));
            }
            block_align =
                Some(u16::from_le_bytes(wav[start + 12..start + 14].try_into().unwrap()) as usize);
        }
        cursor = end + size % 2;
    }
    Err(invalid("WAV 缺少音频数据"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(encoding: &str) -> ConnectionConfig {
        serde_json::from_value(serde_json::json!({
            "id":"test", "type":"TTS", "protocol":"chat-audio-output",
            "url":"http://127.0.0.1", "model":"model", "audioFormat":"wav",
            "streamEncoding":encoding, "sampleRate":24000, "channels":1
        }))
        .unwrap()
    }

    #[test]
    fn independently_decodes_padded_pcm_packets_and_writes_actual_wave_lengths() {
        let pcm = [0u8, 0, 1, 0, 2, 0];
        let packets = pcm
            .chunks(2)
            .map(|chunk| STANDARD.encode(chunk))
            .collect::<Vec<_>>();
        validate(&packets, &config("pcm16")).unwrap();
        let wav = wrap_pcm16(pcm.to_vec(), Some(24000), Some(1)).unwrap();
        assert_eq!(&wav[44..], pcm);
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 42);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 6);
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 24000);
    }

    #[test]
    fn finishes_unknown_wave_sizes_even_when_header_is_split_between_events() {
        for placeholder in [0u32, u32::MAX] {
            let mut wav = wrap_pcm16(vec![0, 0, 1, 0], Some(24000), Some(1)).unwrap();
            wav[4..8].copy_from_slice(&placeholder.to_le_bytes());
            wav[40..44].copy_from_slice(&placeholder.to_le_bytes());
            let packets = wav
                .chunks(7)
                .map(|chunk| STANDARD.encode(chunk))
                .collect::<Vec<_>>();
            validate(&packets, &config("wav")).unwrap();
            let fixed = finalize_wave(wav).unwrap();
            assert_eq!(u32::from_le_bytes(fixed[4..8].try_into().unwrap()), 40);
            assert_eq!(u32::from_le_bytes(fixed[40..44].try_into().unwrap()), 4);
            assert_eq!(&fixed[44..], &[0, 0, 1, 0]);
        }
    }

    #[test]
    fn rejects_missing_pcm_settings_and_incomplete_frames_before_delivery() {
        assert!(wrap_pcm16(vec![0, 0], None, Some(1)).is_err());
        assert!(wrap_pcm16(vec![0], Some(24000), Some(1)).is_err());
        let mut wav = wrap_pcm16(vec![0, 0], Some(24000), Some(1)).unwrap();
        wav.pop();
        assert!(finalize_wave(wav).is_err());
    }
}
