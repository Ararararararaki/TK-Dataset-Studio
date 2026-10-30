# TK-Dataset-Studio 0.2.0 代码评审

- 评审对象：`a0ed70c`（父 `e449cdc`），`git diff e449cdc..a0ed70c -- backend dsh-bridge src`，22 文件 +2169/−62
- 评审环境：Windows，`./runtime/python.exe` = Python 3.12.10，node v24.22.1，DSH 运行时 `C:\Users\Administrator\dsh-runtime-0.2.1-rc.2`
- 评审方式：**只读**。除本文件外未修改仓库任何文件，未 `git add/commit/push`，未启停 DSH/GUI/训练进程，未跑 GPU 任务。
- 证据等级标注：**【实测】** = 本次跑过可复现的脚本/命令并记录输出；**【代码】** = 只凭源码与依赖源码推断，未跑；两者都不写「凭感觉」。

**统计：阻断 1 · 高 2 · 中 6 · 低 17，合计 26 条。**

**结论：不建议以当前形态发布。** 阻断项 B1 让新增的桥接通道成为「本机任意网页都能驱动宿主 471 个工具（含 `purge_apply`）」的入口；H1/H2 让取消与截断在桥接通道上静默失效，直接污染数据集。B1 的修法很小（默认开 token + 校验 Origin/Content-Type + 工具白名单），M1 也是升级即踩的破坏性变更，建议这四项修完再发。

---

## 一、阻断

### B1　`/tk-annotate/*` 无来源校验、默认无 token，任意本机网页可驱动宿主全部已注册工具

- **位置**：`dsh-bridge/lib/index.js:54-58`（`isLoopback` 只看 `req.socket.remoteAddress`）、`:108-120`（`admit` 只在 `sharedToken` 非空时才校验，默认空）、`:292-330`（`handleTool` 无工具白名单，直接 `definition.execute`）
- **触发条件**：插件装上后（`tokenRequired:false`），用户浏览器访问任意恶意/被投毒的网页；该页面对 `http://127.0.0.1:3080/tk-annotate/tool` 发一个 CORS 简单请求即可，无需预检、无需 token、无需用户点击。
- **实测证据（真机，只读工具）**：

  ```bash
  # 1) 确认线上插件在线、无 token、471 个工具
  curl -s http://127.0.0.1:3080/tk-annotate/status
  # → {"ok":true,"service":"tk-annotate-bridge","version":"0.2.0","tokenRequired":false,...,"tools":{...471 个...}}

  # 2) 伪造跨站来源 + text/plain（浏览器简单请求形状），执行真实工具
  curl -s -X POST http://127.0.0.1:3080/tk-annotate/tool \
    -H "content-type: text/plain;charset=UTF-8" \
    -H "origin: https://evil.example" \
    --data-binary '{"name":"purge_status","arguments":{}}'
  # → 200 {"ok":true,"name":"purge_status","value":{"text":"dsh-purge 状态 ..."}}
  ```

  对照组：`-H "host: evil.example"` 同样 200（无 DNS rebinding 防护）。本次**只调用了只读的 `purge_status`**（与 UI 里「验证 dsh-purge」按钮同一操作），未调用 `purge_apply`。
