# dsh-tk-annotate-bridge

让 TK Dataset Studio 的「DSH 打标」**通过端口连到正在运行的 DSH**，由 DSH 宿主自己完成一次模型调用：

- **不创建会话**：没有 `session/created`，不写会话日志，不产生对话记录，界面上不会多出一个聊天。
- **插件生效**：本体是 DSH 插件，运行在 profile 的插件图里，用的是 profile 已加载的 provider 适配器与凭据解析。
- **单次请求**：一次 `ctx.llm.stream()`，不带历史，因此每张图的耗时与第一张一致。
- **图片正规化**：图片走 `ctx.attachments` 的准入路径，与浏览器上传同一套校验。

## 端点

全部只接受回环地址（`127.0.0.1` / `::1`）；若配置了 `token`，还要求请求头 `x-tk-token`。

### `GET /tk-annotate/status`

```json
{
  "ok": true,
  "service": "tk-annotate-bridge",
  "port": 3080,
  "providers": [{ "provider": "workbuddy", "models": ["deepseek-v3.1"] }],
  "tools": { "available": true, "names": ["purge_apply", "purge_revert", "purge_status", "..."] },
  "purge": true,
  "tokenRequired": false
}
```

`tools.names` 是宿主注册表里真实可见的工具名 —— 里面出现 `purge_status` 就说明 `dsh-purge` 这个插件确实加载并注册成功了。

### `POST /tk-annotate/run`

请求体：

```json
{
  "provider": "workbuddy",
  "model": "deepseek-v3.1",
  "system": "You are a visual dataset annotator…",
  "prompt": "…",
  "images": [{ "mediaType": "image/png", "data": "<base64>", "name": "001.png" }],
  "maxTokens": 8192
}
```

响应是 SSE：

```
data: {"delta":"…"}
data: {"done":true,"chars":1234,"usage":{…}}
```

出错时给一帧 `data: {"error":"…"}` 然后结束。

### `GET /tk-annotate/models?provider=<id>`

```json
{ "ok": true, "provider": "workbuddy", "models": [ { "id": "cn:deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "reasoning": [ { "id": "off", "label": "关闭" }, { "id": "high", "label": "高" } ] } ] }
```

列出该 provider 在宿主里真实注册的模型，以及每个模型支持的思考等级，供客户端做下拉选择。
数据来自 `ctx.llm.listModels()` / `ctx.llm.resolveModelInfo()`，不是静态配置扫描。

### `POST /tk-annotate/tool`

```json
{ "name": "purge_status", "arguments": {} }
```

直接通过注册表调用一个插件工具，返回 `{ "ok": true, "name": "purge_status", "value": { … } }`。
这是「插件工具真的能用」的可执行证据，不依赖模型是否愿意调用。

## 安装

### 方式一：本地包注入（免重启）

在 DSH 里用 `dev_inject_plugin` 指向本目录：

```
E:\claude program\TK-Dataset-Studio\dsh-bridge
```

### 方式二：作为 profile bundle

`cordis.patch.yml` 里的 `insert` 条目会被 profile 装配层加载，`name` 需能从 profile 的
`node_modules` 解析到。

## 依赖解析

插件从 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-attachment` 取模型调用与图片准入 API。
本目录下的 `node_modules/@deepseek-ai` 是指向 `~/.dsh/profiles/web/node_modules/@deepseek-ai`
的目录联接（junction），保证用的是宿主同一份包版本。换 profile 时需要重建这个联接。

## 边界

- 只有文本流回传，不承载工具调用循环 —— 单次打标不需要，也就不可能被提示词诱导去执行工具。
- `/tk-annotate/tool` 是显式调用口，调用什么工具由请求方指定，不做模型决策。
- 本插件不改变模型的上游内容政策。图片被 provider 拒绝时会把拒绝原文透传回来，客户端应原样记录，不要改写提示词去绕过。
- 不写 `~/.dsh` 下任何文件；会话、任务文件都不产生。
