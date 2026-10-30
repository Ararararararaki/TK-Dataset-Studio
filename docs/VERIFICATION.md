# 验证记录 · 2026-10-29

所有实测都在新项目中进行。原 Toolkit 仓库和 ComfyUI 运行目录仅作只读参考；没有重新启动或替换用户宿主。测试图片为两张复杂、穿着完整的可爱二次元构图的独立副本，不是单色合成图。

## caption 专用指导词与 WD14 标签强度

本轮两处改动：`backend/presets.py` 新增 `CAPTION` 指导文本，`build_task()` 在 `fmt == 'caption'` 时用它替代通用 `FAITHFUL`；`backend/server.py` 的 `DEFAULTS` 把 `wd14.threshold` 从 `.35` 改为 `.6`，`src/components/Settings.tsx` 在「已发现 N 套模型」之前加「标签强度」数字输入（0.05–0.95，步进 0.05）。

| 检查 | 实测结果 | 范围与说明 |
| --- | --- | --- |
| caption 指导词生效 | `tests/test_presets.py` 20 项通过。caption 任务文本含 `one continuous English paragraph`、`30-80 words`、`180-420 characters`、`Do not use tag lists`、`start directly with the scene`；tags / hybrid / moss 三个预设的任务文本均不含这些句子 | 断言的是 `build_task()` 的文本拼装与 `compile_output()` 的格式契约，不是模型语义准确率 |
| 指导词不串味 | 自定义 guidance 在 tags 等非 caption 格式仍优先；caption 格式下即使预设自带 guidance 也被 `CAPTION` 覆盖 | 覆盖了内置 caption 预设 `guidance=FAITHFUL` 的实际形态 |
| 参考集风格对齐 | `kase_daiki` 193 条 1:1 配对（46 PNG + 147 JPG）：字符中位 287、均值 293.2、范围 167–474；词数中位 51、范围 29–83；193 条全部单段、无换行 | 只统计字符与词数，未做人工语义评分；统计脚本只读该目录 |
| 单图标签产出（真实路径） | `E:\1资源\okitatsuki\okitatsuki 挑选后\000139.png`：阈值 0.6 下为 45 个标签 / 540 字符，当前 `000139.txt` 与 `_tags-0.6\000139.txt` 内容一致；同图上一版 `_txt-backup-20261101\000139.txt` 为 73 个标签 / 894 字符 | 单张样本，不构成批量质量承诺；备份目录名未记录当时阈值，按产出特征视为旧默认 0.35 |
| 上游拒绝（真实路径） | `E:\1资源\okitatsuki\okitatsuki 挑选后\000001.png`：库内 `status=failed`、`format=caption`、error 原文「模型拒绝了本次请求；未保存标注，不会自动重试此回复」（2026-10-30 00:06:57，该次 revision 长度 0）；provider 回复的具体理由（疑似未成年角色）为本轮人工记录，未落库 | 单张样本，不构成批量质量承诺；属上游内容政策，不是程序缺陷；软件原样记录拒绝原因，不修改提示词去绕过；磁盘上仍保留该图 683 字符的旧描述，本次失败没有覆盖它 |
| 标签强度 0.35→0.6 实测 | 同一产出集内 `_txt-backup-20261101` 与 `_tags-0.6` 同图对照 305 对：标签数中位 62（范围 8–99）→ 40（范围 20–68），303/305 张减少、2 张增多，中位比值 0.66；字符数同步下降（`000139`：894→540） | 备份目录名未记录当时阈值，按产出特征视为旧默认 0.35；两次运行的其他参数（模型、排除词）未逐项核对 |
| 标签强度默认 0.6 | `DEFAULTS['wd14']['threshold'] == 0.6`；`settings.save` 接受 0.6 与边界 0.05 / 0.35 / 0.95 并持久化；拒绝 1.5、-0.1、1.01、`'abc'`、`None`、`True`、`False`；只传 `{'wd14':{'threshold':0.6}}` 时 model/device/character_threshold/exclude_tags 不丢；被拒时不改动已存配置 | 前后端范围已一致（都是 0.05–0.95）；`character_threshold` 单独放宽到 0.05–0.99；错误文案 `阈值 <key> 应在 <low> 到 <high> 之间` |
| 全量回归 | Python 79/79；`npx tsc --noEmit` 退出 0；`npx vite build` 成功（2046 modules，383.58 kB） | `runtime/python.exe -m unittest discover -s tests -p "test_*.py" -q` |
| 桥接 `max_tokens` 与思考链预算 | `maxTokens=2048` 时收尾帧 `{"done":true,"chars":0,"usage":{"outputTokens":2048,"reasoningTokens":2048}}`，可见正文 0 字符且无 error 字段；同一输入并发 1 重跑仍为空；提到 `maxTokens=6144` 后 14 秒产出 266 字符正文 | 实测于 workbuddy `cn:deepseek-v4.1-flash`（思考型模型）。结论：空正文先查 `reasoningTokens` 是否吃满 `outputTokens`，不要先怀疑网络或并发；界面默认 8192 |

