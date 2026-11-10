import type { SessionUsage } from "../domain/sessionUsage";
import type { Connection } from "../domain/workspace";
import { streamSpeech, type SpeechEvent } from "./desktop";

function prepareSpeech(
  connection: Connection,
  voice: string,
  text: string,
  usage?: SessionUsage,
) {
  const events: SpeechEvent[] = [];
  let listener: ((event: SpeechEvent) => void) | undefined;
  let submitted = false;
  let failed = false;
  let onSubmit: (() => void) | undefined;
  let report: ReturnType<SessionUsage["submit"]> | undefined;
  function receive(event: SpeechEvent) {
    if (event.kind === "error") failed = true;
    if (event.kind === "done") report?.(event.usage);
    if (listener) listener(event);
    else events.push(event);
  }
  const cancel = streamSpeech(
    connection.id,
    text,
    voice,
    receive,
    (error) => receive({ kind: "error", message: String(error) }),
    () => {
      submitted = true;
      if (usage) report = usage.submit(connection, Array.from(text).length);
      else onSubmit?.();
    },
    true,
  );
  return {
    cancel,
    get failed() {
      return failed;
    },
    listen(callback: (event: SpeechEvent) => void, count: () => void) {
      // An opening prepared during rehearsal is attributed when used in a session.
      if (!usage) {
        onSubmit = count;
        if (submitted) count();
      }
      listener = callback;
      for (const event of events.splice(0)) callback(event);
      return cancel;
    },
  };
}
export type PreparedSpeech = ReturnType<typeof prepareSpeech>;

export function createNarrationBuffer(connection: Connection, voice: string) {
  const queued = new Map<string, PreparedSpeech>();
  function retain(texts: string[]) {
    for (const [text, request] of queued) {
      if (!texts.includes(text)) {
        request.cancel();
        queued.delete(text);
      }
    }
  }
  function keep(texts: string[], usage?: SessionUsage) {
    retain(texts);
    for (const text of texts) {
      if (text && !queued.has(text))
        queued.set(text, prepareSpeech(connection, voice, text, usage));
    }
  }
  return {
    keep,
    retain,
    take(text: string) {
      const request = queued.get(text);
      queued.delete(text);
      return request?.failed ? undefined : request;
    },
    clear: () => keep([]),
  };
}
export type NarrationBuffer = ReturnType<typeof createNarrationBuffer>;
