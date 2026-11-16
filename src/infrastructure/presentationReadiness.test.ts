import { expect, it, vi } from "vitest";
import { waitForPresentationPaint } from "./presentationReadiness";

class Visibility extends EventTarget {
  visibilityState = "visible";
  hide() {
    this.visibilityState = "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

it("does not wait for a suppressed animation frame in a hidden audience window", async () => {
  const visibility = new Visibility();
  visibility.hide();
  await waitForPresentationPaint(
    new Promise(() => {}),
    new AbortController().signal,
    visibility,
  );
});

it("releases an in-flight render when the audience window is minimized", async () => {
  const visibility = new Visibility();
  const done = vi.fn();
  const ready = waitForPresentationPaint(
    new Promise(() => {}),
    new AbortController().signal,
    visibility,
  ).then(done);
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  visibility.hide();
  await ready;
  expect(done).toHaveBeenCalledOnce();
});

it("waits for the actual render when visible and propagates render failures", async () => {
  const visibility = new Visibility();
  let paint!: () => void;
  const done = vi.fn();
  const rendered = new Promise<void>((resolve) => {
    paint = resolve;
  });
  const ready = waitForPresentationPaint(
    rendered,
    new AbortController().signal,
    visibility,
  ).then(done);
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  paint();
  await ready;
  expect(done).toHaveBeenCalledOnce();
  await expect(
    waitForPresentationPaint(
      Promise.reject(new Error("broken page")),
      new AbortController().signal,
      visibility,
    ),
  ).rejects.toThrow("broken page");
});

it("cancels obsolete page handshakes and removes visibility listeners", async () => {
  const visibility = new Visibility();
  const remove = vi.spyOn(visibility, "removeEventListener");
  const controller = new AbortController();
  const ready = waitForPresentationPaint(
    new Promise(() => {}),
    controller.signal,
    visibility,
  );
  controller.abort();
  await expect(ready).rejects.toMatchObject({ name: "AbortError" });
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  visibility.hide();
});
