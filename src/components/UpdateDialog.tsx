import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  DownloadCloud,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { UpdateState } from "../api";

const formatBytes = (value: number) => {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const statusLabel: Record<string, string> = {
  idle: "尚未检查",
  checking: "正在检查",
  current: "已是最新",
  available: "有新版本",
  skipped: "已跳过该版本",
  downloading: "正在下载",
  ready: "可以安装",
  applying: "正在安装",
  error: "检查失败",
};

export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let live = true;
    window.studio.update
      .state()
      .then((next) => {
        if (live) setState(next);
      })
      .catch(() => {});
    const stop = window.studio.update.onState((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<UpdateState>) => {
      setBusy(true);
      setFailure("");
      try {
        setState(await action());
      } catch (error) {
        setFailure(String(error instanceof Error ? error.message : error));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const status = state?.status || "idle";
  const percent = state?.progress?.percent || 0;
  const newer = Boolean(state?.latest) && state?.latest !== state?.current;
  const notes = useMemo(() => {
    const text = (state?.notes || "").trim();
    if (!text) return "";
    // Keep the release body readable without a markdown dependency: strip the
    // heading, emphasis, code and link syntax GitHub renders, then trim.
    return text
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "· ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 4000);
  }, [state?.notes]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && status !== "downloading") onClose();
      }}
    >
      <section
        className="settings-modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-label="软件更新"
      >
        <header>
          <div>
            <h2>软件更新</h2>
            <p>从 GitHub Releases 检查、下载并就地替换便携版。</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭更新面板"
            onClick={onClose}
            disabled={status === "applying"}
          >
            <X size={15} />
          </button>
        </header>

        <main>
          <div className="update-versions">
            <div>
              <small>当前版本</small>
              <strong>{state?.current || "—"}</strong>
            </div>
            <div className="update-arrow">
              {newer ? <ArrowDownToLine size={15} /> : <CheckCircle2 size={15} />}
            </div>
            <div>
              <small>最新版本</small>
              <strong>{state?.latest || "—"}</strong>
            </div>
            <span className={`update-badge is-${status}`}>
              {status === "checking" || status === "applying" ? (
                <Loader2 size={12} className="spin" />
              ) : null}
              {statusLabel[status] || status}
            </span>
          </div>

          {state?.error || failure ? (
            <p className="update-error">{state?.error || failure}</p>
          ) : null}

          {status === "downloading" ? (
            <div className="update-progress">
              <div className="update-progress-track">
                <i style={{ width: `${Math.max(2, percent)}%` }} />
              </div>
              <small>
                {state?.progress
                  ? `${formatBytes(state.progress.received)}${
                      state.progress.total ? ` / ${formatBytes(state.progress.total)}` : ""
                    } · ${percent}%`
                  : "准备中"}
              </small>
            </div>
          ) : null}

          {status === "ready" && state?.downloaded ? (
            <p className="update-verify">
              {state.downloaded.verified ? (
                <>
                  <ShieldCheck size={13} /> 已通过发布方 SHA-256 校验
                </>
              ) : (
                <>
                  <ShieldAlert size={13} /> 发布方未提供校验和，仅本地计算
                </>
              )}
            </p>
          ) : null}

          {notes ? (
            <>
              <h3 className="update-notes-title">
                <Sparkles size={13} /> {newer ? `${state?.latest} 更新内容` : "版本说明"}
              </h3>
              <pre className="update-notes">{notes}</pre>
            </>
          ) : null}

          {status === "current" && !notes ? (
            <p className="help">已安装最新版本，无需更新。</p>
          ) : null}

          {state?.checkedAt ? (
            <p className="help update-checked">
              上次检查：{new Date(state.checkedAt).toLocaleString("zh-CN")}
            </p>
          ) : null}

          <div className="update-actions">
            <button
              className="primary"
              disabled={busy || status === "downloading" || status === "applying"}
              onClick={() => void run(() => window.studio.update.check(true))}
            >
              {status === "checking" ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              检查更新
            </button>

            {newer && (status === "available" || status === "skipped") ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(() => window.studio.update.download())}
              >
                <DownloadCloud size={14} />
                下载 {state?.latest}
              </button>
            ) : null}

            {status === "downloading" ? (
              <button
                disabled={busy}
                onClick={() => void run(() => window.studio.update.cancel())}
              >
                取消下载
              </button>
            ) : null}

            {status === "ready" ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "安装后软件会关闭并自动重新启动。正在进行的打标任务会先停止，未保存的修改会丢失。现在安装？",
                    )
                  )
                    void run(() => window.studio.update.apply());
                }}
              >
                <RotateCcw size={14} />
                安装并重启
              </button>
            ) : null}

            {newer && status !== "downloading" ? (
              <button
                disabled={busy}
                onClick={() => void run(() => window.studio.update.skip())}
              >
                跳过此版本
              </button>
            ) : null}

            {state?.pageUrl ? (
              <button onClick={() => void window.studio.openExternal(state.pageUrl)}>
                <ExternalLink size={14} />
                发布页
              </button>
            ) : null}
          </div>

          <p className="help update-footnote">
            便携版更新直接替换程序文件本身，不写入系统目录、不注册服务、不改注册表。数据、模型与标注结果都保存在应用数据目录，更新不会触碰。
          </p>
        </main>
      </section>
    </div>
  );
}
