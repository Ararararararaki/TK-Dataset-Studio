import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileImage,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Link,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minus,
  Moon,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  imageUrl,
  statusName,
  type Boot,
  type Catalog,
  type ImageRow,
  type Preset,
  type Settings,
  type Ui,
} from "./api";
import { PanelGroup, Panel, Separator } from "./components/Resizable";
import ImageEntry from "./components/ImageEntry";
import SettingsDialog from "./components/Settings";
import { flushDrafts } from "./drafts";
import ImagePreview from "./components/ImagePreview";
import { useBrowserGestures } from "./useBrowserGestures";
import OverwriteOptions from "./components/OverwriteOptions";
import { useAnnotationHover } from "./components/AnnotationHover";

export default function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [dataset, setDataset] = useState("");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [items, setItems] = useState<ImageRow[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [inspector, setInspector] = useState(true);
  const [assistant, setAssistant] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const annotationHover = useAnnotationHover();
  const hideAnnotationHover = annotationHover.hide;
  useEffect(() => hideAnnotationHover(), [view, dataset, query, filter, settingsOpen, hideAnnotationHover]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [channelBusy,setChannelBusy]=useState(false);
  const [stage, setStage] = useState("");
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImageRow | null>(null);
  const [instruction, setInstruction] = useState("");
  const [reply, setReply] = useState("");
  const [thinking, setThinking] = useState(false);
  const [confirm, setConfirm] = useState<{
    ids: string[];
    extra?: string;
  } | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetSave, setPresetSave] = useState(false);
  const [outputHeight, setOutputHeight] = useState(190);
  const [imageScale, setImageScale] = useState(1);
  const [browserWidth, setBrowserWidth] = useState(600);
  const [dragging, setDragging] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const presetDrafts = useRef<Record<string, Preset>>({});
  const lastSelected = useRef("");
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const currentDataset = boot?.datasets.find((d) => d.id === dataset);
  const job = boot?.jobs.find((j) => j.dataset_id === dataset);
  const running = job?.state === "running";
  const report = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const persistUi = useCallback(
    (partial: Partial<Ui>) => {
      void api("ui.save", partial).catch(report);
    },
    [report],
  );
  const refresh = useCallback(async () => {
    const b = await api<Boot>("bootstrap");
    setBoot(b);
    return b;
  }, []);
  const loadItems = useCallback(async () => {
    if (!dataset) {
      setItems([]);
      return;
    }
    setItems(
      await api<ImageRow[]>("images.list", {
        dataset_id: dataset,
        search: query,
        status: filter,
      }),
    );
  }, [dataset, query, filter]);
  useEffect(() => {
    let live = true;
    if (!window.studio) {
      setError("请通过桌面启动程序打开，浏览器预览不提供本机文件权限。");
      return;
    }
    void api<Boot>("bootstrap")
      .then((b) => {
        if (!live) return;
        setBoot(b);
        setDataset(b.ui.dataset || b.datasets[0]?.id || "");
        presetDrafts.current = b.ui.presetDrafts || {};
        const initialPreset =
          b.presets.find((p) => p.id === b.ui.preset) || b.presets[1];
        setPreset(presetDrafts.current[initialPreset.id] || initialPreset);
        setView(b.ui.view || "list");
        setInspector(b.ui.inspector !== false);
        setAssistant(!!b.ui.assistant);
        setTheme(b.ui.theme || "light");
        setOutputHeight(b.ui.outputHeight || 190);
        setImageScale(Math.max(0.6, Math.min(2, b.ui.imageScale || 1)));
        initialized.current = true;
      })
      .catch(report);
    void api<Catalog>("dsh.catalog")
      .then(setCatalog)
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [report]);
  useEffect(
    () =>
      window.studio?.onBeforeClose(async () => {
        try {
          await Promise.all([
            flushDrafts(),
            api("ui.save", { presetDrafts: presetDrafts.current }),
          ]);
        } catch (e) {
          report(e);
        }
      }),
    [report],
  );
  useEffect(() => {
    if (!initialized.current || !preset) return;
    presetDrafts.current = { ...presetDrafts.current, [preset.id]: preset };
    const timer = setTimeout(
      () => persistUi({ presetDrafts: presetDrafts.current }),
      350,
    );
    return () => clearTimeout(timer);
  }, [preset, persistUi]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const t = setTimeout(() => void loadItems().catch(report), query ? 180 : 0);
    return () => clearTimeout(t);
  }, [loadItems, report]);
  useEffect(() => {
    if (!initialized.current) return;
    persistUi({
      dataset,
      view,
      inspector,
      assistant,
      theme,
      outputHeight,
      imageScale,
      preset: preset?.id,
    });
  }, [
    dataset,
    view,
    inspector,
    assistant,
    theme,
    outputHeight,
    imageScale,
    preset?.id,
    persistUi,
  ]);
  useEffect(() => {
    if (!window.studio) return;
    return window.studio.onEvent((e) => {
      if (e.kind === "image" && e.id) {
        const id = e.id;
        setStage(e.stage || "");
        setTicks((t) => ({ ...t, [id]: (t[id] || 0) + 1 }));
      }
      if (e.kind === "import-progress")
        setNotice(
          `正在扫描 ${e.count || 0} 张图片${e.done ? " · 已完成" : ""}`,
        );
      if (e.kind === "download")
        setNotice(
          e.done
            ? "模型下载完成"
            : `正在下载 ${e.model} · ${((e.bytes || 0) / 1024 ** 2).toFixed(0)} MB`,
        );
      if (e.message) setNotice(e.message);
      if (e.kind === "image" || e.kind === "job" || e.kind === "datasets") {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          void refresh().catch(report);
          void loadItems().catch(report);
        }, 250);
      }
    });
  }, [refresh, loadItems, report]);
  useEffect(() => {
    setSelection(new Set());
    if (scroll.current)
      scroll.current.scrollTop = boot?.ui.scroll?.[dataset] || 0;
  }, [dataset]);
  const gridColumns = Math.max(
    1,
    Math.floor((browserWidth + 12) / (190 * imageScale + 12)),
  );
  const rows = useVirtualizer({
    count:
      view === "list" ? items.length : Math.ceil(items.length / gridColumns),
    getScrollElement: () => scroll.current,
    estimateSize: () =>
      view === "list" ? 110 + 310 * imageScale : 220 * imageScale + 54,
    overscan: 3,
    getItemKey: (i) =>
      view === "list" ? items[i]?.id || i : items[i * gridColumns]?.id || i,
  });
  useEffect(() => {
    const el = scroll.current;
    if (!boot || !el) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      setBrowserWidth(
        el.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!boot]);
  const zoomAnchor = useRef<string | null>(null);
  function resizeImages(next: number | ((value: number) => number)) {
    const first = rows
      .getVirtualItems()
      .find((r) => r.end > (scroll.current?.scrollTop || 0));
    zoomAnchor.current = first
      ? items[first.index * (view === "grid" ? gridColumns : 1)]?.id || null
      : null;
    setImageScale((value) =>
      Math.max(
        0.6,
        Math.min(
          2,
          Math.round((typeof next === "function" ? next(value) : next) * 100) /
            100,
        ),
      ),
    );
  }
  useLayoutEffect(() => {
    rows.measure();
    const at = items.findIndex((row) => row.id === zoomAnchor.current);
    if (at >= 0)
      rows.scrollToIndex(Math.floor(at / (view === "grid" ? gridColumns : 1)), {
        align: "start",
      });
    zoomAnchor.current = null;
  }, [view, imageScale, gridColumns, rows]);
  const marquee = useBrowserGestures({
    container: scroll,
    ready: !!boot,
    scope: `${dataset}:${query}:${filter}:${view}:${gridColumns}:${imageScale}`,
    selection,
    onSelect: setSelection,
    onZoom: (delta) => resizeImages((value) => value * Math.exp(delta)),
    getTargets: (box) => {
      const el = scroll.current,
        list = el?.querySelector(".virtual-list");
      if (!el || !list) return [];
      const viewport = el.getBoundingClientRect(),
        content = list.getBoundingClientRect();
      const left = content.left - viewport.left,
        top = content.top - viewport.top + el.scrollTop;
      const columns = view === "grid" ? gridColumns : 1;
      const width = (content.width - (columns - 1) * 12) / columns;
      return rows.measurementsCache
        .filter((r) => r.end + top > box.top && r.start + top < box.bottom)
        .flatMap((r) =>
          items
            .slice(r.index * columns, (r.index + 1) * columns)
            .map((row, column) => ({
              id: row.id,
              left: left + column * (width + 12),
              right: left + column * (width + 12) + width,
              top: top + r.start,
              bottom: top + r.end - 17,
            })),
        );
    },
  });
  const modelGroups = catalog?.capabilities.models.groups || [];
  const route = boot?.settings.dsh;
  const selectedChannelLabel=preset?.pipeline==="wd14"?"WD14 本地":route?.transport==="native"?"DSH Agent":"API 直连";
  const channelLabel=job?.state==="running"&&job.config?(job.config.preset.pipeline==="wd14"?"WD14 本地":job.config.dsh?.transport==="api"?"API 直连":"DSH Agent"):selectedChannelLabel;
  const defaultRoute = catalog?.capabilities.models.default;
  const effectiveProvider = route?.provider || defaultRoute?.provider;
  const effectiveModel = route?.model || defaultRoute?.model;
  const selectedModel = modelGroups
    .find((g) => g.id === effectiveProvider)
    ?.models.find((m) => m.id === effectiveModel);
  const efforts = selectedModel?.reasoning?.efforts || [];
  async function importPaths(paths: string[]) {
    if (!paths.length) return;
    setBusy("import");
    setError("");
    try {
      const ids = await api<string[]>("datasets.import", { paths });
      await refresh();
      setDataset(ids[0] || dataset);
      setQuery("");
      setFilter("all");
      setNotice("图片已导入，原图保持不变");
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  async function chooseFolder() {
    const p = await window.studio.chooseFolder();
    if (p) await importPaths([p]);
  }
  async function updateSettings(next: Settings) {
    if (!boot) return;
    setBoot({ ...boot, settings: next });
    try {
      setBoot(await api<Boot>("settings.save", next));
    } catch (e) {
      report(e);
    }
  }
  function selectPreset(id: string) {
    const p = boot?.presets.find((p) => p.id === id);
    if (p) setPreset({ ...(presetDrafts.current[id] || p) });
  }
  async function switchChannel(transport: "api"|"native") {
    if(!boot||channelBusy||transport===(route?.transport||"api"))return;
    setChannelBusy(true);setCatalog(null);
    try{
      const saved=await api<Boot>("settings.save",{...boot.settings,dsh:{...boot.settings.dsh,transport,provider:"",model:""}});
      setBoot(saved);
      setNotice(`已选择 ${transport==="api"?"API 直连":"DSH Agent"}，用于下一次打标`);
      try{setCatalog(await api<Catalog>("dsh.catalog"));}catch(e){report(e);}
    }catch(e){report(e);}finally{setChannelBusy(false);}
  }
  function toggleSelect(id: string, range = false) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (range && lastSelected.current) {
        const a = items.findIndex((i) => i.id === lastSelected.current),
          b = items.findIndex((i) => i.id === id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++)
          if (items[i]) next.add(items[i].id);
      } else next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    lastSelected.current = id;
  }
  async function start(ids?: string[], overwrite = false, extra = "") {
    if (!boot || !preset) return;
    setBusy("start");
    setError("");
    try {
      const r = await api<{ id: string; count: number }>("jobs.start", {
        dataset_id: dataset,
        ids,
        extra,
        config: {
          ...boot.settings,
          overwrite: overwrite || boot.settings.overwrite,
          preset: { ...preset },
        },
      });
      setNotice(`已开始处理 ${r.count} 张图片`);
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
      setConfirm(null);
    }
  }
  async function action(method: string, params: unknown = {}) {
    try {
      await api(method, params);
      await refresh();
      await loadItems();
    } catch (e) {
      report(e);
    }
  }
  async function ask() {
    const id = selection.values().next().value || items[0]?.id;
    if (!id || !instruction.trim()) return;
    setThinking(true);
    setReply("");
    try {
      const r = await api<{ text: string }>("assistant.chat", {
        id,
        instruction,
      });
      setReply(r.text);
    } catch (e) {
      report(e);
    } finally {
      setThinking(false);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreview(null);
        setSettingsOpen(false);
        setConfirm(null);
        return;
      }
      const target = e.target as HTMLElement;
      if (preview || settingsOpen || confirm) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelection(new Set(items.map((i) => i.id)));
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const at = items.findIndex((i) => i.id === lastSelected.current);
        const next =
          items[
            Math.max(
              0,
              Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)),
            )
          ];
        if (next) {
          lastSelected.current = next.id;
          setSelection(new Set([next.id]));
          rows.scrollToIndex(
            Math.floor(
              items.indexOf(next) / (view === "grid" ? gridColumns : 1),
            ),
          );
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [items, rows, view, gridColumns, preview, settingsOpen, confirm]);
  if (!boot)
    return (
      <div className="boot-screen">
        <div className="brand-symbol">tk</div>
        <h2>TK Dataset Studio</h2>
        {error ? (
          <>
            <p className="danger">{error}</p>
            <button onClick={() => location.reload()}>重试</button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={16} />
            正在打开工作区…
          </p>
        )}
      </div>
    );
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void importPaths(window.studio.paths(Array.from(e.dataTransfer.files)));
      }}
    >
      <header className="titlebar">
        <div className="title-brand">
          <span className="brand-symbol">tk</span>
          <strong>Dataset Studio</strong>
          <span className="title-divider" />
          <span>数据集工作区</span>
        </div>
        <div className="title-right">
          <span className="local-label">
            <span />
            本地优先
          </span>
          <button
            className="icon-button"
            title="切换深浅主题"
            aria-label="切换主题"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
          </button>
          <span className="window-divider" />
          <button
            className="window-button"
            aria-label="最小化"
            onClick={() => window.studio.window("minimize")}
          >
            <Minus size={14} />
          </button>
          <button
            className="window-button"
            aria-label="最大化"
            onClick={() => window.studio.window("maximize")}
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="window-button close-window"
            aria-label="关闭软件"
            onClick={() => window.studio.window("close")}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <PanelGroup
        orientation="horizontal"
        defaultLayout={boot.ui.layout}
        onLayoutChanged={(layout) => persistUi({ layout })}
      >
        <Panel id="sidebar" defaultSize="16%" minSize="174px" maxSize="330px">
          <aside className="sidebar">
            <div className="workspace-name">
              <span className="workspace-icon">
                <LayersIcon />
              </span>
              <div>
                <strong>我的工作区</strong>
                <small>图片与训练标注</small>
              </div>
            </div>
            <button
              className="import-button"
              onClick={() => void chooseFolder()}
              disabled={busy === "import"}
            >
              {busy === "import" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              导入图片文件夹
            </button>
            <div className="sidebar-section-heading">
              <span>数据集</span>
              <span>{boot.datasets.length}</span>
            </div>
            <nav className="datasets">
              {boot.datasets.map((d) => (
                <button
                  className={`dataset-item ${dataset === d.id ? "active" : ""}`}
                  key={d.id}
                  title={d.path}
                  onClick={() => {
                    setDataset(d.id);
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  <Folder size={17} />
                  <span>
                    <strong>{d.name}</strong>
                    <small>
                      {d.online
                        ? `${d.completed || 0} / ${d.count} 已标注`
                        : "目录未连接"}
                    </small>
                  </span>
                  {d.failed > 0 && (
                    <span className="count-error">{d.failed}</span>
                  )}
                </button>
              ))}
              {!boot.datasets.length && (
                <p className="sidebar-empty">
                  导入后，数据集会一直保留在这里。
                </p>
              )}
            </nav>
            <div className="sidebar-bottom">
              <button onClick={() => setSettingsOpen(true)}>
                <Settings2 size={16} />
                设置与模型
              </button>
              <button
                onClick={() => setAssistant(!assistant)}
                className={assistant ? "active" : ""}
              >
                <MessageSquare size={16} />
                打标助手<span className="shortcut">可收起</span>
              </button>
              <div className="connection-dot">
                <span className={catalog ? "online" : ""} />
                {catalog ? (catalog.transport==="api"?"API 直接打标就绪":"DSH Agent 就绪") : "打标连接待检测"}
                <button
                  className="icon-button"
                  title="检测 DSH"
                  aria-label="检测 DSH"
                  onClick={() =>
                    void api<Catalog>("dsh.catalog")
                      .then(setCatalog)
                      .catch(report)
                  }
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              <span className="app-version">
                TK Dataset Studio {boot.version}
              </span>
            </div>
          </aside>
        </Panel>
        <Separator />
        <Panel id="workspace" minSize="400px">
          <main className="workspace">
            <div className="workspace-header">
              <div>
                <h1>{currentDataset?.name || "开始一个数据集"}</h1>
                <p title={currentDataset?.path}>
                  {currentDataset?.path || "拖入图片文件夹，开始整理训练标注"}
                </p>
              </div>
              <div className="header-actions">
                <span className="channel-status" data-testid="execution-channel-status" title="运行中显示本批次通道；切换连接只影响下一批">{job?.state==="running"?"运行中":"下次"} · {channelLabel}</span>
                {running ? (
                  <>
                    <button onClick={() => void action("jobs.pause")}>
                      <Pause size={14} />
                      暂停
                    </button>
                    <button
                      aria-label="停止任务"
                      title="停止并保留进度"
                      onClick={() => void action("jobs.cancel")}
                    >
                      <Square size={14} />
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={!dataset || !!busy || !items.length}
                    onClick={() =>
                      void start(selection.size ? [...selection] : undefined)
                    }
                  >
                    <Play size={14} />
                    {selection.size
                      ? `打标选中 ${selection.size} 张`
                      : "开始打标"}
                  </button>
                )}
                <button
                  className="icon-button inspector-toggle"
                  title={inspector ? "收起参数" : "展开参数"}
                  aria-label="切换参数栏"
                  aria-pressed={inspector}
                  onClick={() => setInspector(!inspector)}
                >
                  {inspector ? (
                    <PanelRightClose size={18} />
                  ) : (
                    <PanelRightOpen size={18} />
                  )}
                </button>
              </div>
            </div>
            <div className="browser-toolbar">
              <div className="search-box">
                <Search size={15} />
                <input
                  aria-label="搜索图片或标签"
                  placeholder="搜索文件名、标签或描述"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="清除搜索"
                    onClick={() => setQuery("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <select
                className="filter-select"
                aria-label="按状态筛选"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  ["all", "全部图片"],
                  ["pending", "待打标"],
                  ["done", "已保存"],
                  ["external", "已有文本"],
                  ["failed", "待重试"],
                ].map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="view-switch">
                <button
                  className={view === "list" ? "active" : ""}
                  aria-label="图文列表"
                  aria-pressed={view === "list"}
                  title="图文列表"
                  onClick={() => setView("list")}
                >
                  <PanelLeft size={16} />
                </button>
                <button
                  className={view === "grid" ? "active" : ""}
                  aria-label="缩略图网格"
                  aria-pressed={view === "grid"}
                  title="缩略图网格"
                  onClick={() => setView("grid")}
                >
                  <LayoutGrid size={16} />
                </button>
              </div>
              <div className="image-size-control" aria-label="图片显示大小">
                <button
                  className="icon-button"
                  aria-label="缩小图片"
                  disabled={imageScale <= 0.6}
                  onClick={() => resizeImages((value) => value - 0.1)}
                >
                  <Minus size={13} />
                </button>
                <button
                  className="image-size-value"
                  title="Ctrl＋滚轮调整图片大小 · 点击恢复 100%"
                  aria-label="恢复图片显示大小"
                  onClick={() => resizeImages(1)}
                >
                  {Math.round(imageScale * 100)}%
                </button>
                <button
                  className="icon-button"
                  aria-label="放大图片"
                  disabled={imageScale >= 2}
                  onClick={() => resizeImages((value) => value + 0.1)}
                >
                  <Plus size={13} />
                </button>
              </div>
              <button
                className="icon-button"
                title="重新扫描目录"
                aria-label="重新扫描目录"
                disabled={!dataset}
                onClick={() => void action("datasets.scan", { id: dataset })}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {(error || notice) && (
              <div
                className={`message-bar ${error ? "error" : ""}`}
                role={error ? "alert" : "status"}
              >
                <span>{error || notice}</span>
                <button
                  className="icon-button"
                  aria-label="关闭提示"
                  onClick={() => {
                    setError("");
                    setNotice("");
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {job && (
              <div className="job-strip">
                <span className={`job-indicator ${running ? "running" : ""}`} />
                <span>
                  {running
                    ? stage || "任务运行中"
                    : job.state === "paused"
                      ? "任务已暂停"
                      : job.state === "cancelled"
                        ? "任务已停止"
                        : job.counts.failed
                          ? "任务结束，有图片待重试"
                          : "最近任务已完成"}
                </span>
                <span>
                  {job.counts.done || 0} 完成
                  {job.counts.failed ? ` / ${job.counts.failed} 待重试` : ""}
                </span>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${
                        (100 *
                          ((job.counts.done || 0) +
                            (job.counts.skipped || 0))) /
                        Math.max(
                          1,
                          Object.values(job.counts).reduce((a, b) => a + b, 0),
                        )
                      }%`,
                    }}
                  />
                </div>
                {!running &&
                (job.counts.failed ||
                  job.counts.pending ||
                  job.counts.cancelled) ? (
                  <button
                    onClick={() => void action("jobs.resume", { id: job.id })}
                  >
                    继续 / 重试未完成
                  </button>
                ) : null}
              </div>
            )}
            <div
              className="image-scroll"
              ref={scroll}
              style={
                {
                  "--grid-columns": gridColumns,
                  "--thumb-height": `${Math.round(220 * imageScale)}px`,
                  "--entry-image-width": `${Math.max(26, Math.min(60, 38 * imageScale))}%`,
                  "--entry-image-height": `${Math.round(300 * imageScale)}px`,
                } as CSSProperties
              }
              onScroll={(e) => {
                clearTimeout(scrollTimer.current);
                const top = e.currentTarget.scrollTop;
                scrollTimer.current = setTimeout(
                  () =>
                    persistUi({
                      scroll: { ...boot.ui.scroll, [dataset]: top },
                    }),
                  350,
                );
              }}
            >
              {!dataset ? (
                <div className="empty-workspace">
                  <div className="empty-illustration">
                    <FileImage size={56} strokeWidth={1} />
                    <span>
                      <Tag size={23} />
                    </span>
                  </div>
                  <h2>让每张图片都有准确的描述</h2>
                  <p>
                    拖入图片或整个文件夹。图片、原始标签和最终文本
                    <br />
                    会在同一个工作区里，清楚地放在一起。
                  </p>
                  <button
                    className="primary"
                    onClick={() => void chooseFolder()}
                  >
                    <FolderPlus size={16} />
                    选择图片文件夹
                  </button>
                  <div className="empty-formats">
                    <span>Danbooru 标签</span>
                    <span>自然语言</span>
                    <span>MOSS Layout</span>
                  </div>
                  <div className="quick-pipeline">
                    <span>导入图片</span>
                    <ChevronRight size={14} />
                    <span>选择预设</span>
                    <ChevronRight size={14} />
                    <span>一键打标与保存</span>
                  </div>
                </div>
              ) : !items.length ? (
                <div className="empty-workspace">
                  <Search size={35} strokeWidth={1} />
                  <h2>
                    {query || filter !== "all"
                      ? "没有匹配图片"
                      : "目录中没有可用图片"}
                  </h2>
                  <p>支持 PNG、JPEG、WebP、TIFF、BMP、GIF、AVIF。</p>
                  <button
                    onClick={() =>
                      void action("datasets.scan", { id: dataset })
                    }
                  >
                    <RefreshCw size={14} />
                    重新扫描
                  </button>
                </div>
              ) : (
                <div
                  className={`virtual-list ${view}`}
                  style={{ height: rows.getTotalSize() }}
                >
                  {rows.getVirtualItems().map((v) => (
                    <div
                      key={v.key}
                      data-index={v.index}
                      ref={rows.measureElement}
                      className="virtual-row"
                      style={{ transform: `translateY(${v.start}px)` }}
                    >
                      {view === "list" ? (
                        <ImageEntry
                          row={items[v.index]}
                          tick={ticks[items[v.index].id] || 0}
                          selected={selection.has(items[v.index].id)}
                          onSelect={toggleSelect}
                          onPreview={setPreview}
                          onRetag={(id) => setConfirm({ ids: [id] })}
                          onError={report}
                          outputHeight={outputHeight}
                          warning={boot.settings.output_warning}
                          onOutputResize={(n) =>
                            setOutputHeight(Math.max(100, n))
                          }
                        />
                      ) : (
                        <div className="thumbnail-grid">
                          {items
                            .slice(
                              v.index * gridColumns,
                              (v.index + 1) * gridColumns,
                            )
                            .map((row) => (
                              <article
                                className={`thumb-card ${selection.has(row.id) ? "selected" : ""}`}
                                key={row.id}
                                data-image-id={row.id}
                                aria-describedby={annotationHover.activeId === row.id ? annotationHover.descriptionId : undefined}
                                onPointerEnter={(e) => { if (e.pointerType === "mouse" && e.buttons === 0) annotationHover.show(row, e.currentTarget, ticks[row.id] || 0); }}
                                onPointerLeave={annotationHover.leave}
                                onPointerDown={annotationHover.hide}
                                onFocus={(e) => annotationHover.show(row, e.currentTarget, ticks[row.id] || 0)}
                                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) annotationHover.leave(); }}
                                onClick={(e) =>
                                  toggleSelect(row.id, e.shiftKey)
                                }
                              >
                                <button
                                  className={`check-button ${selection.has(row.id) ? "checked" : ""}`}
                                  aria-label={`选择 ${row.relative}`}
                                  aria-pressed={selection.has(row.id)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSelect(row.id, e.shiftKey);
                                  }}
                                >
                                  {selection.has(row.id) && <Check size={13} />}
                                </button>
                                <img
                                  src={imageUrl(row.id)}
                                  loading="lazy"
                                  alt={row.relative}
                                  draggable
                                  onDragStart={(e) => {
                                    e.preventDefault();
                                    window.studio.startDrag(row.id);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setPreview(row);
                                  }}
                                />
                                <div>
                                  <strong title={row.relative}>
                                    {row.relative}
                                  </strong>
                                  <span className={`status ${row.status}`}>
                                    {statusName[row.status]}
                                  </span>
                                </div>
                              </article>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {marquee && (
                <div
                  className="selection-marquee"
                  aria-hidden="true"
                  style={{
                    left: marquee.left,
                    top: marquee.top,
                    width: Math.max(0, marquee.right - marquee.left),
                    height: Math.max(0, marquee.bottom - marquee.top),
                  }}
                />
              )}
            </div>
            {assistant && (
              <section className="assistant-panel">
                <header>
                  <span>
                    <Sparkles size={15} />
                    打标助手
                  </span>
                  <small>作用于 {selection.size || 0} 张选中图片</small>
                  <button
                    className="icon-button"
                    aria-label="收起助手"
                    onClick={() => setAssistant(false)}
                  >
                    <ChevronDown size={15} />
                  </button>
                </header>
                {reply && <div className="assistant-reply">{reply}</div>}
                <div className="assistant-composer">
                  <textarea
                    aria-label="助手指令"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例如：保留角色名，把服装和人物动作写得更具体"
                  />
                  <div>
                    <button
                      disabled={
                        thinking || !items.length || !instruction.trim()
                      }
                      onClick={() => void ask()}
                    >
                      {thinking ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <MessageSquare size={14} />
                      )}
                      询问助手
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !selection.size || running || !instruction.trim()
                      }
                      onClick={() =>
                        setConfirm({ ids: [...selection], extra: instruction })
                      }
                    >
                      <Send size={14} />
                      按此要求重打所选
                    </button>
                  </div>
                </div>
              </section>
            )}
            <footer className="workspace-footer">
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={!!items.length && selection.size === items.length}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked
                        ? new Set(items.map((i) => i.id))
                        : new Set(),
                    )
                  }
                />
                {selection.size
                  ? `已选 ${selection.size} 张`
                  : `${items.length.toLocaleString()} 张图片`}
              </label>
              {selection.size > 0 && (
                <button
                  className="text-button"
                  onClick={() => setSelection(new Set())}
                >
                  取消选择
                </button>
              )}
              <span
                className="footer-tip"
                title="从空白处或卡片边缘拖动框选；Shift 增选，Ctrl 反选，Alt 减选；Esc 撤销。图片本身可直接拖出。"
              >
                {currentDataset
                  ? "空白处拖动框选 · Ctrl＋滚轮缩放"
                  : "支持拖入文件夹与图片"}
              </span>
              {currentDataset && (
                <button
                  className="text-button remove-dataset"
                  title="仅移除索引，不删除文件"
                  onClick={() => {
                    if (
                      window.confirm(
                        "仅从工作区移除此数据集？原图和 TXT 会保留。",
                      )
                    )
                      void action("datasets.remove", { id: dataset }).then(() =>
                        setDataset(""),
                      );
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </footer>
          </main>
        </Panel>
        {inspector && (
          <>
            <Separator />
            <Panel
              id="inspector"
              defaultSize="22%"
              minSize="265px"
              maxSize="420px"
            >
              <aside className="inspector">
                <header>
                  <SlidersHorizontal size={16} />
                  <strong>打标配置</strong>
                </header>
                <div className="inspector-scroll">
                  <section>
                    <label className="section-label">输出预设</label>
                    <select
                      aria-label="输出预设"
                      className="preset-select"
                      value={preset?.id}
                      onChange={(e) => selectPreset(e.target.value)}
                    >
                      {boot.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <p className="preset-description">{preset?.description}</p>
                    <div className="preset-flow">
                      <span>WD14</span>
                      {preset?.pipeline !== "wd14" && (
                        <>
                          <ChevronRight size={11} />
                          <span>原图 + LLM</span>
                          {preset?.review && (
                            <>
                              <ChevronRight size={11} />
                              <span>复核</span>
                            </>
                          )}
                        </>
                      )}
                      <ChevronRight size={11} />
                      <strong>TXT</strong>
                    </div>
                    <label>
                      处理方式
                      <select
                        aria-label="处理方式"
                        value={preset?.pipeline}
                        onChange={(e) =>
                          preset &&
                          setPreset({
                            ...preset,
                            pipeline: e.target.value as Preset["pipeline"],
                            format:
                              e.target.value === "wd14"
                                ? "tags"
                                : preset.format,
                          })
                        }
                      >
                        <option value="wd14">仅 WD14 本地打标</option>
                        <option value="wd14-llm">WD14 + LLM 看图</option>
                        <option value="llm">仅 LLM 看图</option>
                      </select>
                    </label>
                    {preset?.pipeline !== "wd14" && (
                      <label className="check-field compact">
                        <input
                          type="checkbox"
                          checked={preset?.review}
                          onChange={(e) =>
                            preset &&
                            setPreset({ ...preset, review: e.target.checked })
                          }
                        />
                        <span>
                          独立看图复核
                          <small>额外请求一次；增加耗时与用量，默认关闭</small>
                        </span>
                      </label>
                    )}
                  </section>
                  <section>
                    <div className="section-title">
                      <label className="section-label">WD14 模型</label>
                      <button
                        className="text-button"
                        onClick={() => setSettingsOpen(true)}
                      >
                        管理模型
                      </button>
                    </div>
                    <select
                      aria-label="WD14 模型"
                      value={boot.settings.wd14.model}
                      onChange={(e) =>
                        void updateSettings({
                          ...boot.settings,
                          wd14: {
                            ...boot.settings.wd14,
                            model: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">
                        {boot.models.length
                          ? "选择模型"
                          : "添加模型文件夹或下载模型"}
                      </option>
                      {boot.models.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <div className="two-fields">
                      <label>
                        普通标签阈值
                        <input
                          type="number"
                          aria-label="普通标签阈值"
                          min={0}
                          max={1}
                          step={0.05}
                          value={boot.settings.wd14.threshold}
                          onChange={(e) =>
                            void updateSettings({
                              ...boot.settings,
                              wd14: {
                                ...boot.settings.wd14,
                                threshold: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        角色阈值
                        <input
                          type="number"
                          aria-label="角色阈值"
                          min={0}
                          max={1}
                          step={0.05}
                          value={boot.settings.wd14.character_threshold}
                          onChange={(e) =>
                            void updateSettings({
                              ...boot.settings,
                              wd14: {
                                ...boot.settings.wd14,
                                character_threshold: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      推理设备
                      <select
                        aria-label="推理设备"
                        value={boot.settings.wd14.device}
                        onChange={(e) =>
                          void updateSettings({
                            ...boot.settings,
                            wd14: {
                              ...boot.settings.wd14,
                              device: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="cpu">CPU · 独立运行时</option>
                        <option value="cuda">CUDA · 需额外 GPU Runtime</option>
                      </select>
                    </label>
                    <details className="advanced">
                      <summary>排除标签</summary>
                      <input
                        aria-label="排除标签"
                        value={boot.settings.wd14.exclude_tags}
                        placeholder="逗号分隔"
                        onChange={(e) =>
                          void updateSettings({
                            ...boot.settings,
                            wd14: {
                              ...boot.settings.wd14,
                              exclude_tags: e.target.value,
                            },
                          })
                        }
                      />
                    </details>
                  </section>
                  <section>
                    <div className="section-title">
                      <label className="section-label">看图模型与通道</label>
                      <button
                        className="text-button"
                        onClick={() => setSettingsOpen(true)}
                      >
                        <Link size={12} />
                        连接
                      </button>
                    </div>
                    <div className="execution-channels" role="group" aria-label="打标通道">
                      <button aria-label="API 直连" aria-pressed={route?.transport!=="native"} disabled={channelBusy} onClick={()=>void switchChannel("api")}>
                        <strong>API 直连</strong><small>直接传图 · 无 DSH 会话</small>
                      </button>
                      <button aria-label="DSH Agent" aria-pressed={route?.transport==="native"} disabled={channelBusy} onClick={()=>void switchChannel("native")}>
                        <strong>DSH Agent</strong><small>原生工具与插件 · 创建会话</small>
                      </button>
                    </div>
                    <select
                      aria-label="DSH 看图模型"
                      value={
                        route?.provider && route.model
                          ? `${route.provider}::${route.model}`
                          : ""
                      }
                      onChange={(e) => {
                        const [provider, model] = e.target.value.split("::");
                        void updateSettings({
                          ...boot.settings,
                          dsh: {
                            ...boot.settings.dsh,
                            provider: provider || "",
                            model: model || "",
                            reasoningEffort: "",
                          },
                        });
                      }}
                    >
                      <option value="">
                        {route?.transport==="native"?"跟随 DSH 当前模型":"使用连接默认模型"}
                        {defaultRoute ? " · " + defaultRoute.model : ""}
                      </option>
                      {modelGroups.map((g) => (
                        <optgroup label={g.label || g.id} key={g.id}>
                          {g.models.map((m) => (
                            <option key={m.id} value={`${g.id}::${m.id}`}>
                              {m.name || m.id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <div className={`dsh-status ${catalog ? "ready" : ""}`}>
                      <span />
                      {catalog
                        ? `${selectedChannelLabel} · ${effectiveModel||"模型待选择"} · 已连接`
                        : `${selectedChannelLabel} · 未连接，点击“连接”设置`}
                    </div>
                    {efforts.length > 0 && (
                      <label>
                        思考强度
                        <select
                          value={route?.reasoningEffort || ""}
                          onChange={(e) =>
                            void updateSettings({
                              ...boot.settings,
                              dsh: {
                                ...boot.settings.dsh,
                                reasoningEffort: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">使用 DSH 默认</option>
                          {efforts.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.label || e.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <details className="advanced">
                      <summary>{route?.transport==="native"?"Agent 预设与 Skill":"辅助 Skill 指导词"} · 已选 {boot.settings.skill_ids.length}</summary>
                      {route?.transport==="native" && <label>
                        DSH Agent
                        <select
                          value={route?.agentPreset || ""}
                          onChange={(e) =>
                            void updateSettings({
                              ...boot.settings,
                              dsh: {
                                ...boot.settings.dsh,
                                agentPreset: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">使用 DSH 默认</option>
                          {catalog?.capabilities.presets?.presets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name || p.id}
                            </option>
                          ))}
                        </select>
                      </label>}
                      {boot.skills.map((s) => (
                        <label className="check-field compact" key={s.id}>
                          <input
                            type="checkbox"
                            checked={boot.settings.skill_ids.includes(s.id)}
                            onChange={(e) =>
                              void updateSettings({
                                ...boot.settings,
                                skill_ids: e.target.checked
                                  ? [...boot.settings.skill_ids, s.id]
                                  : boot.settings.skill_ids.filter(
                                      (x) => x !== s.id,
                                    ),
                              })
                            }
                          />
                          <span>
                            {s.name}
                            <small>
                              {s.characters.toLocaleString()} 字符 · 完整参考
                            </small>
                          </span>
                        </label>
                      ))}
                    </details>
                  </section>
                  <section>
                    <div className="section-title">
                      <label className="section-label">打标指导词</label>
                      <span className="minor-label">可编辑</span>
                    </div>
                    <label className="check-field compact">
                      <input
                        type="checkbox"
                        checked={boot.settings.lookup_characters}
                        onChange={(e) =>
                          void updateSettings({
                            ...boot.settings,
                            lookup_characters: e.target.checked,
                          })
                        }
                      />
                      <span>
                        查库核对 WD14 角色
                        <small>特征对照原图绑定到对应人物</small>
                      </span>
                    </label>
                    <textarea
                      className="guidance-editor"
                      aria-label="打标指导词"
                      value={preset?.guidance || ""}
                      onChange={(e) =>
                        preset &&
                        setPreset({ ...preset, guidance: e.target.value })
                      }
                    />
                    <div className="preset-actions">
                      {preset?.id.startsWith("custom-") && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void api<Preset[]>("presets.save", { preset })
                              .then((ps) => {
                                setBoot({ ...boot, presets: ps });
                                setNotice("预设修改已保存");
                              })
                              .catch(report)
                          }
                        >
                          保存修改
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => {
                          const original = boot.presets.find(
                            (p) => p.id === preset?.id,
                          );
                          if (original) setPreset({ ...original });
                        }}
                      >
                        恢复预设
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setPresetName((preset?.name || "") + " 副本");
                          setPresetSave(true);
                        }}
                      >
                        <Plus size={12} />
                        另存为预设
                      </button>
                      {preset?.id.startsWith("custom-") && (
                        <button
                          className="text-button"
                          aria-label="删除自定义预设"
                          onClick={() =>
                            void api<Preset[]>("presets.delete", {
                              id: preset.id,
                            })
                              .then((ps) => {
                                setBoot({ ...boot, presets: ps });
                                setPreset(ps[1]);
                              })
                              .catch(report)
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </section>
                  <section>
                    <OverwriteOptions overwrite={boot.settings.overwrite} backup={boot.settings.backup_before_overwrite}
                      onChange={(change) => void updateSettings({ ...boot.settings, ...change })} />
                    <div className="save-note">
                      <CheckCircle2 size={14} />
                      <span>
                        结果自动保存同名 .txt
                        <br />
                        <small>失败可重试 · 修改留历史 · 超长不截断</small>
                      </span>
                    </div>
                  </section>
                </div>
                <footer>
                  <span>配置保存在本机</span>
                  <span>
                    {preset?.pipeline === "wd14"
                      ? "本地打标"
                      : preset?.review
                        ? "看图＋细节复核"
                        : "原图看图打标"}
                  </span>
                </footer>
              </aside>
            </Panel>
          </>
        )}
      </PanelGroup>
      {annotationHover.preview}
      {dragging && (
        <div className="drop-overlay">
          <FolderPlus size={48} strokeWidth={1} />
          <h2>松开以导入图片</h2>
          <p>支持整个文件夹，自动扫描子目录</p>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          boot={boot}
          catalog={catalog}
          onCatalog={setCatalog}
          onBoot={setBoot}
          onClose={() => setSettingsOpen(false)}
          onError={report}
        />
      )}
      {preview && (
        <ImagePreview row={preview} onClose={() => setPreview(null)} />
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="确认重新打标"
          >
            <h2>重新打标 {confirm.ids.length} 张图片</h2>
            <p>
              使用当前“{preset?.name}”预设。现有 TXT 将被替换，
              {boot.settings.backup_before_overwrite ? "覆盖前另存原 TXT；" : "不生成额外 TXT 备份；"}修改历史仍保留。
            </p>
            {confirm.extra && <blockquote>{confirm.extra}</blockquote>}
            <div className="button-row">
              <button onClick={() => setConfirm(null)}>取消</button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void start(confirm.ids, true, confirm.extra)}
              >
                <Play size={14} />
                {boot.settings.backup_before_overwrite ? "备份并开始" : "覆盖并开始"}
              </button>
            </div>
          </section>
        </div>
      )}
      {presetSave && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="保存自定义预设"
          >
            <h2>保存打标预设</h2>
            <label>
              预设名称
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </label>
            <label>
              输出格式
              <select
                value={preset?.format}
                onChange={(e) =>
                  preset &&
                  setPreset({
                    ...preset,
                    format: e.target.value as Preset["format"],
                    pipeline:
                      e.target.value === "tags" ? preset.pipeline : "wd14-llm",
                  })
                }
              >
                <option value="tags">Danbooru 标签</option>
                <option value="caption">自然语言</option>
                <option value="hybrid">标签 + 自然语言</option>
                <option value="moss">MOSS Layout</option>
              </select>
            </label>
            <div className="button-row">
              <button onClick={() => setPresetSave(false)}>取消</button>
              <button
                className="primary"
                disabled={!presetName.trim()}
                onClick={() =>
                  void api<Preset[]>("presets.save", {
                    preset: { ...preset, id: "", name: presetName },
                  })
                    .then((ps) => {
                      setBoot({ ...boot, presets: ps });
                      setPreset(ps[ps.length - 1]);
                      setPresetSave(false);
                      setNotice("自定义预设已保存");
                    })
                    .catch(report)
                }
              >
                保存预设
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function LayersIcon() {
  return (
    <>
      <span />
      <span />
      <span />
    </>
  );
}
