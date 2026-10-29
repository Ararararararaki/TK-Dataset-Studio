# TK Dataset Studio

面向图片训练集的 Windows 桌面打标工作区。图片、最终标注和 WD14 原始标签放在同一张卡片中；左边管理数据集，右边调整预设、模型与指导词。独立运行，不需要启动 ComfyUI。

**[下载 Windows x64 便携版](https://github.com/Ararararararaki/TK-Dataset-Studio/releases/latest)** · [首次使用指南](docs/QUICKSTART.zh-CN.md) · [更新记录](CHANGELOG.md)

普通用户下载 Release 中的 `TK-Dataset-Studio-版本号-Windows-x64.exe` 即可，不需要安装 Python、Node.js 或 ComfyUI。源码页面的「Download ZIP」不是可直接运行的桌面包。

## 开始使用

1. 打开 `TK Dataset Studio.exe`。本机桌面快捷方式指向已构建的应用目录；整个 `win-unpacked` 目录需要保留。也可使用单文件便携发行包。
2. 把图片文件夹或图片拖入窗口，或点击「导入图片文件夹」。目录会递归扫描，原图不移动。
3. 在右侧选择输出预设、WD14 模型和处理方式，点击「开始打标」。未勾选图片时处理整个当前数据集；勾选后仅处理所选图片。
4. 结果自动写到原图旁的同名 UTF-8 `.txt`。直接编辑文本也会自动保存。点击图片可放大；图片可拖出到其他支持文件拖放的应用。

首次使用需要选择 WD14 模型，或配置仅 LLM 看图。安装包不附带模型权重、用户图片、账号和 API Key。

主界面「看图模型与通道」直接切换 **API 直连 / DSH Agent**，当前通道显示在开始按钮旁。仅 WD14 时显示「WD14 本地」。辅助 Skill 支持多选，名称与选择数量可直接查看。自然语言预设收到明显的纯标签列表时会报告格式不符，不当作成功标注保存；这不等于自动保证语义准确率。

## 浏览与选择

- 在列表或网格的空白处、卡片边缘按住左键拖动即可框选。靠近上下边缘会自动滚动，可跨屏连续选图。
- Shift＋框选追加选择，Ctrl＋框选反选，Alt＋框选减选；Esc 撤销当前框选。原有复选框与 Shift 连选继续可用。图片本身保留原图拖出，编辑框保留文本编辑。
- 鼠标放在图片工作区，Ctrl＋滚轮调整图片显示大小（60%–200%）。上方显示比例，可用减号、加号调整，点击比例恢复 100%。列数自动适应，大小会持久保存。
- 打开大图后，Ctrl＋滚轮围绕鼠标位置放大（适应尺寸的 1–8 倍），拖动查看细节；双击或点击「适应」恢复完整显示。Layout 框与图片同步缩放，Esc 关闭。

## 四种输出

| 预设 | 最终 TXT 内容 | 默认处理方式 |
| --- | --- | --- |
| Danbooru 标签 | 逗号分隔标签，角色候选优先 | WD14 |
| 自然语言描述 | 纯英文图像描述 | WD14 + 看图 API，单次出稿 |
| 标签 + 自然语言 | 第一段标签，空一行后英文描述 | WD14 + 看图 API，单次出稿 |
| MOSS Layout | 中心化 `yxyx` JSON | WD14 + 看图 API，单次出稿 |

可切换为「仅 LLM 看图」；纯 WD14 只能生成标签。指导词可直接编辑，草稿会记住；「另存预设」创建可命名的持久预设，之后可以保存修改或删除。内置预设保留原版，恢复按钮可撤销当前指导词草稿。

**TXT 只保存最终标注。** 读文件说明、思考过程、工具输出、错误和拒绝消息不作为标注保存。自然语言预设直接请求纯描述，也兼容旧 JSON 草稿的 `caption`，文件中不带该 JSON 包装。输出字符数设置用于超长提醒，应用不截断文本；API 的 token 上限单独设置，服务截断时明确报错，不保存残稿。

## API 直接打标（默认）

在「设置与模型 → DSH 连接」选择「直接 API」。默认读取 DSH Profile 的静态 OpenAI 兼容连接，也可手动填写 Base URL、模型 ID 和 API Key。点击「检测连接」，再在右侧选择模型即可。手动 Key 仅使用当前 Windows 账号的 DPAPI 加密存储，不放入 UI 状态、任务配置或导出文件。

图片与指导词在同一次模型请求中直接传输，不创建 DSH 会话或任务文件。默认每张图只出稿一次；独立复核可手动开启，会额外产生一次请求。API 超时、拒绝、截断或连接失败不自动重发，连续三张失败会暂停批次，避免持续消耗。

**读取 DSH 连接不等于执行 DSH 插件。** 此模式不进入 DSH Agent/会话插件链，仍保留 WD14、角色资料、本地 Skill 参考、自定义指导词和 Layout 编译。需要原生 Agent 时可切换下述模式，不会静默改用另一通道。本机原 Toolkit 节点保存的 WorkBuddy API 默认连接也是直连；节点的「DSH 原生」是另一条执行路径。具体插件是否运行，不能只凭安装清单或连接名称判断。

静态连接适配已验证 DSH 0.2.1-rc.2 的 WorkBuddy 和 OpenAI 兼容 pi-ai 配置；动态 JavaScript 配置不会执行，无法解析的提供商可使用手动 API。外网 API 使用显式 Clash 代理，回环网关直连。无需为了切换模型重启 ComfyUI。

## WD14 模型

在「设置与模型 → WD14 模型」添加现有模型目录，或下载内置来源中的 MOAT v2 / EVA02 Large v3。手动添加时，同一目录需要 `模型名.onnx` 和 `模型名.csv`；CSV 必须与权重匹配。可登记多个目录，不复制已有模型。

默认使用独立 CPU ONNX Runtime。普通标签阈值默认 `0.35`，角色阈值 `0.85`；角色阈值过高可能没有角色候选。模型给出的候选是整张图的标签，不是人物检测框。

本版发行包不含 GPU ONNX Runtime。选择 CUDA 时若当前独立运行时没有 CUDA provider，会明确报错。需要 GPU 的部署应单独验证 ONNX Runtime、CUDA、cuDNN 的版本组合，不修改 ComfyUI 的 Python 环境。

外网模型下载使用「文件与输出」中的代理，默认 `http://127.0.0.1:7890`。代理不可用时保留失败和断点，不改走直连。

## DSH 原生连接

在连接设置显式选择「完整 DSH Agent」。需要已有 DSH 和提供原生执行接口的 **Harness Relay**，接入其公开 MCP 工具；模型、Agent 预设和插件配置由 DSH 管理。此通道会创建独立会话，界面会明确提示。

1. 正常启动 DSH，在 DSH 中配置可看图的模型与账号。默认发现 `~/.dsh/plugins/dsh-relay/web/relay-endpoint.json`；自定义安装可在本软件「DSH 连接」选择描述文件。
2. 点击「检测连接」。若没有可验证的启动记录，请先在 DSH 自己的启动入口启动一次。软件里的启动按钮只使用 Relay 记录的已安装启动器。
3. 在「DSH 连接」选择一个 **DSH 已注册的工作区**。如无合适目录，先在 DSH 添加专用空目录，然后重新检测。软件仅在该目录的 `.tk-dataset-studio` 子目录保存任务说明。
4. 右侧模型选项默认跟随 DSH 当前模型，也可明确选定 provider/model、思考强度、原生 Agent 预设，并多选本地辅助 Skill。开始批次时固定本批次的配置，改设置影响下一批。

软件逐图新建原生只读会话，发送真实图片附件。开启复核时，第二次原生调用携带原图与两个重叠细节裁切。任务状态保留实际模型和会话链接，可到 DSH 核对。安装了插件不代表插件在每次会话中实际执行，不能据此保证输出质量。本软件没有复刻插件的过滤、权限或绕过逻辑。

角色查库可常驻启用：本地快照和已缓存资料先提供参考；启用每日更新时，每天在软件运行期间增量检查一页，查不到角色时可按需补查。更新失败保留旧资料。资料和 WD14 候选都不能替代看图，也不能保证同一画面中每个人物的身份定位准确。

## 保存、重试与关闭

- 已有 TXT 默认跳过。覆盖与「覆盖前备份 TXT」可单独开关；关闭备份后仍采用原子写入并保留修改历史。网格悬停可滚动查看完整标注并复制；原图不改动。
- 运行期间手动编辑、外部修改 TXT、原图变化和同名不同格式图片的 TXT 冲突会阻止静默覆盖。可在历史中核对未覆盖的生成结果。
- 「暂停」在当前图片完成后暂停；「取消」停止本软件的任务。崩溃后批次恢复为暂停，已有 DSH 运行 ID 用于核对。升级前的旧 Agent 批次保留记录，请用当前连接「重试失败」或重新选择图片，不会自动继续旧会话。
- 关闭窗口会先保存编辑草稿，再停止本软件的后端、WD14 工作进程和 Agent 端口。没有隐藏托盘常驻。原来已开启的 DSH 和 ComfyUI 不会被关闭；由本软件启动的 DSH 子进程随本软件释放。
- UI 会记住数据集、主题、分栏宽度、滚动位置、预设草稿、图片显示大小和输出框高度。离线目录可以重新定位，移除目录仅移除索引。

默认应用数据目录为 `%APPDATA%/TK Dataset Studio`；精确路径见「关于与数据」。其中包含数据库、缩略图、备份、任务记录与 Agent 凭据。**备份数据应先关闭应用，再复制整个数据目录。** 数据集中的原图和 TXT 另行备份。

## Agent 接管

「设置与模型 → Agent 接管」可复制 stdio MCP 配置。默认只读；开启「允许 Agent 操作与修改」后，Agent 能导入、启动批次、查看图片、改标注、维护预设、暂停和恢复。GUI 与 Agent 使用同一份任务和版本记录。详见 [Agent API](docs/AGENT-API.md)。

## 开发与构建

独立项目，不修改 Toolkit 的开发、发布或运行目录。Windows x64；Node 及可运行 pip 的 Python 用于初次准备。外网必须先准备 Clash 代理。

```powershell
$env:HTTP_PROXY='http://127.0.0.1:7890'
$env:HTTPS_PROXY=$env:HTTP_PROXY
$env:ALL_PROXY=$env:HTTP_PROXY
$env:NO_PROXY='127.0.0.1,localhost,::1'
$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'
npm ci
python scripts/bootstrap.py
npm run build
npm test
./runtime/python.exe -m unittest discover -s tests -p 'test_*.py'
npm run desktop
npm run package:dir
npm run package
```

Bootstrap 将 CPython 3.12.10 和固定依赖放在项目自己的 `runtime`，不安装到系统或 ComfyUI 环境。脚本要求用于准备的 Python 已有 pip；网络下载显式使用代理。运行环境通过 `_pth` 隔离，依赖锁在 `backend/requirements.lock.txt`。开发热更新可先运行 `npm run dev`，另一个终端设 `TKDS_DEV_URL=http://127.0.0.1:5196` 后运行 `npm run desktop`。

架构见 [CONTEXT.md](CONTEXT.md)，实测范围和限制见 [验证记录](docs/VERIFICATION.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 参考与许可

桌面布局与分栏适配参考 [OpenWork v0.18.63](https://github.com/different-ai/openwork/tree/v0.18.63)，采用 React/Electron 独立实现；未包含其服务端或企业模块。WD14 预处理参考 [ComfyUI-WD14-Tagger](https://github.com/pythongosssss/ComfyUI-WD14-Tagger)。保留许可说明于 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。模型许可由对应模型卡决定，发行包不捆绑权重。