- **同类实测（插件副本 + 伪造 ctx，验证任意工具都能跑）**：`{"name":"purge_apply","arguments":{}}` → `200 {"ok":true,"value":{"status":"applied","patched":82}}`，执行记录 `[{tool:'purge_apply',args:{}}]`。`purge_apply` 会改写 82 处提示词层/代码默认/引擎级审批绕过，属破坏性工具。
- **为什么简单请求能过**：`text/plain` 属 CORS 白名单类型，浏览器不发预检；`mode:'no-cors'` 下攻击页读不到响应，但副作用已经发生。DSH 自身也没有兜底：`dsh-host-webserver/lib/index.js` 与 `dsh-api-gateway/lib/index.js` 全文无 `origin` / `sec-fetch-site` 校验。
- **边界说明（不夸大）**：浏览器侧还有一层 Private Network Access（public→localhost 预检）可能拦截，取决于 Chrome 版本与策略；但（a）它尚未全量强制，（b）从 `http://localhost:xxxx` 起的攻击页（大量本地开发工具、`file://` 页面）不触发 PNA，（c）本机任何脚本/其它 Electron 应用完全不受此限。**把安全性寄托在浏览器策略上不成立**，修法必须在服务端。
- **建议修法**（三条都做）：
  1. **默认要求 token**：插件启用时生成 32 字节随机 token 写入宿主配置，`/status` 只回 `tokenRequired:true` 不回 token，UI 从配置读；`admit` 里 `crypto.timingSafeEqual` 比较。
  2. **校验请求来源**：`Origin` 存在时必须等于 `http://127.0.0.1:<port>` / `http://localhost:<port>`；`Sec-Fetch-Site` 存在时必须为 `same-origin`/`none`；`Content-Type` 必须是 `application/json`（拒掉简单请求）；`Host` 必须是 `127.0.0.1:<port>`/`localhost:<port>`（防 rebinding）。
  3. **工具白名单**：`handleTool` 只放行显式声明的名字（如 `purge_status`），默认拒绝；`run` 端点同样要求 token。

---

## 二、高

### H1　客户端取消/超时后宿主继续生成并计费：`req.on('close')` 是死钩子

- **位置**：`dsh-bridge/lib/index.js:210`（`req.on('close', () => controller.abort())`，注册点在 `readJsonBody` **之后**）；同型问题 `:323`（`handleTool` 内）
- **触发条件**：任何客户端中断——TK 侧点「取消」、`Bridge.request` 的 `timeout` 到点、`Jobs.cancel` 的 `stop.set()`、网络断开。
- **根因**：Node 的 `IncomingMessage` 在请求体读完后**立即**触发 `'close'`；`readJsonBody` 已经把 body 读完，再挂监听就永远收不到该事件，`controller.signal` 从不 abort。
- **实测证据（插件副本）**：假 `llm.stream` 每 50ms 吐一个 delta、共 60 个；客户端读一帧后 `ac.abort()`。服务端计数：

  ```
  {"reqClose":1,"resClose":1,"sockClose":1,"aborted":false,"chunks":60}
  ```

  三个 close 事件都触发了，`options.signal.aborted` 始终 `false`，生成器跑满 60 帧。
  最小归因（读尽 body 后才挂监听，再 abort）：`req.on('close') 在读完 body 后注册 -> fired = false`。
- **后果**：用户点了取消，宿主仍在跑满整段生成、照常计费；TK 侧以为已取消。大 `max_tokens` + 多图时开销可观。
- **建议修法**：改用 `res.on('close', ...)`（响应侧 close 才是真正的连接终止），或在 `readJsonBody` **之前**就挂 `req.on('close')` 并用一个 `bodyDone` 标志区分「读完 body」与「连接断开」；更稳妥的是 `res.on('close', () => { if (!res.writableEnded) controller.abort() })`。修完补一个「abort 后 stream 必须提前结束」的测试。

### H2　截断与异常结束都被当成成功，坏数据直接写进数据集

- **位置**：`dsh-bridge/lib/index.js:83-89`（`finishError`）、`:84`（`if (finish === undefined) return undefined;` 死代码）、`:86`（`max-tokens` 与 `stop` 同等视为成功）
- **触发条件**：模型输出被 token 上限截断（`max_tokens` 默认 8192，长描述/多标签容易撞）；或模型流提前结束但没抛异常。
- **机制（代码 + 依赖源码）**：`BlockAssembler.finish` **永不返回 `undefined`**——`.../@deepseek-ai/dsh-llm/lib/types/assembler.js:171-173` 是 `get finish() { return this._finish ?? { kind: 'stop' }; }`。所以：
  - `index.js:84` 的 `finish === undefined` 分支是死代码；
  - 「流异常结束、没给 finish 帧」会被 `?? {kind:'stop'}` 兜成 stop → 判定成功 → 插件照发 `done:true`；
  - `max-tokens` 也走 `return undefined`（`:86`）→ 判定成功。
  连带后果：客户端 `backend/host_bridge.py:146` 的「DSH 桥接未返回完整结束帧」守卫在真实插件下**永远不可能触发**。
