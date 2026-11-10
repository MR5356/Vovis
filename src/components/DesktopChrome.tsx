import { isDesktop } from "../infrastructure/desktop";

/** Tauri handles dragging and double-click maximize/restore for this region. */
export function DesktopChrome() {
  if (!isDesktop) return null;
  return <div className="desktop-dragbar" data-tauri-drag-region />;
}
