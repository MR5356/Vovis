import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
type Renderer = ReturnType<
  typeof import("../infrastructure/avatarRenderer").createAvatarRenderer
>;
import { loadAvatar } from "../infrastructure/avatarAssets";
import { subscribeAvatarLevel } from "../infrastructure/avatarSpeech";
import { resolveAvatarId } from "../domain/avatar";

export function AvatarView({
  id: requestedId,
  demo = false,
  interactive = false,
  label = "主播形象",
}: {
  id: string;
  demo?: boolean;
  interactive?: boolean;
  label?: string;
}) {
  const id = resolveAvatarId(requestedId);
  const canvas = useRef<HTMLCanvasElement>(null);
  const activeRenderer = useRef<Renderer | undefined>(undefined);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const demoRef = useRef(demo);
  demoRef.current = demo;
  useEffect(() => {
    let alive = true,
      frame = 0,
      level = 0,
      receivedAt = 0;
    let renderer:
      | ReturnType<
          typeof import("../infrastructure/avatarRenderer").createAvatarRenderer
        >
      | undefined;
    pointer.current = null;
    setDragging(false);
    setError("");
    setLoading(true);
    const off = subscribeAvatarLevel((value) => {
      level = value;
      receivedAt = performance.now();
    });
    void (async () => {
      const api = await import("../infrastructure/avatarRenderer");
      const vrm = await api.parseAvatar(await loadAvatar(id));
      if (!alive) {
        api.disposeAvatar(vrm);
        return;
      }
      try {
        renderer = api.createAvatarRenderer(canvas.current!, vrm, {
          interactive,
          assetId: id,
        });
        activeRenderer.current = renderer;
      } catch (e) {
        api.disposeAvatar(vrm);
        throw e;
      }
      setLoading(false);
      const draw = (now: number) => {
        if (!alive || !canvas.current) return;
        const { width, height } = canvas.current.getBoundingClientRect();
        const mouth = demoRef.current
          ? Math.max(0, Math.sin(now * 0.012)) * 0.6
          : !interactive && now - receivedAt < 200
            ? level
            : 0;
        if (width && height) renderer!.render(now / 1000, mouth, width, height);
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    })().catch((e) => {
      if (alive) {
        setError(`形象加载失败：${String(e.message ?? e)}`);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      off();
      cancelAnimationFrame(frame);
      if (activeRenderer.current === renderer)
        activeRenderer.current = undefined;
      renderer?.dispose();
    };
  }, [id, interactive]);
  return (
    <div
      className={`avatar-view${interactive ? " avatar-view-interactive" : ""}`}
      role={interactive ? "group" : "img"}
      aria-label={label}
      data-dragging={dragging}
    >
      <canvas
        ref={canvas}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          interactive
            ? `${label}三维预览，拖动或方向键旋转，Home 键复位`
            : undefined
        }
        onPointerDown={
          interactive
            ? (event) => {
                if (event.button !== 0 || !activeRenderer.current) return;
                event.preventDefault();
                event.currentTarget.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                };
                setDragging(true);
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (event) => {
                const drag = pointer.current;
                if (!drag || drag.id !== event.pointerId) return;
                activeRenderer.current?.rotateBy(
                  event.clientX - drag.x,
                  event.clientY - drag.y,
                );
                drag.x = event.clientX;
                drag.y = event.clientY;
              }
            : undefined
        }
        onPointerUp={
          interactive
            ? (event) => {
                if (pointer.current?.id !== event.pointerId) return;
                pointer.current = null;
                setDragging(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }
            : undefined
        }
        onPointerCancel={
          interactive
            ? () => {
                pointer.current = null;
                setDragging(false);
              }
            : undefined
        }
        onLostPointerCapture={
          interactive
            ? () => {
                pointer.current = null;
                setDragging(false);
              }
            : undefined
        }
        onKeyDown={
          interactive
            ? (event) => {
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-16, 0],
                  ArrowRight: [16, 0],
                  ArrowUp: [0, -16],
                  ArrowDown: [0, 16],
                };
                if (moves[event.key]) {
                  event.preventDefault();
                  activeRenderer.current?.rotateBy(...moves[event.key]);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  activeRenderer.current?.resetView();
                }
              }
            : undefined
        }
      />
      {interactive && !loading && !error && (
        <div className="avatar-view-tools">
          <span>拖动旋转 · 方向键调整</span>
          <Button
            className="avatar-reset"
            variant="ghost"
            size="icon-sm"
            aria-label="复位视角"
            title="复位视角"
            onClick={() => activeRenderer.current?.resetView()}
          >
            <RotateCcw size={15} />
          </Button>
        </div>
      )}
      {loading && <span className="avatar-message">加载形象…</span>}
      {error && (
        <span role="alert" className="avatar-message">
          {error}
        </span>
      )}
    </div>
  );
}