- **实测证据（插件副本，逐场景喂 chunk）**：

  | 模型流结尾 | `/tk-annotate/run` 返回 |
  |---|---|
  | `finish kind='max-tokens'`，文本已截为 `1girl, blue_ha` | `data: {"delta":"1girl, blue_ha"}` + `data: {"done":true,"chars":14}` → **当成功** |
  | 完全没有 finish 帧 | 同样 `done:true`，与正常结束无法区分 |
  | `kind='error'` | `data: {"error":"模型流异常结束：error"}` |
  | `kind='aborted'` | `data: {"error":"模型调用被中断：…"}` |
  | `kind='tool-calls'` | `data: {"error":"模型请求了工具调用…"}` |
  | `kind='stop'` | `done:true`（正确） |

- **放大条件（代码）**：`backend/responses.py` 的 `check_response` 只拒空正文与拒答正则，**不校验完整性/JSON 结构**；`annotation_only` 只拒过程说明。所以截断文本一路存进 `.txt`——`format='tags'` 的逗号列表被截断后仍是合法文本，肉眼几乎看不出。
- **建议修法**：
  1. `finishError` 删掉 `undefined` 分支，改为 `max-tokens` → 抛 `Error('输出被 token 上限截断，未保存')`，或回一个 `{truncated:true}` 帧让客户端按可重试失败处理；
  2. 客户端 `host_bridge.py` 增加「收到 `done` 但 `truncated`/`finish!=='stop'` → 失败」的判断，不要只靠 `done`；
  3. 顺带把 `Bridge.request` 的 `maxTokens` 默认值与 UI 的 `max_tokens` 上限对齐，并在设置页提示截断风险。

---

## 三、中

### M1　旧版合法阈值被读回后，`settings.save` 全部被拒——升级即锁死设置页

- **位置**：`backend/server.py:45-49`（`settings()` 读取路径零校验）＋ `:155-157`（新校验 `.05~.95` / `.05~.99`）
- **触发条件**：从 0.1.x 升级。旧版 `DEFAULTS.wd14.threshold = .35`，旧校验是 `0 <= n <= 1` 且不拒 bool，所以 `threshold: 0.0` 与 `character_threshold: 1.0` 在旧版是**合法**值，已写进用户的 store。
- **实测证据（真 `Server.dispatch` + 真 `Store` + 桩 self）**：把 `wd14:{threshold:0.0, character_threshold:1.0}` 写进 store → `settings()` 原样读回 `{'threshold': 0.0, 'character_threshold': 1.0}`；前端把加载到的完整配置回传、只改一个无关开关 → `REJECTED ValueError: 阈值 threshold 应在 0.05 到 0.95 之间`。改完 threshold 还会再撞 `character_threshold`（报错只提第一个键）。
- **后果**：老用户升级后**任何**保存都失败（改 provider、改并发、改开关全废），且提示指向他没动过的字段。
- **建议修法**：`settings()` 读取时做 clamp+归一化（把越界旧值夹到新区间，或标记 `needs_migration` 并在 UI 提示「旧阈值 X 已调整到 Y」）；`settings.save` 的阈值校验改为逐键收集**全部**错误一次性返回，而不是抛第一个。

### M2　暂停（`pausing`）在 `process` 内不复查，已取槽的任务照发请求

- **位置**：`backend/jobs.py:141` / `:143`（只在取槽前后判 `pausing`）、`:167-230`（`process` 内 `:173` / `:192` / `:227` **只判 `stop.is_set()`**）
- **触发条件**：某个任务连续失败 3 次或撞上鉴权错误 → `pausing=True`；此时已经通过 `:143` 检查、正在 `process` 里的任务继续跑。
- **实测/代码证据**：`grep -n pausing backend/jobs.py` 只出现在 55/94/103/106/136/137/141/143/162 —— **`process` 内零处**。
- **后果**：`wd14-llm` 流水线下，WD14 阶段（`:171`，单图可达数十秒）完全不受暂停约束，暂停后仍会继续发 LLM 请求并继续计费；`llm` 流水线下 `references.lookup`（`:176`）也是窗口。
- **建议修法**：在 `process` 的 WD14 之后、LLM 之前各加一次 `if self.pausing: raise asyncio.CancelledError()`（配合 `one` 的 interrupted 分支把 item 留在 pending），或引入一个 `asyncio.Event` 让 `pausing` 可被 await。

