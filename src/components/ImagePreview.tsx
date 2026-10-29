import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FolderOpen, Maximize2, Minus, Plus, X } from "lucide-react";
import { api, imageUrl, type ImageDetail, type ImageRow } from "../api";
type Region = {
  label: string;
  caption: string;
  bbox: [number, number, number, number];
};
export default function ImagePreview({
  row,
  onClose,
}: {
  row: ImageRow;
  onClose: () => void;
}) {
  const [regions, setRegions] = useState<Region[]>([]),
    [boxes, setBoxes] = useState(true),
    [hover, setHover] = useState(-1);
  const stage = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);
  const pan = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  const fit = Math.min(bounds.width / row.width, bounds.height / row.height);
  const width = Math.max(1, row.width * fit),
    height = Math.max(1, row.height * fit);
  const apply = useCallback(
    (value: typeof transform) => {
      const maxX = Math.max(0, (width * value.zoom - bounds.width) / 2);
      const maxY = Math.max(0, (height * value.zoom - bounds.height) / 2);
      const next = {
        zoom: value.zoom,
        x: Math.max(-maxX, Math.min(maxX, value.x)),
        y: Math.max(-maxY, Math.min(maxY, value.y)),
      };
      transformRef.current = next;
      setTransform(next);
    },
    [width, height, bounds],
  );
  const zoom = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const r = stage.current?.getBoundingClientRect();
      if (!r) return;
      const before = transformRef.current;
      const next = Math.max(1, Math.min(8, before.zoom * factor));
      const x = clientX === undefined ? 0 : clientX - r.left - r.width / 2;
      const y = clientY === undefined ? 0 : clientY - r.top - r.height / 2;
      apply({
        zoom: next,
        x: x - ((x - before.x) * next) / before.zoom,
        y: y - ((y - before.y) * next) / before.zoom,
      });
    },
    [apply],
  );
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setBounds({
        width: Math.max(1, el.clientWidth - 36),
        height: Math.max(1, el.clientHeight - 36),
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    apply(transformRef.current);
  }, [apply]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? bounds.height : 1);
      zoom(
        Math.exp(-Math.max(-120, Math.min(120, delta)) / 500),
        e.clientX,
        e.clientY,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom, bounds.height]);
  useEffect(() => {
    let alive = true;
    setRegions([]);
    setHover(-1);
    transformRef.current = { zoom: 1, x: 0, y: 0 };
    setTransform(transformRef.current);
    void api<ImageDetail>("images.get", { id: row.id })
      .then((d) => {
        try {
          const layout = JSON.parse(d.text);
          if (
            alive &&
            layout.bbox_format === "yxyx" &&
            layout.bbox_coord_space === "abs_centralized"
          )
            setRegions(
              layout.items.filter(
                (r: Region) => Array.isArray(r.bbox) && r.bbox.length === 4,
              ),
            );
        } catch {}
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [row.id]);
  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <header>
        <span>
          {row.relative}{" "}
          <small>
            {row.width} × {row.height}
          </small>
        </span>
        <div>
          <div className="preview-zoom-control" aria-label="预览缩放">
            <button
              className="icon-button"
              aria-label="缩小预览"
              disabled={transform.zoom <= 1}
              onClick={() => zoom(1 / 1.25)}
            >
              <Minus size={15} />
            </button>
            <output aria-label="预览缩放比例" title="相对于适应窗口的大小">
              {Math.round(transform.zoom * 100)}%
            </output>
            <button
              className="icon-button"
              aria-label="放大预览图片"
              disabled={transform.zoom >= 8}
              onClick={() => zoom(1.25)}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label="适应窗口"
              onClick={() => apply({ zoom: 1, x: 0, y: 0 })}
            >
              <Maximize2 size={14} />
              适应
            </button>
          </div>
          {regions.length > 0 && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={boxes}
                onChange={(e) => setBoxes(e.target.checked)}
              />
              显示 Layout 区域（{regions.length}）
            </label>
          )}
          <button onClick={() => void window.studio.reveal(row.id)}>
            <FolderOpen size={15} />
            显示原文件
          </button>
          <button
            className="icon-button"
            aria-label="关闭预览"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div
        ref={stage}
        className={`preview-stage ${transform.zoom > 1 ? "can-pan" : ""}`}
        onDoubleClick={(e) => {
          e.preventDefault();
          apply({ zoom: 1, x: 0, y: 0 });
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && transform.zoom === 1) onClose();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || transform.zoom <= 1) return;
          e.preventDefault();
          pan.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            dx: transform.x,
            dy: transform.y,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add("is-panning");
        }}
        onPointerMove={(e) => {
          if (pan.current?.id !== e.pointerId) return;
          const p = pan.current;
          p.moved ||= Math.hypot(e.clientX - p.x, e.clientY - p.y) > 3;
          apply({
            zoom: transformRef.current.zoom,
            x: p.dx + e.clientX - p.x,
            y: p.dy + e.clientY - p.y,
          });
        }}
        onPointerUp={(e) => {
          if (pan.current?.id !== e.pointerId) return;
          pan.current = null;
          e.currentTarget.classList.remove("is-panning");
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pan.current = null;
          stage.current?.classList.remove("is-panning");
        }}
        onLostPointerCapture={() => {
          pan.current = null;
          stage.current?.classList.remove("is-panning");
        }}
      >
        <svg
          className="layout-preview"
          style={{
            width,
            height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
          }}
          viewBox={`0 0 ${row.width} ${row.height}`}
          onClick={(e) => e.stopPropagation()}
          role="img"
          aria-label={row.relative}
        >
          <image
            href={imageUrl(row.id, true)}
            width={row.width}
            height={row.height}
          />
          {boxes &&
            regions.map((r, i) => {
              const [t, l, b, rt] = r.bbox;
              const x = l + Math.floor(row.width / 2),
                y = t + Math.floor(row.height / 2);
              return (
                <g
                  key={i}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(-1)}
                >
                  <title>{`${i + 1}. ${r.caption}`}</title>
                  <rect
                    x={x}
                    y={y}
                    width={rt - l}
                    height={b - t}
                    fill={hover === i ? "#34d39938" : "#34d39908"}
                    stroke={hover === i ? "#ffbe59" : "#158b69"}
                    strokeWidth={hover === i ? 3 : 1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={x + 4}
                    y={Math.max(16, y + 16)}
                    fill="#fff"
                    stroke="#102c27"
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontSize={14}
                    fontWeight={600}
                  >
                    {i + 1} · {r.label}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
      <footer>
        {hover >= 0
          ? regions[hover].caption
          : regions.length
            ? "Ctrl＋滚轮缩放 · 放大后拖动查看 · 双击适应窗口 · 悬停框线核对对象 · Esc 关闭"
            : "Ctrl＋滚轮缩放 · 放大后拖动查看 · 双击适应窗口 · Esc 关闭"}
      </footer>
    </div>
  );
}
