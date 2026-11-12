import type { Connection } from "../domain/workspace";

export interface RehearsalServices {
  speechReady: boolean;
  speechStatus: string;
  audioReady: boolean;
  audioStatus: string;
}

export async function checkRehearsalServices(
  input: { connection?: Connection; voice: string; offlineReady: boolean },
  services: {
    hasCredential: (id: string) => Promise<boolean>;
    unlockAudio: () => Promise<void>;
    timeoutMs?: number;
  },
): Promise<RehearsalServices> {
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("检查超时")),
            services.timeoutMs ?? 8000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const [speech, audio] = await Promise.all([
    (async () => {
      if (input.offlineReady)
        return {
          speechReady: true,
          speechStatus: "整场语音已缓存，可离线主讲",
        };
      if (!input.connection)
        return { speechReady: false, speechStatus: "缺少语音连接" };
      if (!input.voice.trim())
        return { speechReady: false, speechStatus: "缺少主讲音色" };
      try {
        const ready = await bounded(() =>
          services.hasCredential(input.connection!.id),
        );
        return {
          speechReady: ready,
          speechStatus: ready ? "在线语音已配置" : "缺少语音服务 API Key",
        };
      } catch {
        return {
          speechReady: false,
          speechStatus: "无法读取语音配置，请检查模型服务",
        };
      }
    })(),
    (async () => {
      try {
        await bounded(services.unlockAudio);
        return { audioReady: true, audioStatus: "本机音频输出就绪" };
      } catch {
        return {
          audioReady: false,
          audioStatus: "无法启动音频输出，请检查系统音频设备",
        };
      }
    })(),
  ]);
  return { ...speech, ...audio };
}
