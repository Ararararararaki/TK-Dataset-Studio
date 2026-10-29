# Agent 接管接口 · v1

应用必须已打开。Agent 接口与窗口共用 `Server`、SQLite、任务控制器和写入路径；MCP 进程只是代理，不启动第二份推理后端。

## 连接

打开「设置与模型 → Agent 接管」，复制当前机器的 MCP 配置。下面路径仅说明结构，实际使用 UI 生成的绝对路径：

```json
{
  "mcpServers": {
    "tk-dataset-studio": {
      "command": "C:/Apps/TK Dataset Studio/resources/runtime/python.exe",
      "args": [
        "-m", "backend.agent_mcp", "--data",
        "C:/Users/yourname/AppData/Roaming/TK Dataset Studio"
      ]
    }
  }
}
```

不需要工作目录、硬编码端口或在 MCP 配置里粘贴 token。代理每次读取应用数据目录中的 `agent-endpoint.json` 和其指向的凭据；每次启动端口与 token 都会改变。

长期接管建议使用目录版的稳定安装路径。单文件便携包的运行资源可能位于临时解压目录；移动程序或下次临时目录变化后，需要重新复制当前 MCP 配置。

| 设置 | 能力 |
| --- | --- |
| 关闭 | 不监听端口 |
| 只读（默认） | 状态、图片、标注、历史和审计 |
| 允许操作与修改 | 上述能力，以及导入、打标、编辑、预设和任务控制 |

`studio_assistant` 会调用 DSH，可能产生模型用量，因此也需要操作权限。

## MCP 工具

| 工具 | 主要参数 / 返回 |
| --- | --- |
| `studio_status` | 数据集、设置、预设、批次状态 |
| `studio_images` | `dataset_id`, 可选 `search`, `status`；返回 `images` |
| `studio_annotation` | `image_id`；读取文本、revision、WD14 证据、原生会话 |
| `studio_image` | `image_id`；实际图像附件，最长边不超过 2048 |
| `studio_import` | 授权导入的本机 `paths`；返回 `dataset_ids` |
| `studio_start` | `dataset_id`, `preset_id`, 可选 `ids`, `overwrite`, `instruction` |
| `studio_edit` | `image_id`, `text`, `revision`, 可选 `format` |
| `studio_control` | `action`: pause/cancel/resume；恢复时提供 `job_id` |
| `studio_save_preset` | `name`, `guidance`, `format`, `pipeline`, `review`, 可选 `preset_id` |
| `studio_assistant` | `image_id`, `instruction`；咨询原生 DSH，不自动改文件 |
| `studio_audit` | 最近 100 条 Agent 操作记录 |

建议流程：读取状态 → 查看图片和标注 → 选定预设启动 → 轮询批次 → 核对原图 → 用刚读取的 revision 保存修改。冲突时重新读取并判断，不覆盖用户刚做的编辑。`overwrite` 默认为 false；设为 true 时仍走备份与版本保护。

## 本机 HTTP RPC

给不支持 MCP 的本机客户端使用。描述文件包含 `schemaVersion:1`、`status`、`pid`、`url`、`tokenFile`。向其中的 `/rpc` POST：

```json
{"method":"images.get","params":{"id":"registered-image-id"}}
```

请求头必须带 `Authorization: Bearer <token>`，可附 `X-TKDS-Client: your-agent`。成功返回 `{"result":...}`，失败返回 `{"error":"..."}`。只监听 `127.0.0.1` 随机端口；要求准确 Host，拒绝浏览器 Origin / Sec-Fetch 请求，没有 CORS。请求体上限 2 MiB。该大小是本机 RPC 请求体边界，**不是提示词截断策略**。

RPC 允许的方法在 `backend/agent_api.py` 的 READ / WRITE 集合中列出。没有执行 shell、任意文件读取、删除原图或更改权限设置的操作。Token 是同一 Windows 用户权限边界内的本机凭据，不是针对同用户恶意程序的沙箱。

## 生命周期与审计

Agent 改动以 `Agent · <client>` 保存历史，记录操作、目标、时间、成功与错误；不把整段图片提示词复制进审计。改动也即时通知桌面界面。

关闭应用后监听端口、后端和推理进程释放，描述文件变为 stopped。**外部 Agent 宿主自己管理 stdio MCP 代理进程**；它不会拥有推理模型，应用关闭后调用会报告未连接。需要彻底停止代理时在该宿主断开 MCP，不会结束其他软件进程。
