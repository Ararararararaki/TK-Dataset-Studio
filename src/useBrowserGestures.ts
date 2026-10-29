import { useEffect, useRef, useState, type RefObject } from "react";

export type SelectionBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type SelectionTarget = SelectionBox & { id: string };

// The virtual browser supplies content-space geometry, including unmounted rows.
// This hook owns only the gesture; App remains the owner of the selected IDs.
export function useBrowserGestures({
  container,
  ready,
  scope,
  selection,
  onSelect,
  getTargets,
  onZoom,
}: {
  container: RefObject<HTMLDivElement | null>;
  ready: boolean;
  scope: string;
  selection: Set<string>;
  onSelect: (ids: Set<string>) => void;
  getTargets: (box: SelectionBox) => SelectionTarget[];
  onZoom: (delta: number) => void;
}) {
  const current = useRef({ selection, onSelect, getTargets, onZoom });
  current.current = { selection, onSelect, getTargets, onZoom };
  const [marquee, setMarquee] = useState<SelectionBox | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!ready || !el) return;
    let drag: {
      id: number;
      x: number;
      y: number;
      startX: number;
      startY: number;
      clientX: number;
      clientY: number;
      base: Set<string>;
      mode: "replace" | "add" | "toggle" | "remove";
      active: boolean;
      blank: boolean;
    } | null = null;
    let frame = 0,
      suppressClickUntil = 0,
      previous = "";
    const point = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(el.clientWidth, x - r.left)),
        y: Math.max(0, Math.min(el.clientHeight, y - r.top)) + el.scrollTop,
      };
    };
    const finish = (cancel = false) => {
      if (!drag) return;
      const last = drag;
      drag = null;
      cancelAnimationFrame(frame);
      if (el.hasPointerCapture(last.id)) el.releasePointerCapture(last.id);
      el.classList.remove("is-selecting");
      setMarquee(null);
      if (cancel) {
        if (last.active) current.current.onSelect(last.base);
      } else if (last.active) {
        // A zero-delay timer can run before Chromium dispatches the trailing
        // click. Clear on the next pointer-down instead, without eating it.
        suppressClickUntil = performance.now() + 150;
      } else if (last.blank && last.mode === "replace")
        current.current.onSelect(new Set());
    };
    const tick = () => {
      if (!drag?.active) return;
      const r = el.getBoundingClientRect();
      const edge = Math.min(42, el.clientHeight / 5);
      const y = drag.clientY - r.top;
      const speed =
        y < edge
          ? -Math.min(22, (edge - y) * 0.45)
          : y > el.clientHeight - edge
            ? Math.min(22, (y - el.clientHeight + edge) * 0.45)
            : 0;
      if (speed) el.scrollTop += speed;
      const end = point(drag.clientX, drag.clientY);
      const stamp = `${end.x}:${end.y}:${el.scrollTop}`;
      if (stamp !== previous) {
        previous = stamp;
        const box = {
          left: Math.min(drag.x, end.x),
          right: Math.max(drag.x, end.x),
          top: Math.min(drag.y, end.y),
          bottom: Math.max(drag.y, end.y),
        };
        const hits = current.current
          .getTargets(box)
          .filter(
            (t) =>
              t.right > box.left &&
              t.left < box.right &&
              t.bottom > box.top &&
              t.top < box.bottom,
          );
        const next =
          drag.mode === "replace" ? new Set<string>() : new Set(drag.base);
        for (const hit of hits) {
          if (
            drag.mode === "remove" ||
            (drag.mode === "toggle" && drag.base.has(hit.id))
          )
            next.delete(hit.id);
          else next.add(hit.id);
        }
        const before = current.current.selection;
        if (
          next.size !== before.size ||
          [...next].some((id) => !before.has(id))
        )
          current.current.onSelect(next);
        setMarquee({
          left: r.left + Math.max(0, box.left),
          right: r.left + Math.min(el.clientWidth, box.right),
          top: r.top + Math.max(0, box.top - el.scrollTop),
          bottom: r.top + Math.min(el.clientHeight, box.bottom - el.scrollTop),
        });
      }
      frame = requestAnimationFrame(tick);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary || drag) return;
      suppressClickUntil = 0;
      const target = e.target as Element;
      // Editable text and native image dragging keep their original behavior.
      if (
        target.closest(
          "button, input, textarea, select, a, label, img, [contenteditable=true], .annotation",
        )
      )
        return;
      const r = el.getBoundingClientRect();
      if (
        e.clientX >= r.left + el.clientWidth ||
        e.clientY >= r.top + el.clientHeight
      )
        return;
      const p = point(e.clientX, e.clientY);
      drag = {
        id: e.pointerId,
        x: p.x,
        y: p.y,
        startX: e.clientX,
        startY: e.clientY,
        clientX: e.clientX,
        clientY: e.clientY,
        base: new Set(current.current.selection),
        mode: e.altKey
          ? "remove"
          : e.ctrlKey || e.metaKey
            ? "toggle"
            : e.shiftKey
              ? "add"
              : "replace",
        active: false,
        blank: !target.closest("[data-image-id]"),
      };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag.clientX = e.clientX;
      drag.clientY = e.clientY;
      if (
        !drag.active &&
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= 5
      ) {
        drag.active = true;
        previous = "";
        el.classList.add("is-selecting");
        frame = requestAnimationFrame(tick);
      }
    };
    const up = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId) return;
      if (drag.active && e.type === "pointerup") {
        drag.clientX = e.clientX;
        drag.clientY = e.clientY;
        cancelAnimationFrame(frame);
        tick();
      }
      finish(e.type !== "pointerup");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag) {
        e.preventDefault();
        finish(true);
      }
    };
    const blur = () => finish(true);
    const click = (e: MouseEvent) => {
      if (e.detail > 0 && performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickUntil = 0;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (drag) finish(true);
      const pixels =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      current.current.onZoom(-Math.max(-120, Math.min(120, pixels)) / 600);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("click", click, true);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      finish(true);
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [container, ready, scope]);
  return marquee;
}
