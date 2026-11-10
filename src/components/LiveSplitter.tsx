import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

const panels = {
  vertical: {
    label: "调整演示区与观众问题的宽度",
    variable: "--live-left",
    initial: 2 / 3,
    minFirst: 310,
    minSecond: 244,
  },
  horizontal: {
    label: "调整预览与主讲控制台的高度",
    variable: "--live-top",
    initial: 2.6 / 3.6,
    minFirst: 250,
    minSecond: 178,
  },
};

export function LiveSplitter({
  orientation,
}: {
  orientation: keyof typeof panels;
}) {
  const spec = panels[orientation];
  const key = "vovis.live-layout." + orientation;
  const vertical = orientation === "vertical";
  const handle = useRef<HTMLDivElement>(null);
  const grab = useRef<{ pointer: number; offset: number } | null>(null);
  const [available, setAvailable] = useState(0);
  const [share, setShare] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved > 0 && saved < 1) return saved;
    } catch {
      /* Layout is still adjustable when storage is unavailable. */
    }
    return spec.initial;
  });

  useLayoutEffect(() => {
    const bar = handle.current!;
    const panel = bar.parentElement!;
    const measure = () =>
      setAvailable(
        vertical
          ? panel.clientWidth - bar.offsetWidth
          : panel.clientHeight - bar.offsetHeight,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      panel.style.removeProperty(spec.variable);
    };
  }, [vertical, spec]);

  const min = spec.minFirst;
  const max = Math.max(min, available - spec.minSecond);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const first = clamp(available * share);
  useLayoutEffect(() => {
    if (available > 0)
      handle.current?.parentElement?.style.setProperty(
        spec.variable,
        first + "px",
      );
  }, [available, first, spec]);

  function resize(size: number, save: boolean) {
    if (available <= 0) return;
    const next = clamp(size) / available;
    setShare(next);
    if (save) {
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* Session-only preference. */
      }
    }
  }

  function move(event: PointerEvent<HTMLDivElement>, save: boolean) {
    const drag = grab.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const rect = event.currentTarget.parentElement!.getBoundingClientRect();
    resize(
      (vertical ? event.clientX - rect.left : event.clientY - rect.top) -
        drag.offset,
      save,
    );
  }

  const percent = (size: number) =>
    available ? Math.round((100 * size) / available) : 0;
  return (
    <div
      ref={handle}
      className="live-splitter"
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={spec.label}
      title={spec.label}
      aria-valuemin={percent(min)}
      aria-valuemax={percent(max)}
      aria-valuenow={percent(first)}
      aria-valuetext={percent(first) + "%"}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const rect = event.currentTarget.getBoundingClientRect();
        grab.current = {
          pointer: event.pointerId,
          offset: vertical
            ? event.clientX - rect.left
            : event.clientY - rect.top,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => move(event, false)}
      onPointerUp={(event) => move(event, true)}
      onLostPointerCapture={() => {
        grab.current = null;
      }}
      onKeyDown={(event) => {
        const decrease = vertical ? "ArrowLeft" : "ArrowUp";
        const increase = vertical ? "ArrowRight" : "ArrowDown";
        const step = event.shiftKey ? 48 : 12;
        const sizes: Record<string, number> = {
          [decrease]: first - step,
          [increase]: first + step,
          Home: min,
          End: max,
        };
        if (!(event.key in sizes)) return;
        event.preventDefault();
        resize(sizes[event.key], true);
      }}
    />
  );
}
