import { describe, it, expect } from "vitest";
import { parseWorkspace, sessionSchema, workspaceSchema } from "./workspace";
const fixture = () => ({
  projects: [
    {
      id: "p",
      data: {
        title: "Talk",
        audience: "Team",
        minutes: 15,
        tone: "自然",
        slides: [{ title: "A", script: "Original" }],
        page: 0,
        notes: "",
      },
      updatedAt: "2026-11-06",
      archived: false,
    },
  ],
  sessions: [],
  materials: [],
  connections: [],
  bindings: { script: "", qa: "", asr: "", tts: "" },
});
describe("workspace persistence contract", () => {
  it("accepts the legacy project shape and fills new optional fields", () => {
    const result = workspaceSchema.parse(fixture());
    expect(result.projects[0].data.materialIds).toEqual([]);
    expect(result.projects[0].data.pdfAssetId).toBe("");
    expect(result.projects[0].data.language).toBe("zh-CN");
  });
  it("preserves an English project and rejects unsupported language codes", () => {
    const value = fixture();
    const english = {
      ...value,
      projects: value.projects.map((project) => ({
        ...project,
        data: { ...project.data, language: "en-US" },
      })),
    };
    expect(parseWorkspace(english)?.projects[0].data.language).toBe("en-US");
    expect(() =>
      parseWorkspace({
        ...english,
        projects: english.projects.map((project) => ({
          ...project,
          data: { ...project.data, language: "invalid" },
        })),
      }),
    ).toThrow();
  });
  it("defaults legacy session recordings to Chinese", () => {
    const session = sessionSchema.parse({
      id: "session",
      projectId: "project",
      title: "Talk",
      startedAt: "now",
      duration: 1,
      events: [],
      slides: [{ title: "A", script: "Script" }],
      demo: false,
      mode: "本机主讲",
    });
    expect(session.language).toBe("zh-CN");
  });
  it("rejects an out-of-range page instead of replacing user data", () => {
    const value = fixture();
    value.projects[0].data.page = 3;
    expect(() => parseWorkspace(value)).toThrow();
  });
  it("retains resumable script generation progress when reopening saved projects", () => {
    const value = fixture();
    const checkpoint = { sourceKey: "same-generation-input", nextPage: 1 };
    const project = value.projects[0];
    const saved = {
      ...value,
      projects: [
        {
          ...project,
          data: {
            ...project.data,
            slides: [...project.data.slides, { title: "B", script: "" }],
            scriptGeneration: checkpoint,
          },
        },
      ],
    };
    const restored = parseWorkspace(JSON.parse(JSON.stringify(saved)))!;
    expect(restored.projects[0].data.scriptGeneration).toEqual(checkpoint);
    expect(restored.projects[0].data.slides[0].script).toBe("Original");
  });
  it("strips credentials from ordinary workspace configuration", () => {
    const input = {
      ...fixture(),
      feishu: {
        appId: "cli_test",
        transport: "long-connection",
        name: "obsolete",
        appSecret: "do-not-store",
      },
    };
    const result = parseWorkspace(input)!;
    expect(result.feishu).toEqual({
      appId: "cli_test",
      transport: "long-connection",
      demoCredential: false,
    });
    expect(JSON.stringify(result)).not.toContain("do-not-store");
  });
  it("migrates protocols while retaining IDs, configured voices and bindings", () => {
    const original = {
      id: "voice-1",
      type: "TTS",
      name: "My gateway",
      vendor: "Any label",
      url: "https://example.com/voice/v1",
      model: "my-alias",
      voice: "custom-id",
    };
    const input = {
      ...fixture(),
      connections: [original],
      bindings: { ...fixture().bindings, tts: original.id },
    };
    const migrated = parseWorkspace(input)!;
    expect(migrated.connections).toEqual([
      { ...original, protocol: "audio-speech" },
    ]);
    expect(migrated.bindings.tts).toBe(original.id);
    expect(parseWorkspace(migrated)).toEqual(migrated);
  });
  it("distinguishes a new workspace from a corrupted workspace", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(() => parseWorkspace({ projects: "broken" })).toThrow();
  });

  it("restores creation order when legacy saves moved edited connections", () => {
    const ids = ["1800000000002", "tts", "1800000000001", "llm", "asr"];
    const connections = ids.map((id) => ({
      id,
      type: "LLM",
      name: id,
      vendor: "",
      model: "",
      url: "",
    }));
    const restored = parseWorkspace({ ...fixture(), connections })!;
    expect(restored.connections.map((c) => c.id)).toEqual([
      "llm",
      "asr",
      "tts",
      "1800000000001",
      "1800000000002",
    ]);
    expect(parseWorkspace(restored)).toEqual(restored);
  });
});
