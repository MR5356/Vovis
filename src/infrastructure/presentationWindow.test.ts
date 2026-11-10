import { afterEach, expect, it, vi } from "vitest";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { fitAudienceWindow } from "./presentationWindow";

const { monitor, win } = vi.hoisted(() => ({
  monitor: vi.fn(),
  win: {
    innerSize: vi.fn(),
    outerSize: vi.fn(),
    outerPosition: vi.fn(),
    scaleFactor: vi.fn(),
    isFullscreen: vi.fn(),
    isMaximized: vi.fn(),
    setSize: vi.fn(),
    setPosition: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: monitor,
  getCurrentWindow: () => win,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("fits a portrait page inside a Retina display's work area including the WebKit title-bar inset", async () => {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
  monitor.mockResolvedValue({
    scaleFactor: 2,
    workArea: {
      size: new PhysicalSize(3600, 2186),
      position: { x: -3600, y: 78 },
    },
  });
  win.scaleFactor.mockResolvedValue(2);
  win.innerSize.mockResolvedValue(new PhysicalSize(2560, 1504));
  win.outerSize.mockResolvedValue(new PhysicalSize(2560, 1504));
  win.outerPosition.mockResolvedValue({ x: -3000, y: 260 });
  await fitAudienceWindow(9 / 16, () => true);
  expect(win.setSize).toHaveBeenCalledWith(
    expect.objectContaining({ width: 597, height: 1093 }),
  );
  expect(win.setPosition).toHaveBeenCalledWith(
    expect.objectContaining({ x: -3000, y: 78 }),
  );
});
