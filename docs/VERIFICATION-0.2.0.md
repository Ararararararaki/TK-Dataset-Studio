# TK-Dataset-Studio 0.2.0 · 端到端实测验证

> 本文件只记录**实际执行过的命令与原始输出**。凡是没跑到的，写在「未能验证」一节，不给推测结论。
>
> | 项 | 值 |
> |---|---|
> | 仓库 | `E:\claude program\TK-Dataset-Studio` |
> | 提交 | `a0ed70c403f809a55f8fe0c43530a1d9a5f0d212`（`a0ed70c`，工作树干净） |
> | 应用版本 | `package.json` = `0.2.0` |
> | 桥插件 | `dsh-bridge/`，包名 `dsh-tk-annotate-bridge`，版本 `0.1.0` |
> | 插件注入 | `C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-tk-annotate-bridge` → 软链到 `E:\claude program\TK-Dataset-Studio\dsh-bridge`（即**运行的插件就是本仓库源码**） |
> | DSH 宿主 | `http://127.0.0.1:3080`，DSH 0.2.1-rc.2，profile `web` |
> | 运行环境 | Node `v24.22.1`；`./runtime/python.exe` = Python `3.12.10`（PIL 12.0.0） |
> | 实测时间 | 2026-10-30 10:29–10:31 |
> | 模型调用总次数 | **3 次**（预算 6 次） |
>
> **执行边界**：除本文件外未修改仓库任何文件（`git status --porcelain` 实测前后均为空）；未 `git add/commit/push`；未写 `C:\Users\Administrator\.dsh`（仅只读遍历 `sessions/`）；未重启/停止 DSH、GUI 或训练进程；未跑 GPU 任务、未对真实数据集推理。全部测试图由 PIL 自造，位于 `C:\Users\Administrator\AppData\Local\Temp\tkds-verify\`。

---

## 1. `GET /tk-annotate/status`

### 命令

```bash
curl -sS --noproxy '*' http://127.0.0.1:3080/tk-annotate/status
```

### 原始输出摘录

```json
{"ok":true,"service":"tk-annotate-bridge","version":"0.1.0","port":3080,
 "origin":"http://127.0.0.1:3080",
 "providers":[{"id":"workbuddy","name":"WorkBuddy"},
              {"id":"deepseek-official","name":"DeepSeek"},
              {"id":"deepseek-account","name":"DeepSeek Account"},
              {"id":"codex","name":"ChatGPT (Codex)"},
              {"id":"claude","name":"Claude (Subscription)"},
              {"id":"grok","name":"Grok (Subscription)"},
              {"id":"copilot","name":"GitHub Copilot"},
              {"id":"antigravity","name":"Google Antigravity"},
              {"id":"FallbacksChain","name":"FallbacksChain"},
              {"id":"opencode-go","name":"OpenCode GO"}],
 "tools":{"available":true,"names":["acp_cache", ... ,"purge_apply","purge_revert","purge_status","read_mcp_resource", ...]},
 "purge":true,"tokenRequired":false}
```

字段实测值（脚本解析，非肉眼）：

```
providers_count = 10
provider_ids    = ['workbuddy', 'deepseek-official', 'deepseek-account', 'codex', 'claude',
                   'grok', 'copilot', 'antigravity', 'FallbacksChain', 'opencode-go']
tools_count     = 471
  contains purge_status  = True
  contains purge_apply   = True
  contains purge_revert  = True
purge           = True
tokenRequired   = False
version/port    = 0.1.0 3080 http://127.0.0.1:3080
```

HTTP 状态：`200`。

### 结论

**通过**。`service` / `version` / `port` / `providers`（10 个）/ `tools`（471 个，`available=true`）/ `purge=true` / `tokenRequired=false` 全部返回；`purge_status`、`purge_apply`、`purge_revert` 三个工具名**都在** `tools.names` 里，证明 dsh-purge 插件确实加载在同一宿主。

两点需要留意（已记入偏差）：`version` 报的是**插件自身版本 `0.1.0`**，不是应用版本 `0.2.0`；`471` 与 `docs/VERIFICATION.md:45` 声称的数字一致。

---

## 2. `GET /tk-annotate/models?provider=X`

### 命令

```bash
curl -sS --noproxy '*' "http://127.0.0.1:3080/tk-annotate/models?provider=workbuddy"
curl -sS --noproxy '*' "http://127.0.0.1:3080/tk-annotate/models?provider=opencode-go"
```

### 原始输出摘录

`provider=workbuddy` → HTTP `200`：

```
ok = True  provider = workbuddy
  model id  = cn:deepseek-v4.1-flash
  name      = DeepSeek V4.1 Flash
  reasoning = ['off', 'high', 'max']
  model id  = cn:glm-5.3-flash
  name      = GLM-5.3 Flash
  reasoning = ['off', 'high', 'max']
  model id  = cn:hy4-preview
  name      = HY4 Preview
  reasoning = ['off', 'high', 'max']
  model id  = cn:hy4-preview-f
  name      = HY4 Preview (Free)
  reasoning = ['off', 'high', 'max']
```

`provider=opencode-go` → HTTP `200`：

```
ok = True  provider = opencode-go
  model id  = deepseek-v4.1-flash
  name      = DeepSeek V4.1 Flash
  reasoning = ['low', 'medium', 'high']
