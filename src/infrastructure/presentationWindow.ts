import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

// Keep the usual landscape width while allowing taller slides to use the screen height.
function presentationSize(ratio: number, maxWidth: number, maxHeight: number) {
  const width = Math.min(1280, maxWidth, maxHeight * ratio);
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(width / ratio)),
  };
}

export async function fitAudienceWindow(
  ratio: number,
  isCurrent: () => boolean,
) {
  const win = getCurrentWindow();
  const [monitor, inner, outer, position, scale, fullscreen, maximized] =
    await Promise.all([
      currentMonitor(),
      win.innerSize(),
      win.outerSize(),
      win.outerPosition(),
      win.scaleFactor(),
      win.isFullscreen(),
      win.isMaximized(),
    ]);
  if (!isCurrent() || fullscreen || maximized || !monitor) return;
  const work = monitor.workArea.size.toLogical(monitor.scaleFactor);
  // On macOS the native inner view can extend under the title bar,
  // while the WebKit layout viewport excludes that space.
  const insetWidth = Math.max(0, inner.width / scale - window.innerWidth);
  const insetHeight = Math.max(0, inner.height / scale - window.innerHeight);
  const maxWidth =
    work.width - (outer.width - inner.width) / scale - insetWidth;
  const maxHeight =
    work.height - (outer.height - inner.height) / scale - insetHeight;
  const size = presentationSize(ratio, maxWidth, maxHeight);
  const target = new LogicalSize(
    size.width + insetWidth,
    size.height + insetHeight,
  );
  const physical = target.toPhysical(scale);
  const area = monitor.workArea;
  const outerWidth = physical.width + outer.width - inner.width;
  const outerHeight = physical.height + outer.height - inner.height;
  const x = Math.max(
    area.position.x,
    Math.min(position.x, area.position.x + area.size.width - outerWidth),
  );
  const y = Math.max(
    area.position.y,
    Math.min(position.y, area.position.y + area.size.height - outerHeight),
  );
  await win.setSize(target);
  if (isCurrent() && (x !== position.x || y !== position.y)) {
    await win.setPosition(new PhysicalPosition(x, y));
  }
}

export function fitAudiencePopup(win: Window, ratio: number) {
  if (win.document.fullscreenElement) return;
  const frameWidth = Math.max(0, win.outerWidth - win.innerWidth);
  const frameHeight = Math.max(0, win.outerHeight - win.innerHeight);
  const size = presentationSize(
    ratio,
    win.screen.availWidth - frameWidth,
    win.screen.availHeight - frameHeight,
  );
  win.resizeTo(size.width + frameWidth, size.height + frameHeight);
}
