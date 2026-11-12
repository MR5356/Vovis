import { afterEach, expect, it, vi } from "vitest";
import {
  synchronizePresentation,
  type PresentationStatus,
} from "./presentationSync";
import type { PresentationPayload } from "./desktop";

const payload: PresentationPayload = {
  revision: "page-2-attempt-1",
  title: "Talk",
  slide: { title: "Second", script: "Text" },
  page: 1,
  pdfAssetId: "pdf",
};

function setup(publish = vi.fn(async () => true)) {
  let receive = (_status: PresentationStatus) => {};
  const stop = vi.fn();
  const transport = {
    subscribe: vi.fn(async (callback: typeof receive) => {
      receive = callback;
      return stop;
    }),
    publish,
  };
  const controller = new AbortController();
  const sync = synchronizePresentation(payload, transport, controller.signal);
  return {
    sync,
    controller,
    transport,
    stop,
    receive: (status: PresentationStatus) => receive(status),
  };
}

afterEach(() => vi.useRealTimers());

it("ignores delayed acknowledgements from a different page or an earlier retry", async () => {
  const run = setup();
  const completed = vi.fn();
  void run.sync.then(completed);
  await Promise.resolve();
  run.receive({ state: "ready", revision: "page-1-attempt-1" });
  run.receive({ state: "ready", revision: "page-2-attempt-0" });
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  run.receive({ state: "ready", revision: payload.revision });
  await run.sync;
  expect(run.stop).toHaveBeenCalledOnce();
});

it("accepts a cached page acknowledgement before the publish IPC returns", async () => {
  let acknowledgePublish = (_value: boolean) => {};
  const run = setup(
    vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledgePublish = resolve;
        }),
    ),
  );
  await Promise.resolve();
  run.receive({ state: "ready", revision: payload.revision });
  await expect(run.sync).resolves.toBeUndefined();
  acknowledgePublish(true);
});

it("unblocks when the audience window closes during rendering", async () => {
  const run = setup();
  await Promise.resolve();
  run.receive({ state: "closed" });
  await expect(run.sync).resolves.toBeUndefined();
  expect(run.stop).toHaveBeenCalledOnce();
});

it("does not wait for an audience when no window exists", async () => {
  const run = setup(vi.fn(async () => false));
  await expect(run.sync).resolves.toBeUndefined();
  expect(run.stop).toHaveBeenCalledOnce();
});

it("reports render failures instead of leaving narration waiting", async () => {
  const run = setup();
  const result = expect(run.sync).rejects.toThrow("PDF damaged");
  await Promise.resolve();
  run.receive({
    state: "error",
    revision: payload.revision,
    message: "PDF damaged",
  });
  await result;
  expect(run.stop).toHaveBeenCalledOnce();
});

it("times out with a recoverable error if the window stops responding", async () => {
  vi.useFakeTimers();
  const run = setup();
  const result = expect(run.sync).rejects.toThrow("继续讲解");
  await vi.advanceTimersByTimeAsync(30_000);
  await result;
  expect(run.stop).toHaveBeenCalledOnce();
});

it("cleans up a listener that arrives after cancellation and never publishes stale content", async () => {
  const controller = new AbortController();
  const stop = vi.fn();
  let subscribed = (_stop: () => void) => {};
  const publish = vi.fn(async () => true);
  const sync = synchronizePresentation(
    payload,
    {
      subscribe: () =>
        new Promise((resolve) => {
          subscribed = resolve;
        }),
      publish,
    },
    controller.signal,
  );
  const result = expect(sync).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  subscribed(stop);
  await result;
  expect(stop).toHaveBeenCalledOnce();
  expect(publish).not.toHaveBeenCalled();
});

it("keeps a newer page waiting for an in-flight window creation after cancelling the old page", async () => {
  let opened = () => {};
  const opening = new Promise<void>((resolve) => {
    opened = resolve;
  });
  let receive = (_status: PresentationStatus) => {};
  const publish = vi.fn(async () => true);
  const transport = {
    subscribe: async (callback: typeof receive) => {
      receive = callback;
      return () => {};
    },
    open: () => opening,
    publish,
  };
  const previous = new AbortController();
  const old = synchronizePresentation(
    { ...payload, revision: "old" },
    transport,
    previous.signal,
  );
  const cancelled = expect(old).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  previous.abort();
  const current = synchronizePresentation(
    payload,
    transport,
    new AbortController().signal,
  );
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
  opened();
  await Promise.resolve();
  expect(publish).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledWith(payload);
  receive({ state: "ready", revision: payload.revision });
  await current;
  await cancelled;
});