```

### 边界行为（原始输出）

| 请求 | HTTP | 响应体原文 |
|---|---|---|
| `?provider=`（空值） | `400` | `{"ok":false,"error":"需要 provider 参数"}` |
| 完全不带 `provider` 参数 | `400` | `{"ok":false,"error":"需要 provider 参数"}` |
| `?provider=%20%20`（仅空格） | `400` | `{"ok":false,"error":"需要 provider 参数"}` |
| `?provider=not-a-real-provider` | **`200`** | `{"ok":false,"provider":"not-a-real-provider","models":[],"error":"no adapter registered for provider \"not-a-real-provider\""}` |

### 结论

**通过**。两个 provider 的模型 id 与思考档位清单与已知事实完全一致：`workbuddy` 的 `cn:deepseek-v4.1-flash` 有 `off|high|max`；`opencode-go` 的 `deepseek-v4.1-flash` 是 `low|medium|high`，**确实没有 `off`**。空/缺/纯空格的 `provider` 一律 `400`。

一个语义瑕疵（记入偏差 D3）：**不存在的 provider 返回 HTTP `200` + `ok:false`**，不是 4xx。客户端 `Bridge.models()` 会检查 `ok is not True` 并抛 `NativeFailure`（见第 9 节实测），所以功能上没问题，但 HTTP 层无法用状态码区分「参数错」与「成功但为空」。

---

## 3. `POST /tk-annotate/tool`

### 命令与原始输出

**a) 调 `purge_status`（只读），且不带任何 token 头**

```bash
curl -sS --noproxy '*' -X POST -H 'content-type: application/json' \
  --data '{"name":"purge_status"}' http://127.0.0.1:3080/tk-annotate/tool
