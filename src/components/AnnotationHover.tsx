import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { api, type ImageDetail, type ImageRow } from "../api";

type Target = { row: ImageRow; rect: DOMRect; key: string };
type Content = { target: Target; text: string; loading: boolean; error: boolean };

/** One lazy, bounded preview for the virtual grid; no model calls or eager caption downloads. */
export function useAnnotationHover() {
  const [content, setContent] = useState<Content | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, string>());
  const generation = useRef(0);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const hold = useCallback(() => clearTimeout(closeTimer.current), []);
  const hide = useCallback(() => {
    generation.current++;
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    setContent(null);
  }, []);
  const leave = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(hide, 180);
  }, [hide]);
  const show = useCallback((row: ImageRow, element: HTMLElement, tick: number) => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    const target = { row, rect: element.getBoundingClientRect(), key: `${row.id}:${row.revision}:${tick}` };
    const request = ++generation.current;
    setContent(null);
    openTimer.current = setTimeout(() => {
      setCopied(false);
      const saved = cache.current.get(target.key);
      setContent({ target, text: saved ?? "", loading: saved === undefined, error: false });
      if (saved !== undefined) return;
      void api<ImageDetail>("images.get", { id: row.id }).then((detail) => {
        if (request !== generation.current) return;
        cache.current.set(target.key, detail.text);
        if (cache.current.size > 128) cache.current.delete(cache.current.keys().next().value!);
        setContent({ target, text: detail.text, loading: false, error: false });
      }).catch(() => {
        if (request === generation.current) setContent({ target, text: "文本读取失败，移开后重试", loading: false, error: true });
      });
    }, 280);
  }, []);

  useLayoutEffect(() => {
    if (!content || !panel.current) return;
    const box = panel.current.getBoundingClientRect(), anchor = content.target.rect;
    const margin = 12, gap = 12, width = window.innerWidth, height = window.innerHeight;
    const right = anchor.right + gap, left = anchor.left - box.width - gap;
    let x = right + box.width <= width - margin ? right : left >= margin ? left : anchor.left;
    let y = anchor.top;
    if (right + box.width > width - margin && left < margin) {
      y = anchor.bottom + gap + box.height <= height - margin ? anchor.bottom + gap : anchor.top - box.height - gap;
    }
    x = Math.max(margin, Math.min(x, width - box.width - margin));
    y = Math.max(margin, Math.min(y, height - box.height - margin));
    setPosition({ left: x, top: y });
  }, [content]);

  useEffect(() => {
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      hide();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) hide();
    };
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      generation.current++;
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [hide]);

  const preview = content ? createPortal(
    <div ref={panel} id={id} role="dialog" aria-label="打标文本预览" className="annotation-hover" style={position}
      onPointerEnter={hold} onPointerLeave={leave} onFocus={hold}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}>
      <div className="annotation-hover-heading">
        <strong>{content.target.row.relative}</strong>
        <button className="icon-button" aria-label="关闭文本预览" onClick={hide}><X size={14} /></button>
      </div>
      <div className={`annotation-hover-text ${content.error ? "error" : ""}`} tabIndex={0}>
        {content.loading ? "读取中…" : content.text || "暂无打标文本"}
      </div>
      <footer><span>{content.loading ? "" : `${content.text.length.toLocaleString()} 字符`}</span>
        <button disabled={content.loading || content.error || !content.text} onClick={() => {
          void navigator.clipboard.writeText(content.text).then(() => setCopied(true)).catch(() => setCopied(false));
        }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "已复制" : "复制文本"}</button>
      </footer>
    </div>, document.body,
  ) : null;
  return { show, leave, hide, preview, activeId: content?.target.row.id, descriptionId: id };
}