### M3　桥接离线/配置缺失时仍能启动任务，要跑坏 3 张图才停

- **位置**：`backend/api_transport.py:102-108`（`bridge_catalog` 捕获 `NativeFailure` 后返回 `connected:False`，**不抛**，且返回值无 `capabilities`）＋ `backend/jobs.py:71-83`（`default`/`groups` 从 `catalog['capabilities']['models']` 取，取不到就静默跳过校验）
- **触发条件**：transport=`bridge`，但 DSH 没开、端口不对、provider/model 没填。
- **实测/代码证据**：`bridge_catalog` 成功/失败两种返回都没有 `capabilities` 字段（`:106-108`），所以 `jobs.py:72` 的 `default` 恒为 `{}`、`:79-83` 的 groups 恒为空 → provider/model 校验与思考强度校验全部跳过；失败信息只落在 `catalog.error` 里，`Jobs.start` 不看它。
- **后果**：任务正常启动，每张图都因 `host_bridge.py:74-75`（缺 provider/model）或连接失败而报错，连续 3 次后 `pausing`，用户看到「任务已暂停」而不是「桥接没连上」。
- **建议修法**：`Jobs.start` 在 `transport=='bridge'` 时检查 `catalog.get('connected')`，未连接直接拒绝启动并回显 `catalog.error`；`bridge_catalog` 至少补 `capabilities:{models:{default,groups}}`（从 `/models` 组装），让既有校验路径自然生效。

### M4　96MB 请求体无预检、无并发上限，可被同源脚本打爆内存

- **位置**：`dsh-bridge/lib/index.js:28`（`MAX_BODY_BYTES = 96 * 1024 * 1024`）、`:58-79`（`readJsonBody` 只累加 `size`，不预检 `Content-Length`、无超时、无背压）
- **触发条件**：任意能连到 3080 的客户端（含 B1 的跨站场景，`no-cors` 也能发）并发 POST 大 body。
- **代码证据**：`readJsonBody` 在 `for await (const chunk of req)` 里累加到超限才抛，此时已经缓冲到内存；`handleRun` 之前没有任何 in-flight 计数或限流。
- **后果**：宿主进程内存被打满（96MB × N 并发），DSH 卡死；与 LoRA 训练同机时影响更大。
- **建议修法**：先读 `Content-Length` 超限直接 413；`MAX_BODY_BYTES` 降到实际需要（图片 base64 走 attachments 的话几 MB 足够）；加一个简单的 in-flight 计数器（如同时最多 2 个 `/run`）。

### M5　`bootstrap()` 版本号硬编码 `0.1.4`，UI 直接显示错误版本

- **位置**：`backend/server.py:101`（`'version': '0.1.4'`）；显示点 `src/App.tsx:681`、`src/components/Settings.tsx:785`
- **触发条件**：恒成立。
- **实测/代码证据**：仓库 `package.json` = `0.2.0`，`bootstrap()` 却回 `0.1.4`，而 `App.tsx:681` 渲染 `TK Dataset Studio {boot.version}`、`Settings.tsx:785` 渲染 `{boot.version}`。
- **后果**：用户看到 0.1.4，报障与支持全部错位；也让「这份代码是不是 0.2.0」无法自证。
- **建议修法**：从 `package.json` 读（后端已能读仓库根 package.json），或注入构建期常量；加一条断言 `bootstrap.version === package.json.version` 的单测。

### M6　`concurrency` 非 dict 时原样落盘，`Jobs.run` 抛 `AttributeError` 且任务停在 running

- **位置**：`backend/server.py:138-143`（`if isinstance(conc, dict)` 为假就完全跳过校验并原样存）＋ `backend/jobs.py:118-120`（`concurrency.get(...)`）
- **触发条件**：`settings.save` 收到 `concurrency:"abc"` / `concurrency:null`（前端不该发，但 dispatch 是公开入口，`api('settings.save', …)` 任意客户端可发；旧版 store 里也可能残留）。
- **实测证据**：`concurrency:"abc"` → ACCEPTED 且原样落盘；随后 `Jobs.run` → `AttributeError: 'str' object has no attribute 'get'`（`jobs.py:119`）。该异常发生在 `try` 之前，`finally` 不执行 → `jobs.state` 不更新、无 notify，任务行永远停在 `running`。
- **建议修法**：`settings.save` 里 `concurrency` 必须是 dict（`isinstance` 为假就 raise），且逐键做 `type(v) is int` 严格校验；`Jobs.run` 取值包一层 `isinstance(...,dict) or {}` 兜底。