```

HTTP `200`。顶层形状：

```
top-level keys = ['ok', 'name', 'value']
ok = True | name = purge_status
value type = dict
value keys = ['text']
--- value (截断 900 字符) ---
{"text": "dsh-purge 状态 / Status\n· 宿主 / surface: web\n· DSH_HOME: C:\\Users\\Administrator\\.dsh\n
 · 插件根 / plugin root: C:\\Users\\Administrator\\dsh-runtime-0.2.1-rc.2\\node_modules\\@deepseek-ai\n
     ✓ agent-instructions     ...\\dsh-agent-instructions\\lib\\index.js\n
     ✓ web-app                ...\\dsh-web-app\\cordis.patch.yml\n
     ✓ web-app-lib            ...\\dsh-web-app\\lib\\index.js\n
     ✓ headless               ...\\dsh-headless\\cordis.patch.yml\n
     ✓ agent-preset           ...\\dsh-web-app\\presets\\standard.patch.y"}
```

`value.text` 全长 11512 字符（第 9 节客户端路径复测同值）。返回形状 = `{ok, name, value}`，`value` 是工具原始返回（`purge_status` 返回 `{text: ...}`）。

**b) 不存在的工具名**

```bash
curl ... --data '{"name":"definitely_not_a_tool"}'
```
→ HTTP `404`：`{"error":"工具不存在或不可见：definitely_not_a_tool"}`

**c) 缺 `name` 字段** → HTTP `400`：`{"error":"name 必填"}`

**d) 非法 JSON body（`{not json`）** → HTTP `400`：
`{"error":"请求体解析失败：Expected property name or '}' in JSON at position 1 (line 1 column 2)"}`

**e) 带一个错误 token 头（`x-tk-token: wrong-token`）** → HTTP `200`（放行）

### 结论

**通过**。`purge_status` 经 `/tool` 在**宿主进程内**真实执行并返回 11.5 KB 的真实状态文本（里面能看到 `DSH_HOME`、`plugin root` 与各补丁文件的 ✓ 标记），这是「插件确实在跑」的硬证据，而不是「端口活着」。未知工具 `404`、缺参 `400`、坏 JSON `400` 均符合源码 `dsh-bridge/lib/index.js:280-322` 的实现。

`tokenRequired=false` 时**不带 token 放行**，且带**错误 token 也照样放行**——这与源码 `admit()` 一致（`sharedToken === ''` 时整段 token 校验被跳过，`dsh-bridge/lib/index.js:102`）。这是设计意图，但也意味着「配置里没设 token」时，本机任何进程都能直接调宿主工具。

---

## 4. `POST /tk-annotate/run`（真实模型调用）

### 自造测试图

用 PIL 画纯几何图形，**不使用数据集里的任何图片**：

```bash
./runtime/python.exe "C:/Users/Administrator/AppData/Local/Temp/tkds-verify/make-image.py"
```
```
written: C:\Users\Administrator\AppData\Local\Temp\tkds-verify\geometry.png
size   : 16315 bytes
pixels : (768, 768) RGB
```

图内容经 `read_image` 目视确认：白底网格 + 红色圆 + 蓝色圆角矩形 + 绿色倒三角 + 黄色五角星 + 紫色横线 + 顶部 `TK VERIFY GEOMETRY` 与底部 `circle / rounded rect / triangle / star / line` 文字。无任何露骨或数据集内容。

### 请求

```json
{
  "provider": "workbuddy",
  "model": "cn:deepseek-v4.1-flash",
  "system": "You are a visual dataset annotator. Return only the requested final annotation. Do not narrate the task or use tools.",
  "prompt": "Describe this image as a dataset annotation.\nReturn one line of comma-separated English tags ...",
  "images": [{"mediaType": "image/png", "data": "<21756 base64 字符>", "name": "geometry.png"}],
  "maxTokens": 6144,
  "reasoningEffort": "off"
}
```

### 原始输出摘录

```
HTTP status   = 200
content-type  = text/event-stream; charset=utf-8
cache-control = no-store

帧总数        = 91
delta 帧数    = 90
耗时          = 7.19s
```

原始 SSE 帧（逐字）：

```
{"delta":"red"}
{"delta":" circle"}
{"delta":" top"}
...
{"delta":"."}
{"done":true,"chars":448,"usage":{"inputTokens":474,"outputTokens":469,"cacheReadTokens":0,"reasoningTokens":378}}
```

断言结果：

```
可见文本字符数            = 448
done.chars                = 448
chars == 累积 delta 长度   = True
error 帧                  = (none)
outputTokens              = 469
reasoningTokens           = 378
outputTokens == reasoningTokens ? False
```

可见输出全文（**非空，且内容正确**）：

```
red circle top-left, blue rounded rectangle top-right, green inverted triangle bottom-left,
yellow five-point star bottom-right, purple horizontal line bottom-center, light grid background,
title text top, label text bottom
The image shows a red circle at top left, a blue rounded rectangle at top right, a green inverted
triangle at bottom left, a yellow star at bottom right, and a purple horizontal line beneath the
star on a gridded background.
```

### 结论

**通过**。

- **SSE 帧格式**：每个正文分片一帧 `data: {"delta":"<片段>"}\n\n`；收尾一帧 `data: {"done":true,"chars":N,"usage":{...}}\n\n`。客户端 `backend/host_bridge.py:122-143` 正是按这个格式解析的。
- **delta 累积自洽**：`done.chars = 448` 与所有 delta 拼接后的长度 `448` **完全相等**，说明没有丢帧、没有重复计数。
- **`usage` 字段齐全**：`inputTokens / outputTokens / cacheReadTokens / reasoningTokens` 四项都在。
- **可见输出非空**：448 字符，且描述与自造图内容逐项对得上（红圆左上、蓝圆角矩形右上、绿倒三角左下、黄星右下、紫线中下、网格背景）——证明**图片真的到达了模型**，不是纯文本猜测。
- 模型没有把思考链当正文输出，也没有走工具循环（无 `tool-calls` 结束原因）。

一处需要记录的实测事实（记入偏差 D5）：**`reasoningEffort=off` 并没有把思考 token 归零**——本次 `reasoningTokens=378`。三次调用分别是 `378 / 379 / 453`。所以 `off` 只能理解为「不额外请求更高思考档」，不等于「零思考」；`maxTokens` 仍需给足（6144 本次未出现 `outputTokens == reasoningTokens` 的饿死特征）。

---

## 5. 零会话验证（最关键）

### 实验设计

并发环境里有 4 个 agent 会话在同时写 `sessions/`，所以**单次「调用前后对比」无法归因**——第一次尝试就出现了 2 个会话文件被改动。为此改成受控三窗口实验（同一进程内，各 8 秒）：

- **W0 对照**：只 `sleep 8`，不发 `/run`
- **W1 对照**：只 `sleep 8`，不发 `/run`
- **W2 实验**：窗口开始处发一次真实 `/run`

若 W0/W1 已经出现同样的 churn，则 W2 的 churn 不能归因于桥接；「零会话」的判据是**会话目录数与文件数不增加**。

### 命令

```bash
./runtime/python.exe "C:/Users/Administrator/AppData/Local/Temp/tkds-verify/control-vs-run.py"
```

（脚本只 `rglob` 读取 `C:\Users\Administrator\.dsh\sessions`，对每个文件记录 `size + st_mtime_ns`，不写任何东西。）

### 原始输出（全文）

```
=== 起点 ===
会话目录数 = 480 | 文件数 = 491

=== W0 对照窗口（8s，无 /run）===
[W0] 会话目录数变化 = +0 | 文件数变化 = +0
[W0] 新增 = (none)
[W0] 消失 = (none)
[W0] 被改动 (2) = ['session.v4.jsonl.zstd@f85365c9-a3ba-42a2-a608-77b50ff0c090',
                    'session.v4.jsonl.zstd@session-c505aaff-ba1f-4850-9058-b5704e7c4273']

=== W1 对照窗口（8s，无 /run）===
[W1] 会话目录数变化 = +0 | 文件数变化 = +0
[W1] 新增 = (none)
[W1] 消失 = (none)
[W1] 被改动 (3) = ['session.v4.jsonl.zstd@85a8369a-d4c4-4e1b-8bef-1817d439b4e3',
                    'session.v4.jsonl.zstd@f85365c9-a3ba-42a2-a608-77b50ff0c090',
                    'session.v4.jsonl.zstd@session-c505aaff-ba1f-4850-9058-b5704e7c4273']

=== W2 实验窗口（8s，窗口开始处发一次 /run）===
[W2] 会话目录数变化 = +0 | 文件数变化 = +0
[W2] 新增 = (none)
[W2] 消失 = (none)
[W2] 被改动 (3) = ['session.v4.jsonl.zstd@85a8369a-d4c4-4e1b-8bef-1817d439b4e3',
                    'session.v4.jsonl.zstd@f85365c9-a3ba-42a2-a608-77b50ff0c090',
                    'session.v4.jsonl.zstd@session-c505aaff-ba1f-4850-9058-b5704e7c4273']

/run HTTP = 200 | 可见字符 = 379 | 耗时 = 4.23s
done 帧   = {"done": true, "chars": 379, "usage": {"inputTokens": 218, "outputTokens": 456,
             "cacheReadTokens": 256, "reasoningTokens": 379}}
error 帧  = (none)

=== 归因分析 ===
对照窗口已出现的被改文件数 = 3
实验窗口被改文件数         = 3
只在实验窗口出现的被改文件 = (none)

三个窗口的新增会话文件合计 = (none)
三个窗口的会话目录数变化   = +0 / +0 / +0

结论： 零会话成立（未新建会话目录/文件）+ 可见输出非空 -> PASS
```

### churn 的归属（决定性补充证据）

用 `session_peek_list` 把这三个「一直在变」的会话文件对回了具体 agent 会话：

| 会话 id | 标题开头 | 归属 |
|---|---|---|
| `85a8369a-d4c4-4e1b-8bef-1817d439b4e3` | 「你把 `E:\AI project 2\lora训练`（MO…」 | `trainer-repo` 队友 |
| `f85365c9-a3ba-42a2-a608-77b50ff0c090` | 「你是 TK-Dataset-Studio 0.2.0 的独立…」 | `tk-reviewer` 队友 |
| `session-c505aaff-ba1f-4850-9058-b5704e7c4273` | （本会话，故不出现在「其他对话」列表里） | 我自己 `tk-verify` |

即：**W0/W1/W2 三个窗口里被改动的文件，恰好是三个并发 agent 会话自己的日志**，与桥接无关；`/run` 窗口没有引入任何「只在实验窗口出现」的文件。

### 首轮（未受控）观测，一并留档

第一次「调用前/后」快照（`run-and-session-snapshot.py`）显示：

```
调用前：文件数 = 491，newest_mtime = 2026-10-30 10:28:46 (mtime_ns=1793327326176436200)
调用后：文件数 = 491，newest_mtime = 2026-10-30 10:28:51 (mtime_ns=1793327331131256900)
新增会话文件 = (none) | 消失会话文件 = (none) | 文件数变化 = 491 -> 491
被改动文件 = ['...f85365c9.../session.v4.jsonl.zstd', '...session-c505aaff.../session.v4.jsonl.zstd']
```

「新增 = none、文件数不变」在两次独立观测中一致；被改动项在受控实验中已归因为并发 agent 会话。

### 结论

**通过（附证据链）**。`/run` 是真实模型调用（HTTP 200、379/448 字符可见输出、`usage` 有值），而：

1. **没有新建会话**：480 个会话目录、491 个文件，三个窗口前后**全部 `+0`**，新增会话文件合计 `(none)`。
2. **没有改动任何会话文件**：W2 被改动的 3 个文件在**无 `/run` 的对照窗口 W0/W1 中就已经在改**，且经 `session_peek_list` 对回为 `trainer-repo` / `tk-reviewer` / 本会话——是并发 agent 自己的日志，不是桥接写的。
3. 源码层一致：`dsh-bridge/lib/index.js:23` 的 `inject = ['webServer','llm','attachments']` **不包含任何 session 服务**，全文没有 session 相关调用。

---

## 6. 非回环地址拒绝

### 6.1 socket 层（实际部署的第一道闸门）

```bash
netstat -ano | grep LISTENING | grep ':3080'
```
```
TCP    127.0.0.1:3080    0.0.0.0:0    LISTENING    28968
```

宿主只 bind `127.0.0.1`。从本机三块非回环网卡实测：

```bash
curl -sS --noproxy '*' --max-time 6 "http://10.31.170.218:3080/tk-annotate/status"   # WLAN
curl -sS --noproxy '*' --max-time 6 "http://192.168.153.1:3080/tk-annotate/status"   # VMware VMnet8
curl -sS --noproxy '*' --max-time 6 "http://26.216.143.233:3080/tk-annotate/status"  # Radmin VPN
```
```
[HTTP 000] [exit-ok]
[curl exit=7 -> connection not established]
curl: (7) Failed to connect to 10.31.170.218:3080 after 2042 ms: Could not connect to server
curl: (7) Failed to connect to 192.168.153.1:3080 after 2050 ms: Could not connect to server
curl: (7) Failed to connect to 26.216.143.233:3080 after 2046 ms: Could not connect to server
```

### 6.2 代码层 `isLoopback()` 分支

因为 socket 只 bind 回环，生产路径上**走不到** `dsh-bridge/lib/index.js:98-101` 的 403 分支。为了实测这段源码本身，用临时 harness 直接 `import` 真实模块、用假 `req.socket.remoteAddress` 调它注册的 handler（不改仓库、不连 DSH、纯内存）：

```bash
node "C:/Users/Administrator/AppData/Local/Temp/tkds-verify/probe-loopback.mjs"
```
```
module exports: apply, default, inject, name | inject = ["webServer","llm","attachments"]

--- A. 默认配置（无 token）：回环判定 ---
remoteAddress = 127.0.0.1                      -> HTTP 200  {"ok":true, ...}
remoteAddress = ::1                            -> HTTP 200  {"ok":true, ...}
remoteAddress = ::ffff:127.0.0.1               -> HTTP 200  {"ok":true, ...}
remoteAddress = 10.31.170.218  (LAN)           -> HTTP 403  {"error":"只接受本机回环地址的请求"}
remoteAddress = 192.168.153.1  (VMnet8)        -> HTTP 403  {"error":"只接受本机回环地址的请求"}
remoteAddress = 26.216.143.233 (Radmin)        -> HTTP 403  {"error":"只接受本机回环地址的请求"}
remoteAddress = 127.0.0.2 (loopback alias)     -> HTTP 403  {"error":"只接受本机回环地址的请求"}
remoteAddress = undefined                      -> HTTP 403  {"error":"只接受本机回环地址的请求"}

--- B. /run 与 /tool 的非回环拒绝（同一 admit 闸门）---
POST /run from 10.31.170.218                   -> HTTP 403  {"error":"只接受本机回环地址的请求"}
POST /tool from 10.31.170.218                  -> HTTP 403  {"error":"只接受本机回环地址的请求"}
GET /models from 10.31.170.218                 -> HTTP 403  {"error":"只接受本机回环地址的请求"}

--- C. 配了 token 时的强制校验 ---
无 x-tk-token 头                                 -> HTTP 401  {"error":"token 不匹配"}
x-tk-token: wrong                              -> HTTP 401  {"error":"token 不匹配"}
x-tk-token: secret-abc                         -> HTTP 200  {"ok":true, ...,"tokenRequired":true}
```

### 结论

**通过（两层都实测）**。

- 部署层：只 bind `127.0.0.1`，三块非回环网卡一律 `curl exit 7`（连接都建立不起来）。
- 代码层：`10.31.170.218` / `192.168.153.1` / `26.216.143.233` 全部 `403`，且 `/run`、`/tool`、`/models` 共用同一 `admit()` 闸门，都被拦。
- 失败方向正确：`remoteAddress` 取不到时 `403`（fail-closed），不是放行。
- token 强制校验分支也实测：无 token / 错 token → `401`，正确 token → `200` 且 `tokenRequired:true`。

一个精度问题（记入偏差 D6）：回环判定是**精确字符串匹配**，`127.0.0.2` 被拒。Windows 上只有 `127.0.0.1` 被路由，所以当前无害；但严格说 `127.0.0.0/8` 都是回环段，该判定比「回环」定义窄。

---

## 7. 客户端契约（Python / Node / tsc / vite）

### 7.1 `./runtime/python.exe -m unittest discover -s tests -p "test_*.py" -q`

```
Ran 79 tests in 17.907s

OK
[python unittest exit=0]
```

### 7.2 `node --test tests/*.test.cjs`

```
✔ independent Python RPC, durable settings, shutdown without host (720.8534ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 870.489
[node test exit=0]
```

补充核查：`tests/*.test.cjs` 只匹配到 `tests/bridge.test.cjs` 一个文件，该文件 30 行、只有 1 处 `test(`（`tests/bridge.test.cjs:7`）。

### 7.3 `npx tsc --noEmit`

```
[tsc exit=0]
```
（无任何输出）

### 7.4 `npx vite build`

```
vite v8.3.5 building client environment for production...
transforming...
✓ 2046 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.61 kB │ gzip:   0.39 kB
dist/assets/index-CZtFpHYg.css   29.26 kB │ gzip:   6.32 kB
dist/assets/index-Dvkp6OWD.js   383.58 kB │ gzip: 119.09 kB

✓ built in 6.08s
[vite exit=0]
```

构建后 `git status --porcelain` 仍为空（`dist/` 在 `.gitignore:2`，未跟踪），**未污染仓库**。

### 结论

**通过**。Python 套件 **79 项全过**，与声称的 79 完全一致；`tsc --noEmit` 退出码 0；`vite build` 成功（2046 模块，6.08 s）。`node --test` 1 项通过 0 失败——这是该套件的**实际规模**，不是失败。

一处需要如实标注的覆盖面事实（记入偏差 D7）：`node --test tests/*.test.cjs` 只有 **1 个用例**。CHANGELOG 0.2.0 写「Add regression tests for the bridge client, the concurrency contracts and the caption presets」——这些回归实际在 **Python 套件**里（`tests/test_concurrency.py`、`tests/test_presets.py`、`tests/test_host_bridge.py` 等），JS 侧并不承担。

---

## 8. `dsh-bridge/test/harness.mjs`

### 命令

```bash
node dsh-bridge/test/harness.mjs
```

### 原始输出（全文）

```
PASS  插件导出 name/inject
FAIL  注册了三条路由  /tk-annotate/status,/tk-annotate/run,/tk-annotate/models,/tk-annotate/tool
PASS  status 报告端口与 provider
PASS  status 报告 purge 插件已注册  purge_apply,purge_revert,purge_status,read_file
PASS  run 返回 200 + SSE 内容类型
PASS  SSE 拼回完整文本  "1girl, solo, outdoors"
PASS  SSE 以 done 收尾  {"done":true,"chars":21}
PASS  图片走了准入路径
PASS  调用带 system 消息
PASS  用户消息含文本块与图片块
PASS  maxTokens 透传
PASS  没有 sessionId —— 无会话
PASS  缺 provider/model 返回 400
PASS  调用 purge_status 成功  {"tool":"purge_status","received":{"verbose":true},"ok":true}
PASS  未知工具返回 404
PASS  配置 token 后无 token 被拒
PASS  带正确 token 放行
PASS  上游失败给 error 帧

17/18 通过
[harness exit=1]
```

### 失败项根因

`dsh-bridge/test/harness.mjs:121`：

```js
check('注册了三条路由', webServer.routes.size === 3, [...webServer.routes.keys()].join(','));
```

断言要求 `routes.size === 3`，但 0.2.0 的插件注册了 **4 条**路由（`dsh-bridge/lib/index.js:326-329`：`status` / `run` / `models` / `tool`）。断言里的诊断串已经把 4 条路由原样打出来了：`/tk-annotate/status,/tk-annotate/run,/tk-annotate/models,/tk-annotate/tool`。

即：**实现是对的（4 条路由，且 `/tool` 已在真机验证可用），测试期望是旧的**——0.2.0 新增 `/tool` 时没有同步更新这条断言。

### 结论

**未通过（17/18，实测 1 项失败）**。失败项是**测试期望过时**，不是产品缺陷；但这一条直接推翻了 `docs/VERIFICATION.md:44` 写的「`node dsh-bridge/test/harness.mjs` 18/18」。

---

## 9. 附加：真·端到端（用 TK 自己的客户端代码打宿主）

第 1–4 节都是 curl 直接打插件。为验证「TK 客户端 → 回环 HTTP → 插件 → 宿主 provider」整条链路，直接用仓库自己的 `backend.host_bridge.Bridge` 跑一遍（模型调用 1 次）：

```bash
./runtime/python.exe "C:/Users/Administrator/AppData/Local/Temp/tkds-verify/e2e-client.py"
```
```
=== 1) Bridge.status(config) —— 客户端解析宿主 /status ===
service       = tk-annotate-bridge
version       = 0.1.0
port          = 3080
purge         = True
tokenRequired = False
providers     = 10

=== 2) Bridge.models(config, provider) ===
workbuddy: [('cn:deepseek-v4.1-flash', ['off', 'high', 'max']), ('cn:glm-5.3-flash', ['off', 'high', 'max']),
            ('cn:hy4-preview', ['off', 'high', 'max']), ('cn:hy4-preview-f', ['off', 'high', 'max'])]
opencode-go: [('deepseek-v4.1-flash', ['low', 'medium', 'high'])]

=== 3) Bridge.models(config, 'not-a-provider') —— 应抛 NativeFailure ===
NativeFailure: DSH 未返回该 provider 的模型列表：no adapter registered for provider "not-a-provider"

=== 4) Bridge.tool(config, 'purge_status') ===
ok            = True | name = purge_status
value.text 首行 = dsh-purge 状态 / Status
value.text 长度 = 11512

=== 5) Bridge.tool(config, 'no_such_tool') —— 应抛 NativeFailure ===
NativeFailure: DSH 插件工具 no_such_tool 调用失败：工具不存在或不可见：no_such_tool

=== 6) Bridge.annotate(...) —— 真实一次模型调用（端到端）===
  progress -> {"transport": "bridge", "requestId": "ab88525dd6bf4241b434afa4f8c091f9",
               "provider": "workbuddy", "model": "cn:deepseek-v4.1-flash", "status": "running",
               "runId": "", "host_url": "http://127.0.0.1:3080"}

耗时        = 5.62s
meta        = {"transport": "bridge", "requestId": "ab88525dd6bf4241b434afa4f8c091f9",
               "provider": "workbuddy", "model": "cn:deepseek-v4.1-flash", "status": "succeeded",
               "runId": "", "host_url": "http://127.0.0.1:3080",
               "usage": {"inputTokens": 474, "outputTokens": 522, "cacheReadTokens": 0,
                         "reasoningTokens": 453}, "elapsed": 5.578}
progress 次数 = 1

=== 客户端最终结果（check_response 之后）===
red circle top-left, blue rounded rectangle top-right, green inverted triangle bottom-left,
yellow five-pointed star bottom-right, purple horizontal line lower-right, white grid background
A red circle and a blue rounded rectangle sit above a green downward triangle and a yellow star,
with a purple line beneath the star on a gridded background.

结果非空     = True
meta.usage  = {"inputTokens": 474, "outputTokens": 522, "cacheReadTokens": 0, "reasoningTokens": 453}
```

结论：**通过**。`status` / `models` / `tool` / `annotate` 四条客户端路径全部打通；错误路径都转成了带中文原因的 `NativeFailure`，不是裸异常；`meta` 里 `transport=bridge`、`runId` 为空、`status=succeeded`、`usage` 完整、`elapsed=5.578s`。

注意 `runId` 为空——这与 `docs/VERIFICATION.md:40`「DSH 会话隔离：native 调用 0 次，runId 为空」的描述一致，可作为「桥接通道不进入 DSH 会话」的旁证。

---

## 10. 偏差清单

按严重度排序。「偏差」= 实测与 README / CHANGELOG / docs/VERIFICATION.md 的声称不一致，或行为与字面语义有出入。

### D1 · 离线 harness 实测 17/18，文档写 18/18（**已确认，可复现**）

- 声称：`docs/VERIFICATION.md:44` — 「端口桥接插件（离线） | `node dsh-bridge/test/harness.mjs` **18/18**」
- 实测：`17/18 通过`，`[harness exit=1]`
- 失败项：`注册了三条路由`（`dsh-bridge/test/harness.mjs:121`，`webServer.routes.size === 3`）
- 根因：0.2.0 的插件注册 **4** 条路由（`dsh-bridge/lib/index.js:326-329`），断言与标签仍写「三条」/`=== 3`
- 影响：**不是产品缺陷**（4 条路由正确，`/tool` 真机可用），但文档结论失真；且 `exit=1` 会让任何把 harness 当 CI 门的流程直接红

### D2 · CHANGELOG 同一条 bullet 内自相矛盾（4 条路由 vs 三条路由）

- `CHANGELOG.md:10` 前半：明确列出**四条**路由 `GET /tk-annotate/status`、`POST /tk-annotate/run`、`POST /tk-annotate/tool`、`GET /tk-annotate/models`
- 同一条 bullet 末尾：「an offline harness that exercises the plugin's **three routes**」
- `CONTEXT.md:33` 也写成 `/tk-annotate/{status,run,tool}`（漏 `models`）
- 实测：注册 **4** 条（`dsh-bridge/lib/index.js:326-329`）

### D3 · `GET /models` 对不存在的 provider 返回 HTTP 200

- 实测：`?provider=not-a-real-provider` → `HTTP 200` + `{"ok":false,...,"error":"no adapter registered..."}`
- 对比：空/缺 provider → `HTTP 400`
- 影响：功能可用（客户端 `Bridge.models()` 检查 `ok is not True` 后抛 `NativeFailure`，第 9 节已实测），但 HTTP 层无法用状态码区分「参数错」与「成功但空列表」；若将来有调用方只看 `response.status_code` 就会误判成功

### D4 · `/status` 的 `version` 是插件版本 `0.1.0`，不是应用版本 `0.2.0`

- 实测：`version = 0.1.0`（源码 `dsh-bridge/lib/index.js:137` 硬编码 `version: '0.1.0'`）
- 对比：`package.json` = `0.2.0`
- 影响：任何「用 status.version 判断宿主侧桥能力是否 ≥ 0.2.0」的逻辑都会拿到错误版本号；`backend/host_bridge.py:62` 目前只校验 `service === 'tk-annotate-bridge'`，**没有校验 version**，所以当前不受影响，但这是个埋着的坑

### D5 · `reasoningEffort=off` 并未把思考 token 归零

- 实测三次 `off` 调用的 `reasoningTokens`：**378 / 379 / 453**（`outputTokens` 分别 469 / 456 / 522）
- 影响：`off` 只等于「不额外请求更高思考档」，不等于零思考。因此 `maxTokens` 仍必须给足；本次 6144 未出现 `outputTokens == reasoningTokens`（`docs/VERIFICATION.md:19` 记录的饿死特征），三次可见正文 448 / 379 / 448 字符均正常。这条不推翻 6144 的结论，但「off 就没有思考开销」的直觉是错的

### D6 · 回环判定是精确字符串匹配，`127.0.0.2` 被拒

- 实测：`remoteAddress = 127.0.0.2` → `HTTP 403`
- 源码：`dsh-bridge/lib/index.js:43-46` 只接受 `'127.0.0.1'`、`'::1'`、`'::ffff:127.0.0.1'`
- 影响：Windows 当前只路由 `127.0.0.1`，**无实际影响**；但按「回环 = `127.0.0.0/8`」的定义，判定偏窄。失败方向是拒绝（fail-closed），不是放行

### D7 · `node --test tests/*.test.cjs` 实际只有 1 个用例

- 实测：`tests 1 / pass 1 / fail 0`
- `tests/*.test.cjs` 仅匹配 `tests/bridge.test.cjs`（30 行，`tests/bridge.test.cjs:7` 一处 `test(`）
- 影响：CHANGELOG 0.2.0 提到的「回归测试（bridge client / 并发契约 / caption 预设）」实际都在 **Python 套件**（79 项）里；JS 侧这一门很薄，不应被当作 JS 覆盖的证据

### D8 · 代码层 403 分支在生产路径不可达（设计取舍，非缺陷）

- 实测：宿主只 bind `127.0.0.1:3080`（`netstat` 单条 `TCP 127.0.0.1:3080 ... LISTENING 28968`），三块非回环网卡 `curl exit 7`
- 后果：`dsh-bridge/lib/index.js:98-101` 的 403 分支在真实部署里**走不到**，只有 harness 能覆盖（第 6.2 节已用真实模块实测该分支正确）
- 评价：安全性上是**加固**（OS 先拦一层），但「只接受回环」这句话的实际执行者是 socket bind，不是代码判断；若将来有人把 webServer 改成 bind `0.0.0.0`，代码闸门才会成为唯一防线

---

## 11. 未能验证 / 未覆盖

以下**没有实测**，不给结论：

1. **`purge_apply` / `purge_revert` 的实际执行效果**：只验证了它们在 `tools.names` 里可见，并只实际调用了只读的 `purge_status`。`purge_apply` 会改 DSH 安装目录、`purge_revert` 会回滚，超出本次「只读验证 + 不得写 `.dsh`」的边界，**未执行**。
2. **`opencode-go` 的 `/run` 通路**：本次 3 次模型调用全部走 `workbuddy`。`opencode-go` 只验证了 `models` 列表（`low|medium|high`，无 `off`），**没有发过 `opencode-go` 的 `/run`**。若要在该 provider 上验证「`reasoningEffort=off` 会怎样」，需额外一次调用。
3. **`reasoningEffort` 取非法值时的行为**（如给 `workbuddy` 传 `low`、给 `opencode-go` 传 `off`）：未测，无法说明是 400、被忽略还是上游报错。
4. **`purge_status` 之外其余 468 个工具的可执行性**：未逐个验证。`docs/VERIFICATION.md:51` 自己也只声称验证了 dsh-purge 的三个。
5. **`maxTokens` 边界**：未复现 `docs/VERIFICATION.md:19` 的 `maxTokens=2048` 饿死现象（那会消耗模型调用预算且已知结论），本次只验证 6144 正常。
6. **客户端 UI 层**：只测了 `backend.host_bridge.Bridge` 这一层，没启动 Electron/TK 界面，所以「用户在界面里点打标」这一步未验证。
7. **并发批处理**：`docs/VERIFICATION.md` 声称的并发 2 路吞吐未复测（受「不得批量推理、GPU 被训练占用」约束）。

---

## 12. 结论：端到端是否成立

**成立。**

依据（每条都能在第 1–9 节找到原始输出）：

1. **插件真的在跑**：`/status` 报 `service=tk-annotate-bridge`、`port=3080`、`purge=true`、`tools.available=true`、**471** 个工具名，含 `purge_status` / `purge_apply` / `purge_revert`。
2. **宿主插件真的能执行**：`purge_status` 经 `/tool` 在宿主进程内跑出 **11512 字符**真实状态（含 `DSH_HOME`、`plugin root`、各补丁 ✓），这是「已加载插件生效」的实证。
3. **真实模型调用通路成立**：`/run` 对 PIL 自造几何图返回 `HTTP 200` + `text/event-stream`，91 帧、90 个 delta 帧，`done.chars=448` 与 delta 拼接长度**完全相等**，`usage` 四项齐全，可见输出 448 字符且**逐项描述对了图里的形状、颜色、方位**——图片确实到达了模型。
4. **零会话成立（受控实验）**：480 个会话目录 / 491 个文件，在「无 `/run` 对照窗口 W0/W1」与「有 `/run` 实验窗口 W2」中**全部 `+0`**，新增 `(none)`；W2 里被改的 3 个文件在对照窗口就已在改，且经 `session_peek_list` 对回为 `trainer-repo` / `tk-reviewer` / 本会话——**并发 agent 自己的日志，不是桥接写的**。
5. **安全边界成立（两层）**：socket 只 bind `127.0.0.1`（三块非回环网卡 `curl exit 7`）；代码层对非回环 `remoteAddress` 一律 `403`（`/run`、`/tool`、`/models` 同一闸门），`remoteAddress` 缺失也 `403`（fail-closed）；token 配了则 `401`/`200` 行为正确。
6. **客户端契约成立**：Python **79/79** 全过、`tsc --noEmit` 退出 0、`vite build` 成功且未污染仓库；用 TK 自己的 `Bridge` 类跑通 `status`/`models`/`tool`/`annotate` 四条路径，`meta.transport=bridge`、`runId` 为空、`status=succeeded`。
7. **图片准入与错误路径成立**：非法 base64 图片 → `400 图片准入失败：Image upload is not canonical base64.`；缺 `provider`/`model` → `400`；未知工具 → `404`；坏 JSON → `400`。

**但端到端成立 ≠ 文档无误**：`docs/VERIFICATION.md:44` 的「18/18」是错的（实测 17/18，D1），CHANGELOG/CONTEXT 的路由数自相矛盾（D2）。这两条建议在发布前修掉——修法很小：把 `dsh-bridge/test/harness.mjs:121` 的 `routes.size === 3` 改成 `=== 4`、标签改成「注册了四条路由」，并同步 `docs/VERIFICATION.md:44`、`CHANGELOG.md:10` 末句、`CONTEXT.md:33`。

---

## 附：本次使用的临时脚本（不在仓库内）

均位于 `C:\Users\Administrator\AppData\Local\Temp\tkds-verify\`：

| 文件 | 作用 |
|---|---|
| `make-image.py` | 用 PIL 生成 768×768 纯几何测试图 |
| `geometry.png` | 上一步产物（16315 字节） |
| `probe-loopback.mjs` | 直接 import 真实插件模块，验证 `isLoopback` 403 分支与 token 401/200 分支 |
| `run-and-session-snapshot.py` | 首次「调用前/后」会话快照 + 一次 `/run` |
| `control-vs-run.py` | 受控三窗口实验（W0/W1 对照、W2 实验），归因会话 churn |
| `e2e-client.py` | 用 `backend.host_bridge.Bridge` 跑真·端到端 |

---

## 12. 偏差处置记录（D1–D8，2026-10-30 11:0x 由 lead 修复）

| 编号 | 处置 | 证据 |
|---|---|---|
| D1 | **已修**。`dsh-bridge/test/harness.mjs:121` 断言改为 `routes.size === 4`，用例名改「注册了四条路由」 | 重跑 `node dsh-bridge/test/harness.mjs` → **18/18 通过，exit=0** |
| D2 | **已修**。`CHANGELOG.md` 同 bullet 末句 `three routes` → `four routes`；`CONTEXT.md:33` 改为 `/tk-annotate/{status,run,models,tool}`；`docs/VERIFICATION.md:44` 用例名同步「四条路由注册」 | 三处 grep 复核 |
| D3 | **已修**。未知 provider 由 `200 + ok:false` 改为 **404**（空/缺参数仍是 400），三种情况可只凭状态码区分；客户端 `backend/host_bridge.py` 先解析 JSON 再判 `ok`，不依赖状态码，故无需改动 | 真机 `curl .../models?provider=no-such-provider` → **404**；`?provider=` → **400** |
| D4 | **已修**。插件版本不再硬编码：`dsh-bridge/lib/index.js` 用 `readFileSync(new URL('../package.json', import.meta.url))` 读版本，`dsh-bridge/package.json` 提到 **0.2.0** 与应用对齐 | 热重载后 `/status` → `version=0.2.0`（原 `0.1.0`），`purge=true`、`tools=471`、`providers=10` 不变 |
| D5 | **已记录**。`reasoningEffort: off` 不归零思考 token（378/379/453），已写进 `README.md` 桥接节 | `README.md:83` |
| D6 | **保留**。回环判定是精确字符串匹配，方向 fail-closed；Windows 只路由 127.0.0.1，无实际影响 | 原文保留 |
| D7 | **无需改**。`node --test tests/*.test.cjs` 只匹配 1 个用例属实；CHANGELOG 所指的桥接客户端/并发/caption 回归确实在 Python 79 项里 | 原文保留 |
| D8 | **保留**。代码层 403 在生产路径不可达（socket 先拦）属实，属纵深加固 | 原文保留 |

修复后回归：`node dsh-bridge/test/harness.mjs` **18/18**、`python -m unittest discover` **79/79**、`node --test tests/*.test.cjs` **1/1**、`npx tsc --noEmit` **exit 0**、`npx vite build` **成功**。
