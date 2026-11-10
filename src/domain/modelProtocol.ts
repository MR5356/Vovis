export const protocolOptions = {
  LLM: [
    {
      id: "chat-completions",
      label: "OpenAI Chat Completions",
      path: "/chat/completions",
    },
  ],
  ASR: [
    {
      id: "audio-transcriptions",
      label: "OpenAI Audio Transcriptions",
      path: "/audio/transcriptions",
    },
    {
      id: "chat-audio-input",
      label: "Chat Completions 音频输入",
      path: "/chat/completions",
    },
  ],
  TTS: [
    { id: "audio-speech", label: "OpenAI Audio Speech", path: "/audio/speech" },
    {
      id: "chat-audio-output",
      label: "Chat Completions 音频输出（SSE）",
      path: "/chat/completions",
    },
  ],
} as const;

export function protocolsFor(type: string) {
  return type === "LLM" || type === "ASR" || type === "TTS"
    ? protocolOptions[type]
    : [];
}

export function protocolFor(connection: { type: string; protocol?: string }) {
  return connection.protocol ?? protocolsFor(connection.type)[0]?.id;
}

export function speechFormat(connection: {
  type: string;
  protocol?: string;
  audioFormat?: string;
}) {
  return (
    connection.audioFormat ??
    (protocolFor(connection) === "chat-audio-output" ? "wav" : "mp3")
  );
}
