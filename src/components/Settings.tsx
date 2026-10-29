import { useState } from "react";
import {
  CheckCircle2,
  Download,
  FolderPlus,
  Link,
  LoaderCircle,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { api, type Boot, type Catalog, type Settings as Config } from "../api";
import ApiConnectionSettings from "./ApiConnectionSettings";
export default function Settings({
  boot,
  catalog,
  onCatalog,
  onBoot,
  onClose,
  onError,
}: {
  boot: Boot;
  catalog: Catalog | null;
  onCatalog: (c: Catalog) => void;
  onBoot: (b: Boot) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [config, setConfig] = useState(boot.settings);
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState("connection");
  async function persist(next: Config) {
    setConfig(next);
    const saved=await api<Boot>("settings.save", next);
    setConfig(saved.settings);onBoot(saved);
  }
  async function probe(start = false) {
    setBusy(start ? "start" : "probe");
    try {
      onCatalog(await api<Catalog>(start ? "dsh.start" : "dsh.catalog"));
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function addFolder() {
    const p = await window.studio.chooseFolder();
    if (p)
      await persist({
        ...config,
        model_dirs: [...new Set([...config.model_dirs, p])],
      });
  }
  async function download(repo: string) {
    setBusy("download");
    try {
      onBoot(await api<Boot>("models.download", { repo }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header>
          <div>
            <h2>工作区设置</h2>
            <p>连接、模型和保存行为。自动保存在本机。</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="settings-layout">
          <nav>
            {[
              ["connection", "DSH 连接"],
              ["models", "WD14 模型"],
              ["characters", "角色资料"],
              ["files", "文件与输出"],
              ["agent", "Agent 接管"],
              ["about", "关于与数据"],
            ].map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <main>
            {tab === "connection" && (
              <>
                <h3>
                  <Link size={17} />
                  打标连接
                </h3>
                <p className="help">
                  默认直接传图，一次请求后保存标注。完整 Agent 仅在主动选择时启用。
                </p>
                <label>执行方式
                  <select aria-label="打标执行方式" value={config.dsh.transport || "api"} onChange={e=>void persist({...config,dsh:{...config.dsh,transport:e.target.value as "api"|"native",provider:"",model:""}}).then(()=>probe()).catch(onError)}>
                    <option value="api">直接 API · 不创建 DSH 对话</option>
                    <option value="native">完整 DSH Agent · 会创建独立对话</option>
                  </select>
                </label>
                {config.dsh.transport!=="native" && <ApiConnectionSettings config={config} persist={persist} onError={onError}/>}
                {config.dsh.transport==="native" && <>
                <p className="help">此模式通过 Relay 调用完整 Agent，每张图片会创建独立会话，并保留 DSH 的原生插件和权限处理。</p>
                <label>
                  Profile
                  <input
                    value={config.dsh.profile}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        dsh: { ...config.dsh, profile: e.target.value },
                      })
                    }
                    onBlur={() => void persist(config).catch(onError)}
                  />
                </label>
                <label>
                  Relay 描述文件
                  <div className="input-action">
                    <input
                      placeholder="自动发现 ~/.dsh/plugins/dsh-relay/web/relay-endpoint.json"
                      value={config.dsh.descriptor}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          dsh: { ...config.dsh, descriptor: e.target.value },
                        })
                      }
                      onBlur={() => void persist(config).catch(onError)}
                    />
                    <button
                      onClick={() =>
                        void window.studio
                          .chooseFile()
                          .then((p) =>
                            p
                              ? persist({
                                  ...config,
                                  dsh: { ...config.dsh, descriptor: p },
                                })
                              : undefined,
                          )
                          .catch(onError)
                      }
                    >
                      浏览
                    </button>
                  </div>
                </label>
                </>}
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() => void probe()}
                  >
                    {busy === "probe" ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    检测连接
                  </button>
                  {config.dsh.transport==="native" && <button disabled={!!busy} onClick={() => void probe(true)}>
                    <Play size={14} />
                    一键启动 DSH
                  </button>}
                </div>
                <div className={`connection-result ${catalog ? "ready" : ""}`}>
                  {catalog ? (
                    <>
                      <CheckCircle2 size={17} />
                      <div>
                        <strong>{catalog.transport==="api"?"API 连接就绪 · 无 DSH 会话":"原生 Agent 连接就绪"}</strong>
                        <p>{catalog.host_url}</p>
                      </div>
                    </>
                  ) : (
                    <p>检测后自动读取当前可用模型，无需在多个地方重复配置。</p>
                  )}
                </div>
                {catalog && config.dsh.transport==="native" && (
                  <>
                    <label>
                      DSH 工作区
                      <select
                        aria-label="DSH 工作区"
                        value={config.dsh.workspace || ""}
                        onChange={(e) =>
                          void persist({
                            ...config,
                            dsh: { ...config.dsh, workspace: e.target.value },
                          }).catch(onError)
                        }
                      >
                        <option value="">
                          自动使用包含本软件数据的已注册工作区
                        </option>
                        {catalog.workspaces.map((w) => (
                          <option key={w.workspaceId} value={w.path}>
                            {w.title} · {w.path}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="help">
                      首次使用可先在 DSH
                      添加专用空目录，再点“检测连接”选择。软件仅在所选工作区的
                      .tk-dataset-studio
                      子目录准备任务材料；每次原生会话只读本次材料。
                    </p>
                    <h4>插件状态</h4>
                    <p className="help">
                      执行由 DSH
                      当前配置管理。检测到安装不代表插件已参与某次运行；可通过原生会话核对。
                    </p>
                    {catalog.plugins.length ? (
                      catalog.plugins.map((p) => (
                        <div className="plugin-row" key={p.name}>
                          <span>{p.name}</span>
                          <code>{p.version}</code>
                        </div>
                      ))
                    ) : (
                      <p className="help">
                        未从通用目录检测到插件清单；已有 DSH 配置会继续使用。
                      </p>
                    )}
                  </>
                )}
                <label>
                  单次运行等待上限（秒）
                  <input
                    type="number"
                    min={15}
                    max={3600}
                    value={config.dsh.timeout}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        dsh: { ...config.dsh, timeout: Number(e.target.value) },
                      })
                    }
                    onBlur={() => void persist(config).catch(onError)}
                  />
                </label>
              </>
            )}
            {tab === "agent" && (
              <>
                <h3>Agent 接口</h3>
                <p className="help">
                  Agent
                  与桌面共用当前任务、预设、图片和标注。接口只监听本机，独立凭据验证；关闭软件即释放端口。
                </p>
                <label>
                  允许的操作
                  <select
                    aria-label="Agent 接口权限"
                    value={config.agent_access}
                    onChange={(e) =>
                      void persist({
                        ...config,
                        agent_access: e.target.value as Config["agent_access"],
                      }).catch(onError)
                    }
                  >
                    <option value="read">只读查看状态与结果</option>
                    <option value="write">允许 Agent 操作与修改</option>
                    <option value="off">关闭接口</option>
                  </select>
                </label>
                <p className="help">
                  开启操作后，可导入目录、选预设打标、暂停/重试、查看原图、编辑文本。编辑必须匹配当前版本，替换前自动备份；不提供执行命令或修改原图的接口。
                </p>
                <div className="mcp-heading">
                  <h4>MCP 连接配置</h4>
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(
                          JSON.stringify(
                            {
                              mcpServers: {
                                "tk-dataset-studio": boot.agent.mcp,
                              },
                            },
                            null,
                            2,
                          ),
                        )
                        .catch(onError)
                    }
                  >
                    复制 MCP 配置
                  </button>
                </div>
                <pre className="path-block">
                  {JSON.stringify(
                    { mcpServers: { "tk-dataset-studio": boot.agent.mcp } },
                    null,
                    2,
                  )}
                </pre>
                <h4>本机连接描述</h4>
                <code className="path-block">{boot.agent.descriptor}</code>
                <p className="help">
                  凭据只保存在本机文件，连接配置不包含密钥。Agent
                  的操作记录保存在工作区数据库。
                </p>
              </>
            )}
            {tab === "models" && (
              <>
                <h3>WD14 本地模型</h3>
                <p className="help">
                  选择放有 ONNX 和同名 CSV 的文件夹。模型只读复用，软件不依赖
                  ComfyUI。
                </p>
                <div className="model-dirs">
                  {config.model_dirs.map((p) => (
                    <div key={p}>
                      <code>{p}</code>
                      <button
                        className="icon-button"
                        aria-label="移除模型目录"
                        onClick={() =>
                          void persist({
                            ...config,
                            model_dirs: config.model_dirs.filter(
                              (x) => x !== p,
                            ),
                          }).catch(onError)
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => void addFolder().catch(onError)}>
                  <FolderPlus size={15} />
                  添加模型文件夹
                </button>
                <h4>已发现 {boot.models.length} 套模型</h4>
                {boot.models.map((m) => (
                  <div className="model-row" key={m.id}>
                    <div>
                      <strong>{m.name}</strong>
                      <small>
                        {(m.bytes / 1024 ** 3).toFixed(2)} GB · ONNX + CSV
                      </small>
                    </div>
                    <button
                      className={config.wd14.model === m.id ? "active" : ""}
                      onClick={() =>
                        void persist({
                          ...config,
                          wd14: { ...config.wd14, model: m.id },
                        }).catch(onError)
                      }
                    >
                      {config.wd14.model === m.id ? "当前模型" : "使用"}
                    </button>
                  </div>
                ))}
                <h4>下载官方模型</h4>
                <p className="help">
                  保存在应用数据目录，支持断点续传；经配置代理下载，不会静默直连。
                </p>
                <label>
                  HTTP 代理
                  <input
                    value={config.proxy}
                    onChange={(e) =>
                      setConfig({ ...config, proxy: e.target.value })
                    }
                    onBlur={() => void persist(config).catch(onError)}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void download("SmilingWolf/wd-eva02-large-tagger-v3")
                    }
                  >
                    {busy === "download" ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    EVA02 Large v3
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void download("SmilingWolf/wd-v1-4-moat-tagger-v2")
                    }
                  >
                    MOAT v2（较小）
                  </button>
                </div>
              </>
            )}
            {tab === "characters" && (
              <>
                <h3>角色候选与特征核对</h3>
                <p className="help">
                  WD14 只提供整张图的角色候选；LLM
                  对照原图与角色特征核对归属，不把候选当作人物坐标。
                </p>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={config.lookup_characters}
                    onChange={(e) =>
                      void persist({
                        ...config,
                        lookup_characters: e.target.checked,
                      }).catch(onError)
                    }
                  />
                  <span>扩写前查库核对角色</span>
                </label>
                <label>
                  本地角色快照（JSON / JSON.GZ）
                  <input
                    value={config.character_snapshot}
                    placeholder="可选：已有 Toolkit 的 anima_animadex.json.gz"
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        character_snapshot: e.target.value,
                      })
                    }
                    onBlur={() => void persist(config).catch(onError)}
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={config.character_update}
                    onChange={(e) =>
                      void persist({
                        ...config,
                        character_update: e.target.checked,
                      }).catch(onError)
                    }
                  />
                  <span>
                    每天后台补充资料
                    <small>软件使用期间检查一次，失败保留旧资料。</small>
                  </span>
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={config.lookup_missing}
                    onChange={(e) =>
                      void persist({
                        ...config,
                        lookup_missing: e.target.checked,
                      }).catch(onError)
                    }
                  />
                  <span>
                    查不到时联网补查
                    <small>
                      通过配置代理访问 AnimaDex，来源和更新时间随资料保存。
                    </small>
                  </span>
                </label>
                <div className="notice">
                  库中没有记录时，保留不确定性，继续依据原图描述；不自动编造身份或移植其他人物特征。
                </div>
              </>
            )}
            {tab === "files" && (
              <>
                <h3>文件与输出</h3>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={config.overwrite}
                    onChange={(e) =>
                      void persist({
                        ...config,
                        overwrite: e.target.checked,
                      }).catch(onError)
                    }
                  />
                  <span>
                    备份并覆盖已有 TXT
                    <small>默认关闭，已有同名文本自动跳过。</small>
                  </span>
                </label>
                <label>
                  输出长度提醒（字符）
                  <input
                    type="number"
                    min={100}
                    value={config.output_warning}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        output_warning: Number(e.target.value),
                      })
                    }
                    onBlur={() => void persist(config).catch(onError)}
                  />
                </label>
                <p className="help">
                  超过提醒值会显示提示，完整保留内容，不截断。编辑会自动保存为
                  UTF-8 同名 TXT；历史和备份存放在应用数据目录。
                </p>
                <div className="notice">
                  图片始终保持原样。移除数据集只删除软件内索引；图片与 TXT
                  不受影响。
                </div>
              </>
            )}
            {tab === "about" && (
              <>
                <h3>
                  TK Dataset Studio{" "}
                  <span className="version">{boot.version}</span>
                </h3>
                <p>本地 WD14 · 原生 DSH 看图 · 数据集标注</p>
                <h4>应用数据位置</h4>
                <code className="path-block">{boot.data_root}</code>
                <p className="help">
                  SQLite 保存数据集目录、任务、预设和历史；thumbnails
                  为可再生缩略图缓存；backups 保存被替换的文本。
                </p>
                <h4>关闭行为</h4>
                <p className="help">
                  关闭窗口会停止本软件的任务与 WD14 工作进程，释放模型资源。已有
                  DSH 服务由其原启动方式继续管理。
                </p>
                <h4>来源与许可</h4>
                <p className="help">
                  MIT。界面分栏适配 OpenWork v0.18.63 开源组件；不含其 EE
                  模块。第三方许可见安装目录 THIRD-PARTY-NOTICES.md。
                </p>
              </>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
