import { isDesktop } from "../infrastructure/desktop";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { notify } from "../infrastructure/notifications";

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      void win
        .isMaximized()
        .then((value) => {
          if (alive) setMaximized(value);
        })
        .catch(console.error);
    };
    refresh();
    void win
      .onResized(refresh)
      .then((stop) => {
        if (alive) unlisten = stop;
        else stop();
      })
      .catch(console.error);
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  async function act(action: "minimize" | "toggleMaximize" | "close") {
    try {
      setError("");
      const win = getCurrentWindow();
      await win[action]();
      if (action === "toggleMaximize") setMaximized(await win.isMaximized());
    } catch (error) {
      console.error("窗口操作失败", error);
      setError("窗口操作失败，请重试");
      notify("窗口操作失败，请重试", "error");
    }
  }

  return (
    <>
      {!maximized && document.documentElement.dataset.platform === "linux" && (
        <div className="window-resize-handles" aria-hidden="true">
          {(
            [
              "North",
              "South",
              "East",
              "West",
              "NorthEast",
              "NorthWest",
              "SouthEast",
              "SouthWest",
            ] as const
          ).map((direction) => (
            <div
              key={direction}
              data-direction={direction}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                void getCurrentWindow()
                  .startResizeDragging(direction)
                  .catch(console.error);
              }}
            />
          ))}
        </div>
      )}
      <div className="window-controls" role="group" aria-label="窗口控制">
        <button
          type="button"
          aria-label="最小化"
          title="最小化"
          onClick={() => void act("minimize")}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "还原" : "最大化"}
          title={maximized ? "还原" : "最大化"}
          onClick={() => void act("toggleMaximize")}
        >
          {maximized ? (
            <Copy size={13} aria-hidden="true" />
          ) : (
            <Square size={13} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="关闭窗口"
          title="关闭窗口"
          onClick={() => void act("close")}
        >
          <X size={16} aria-hidden="true" />
        </button>
        {error && (
          <span className="window-control-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </>
  );
}

/** Tauri handles dragging and double-click maximize/restore for this region. */
export function DesktopChrome() {
  if (!isDesktop) return null;
  return (
    <>
      <div className="desktop-dragbar" data-tauri-drag-region />
      {document.documentElement.dataset.platform !== "macos" && (
        <WindowControls />
      )}
    </>
  );
}