标签强度的量化口径以本机 WD14 实测为准：0.6 下标签数中位 40（范围 20–68），0.35 下中位 62。这是本机某次运行的经验值，不是对某个模型版本的基准。

## 0.1.4 可选备份与网格文本预览

- Python 48/48、Node 1/1、TS/Vite 构建通过。储存与批次用例检查关闭备份后确实没有新 TXT 备份，修改历史和旧 revision 冲突仍有效；Agent HTTP 保存也遵循同一设置。
- `node scripts/annotation-hover-e2e.cjs` 开发桌面通过：1440×900 浅色与 920×650 深色，6674 字符完整标注、空标注、键盘触发、浮层滚动、Esc、浏览区滚动关闭、悬停不改变选择；偏好刷新保持，真实 IPC 保存不生成 TXT 备份。
- 此界面夹具仅用三张占位 PNG 验证交互，不是 WD14/LLM 质量或性能样本。预览读取已有标注，无新模型请求。缓存限 128 个版本，未对一千张不同长文本同时做内存基准。
- `scripts/skills-e2e.cjs` 在 0.1.4 开发桌面再次通过，Skill 与通道可见性保留。
- 同三组桌面检查也在 0.1.4 目录包通过：`annotation-hover-e2e --packaged`、`skills-e2e --packaged`、`api-e2e --packaged`。最后一组使用真实 WD14 与模拟 API，2 张图片各 1 次请求、2 份 TXT；关闭后后端及端口释放。模拟 API 不是模型质量测试。

## 0.1.2 API 调用修复

0.1.3 补充：`runtime/python.exe -m unittest discover -s tests -p test_annotation_regressions.py` 修复前能重现“纯标签保存成功”，修复后验证纯文本、caption JSON 和 hybrid 的标签回复不计完成且不写 TXT，保留短描述和含逗号的正常描述。`node scripts/skills-e2e.cjs` 修复前捕获 272px 复选框挤出名称；修复后验证 920/1440px、深浅主题、不可自然断行的长名称、Skill 勾选持久化、主界面双通道切换及通道标签。完整 Python 检查增至 46 项。此格式检测不代替语义质量评价。

用户批次曾出现 18 张失败：5 次最终稿协议提取失败、13 次 Relay HTTP 413。复查其中一条原始回复发现模型已拒绝请求，旧错误却只报告缺少标记。这不属于可当作成功保存的提示词；新实现分别报告拒绝、过程文字、截断和正文缺失，保留真实失败，不自动换模型或通道。

