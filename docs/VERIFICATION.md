# 验证记录 · 2026-10-29

所有实测都在新项目中进行。原 Toolkit 仓库和 ComfyUI 运行目录仅作只读参考；没有重新启动或替换用户宿主。测试图片为两张复杂、穿着完整的可爱二次元构图的独立副本，不是单色合成图。

## 0.1.2 API 调用修复

用户批次曾出现 18 张失败：5 次最终稿协议提取失败、13 次 Relay HTTP 413。复查其中一条原始回复发现模型已拒绝请求，旧错误却只报告缺少标记。这不属于可当作成功保存的提示词；新实现分别报告拒绝、过程文字、截断和正文缺失，保留真实失败，不自动换模型或通道。

| 检查 | 实测结果 | 范围 |
| --- | --- | --- |
| 真实 WD14 + 图像 API | 1/1 保存 TXT，数据库 completed=1 | 穿着完整的五人复杂二次元图；EVA02 2026 canary CPU 7.89s；WorkBuddy `cn:deepseek-v4.1-flash` 单次 LLM 4.797s、283 output tokens；不是批量速度或语义准确率承诺 |
| DSH 会话隔离 | native 调用 0 次，runId 为空 | 上述实际任务与 mock 端到端均验证；API 模式不进入 DSH 插件链 |
| 开发版及目录包界面 | 各 2/2，2 张各请求一次，2 份 TXT | 真实包内 WD14、模拟 OpenAI SSE 网关；Key 保存与脱敏、纯正文计数、默认复核关闭、正常关闭及端口释放；不将模拟网关当作真实 LLM 质量测试 |
| 回归 | Python 43/43；Node 1/1；TS/Vite 通过 | SSE reasoning 排除、截断/拒绝/413 不重发、连续失败暂停、凭据优先级、DPAPI、旧 Agent 思考等级不拦 API、原有保存/选择/任务规则 |
| 原生附件体积 | 三个噪声图附件编码合计 <750KB | 防止旧 Relay 请求体过大；API 保持更高图像预算，不更改原图 |

复现：`node scripts/api-e2e.cjs`；目录包设置 `TKDS_QA_EXE` 后运行 `node scripts/api-e2e.cjs --packaged`。夹具位于本机 `.scratch/示例数据集`，设置从本机私有 `.scratch/current-bootstrap.json` 读取，脚本不将凭据或图片加入发行包。证据为 `.scratch/evidence/api-ui-{dev,packaged}.json`、`api-smoke.json`；截图以 `api-` 开头。

API 连接读取已验证 DSH 0.2.1-rc.2 静态 WorkBuddy / OpenAI 兼容配置。凭据优先级以本机官方 `@deepseek-ai/dsh-credentials-local` v1 实现为准；PyYAML 6.0.3 只作静态解析，未知标签不执行。没有验证所有 DSH 插件，也不声称 `dsh-purge` 随 API 直连执行。原生 Agent 通道保留，由 Host 决定插件启用及作用域。

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

依赖下载与构建只使用显式代理；原生回环 MCP 和 Agent RPC 直连。没有因代理失败切换外网直连。
