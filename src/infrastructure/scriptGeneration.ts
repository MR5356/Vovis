import type { Connection, Material, Slide } from "../domain/workspace";
import {
  reviseScriptMessage,
  scriptLength,
  scriptMessages,
  scriptWeights,
} from "../domain/prompts";
import {
  DEFAULT_LANGUAGE,
  languageProfile,
  type ProjectLanguage,
} from "../domain/language";

export interface ScriptGenerationInput {
  connection?: Connection;
  slides: Slide[];
  page: number;
  all: boolean;
  minutes: number;
  audience: string;
  tone: string;
  notes: string;
  materials: Material[];
  language?: ProjectLanguage;
}

export interface ScriptCheckpoint {
  sourceKey: string;
  nextPage: number;
}

export interface ScriptGenerationProgress {
  completed: number;
  page: number;
  attempt: number;
  phase: "generating" | "revising" | "retrying";
}

type Messages = { role: string; content: string }[];
type Complete = (connection: Connection, messages: Messages) => Promise<string>;

// An identity for resuming the same job, not a security or integrity checksum.
export function scriptGenerationKey(input: ScriptGenerationInput) {
  const value = JSON.stringify({
    version: 1,
    // Legacy checkpoints were all Chinese; preserve their key when adding the default.
    ...(input.language && input.language !== DEFAULT_LANGUAGE
      ? { language: input.language }
      : {}),
    connection: input.connection,
    slides: input.slides.map(({ title, sourceText }) => ({
      title,
      sourceText,
    })),
    minutes: input.minutes,
    audience: input.audience,
    tone: input.tone,
    notes: input.notes,
    materials: input.materials,
  });
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16);
}

export function resumePage(
  input: ScriptGenerationInput,
  checkpoint?: ScriptCheckpoint,
) {
  return input.all &&
    checkpoint?.sourceKey === scriptGenerationKey(input) &&
    checkpoint.nextPage > 0 &&
    checkpoint.nextPage < input.slides.length &&
    input.slides
      .slice(0, checkpoint.nextPage)
      .every((slide) => slide.script.trim())
    ? checkpoint.nextPage
    : 0;
}

function cancelled() {
  return new DOMException("已暂停生成", "AbortError");
}

function waitFor<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeout: number,
) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(cancelled()));
    const timer = setTimeout(
      () => finish(() => reject(new Error("生成请求超时"))),
      timeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function retryable(error: unknown) {
  return !/HTTP (?:400|401|403|404|405|413|415|422)\b|请先|请选择|请填写|未配置|鉴权|无权|模型不存在|消息无效/u.test(
    String(error),
  );
}

export async function generateScripts(
  input: ScriptGenerationInput,
  options: {
    complete: Complete;
    signal: AbortSignal;
    checkpoint?: ScriptCheckpoint;
    onProgress: (progress: ScriptGenerationProgress) => void;
    onCheckpoint: (scripts: string[], checkpoint?: ScriptCheckpoint) => void;
    timeoutMs?: number;
    retryDelayMs?: number;
  },
) {
  if (!input.connection) throw new Error("请先在全局模型服务中选择讲稿模型");
  const connection = input.connection;
  const start = resumePage(input, options.checkpoint);
  const sourceKey = scriptGenerationKey(input);
  const scripts = input.slides.map((slide) => slide.script);
  if (input.all && start === 0) options.onCheckpoint([...scripts], undefined);
  const language = languageProfile(input.language);
  const weights = scriptWeights(input.slides, input.language);
  let remaining = input.minutes * language.unitsPerMinute;
  let remainingWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (input.all) {
    for (let page = 0; page < start; page++) {
      remaining -= scriptLength(scripts[page], input.language);
      remainingWeight -= weights[page];
    }
  }
  const pages = input.all
    ? input.slides.map((_, page) => page).slice(start)
    : [input.page];
  let completed = start;
  for (const page of pages) {
    const target = Math.max(
      1,
      Math.round((remaining * weights[page]) / remainingWeight),
    );
    const messages = scriptMessages({
      ...input,
      page,
      target,
      previous: scripts[page - 1],
    });
    const request = async (
      messages: Messages,
      phase: "generating" | "revising",
    ) => {
      for (let attempt = 1; ; attempt++) {
        if (options.signal.aborted) throw cancelled();
        options.onProgress({ completed, page, attempt, phase });
        try {
          // The native provider has a 120 s request deadline. This also bounds IPC/storage stalls.
          const text = (
            await waitFor(
              options.complete(connection, messages),
              options.signal,
              options.timeoutMs ?? 130_000,
            )
          ).trim();
          if (!text) throw new Error(`第 ${page + 1} 页没有生成讲稿`);
          return text;
        } catch (error) {
          if (options.signal.aborted || attempt >= 3 || !retryable(error))
            throw error;
          options.onProgress({
            completed,
            page,
            attempt: attempt + 1,
            phase: "retrying",
          });
          await waitFor(
            new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                (options.retryDelayMs ?? 1000) * 2 ** (attempt - 1),
              ),
            ),
            options.signal,
            (options.retryDelayMs ?? 1000) * 2 ** (attempt - 1) + 1000,
          );
        }
      }
    };
    let script = await request(messages, "generating");
    const deviation = (value: string) =>
      Math.abs(scriptLength(value, input.language) - target);
    if (
      deviation(script) >
      Math.max(Math.round(language.unitsPerMinute * 0.16), target * 0.25)
    ) {
      try {
        const revised = await request(
          [
            ...messages,
            { role: "assistant", content: script },
            {
              role: "user",
              content: reviseScriptMessage(target, input.language),
            },
          ],
          "revising",
        );
        if (deviation(revised) < deviation(script)) script = revised;
      } catch (error) {
        if (options.signal.aborted) throw error;
        // A failed length adjustment must not discard a usable generated page.
      }
    }
    if (options.signal.aborted) throw cancelled();
    scripts[page] = script;
    remaining -= scriptLength(script, input.language);
    remainingWeight -= weights[page];
    completed++;
    options.onCheckpoint(
      [...scripts],
      input.all && page + 1 < scripts.length
        ? { sourceKey, nextPage: page + 1 }
        : undefined,
    );
    options.onProgress({ completed, page, attempt: 1, phase: "generating" });
  }
  return scripts;
}