| 检查 | 实测结果 | 范围 |
| --- | --- | --- |
| 真实 WD14 + 图像 API | 1/1 保存 TXT，数据库 completed=1 | 穿着完整的五人复杂二次元图；EVA02 2026 canary CPU 7.89s；WorkBuddy `cn:deepseek-v4.1-flash` 单次 LLM 4.797s、283 output tokens；不是批量速度或语义准确率承诺 |
| DSH 会话隔离 | native 调用 0 次，runId 为空 | 上述实际任务与 mock 端到端均验证；API 模式不进入 DSH 插件链 |
| 开发版及目录包界面 | 各 2/2，2 张各请求一次，2 份 TXT | 真实包内 WD14、模拟 OpenAI SSE 网关；Key 保存与脱敏、纯正文计数、默认复核关闭、正常关闭及端口释放；不将模拟网关当作真实 LLM 质量测试 |
| 回归 | Python 52/52；Node 1/1；TS/Vite 通过 | SSE reasoning 排除、截断/拒绝/413 不重发、连续失败暂停、凭据优先级、DPAPI、旧 Agent 思考等级不拦 API、原有保存/选择/任务规则 |
| 并行度 | 4/4 并发契约测试通过；真实 WD14 进程池 CPU 实测 | 三槽池六次调用并行、单槽保持串行；四张图在 wd14=2/llm=2 下两阶段同时在场（peak>1）且总耗时低于串行；真实 `Worker(1)`/`Worker(2)` 跑通 wd-eva02 2026 canary（CPU 单张 6.25s，两进程两张 7.12s 含第二个进程加载） |
| 端口桥接插件（离线） | `node dsh-bridge/test/harness.mjs` 18/18 | 三条路由注册、SSE 增量拼回正文、图片走 `admitEncodedImages`、请求不带 sessionId、缺 provider/model 400、`purge_status` 真实调用、未知工具 404、token 401/放行、上游失败回 error 帧 |
| 端口桥接（本机真机，已注入运行中的 DSH 0.2.1-rc.2 / profile web） | 2026-11-01 实测 | `GET /tk-annotate/status` 报 `service=tk-annotate-bridge`、`purge=true`、注册表可见 471 个工具（含 `purge_apply`/`purge_revert`/`purge_status`）；`purge_status` 经 `/tk-annotate/tool` 在宿主里执行成功；`/tk-annotate/run` 对真实图写出 .txt（580 字符，opencode-go/deepseek-v4.1-flash，28.4s）；PIL 造的无害图被 workbuddy / opencode-go 三个模型正确描述，证明图片通路到达模型；`GET /tk-annotate/models?provider=workbuddy` 返回 4 个模型与各自思考等级 |
| WD14 并发（CPU 稳态） | 真实 6 张对照 | 池=1 16.38s（2.73s/张）→ 池=3 11.30s（1.88s/张），约 1.45× 提速；每进程 `intra_op_num_threads=4`，CPU 下有争用，拿不到线性加速 |
| 原生附件体积 | 三个噪声图附件编码合计 <750KB | 防止旧 Relay 请求体过大；API 保持更高图像预算，不更改原图 |

复现：`node scripts/api-e2e.cjs`；目录包设置 `TKDS_QA_EXE` 后运行 `node scripts/api-e2e.cjs --packaged`。夹具位于本机 `.scratch/示例数据集`，设置从本机私有 `.scratch/current-bootstrap.json` 读取，脚本不将凭据或图片加入发行包。证据为 `.scratch/evidence/api-ui-{dev,packaged}.json`、`api-smoke.json`；截图以 `api-` 开头。

API 连接读取已验证 DSH 0.2.1-rc.2 静态 WorkBuddy / OpenAI 兼容配置。凭据优先级以本机官方 `@deepseek-ai/dsh-credentials-local` v1 实现为准；PyYAML 6.0.3 只作静态解析，未知标签不执行。没有验证所有 DSH 插件，也不声称 `dsh-purge` 随 API 直连执行。原生 Agent 通道保留，由 Host 决定插件启用及作用域。端口桥接插件已注入本机运行中的 DSH 并完成真机验证（`purge_status` 在宿主里执行成功、图片到达模型、模型目录可读），但**只验证了 `dsh-purge` 的三个工具**，其余 468 个工具的可执行性未逐个验证。

以下 0.1.0–0.1.1 原生测试是历史样本；不能用三条成功记录推断大批次可靠性。0.1.2 默认改为单次 API 出稿，复核仍可手动开启。

## 环境与版本

