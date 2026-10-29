import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Expand,
  FolderOpen,
  History,
  LoaderCircle,
  RotateCcw,
  Tag,
  ExternalLink,
} from "lucide-react";
import {
  api,
  imageUrl,
  statusName,
  type ImageDetail,
  type ImageRow,
} from "../api";
import { clearDraft, keepDraft, readDraft, registerWriter } from "../drafts";

export default function ImageEntry({
  row,
  tick,
  selected,
  onSelect,
  onPreview,
  onRetag,
  onError,
  onOutputResize,
  outputHeight,
  warning,
}: {
  row: ImageRow;
  tick: number;
  selected: boolean;
  onSelect: (id: string, range: boolean) => void;
  onPreview: (row: ImageRow) => void;
  onRetag: (id: string) => void;
  onError: (e: unknown) => void;
  onOutputResize: (n: number) => void;
  outputHeight: number;
  warning: number;
}) {
  const [detail, setDetail] = useState<ImageDetail>();
  const [text, setText] = useState("");
  const [state, setState] = useState("");
  const [rawOpen, setRawOpen] = useState(true);
  const [history, setHistory] = useState<
    { id: number; text: string; reason: string; created: number }[] | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ text: "", revision: row.revision });
  const dirty = useRef(false);
  const saving = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      if (dirty.current && !saving.current) {
        const value = latest.current;
        void api("images.save", {
          id: row.id,
          text: value.text,
          revision: value.revision,
          format: row.format,
        }).catch(onError);
      }
    };
  }, [row.id]);
  useEffect(
    () =>
      registerWriter(row.id, async () => {
        await inflight.current;
        while (dirty.current) await saveRef.current();
      }),
    [row.id],
  );
  useEffect(() => {
    let live = true;
    void api<ImageDetail>("images.get", { id: row.id })
      .then((d) => {
        if (!live) return;
        setDetail(d);
        if (!dirty.current) {
          const recovered = readDraft(row.id);
          if (recovered && recovered.text !== d.text) {
            setText(recovered.text);
            latest.current = recovered;
            dirty.current = true;
            setState(
              recovered.revision === d.revision
                ? "已恢复未保存草稿"
                : "已恢复草稿，原标注有更新；请复制草稿并核对",
            );
          } else {
            if (recovered) clearDraft(row.id, recovered.text);
            setText(d.text);
            latest.current = { text: d.text, revision: d.revision };
          }
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [row.id, tick, row.revision]);
  async function save() {
    if (!dirty.current) return;
    if (saving.current) {
      await inflight.current;
      return;
    }
    saving.current = true;
    clearTimeout(timer.current);
    const value = { ...latest.current };
    setState("保存中");
    try {
      const pending = api<ImageDetail>("images.save", {
        id: row.id,
        text: value.text,
        revision: value.revision,
        format: detail?.format || "manual",
      });
      inflight.current = pending.then(
        () => {},
        () => {},
      );
      const d = await pending;
      latest.current.revision = d.revision;
      if (latest.current.text === value.text) {
        dirty.current = false;
        clearDraft(row.id, value.text);
      } else keepDraft(row.id, latest.current);
      if (mounted.current) {
        setDetail(d);
        setState("已自动保存");
      }
    } catch (e) {
      if (mounted.current) setState("保存失败");
      onError(e);
      throw e;
    } finally {
      saving.current = false;
      inflight.current = null;
      if (dirty.current && latest.current.text !== value.text) {
        timer.current = setTimeout(() => void save().catch(() => {}), 100);
      }
    }
  }
  saveRef.current = save;
  function change(value: string) {
    dirty.current = true;
    latest.current.text = value;
    keepDraft(row.id, latest.current);
    setText(value);
    setState("编辑中");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(() => {}), 800);
  }
  return (
    <article
      className={`image-entry ${selected ? "selected" : ""}`}
      data-image-id={row.id}
    >
      <header className="entry-header">
        <button
          className={`check-button ${selected ? "checked" : ""}`}
          aria-label={`选择 ${row.relative}`}
          aria-pressed={selected}
          onClick={(e) => onSelect(row.id, e.shiftKey)}
        >
          {selected && <Check size={13} />}
        </button>
        <span className="filename" title={row.relative}>
          {row.relative}
        </span>
        <span className="resolution">
          {row.width} × {row.height}
        </span>
        <span className={`status ${row.status}`}>
          {row.status === "running" && (
            <LoaderCircle size={12} className="spin" />
          )}
          {statusName[row.status] || row.status}
        </span>
      </header>
      <div className="entry-body">
        <div className="picture-wrap">
          <img
            src={imageUrl(row.id)}
            alt={row.relative}
            loading="lazy"
            draggable
            onDragStart={(e) => {
              e.preventDefault();
              window.studio.startDrag(row.id);
            }}
            onClick={() => onPreview(row)}
          />
          <button
            className="preview-button icon-button"
            aria-label="放大预览"
            onClick={() => onPreview(row)}
          >
            <Expand size={16} />
          </button>
          <span className="image-hint">点击放大 · 可拖出原图</span>
        </div>
        <div className="annotation">
          <div className="annotation-heading">
            <span>
              <Tag size={14} />
              最终打标文本
            </span>
            <div>
              <button
                className="icon-button"
                title="重新打标"
                aria-label="重新打标"
                onClick={() => onRetag(row.id)}
              >
                <RotateCcw size={14} />
              </button>
              <button
                className="icon-button"
                title="复制文本"
                aria-label="复制文本"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => setState("已复制"))
                    .catch(onError)
                }
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button"
                title="历史版本"
                aria-label="历史版本"
                onClick={() =>
                  void api<typeof history>("images.history", { id: row.id })
                    .then(setHistory)
                    .catch(onError)
                }
              >
                <History size={14} />
              </button>
              <button
                className="icon-button"
                title="在文件夹中显示"
                aria-label="在文件夹中显示"
                onClick={() => void window.studio.reveal(row.id)}
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>
          <textarea
            className="output-editor"
            aria-label={`${row.relative} 打标文本`}
            value={text}
            onChange={(e) => change(e.target.value)}
            onBlur={() => void save().catch(() => {})}
            onPointerUp={(e) => onOutputResize(e.currentTarget.offsetHeight)}
            style={{ height: outputHeight }}
            placeholder={
              row.status === "running"
                ? "正在识别原图，结果会自动显示在这里…"
                : "打标结果会显示在这里，也可以直接输入。修改后自动保存同名 TXT。"
            }
          />
          <div className="editor-footer">
            <span className={state === "保存失败" ? "danger" : ""}>
              {state || "UTF-8 · 同名 TXT"}
            </span>
            <span className={text.length > warning ? "warning" : ""}>
              {text.length.toLocaleString()} 字符
              {text.length > warning ? " · 超出提醒值，完整保留" : ""}
            </span>
          </div>
          {row.error && <div className="inline-error">{row.error}</div>}
          <details
            className="raw-tags"
            open={rawOpen}
            onToggle={(e) => setRawOpen(e.currentTarget.open)}
          >
            <summary>
              WD14 原始标签 <span>{detail?.raw.tags?.length || 0}</span>
              {detail?.raw.model && <small>{detail.raw.model}</small>}
            </summary>
            <div className="tag-chips">
              {detail?.raw.tags?.map((tag) => (
                <span
                  className={
                    detail.raw.characters?.includes(tag) ? "character" : ""
                  }
                  key={tag}
                  title={`置信度 ${Math.round((detail.raw.scores?.[tag] || 0) * 100)}%`}
                >
                  {tag.replaceAll("_", " ")}
                </span>
              ))}
              {!detail?.raw.tags?.length && (
                <p className="muted">尚未运行 WD14</p>
              )}
            </div>
          </details>
          {detail?.native.webUrl && (
            <a
              className="native-link"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void window.studio.openExternal(detail.native.webUrl!);
              }}
            >
              <ExternalLink size={12} />
              查看 DSH 原生运行
              {detail.native.model ? " · " + detail.native.model : ""}
            </a>
          )}
        </div>
      </div>
      {history && (
        <div className="history-inline">
          <div>
            <strong>历史版本</strong>
            <button onClick={() => setHistory(null)}>收起</button>
          </div>
          {history.length === 0 ? (
            <p>尚无历史版本</p>
          ) : (
            history.map((h) => (
              <section key={h.id}>
                <span>
                  {new Date(h.created * 1000).toLocaleString()} · {h.reason}
                </span>
                <pre>{h.text || "（空文本）"}</pre>
                <button
                  onClick={() => {
                    change(h.text);
                    setHistory(null);
                  }}
                >
                  恢复到编辑框
                </button>
              </section>
            ))
          )}
        </div>
      )}
    </article>
  );
}
