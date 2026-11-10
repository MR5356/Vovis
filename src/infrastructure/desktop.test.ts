import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
const workspace = {
  projects: [],
  sessions: [],
  materials: [],
  connections: [],
  bindings: { script: "", qa: "", asr: "", tts: "" },
};
beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
});
describe("native persistence bridge", () => {
  it("does not expose invalid native data to React", async () => {
    mocks.invoke.mockResolvedValue({
      workspace: { projects: "invalid" },
      revision: "test",
    });
    const { initializeWorkspace } = await import("./desktop");
    await expect(initializeWorkspace()).rejects.toThrow();
  });
  it("serializes snapshots and resumes after a failed write", async () => {
    let rejectFirst: (e: Error) => void = () => {};
    mocks.invoke
      .mockResolvedValueOnce({ workspace, revision: "initial" })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const { initializeWorkspace } = await import("./desktop");
    const { save: persistWorkspace } = await initializeWorkspace();
    const first = persistWorkspace(workspace);
    const handled = first.catch(() => undefined);
    const second = persistWorkspace({
      ...workspace,
      materials: [{ id: "m", title: "newer", content: "", updatedAt: "now" }],
    });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    rejectFirst(new Error("disk unavailable"));
    await handled;
    await second;
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.invoke.mock.calls[2][1].expectedRevision).toBe("initial");
    expect(mocks.invoke.mock.calls[2][1].workspace.materials[0].title).toBe(
      "newer",
    );
  });
  it("never retrieves a credential value into the renderer", async () => {
    mocks.invoke.mockResolvedValue(true);
    const { credentialExists } = await import("./desktop");
    await expect(credentialExists("llm")).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("has_credential", { id: "llm" });
  });
});

it("cancels a registered speech request even if stop precedes IPC acknowledgement", async () => {
  let acknowledge = () => {};
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "start_speech")
      return new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
    return Promise.resolve();
  });
  const { streamSpeech } = await import("./desktop");
  const receive = vi.fn();
  const stop = streamSpeech("voice", "test", "alias", receive, vi.fn());
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
  const payload = mocks.invoke.mock.calls[0][1];
  stop();
  payload.events.onmessage({ kind: "audio", data: "AAAA" });
  expect(receive).not.toHaveBeenCalled();
  acknowledge();
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_speech", {
      requestId: payload.requestId,
    }),
  );
});
