import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
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
  useEffect(() => {
    let alive = true;
    void api<ImageDetail>("images.get", { id: row.id }).then((d) => {
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
    });
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
      <div onClick={onClose} className="preview-stage">
        <svg
          className="layout-preview"
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
            ? "悬停框线核对对象 · 坐标由原图像素确定 · Esc 关闭"
            : "原图完整预览 · 从列表可直接拖出原图 · Esc 关闭"}
      </footer>
    </div>
  );
}