| 项目 | 已验证版本 / 条件 |
| --- | --- |
| 系统 | Windows 11 x64，显示缩放 150% |
| 桌面 | Electron 45.1.0；React 19.3.1；Vite 8.3.5；TypeScript 7.0.2 |
| 独立 Python | CPython 3.12.10 embed；项目 `runtime/python.exe` |
| 推理 | ONNX Runtime 1.23.2 CPU；Pillow 12.0.0；具体依赖见 lock |
| MCP | Python SDK 1.26.0，真实 stdio 客户端和 Relay 调用 |
| WD14 权重 | `wd-v1-4-moat-tagger-v2.onnx`，配套 CSV，只读使用已有安装 |
| DSH 路由 | `workbuddy / cn:deepseek-v4.1-flash / high`，记录原生 runId |
| 图片 | 850×1185 多人食物摊场景；850×981 多实例、拥抱与遮挡拼贴 |

## 实际结果

| 验证项 | 结果 | 范围与说明 |
| --- | --- | --- |
| 开发桌面 WD14 | 2/2，合计 3.272 秒 | 含首次 CPU 模型加载；25 / 34 个标签 |
| DSH 纯描述 | 1/1，75.674 秒 | WD14、原图出稿、独立复核、保存；最终 1988 字符，纯描述 |
| DSH 标签 + 描述 | 1/1，124.895 秒 | 实际两阶段原生会话；最终为标签段 + 描述段，没有 JSON 包装或过程说明 |
| DSH MOSS Layout | 1/1，130.947 秒 | 原图出稿 + 原图及两张裁切复核；10 个人物条目，合法中心化 yxyx |
| 一千张目录 | 导入 138 毫秒 | 同两张复杂原图的 1000 个本机硬链接，用于索引与滚动压力验证，不是质量样本 |
| 虚拟列表 | 起止均约 5 张卡片 DOM | 16 次跨列表跳转，两帧等待 P50 17.6ms，最大 29.7ms；不是长时间 FPS 基准 |
| 文件拖入 | 通过 | CDP 原生文件路径 → Electron File → 实际目录导入 |
| MCP 接管 | 11 个工具，实际客户端通过 | 图像附件、状态、版本保护、修改/恢复和审计；默认只读 |
| UI | 通过 | 深浅主题、列表/网格、指导词草稿、输出框高度刷新保持、切视图保存、框线预览 |
| 目录版 | 多次 2/2，合计约 3.1–4.1 秒 | 实际包内 CPU 推理；920×650 无横向溢出；包内 MCP、立即编辑后关闭保存，后端与端口释放 |
| 0.1.0 自动检查 | Python 32/32；Node 1/1；TS/Vite 通过 | 状态存储、编译器、冲突、恢复、阶段任务、Relay 协议、任务取消、资料保留与 HTTP 权限 |
| 单文件便携包 | 已实际启动并关闭 | 独立解压运行；后端、端口、便携启动器均释放 |
| 0.1.1 浏览手势 | 开发版及目录包通过 | 1000 张索引夹具；正反向框选、Ctrl/Shift/Alt、Esc、边缘自动滚动、列表/网格缩放、刷新记忆、大图锚点及拖动、适应复位、920×650 深浅主题 |

原生耗时是当前路由、当前图片和网络下的单次记录，不是统一速度承诺。SDK 会在 stderr 发出依赖注解警告，当前已测工具调用正常；未以屏蔽警告冒充兼容性修复。

## 退出与打包检查

包内 Python 已独立导入后端、ORT、Pillow 和 MCP；没有借用 ComfyUI 的 Python。旧的错误 ABI 依赖目录留在开发目录中，隔离路径不会加载它，发行过滤规则也不包含它。

验收中发现二次启动会继续执行入口、生成第二份后端并覆盖端点描述的缺陷。`scripts/single-instance-e2e.cjs` 在修复前明确失败（后端 PID 被替换），修复为未拿到实例锁时立即返回入口后通过。该回归测试同时要求第二实例迅速退出、第一份后端保持不变。

最终包的 UI、实际推理、立即编辑后关闭、进程退出与端口释放结果保存在本机 `.scratch/evidence/packaged.json`；截图在 `.scratch/screenshots/`，未把用户图片作为发行资产或提交到 Git。