---

## 四、低

| # | 位置 | 问题 | 触发/证据 | 建议 |
|---|---|---|---|---|
| L1 | `backend/host_bridge.py:122,130,162` | SSE 分帧失败报误导性错误：「请检测端口与插件状态」 | **实测**：delta 含 U+2028/U+2029，或出现非 JSON 的 `data: ping` 帧 → `aiter_lines` 用 `splitlines()` 在此类字符处切行 → `json.loads` 抛 → 落到 `:162` 的泛化文案，且 `retryable=False` | 区分「连接失败」与「帧解析失败」两种文案；解析失败时带上帧前 120 字符 |
| L2 | `backend/host_bridge.py:20-28` | `endpoint()` 不校验 path | **实测**：`http://127.0.0.1:3080/path` → ACCEPT，后续拼成 `/path/tk-annotate/status` 得 404 | 拒绝非空 path（或强制 strip） |
| L3 | `backend/host_bridge.py:20-28` | 非法端口抛裸 `ValueError`（英文、未捕获） | **实测**：`http://127.0.0.1:abc` → `ValueError: Port could not be cast to integer value as 'abc'`；`http://127.0.0.1:99999` → `ValueError: Port out of range 0-65535`；`endpoint()` 只 catch 自己的 NativeFailure | 用 `try: parts.port except ValueError` 包住并转成中文 NativeFailure |
| L4 | `backend/server.py:176` | `dsh.tool` 缺 `name` 时 `KeyError` 变成错误串 `'name'` | **实测**：`api('dsh.tool',{})` → `{'error': "'name'"}` | 显式校验 `name` 非空并回中文错误 |
| L5 | `dsh-bridge/lib/index.js:115` | token 用 `!==` 非恒时比较 | **代码**：`if (given !== sharedToken)`；配合默认空 token，实际风险低（回环 + 无 token） | 改 `crypto.timingSafeEqual`；真正修法是 B1 的默认开 token |
| L6 | `dsh-bridge/lib/index.js:58-79` | `readJsonBody` 无读超时 | **代码**：慢速客户端可长期占住连接（slow-loris） | `req.setTimeout(30_000)` |
| L7 | `backend/jobs.py:140-141` | 第 4 次及以后每次失败都重复 notify | **代码**：`if count >= 3: notify(...)` 在 guard 外，`count` 单调递增 | 只在 `count == 3` 时 notify |
| L8 | `backend/jobs.py:223` | repair 路径只传 `config.get('dsh',{})`，丢了 `proxy` 与 `detail_pass` | **代码**：对比 `:198-199` 的完整 `{**config['dsh'],'proxy':…,'detail_pass':…}` | 抽一个 `bridge_config(config)` 两处共用 |
| L9 | `src/components/Settings.tsx:62-71` | `probe()` 无序号/abort 守卫 | **代码**：并发点「检测连接」时旧响应可能覆盖新 catalog | 加 `seq` 计数，回包时比对 |
| L10 | `src/components/Settings.tsx:373` | `currentModel?.reasoning.length` 未对 `reasoning` 做可选链 | **代码**：`/models` 返回项若缺 `reasoning` 则 TypeError 整页白屏 | `currentModel?.reasoning?.length` |
| L11 | `src/components/Settings.tsx:37-53` | 切 provider 时旧模型列表短暂残留 | **代码**：只在 `!bridgeProvider` 分支 `setModels([])` | 进入 effect 先 `setModels([])` |
| L12 | `backend/server.py:138-143` | `concurrency` 不做深合并，部分对象把未提供的键重置为 1 | **实测**：`{wd14:3}` → 落盘 `{wd14:3, llm:1}` | 与 wd14/dsh 一致地做 `{**current, **value}` |
| L13 | `backend/jobs.py:45-48` | `_Slot` 取消路径不清理 in-flight 子进程 | **代码**：`infer` 的 `finally` 只 `put_nowait(slot)`，取消时子进程仍在算，下次 `infer` 可能读到上一次的输出 | 在 `finally` 里若 `CancelledError` 则 `await slot.close()` 再回池 |
| L14 | `backend/jobs.py:36-39` | `Worker.configure` 丢弃 live slot 不 `close` | **代码**：`self.slots=[]; self.free=None` 直接丢弃；当前单任务串行使其不可达，属潜在 | 丢弃前 `await close()`，或断言无 in-flight |
| L15 | `backend/jobs.py:14` | 所有 slot 共用同一个 `wd14-worker.log`，`'ab'` 追加 | **代码**：多进程同时写同一文件，行会交错 | 按 pid 或 slot 序号分文件 |
| L16 | `dsh-bridge/package.json`（0.1.0） vs 运行实例 `/status`（0.2.0） | 仓库源码与线上插件版本不一致 | **实测**：`/status` 报 `version:"0.2.0"`；`index.js:33` 从 `dsh-bridge/package.json` 读版本，而仓库该文件是 `0.1.0` → 线上不是这份源码构建的 | 发布流程里加「仓库版本 == 部署版本」校验 |
| L17 | `backend/host_bridge.py:82-84` + `backend/jobs.py:200` | 失败时 `images.native` 停在 `status:'running'` | **代码**：`meta['status']='succeeded'` 只在成功分支（`:94`）；`:200` 的落库也只在成功路径 | 失败时也写一次 `meta['status']='failed'` |

