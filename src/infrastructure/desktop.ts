import { fileSelectionError } from "../domain/fileSelection";
import type { SessionUsage, TokenUsage } from "../domain/sessionUsage";
import { parseWorkspace } from "../domain/workspace";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export const isDesktop = isTauri();

let writeQueue: Promise<void> = Promise.resolve();

/** Keep the write revision paired with the snapshot this window actually loaded. */
export async function initializeWorkspace() {
  if (!isDesktop) {
    const key = "vovis-library-v2";
    let previous = localStorage.getItem(key);
    return {
      workspace:
        previous === null ? null : parseWorkspace(JSON.parse(previous)),
      async save(value: unknown) {
        if (localStorage.getItem(key) !== previous)
          throw new Error("工作区已在其他窗口更新，请重新加载");
        const next = JSON.stringify(value);
        localStorage.setItem(key, next);
        previous = next;
      },
    };
  }
  const loaded = await invoke<{ workspace: unknown; revision: string }>(
    "load_workspace",
  );
  if (typeof loaded?.revision !== "string")
    throw new Error("无法识别工作区版本");
  let revision = loaded.revision;
  return {
    workspace: parseWorkspace(loaded.workspace),
    async save(value: unknown) {
      const snapshot = parseWorkspace(value);
      const pending = writeQueue
        .catch(() => undefined)
        .then(async () => {
          revision = await invoke<string>("save_workspace", {
            workspace: snapshot,
            expectedRevision: revision,
          });
        });
      writeQueue = pending;
      await pending;
    },
  };
}

export type WorkspaceStore = Awaited<ReturnType<typeof initializeWorkspace>>;

export async function storeCredential(
  id: string,
  secret: string,
): Promise<void> {
  if (!isDesktop) throw new Error("真实凭据仅在桌面应用内配置");
  await invoke("save_credential", { id, secret });
}

export async function credentialExists(id: string): Promise<boolean> {
  return isDesktop && invoke<boolean>("has_credential", { id });
}

export type PresentationPayload = {
  revision: string;
  reload?: number;
  title: string;
  slide: { title: string; script: string; kind?: string };
  page: number;
  pdfAssetId: string;
};

export async function publishPresentation(
  payload: PresentationPayload,
): Promise<boolean> {
  return isDesktop && invoke<boolean>("update_presentation", { payload });
}

export async function completeText(
  config: import("../domain/workspace").Connection,
  messages: { role: string; content: string }[],
  usage?: SessionUsage,
): Promise<string> {
  await flushWorkspace();
  const report = usage?.submit(config);
  const result = await invoke<{ text: string; usage: TokenUsage | null }>(
    "complete_text",
    { connectionId: config.id, messages },
  );
  report?.(result.usage);
  return result.text;
}

export type SpeechEvent =
  | { kind: "audio"; data: string }
  | { kind: "done"; firstChunkMs: number; usage?: TokenUsage | null }
  | { kind: "error"; message: string };

export function streamSpeech(
  connectionId: string,
  text: string,
  voice: string,
  receive: (event: SpeechEvent) => void,
  fail: (error: unknown) => void,
  onSubmit?: () => void,
  verifyScript = false,
) {
  const requestId = crypto.randomUUID();
  const events = new Channel<SpeechEvent>();
  let cancelled = false;
  let started = false;
  const cancelNative = () => {
    void invoke("cancel_speech", { requestId }).catch(() => undefined);
  };
  events.onmessage = (event) => {
    if (!cancelled) receive(event);
  };
  void (async () => {
    await flushWorkspace();
    if (cancelled) return;
    onSubmit?.();
    await invoke("start_speech", {
      connectionId,
      requestId,
      verifyScript,
      text,
      voice,
      events,
    });
    started = true;
    if (cancelled) cancelNative();
  })().catch((error: unknown) => {
    if (!cancelled) fail(error);
  });
  return () => {
    if (cancelled) return;
    cancelled = true;
    events.onmessage = () => undefined;
    if (started) cancelNative();
  };
}

async function readRecording(file: File) {
  const error = fileSelectionError("audio", file);
  if (error) throw new Error(error);
  const format = file.name.split(".").pop()?.toLowerCase();
  const audio = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("无法读取音频文件"));
    reader.readAsDataURL(file);
  });
  return { format, audio };
}

export async function transcribeAudio(connectionId: string, file: File) {
  const recording = await readRecording(file);
  await flushWorkspace();
  return invoke<string>("transcribe_audio", { connectionId, ...recording });
}

export async function createCustomVoice(
  connectionId: string,
  file: File,
  name: string,
  transcript: string,
) {
  const recording = await readRecording(file);
  await flushWorkspace();
  return invoke<string>("create_custom_voice", {
    connectionId,
    ...recording,
    name,
    transcript,
  });
}

export async function testFeishuCredentials(appId: string): Promise<void> {
  return invoke("test_feishu_credentials", { appId });
}

export async function flushWorkspace(): Promise<void> {
  await writeQueue;
}

export function readFeishuChat(
  appId: string,
  groupId: string,
  since: number,
  until: number,
  requestId: string,
) {
  return invoke<{ id: string; text: string }[]>("read_feishu_chat", {
    appId,
    groupId,
    since,
    until,
    requestId,
  });
}

export function cancelFeishuRead(requestId: string) {
  void invoke("cancel_feishu_read", { requestId }).catch(() => undefined);
}