## 可复现命令

0.1.1 手势验收使用 `node scripts/gestures-e2e.cjs` 与 `node scripts/gestures-e2e.cjs --packaged`。需要本机 `.scratch/scale-dataset`（1000 张重复内容索引夹具，见上表限制）；`TKDS_QA_EXE` 可指定隔离的待发布目录包，`TKDS_QA_STATE` 可指定新的独立测试数据目录。脚本不加载 WD14 或发出付费 LLM 请求。

本轮目录包跨屏框选保留 32 张选择，挂载 45 张卡片 DOM；数量随拖动时间和视口变化。Ctrl 滚轮将浏览大小从 100% 调至 122%，刷新保留；大图缩放后鼠标锚点的归一化偏差小于 0.01。窗口与后台关闭后再次验证端口可绑定，浏览器没有 JS 页面错误。证据位于 `.scratch/evidence/gestures-packaged.json`，截图以 `gestures-` 开头。

手势使用原生 [Pointer Capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture) 和非被动 [wheel 监听](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event)；在本版 Electron 上实际验证，未引入交互依赖。对框选的尾随 click 进行抑制，防止结束时再反选一次卡片。

```powershell
npm run build
npm test
./runtime/python.exe -m unittest discover -s tests -p 'test_*.py'
node scripts/single-instance-e2e.cjs
node scripts/quit-repro.cjs
node scripts/packaged-e2e.cjs
```

`packaged-e2e` 需要先设 `TKDS_WD14_MODEL_DIR` 并用 `scripts/prepare-packaged-qa.py` 建立本机隔离夹具；该准备脚本使用本次测试机器的显式配置，不是产品默认路径。其他 CDP 验收脚本需要已通过 `--remote-debugging-port=9236` 启动的测试实例，不能对用户正在处理数据的窗口直接执行。

## 质量与覆盖限制

- WD14 的这两张样本在角色阈值 0.85 时没有输出角色候选。已验证查库和原图证据的接线，未据此宣称角色识别率。
- 复杂拼贴 Layout 虽然结构与坐标合法，仍会误判部分人物可见范围、动作和服装，且有将无边框拼贴标为 multi_panel 的情况。复核增加了实例数量，未达到逐对象无误。框线预览帮助人工或 Agent 检查；本轮没有将 Layout 再送 MOSS 生图验证。
- EVA02 Large v3、2026 canary 等现有模型可列出，本轮没有对其全部跑质量或内存对比。独立发行包默认 CPU，CUDA 未进行端到端验证。
- 每日角色更新是使用期间的增量分页和补查，不是对整个训练集角色库的实时镜像。源站失败可保留旧资料；新增角色仍可能查不到。
- 列表压力测试使用重复内容，不代表一千张独立大图的磁盘、解码或 LLM 总成本。目录导入期间暂未提供中途取消。
- 原生 DSH 插件由 Host 管理；只观测到安装清单不能证明某个插件在单次会话里运行。
- **本机发行包没有 CUDA provider**：`runtime/python.exe` 的 onnxruntime 1.23.2 只报 `AzureExecutionProvider`/`CPUExecutionProvider`，选 `device=cuda` 直接报「独立运行时未安装 CUDA provider」。库里历史记录的 `raw.provider` 也全是 `CPUExecutionProvider`。因此 GPU 并发收益在本机无法测量；要用 GPU 需另装与 CUDA/cuDNN 匹配的 onnxruntime-gpu，本应用不猜版本。
- 端口桥接的 LLM 描述路线受上游内容政策限制：实测露骨内容图片被 opencode-go 明确拒绝、被 workbuddy 网关过滤成「image unavailable」。本应用**不绕过内容拒绝**（不改提示词、不诱导、不换壳重试），此类数据集只能用本地 WD14 标签。
- LLM 并发在原生 Agent 通道会同时占用多个会话；默认 2 只在 API/桥接通道有实测依据。

依赖下载与构建只使用显式代理；原生回环 MCP 和 Agent RPC 直连。没有因代理失败切换外网直连。