---

## 五、已查、无问题的方向（附查法，不留白）

| 怀疑方向 | 结论与查法 |
|---|---|
| `endpoint()` 能否被 URL 技巧绕过（`@`、scheme、端口、userinfo、query、fragment、大小写） | **无问题**。**实测** 10 个值：`http://127.0.0.1:3080@evil.com`（hostname 解析为 evil.com）、`http://evil.com:3080`、`https://…`、无端口、带 query/fragment/userinfo、裸 `127.0.0.1:3080` → 全部 REJECT；`http://[::1]:3080`、`http://LOCALHOST:3080` → 正确 ACCEPT。`./runtime/python.exe -m unittest tests.test_host_bridge -q` → Ran 7 tests OK |
| `Bridge.annotate` 的 `active` 集合与取消任务是否泄漏 | **无问题**。**代码**：`host_bridge.py:86` `active.add(operation)`，`:96-100` `finally` 里 `cancel.cancel()` + `operation.cancel()` + `gather(return_exceptions=True)` + `active.discard(operation)`，正常/异常/取消三条路径都覆盖 |
| `connections.settings()` 的 dsh 子字典摊平会不会让自定义 `bridge_url` 失效 | **无问题**（原怀疑不成立）。**代码**：`server.py:22` 是 `lambda: {**self.settings()['dsh'], 'proxy': …}`，`bridge_url` 就在 `dsh` 子字典里，`Bridge.base(config)` 的 `config.get('bridge_url')` 能取到 |
| `isLoopback` 是否漏掉常见回环写法 | **无问题**。**代码**：`index.js:54-58` 覆盖 `127.0.0.1` / `::1` / `::ffff:127.0.0.1` 三种 `remoteAddress` 形态（IPv4-mapped 已含） |
| 前端 models `useEffect` 的竞态 | **无问题**。**代码**：`Settings.tsx:37-53` 有 `live` 清理标志，effect 重跑或卸载时旧请求的回包被丢弃（残留问题只有 L11 的「不置空」） |
| `handleModels` 出错时回 `200 {ok:false}` 会不会被客户端当成功 | **无问题**。**代码**：`host_bridge.py:164-181` 判的是 `value.get('ok') is not True` 就抛，不依赖 HTTP 状态码 |
| 插件是否忽略请求里的 `system` 提示词 | **无问题**。**代码**：`index.js:233-237` 取 `body.system`，非空则 `createSystemMessage`，`host_bridge.py:78` 确实传了 `SYSTEM` |
| `annotate()` 的 transport 分派有没有漏掉 api 分支 | **无问题**。**代码**：`api_transport.py:113-115` `{'native':…, 'bridge':…}.get(config.get('transport'), self.api)`，`api` 走默认值 |
| 客户端 SSE 对正常流/注释行/`event:` 前缀/空 body/缺 done 的处理 | **无问题**。**实测** 10 例：正常 2 帧 + done → `'1girl, blue_hair'`；`: keepalive` 注释行、`event:` 前缀行正常跳过；空 body 与缺 done → 正确报「未返回完整结束帧」（`host_bridge.py:146`）；delta 内 `\t`/`\r` 正常（JSON 已转义） |
| `LlmProviderInfo` 形状与 Settings 的 `p.id`/`p.name` 取值 | **无问题**。**代码**：`.../dsh-llm/lib/types/types.d.ts:205-210` 是 `{id: string, name: string}`，`listProviders()` 同步返回对象数组 |
| 错误帧会不会泄漏 stack / 内部路径 | **无问题**。**代码**：`index.js` 的 catch 只写 `{error: String(...)}` 再 `res.end()`；`host_bridge.py` 侧也只透传 `value.get('error')` |
| `settings.save` 的 bool 拒绝是否生效（阈值/max_tokens/timeout） | **无问题**。**实测**：`threshold: true` → REJECTED（`isinstance(n,bool)` 生效）；`max_tokens`/`timeout` 用 `type(n) not in (int,float)` 排 bool |
| `concurrency` 的 0 / 越界是否被拒 | **无问题**。**实测**：`{wd14:0}` → REJECTED「并行度必须是 1 到 8 之间的整数」 |

---

## 六、测试覆盖缺口

新增测试**全绿**（`./runtime/python.exe -m unittest discover -s tests -p "test_*.py" -q` → Ran 79 tests, OK, 16.5s），但覆盖不到本次改动的主要风险面：

1. `tests/test_concurrency.py` 的两个用例都 `monkeypatch(jobs_module._Slot, 'infer')`，**真实子进程路径零覆盖** —— `_Slot.infer` 的重启判定、240s 超时、`if not line` 分支、取消后的槽位复用（L13）全部没跑过。
2. `Worker.configure` 的缩容/扩容路径没测（L14）。
3. `tests/test_host_bridge.py` 的 SSE 用例是「整段回放」，**没有分块边界**：U+2028/U+2029 切行（L1）、多 `data:` 行、超大帧都没覆盖。
4. 取消链路没测：H1 那种「客户端 abort 后宿主必须停」在插件侧无测试，`Jobs.cancel` 的 12s 超时分支也无测试。
5. `settings.save` 的迁移场景（M1 的旧阈值）与 `concurrency` 的非法类型（M6）无测试。
6. 插件侧完全没有自动化测试（`dsh-bridge/` 下无 test 脚本），本次评审的插件结论全靠临时脚本复现。

建议补三条最小的回归：① 旧 store（threshold=0）升级后 `settings.save` 必须成功；② 客户端 abort 后 `/run` 的 stream 必须提前结束；③ `finish kind='max-tokens'` 必须返回可识别的截断标记而不是 `done:true`。

---

## 附录：复现环境

```bash
# 全部命令在仓库根执行
cd "E:/claude program/TK-Dataset-Studio"
./runtime/python.exe -m unittest discover -s tests -p "test_*.py" -q   # 79 tests OK
./runtime/python.exe -m unittest tests.test_host_bridge -q              # 7 tests OK
```

插件级复现用的临时垫片（不污染仓库）：在 `%TEMP%/tkrev2` 下建 `node_modules/@deepseek-ai/dsh-llm` junction 指向运行时包，再放一份 `dsh-bridge/lib/index.js` 副本，用伪造 `ctx`（`effect` / `webServer.register` / `llm.stream` / `get('tools')`）挂起路由后用 `fetch` 打本机端口。

> 注意：不要把 `@deepseek-ai/dsh-llm` 用 `module.registerHooks` 重定向到 `file://` URL —— 该包内部 `createRequire(import.meta.url)('../package.json')` 会解析到不存在的 `lib/package.json`，报 `Cannot find module '../package.json'`，整包加载失败。走 `node_modules` 裸名解析才正常。
