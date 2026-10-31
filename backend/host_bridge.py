"""Loopback HTTP bridge into a running DSH host: one model call, no session, no conversation.

The DSH side is the ``dsh-tk-annotate-bridge`` plugin (``dsh-bridge/`` in this
repository). It runs inside the DSH profile, so it uses that profile's provider
adapters, credentials and plugin registry, but it never creates a session: one
request in, one streamed annotation out.
"""
from __future__ import annotations
import asyncio, json, time, uuid
from urllib.parse import urlsplit
from .images import file_block
from .native import NativeFailure
from .responses import check_response

DEFAULT_URL = 'http://127.0.0.1:3080'
SYSTEM = ('You are a visual dataset annotator. Return only the requested final annotation. '
          'Do not narrate the task or use tools.')


def endpoint(value):
    """Validate the bridge base URL; only a loopback HTTP origin is accepted."""
    text = str(value or DEFAULT_URL).strip().rstrip('/')
    parts = urlsplit(text)
    if parts.scheme != 'http' or parts.hostname not in ('127.0.0.1', 'localhost', '::1') or not parts.port:
        raise NativeFailure('DSH 桥接地址必须是本机 HTTP 端口，例如 http://127.0.0.1:3080', False)
    if parts.username or parts.password or parts.query or parts.fragment:
        raise NativeFailure('DSH 桥接地址不能包含账号、查询或锚点', False)
    return text


class Bridge:
    """Streams one annotation per image through the DSH host's own LLM service."""

    def __init__(self, connections):
        self.connections = connections
        self.active = set()

    async def cancel_all(self):
        for task in tuple(self.active):
            task.cancel()
        if self.active:
            await asyncio.gather(*tuple(self.active), return_exceptions=True)

    def base(self, config):
        return endpoint(config.get('bridge_url') or DEFAULT_URL)

    async def status(self, config):
        """Read the bridge status: port, providers and the host's registered tools."""
        import httpx
        base = self.base(config)
        try:
            async with asyncio.timeout(15):
                async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(15, connect=5)) as client:
                    response = await client.get(base + '/tk-annotate/status')
                    if response.status_code != 200:
                        raise NativeFailure(f'DSH 桥接返回 HTTP {response.status_code}；请确认插件已加载', False)
                    value = response.json()
        except NativeFailure:
            raise
        except Exception:
            raise NativeFailure('连不上 DSH 桥接端口；请确认 DSH 正在运行且已加载 dsh-tk-annotate-bridge 插件', False) from None
        if not isinstance(value, dict) or value.get('service') != 'tk-annotate-bridge':
            raise NativeFailure('该端口不是 TK 打标桥（服务标识不匹配）', False)
        return value

    async def annotate(self, row, task, config, key, progress, stop, resume_run=''):
        if resume_run:
            raise NativeFailure('此记录来自旧版 Agent 会话；桥接模式不恢复旧会话，请重新打标', False)
        if stop.is_set():
            raise asyncio.CancelledError()
        base = self.base(config)
        provider = str(config.get('provider') or '').strip()
        model = str(config.get('model') or '').strip()
        if not provider or not model:
            raise NativeFailure('桥接模式需要先填写 DSH provider 与 model；点“检测连接”可读取宿主已加载的模型', False)
        image = await asyncio.to_thread(file_block, row['path'])
        effort = str(config.get('reasoning_effort') or '').strip()
        payload = {'provider': provider, 'model': model, 'system': SYSTEM, 'prompt': task,
                   'images': [{'mediaType': image['mediaType'], 'data': image['data'], 'name': row.get('relative') or ''}],
                   'maxTokens': int(config.get('max_tokens', 8192))}
        if effort: payload['reasoningEffort'] = effort
        if config.get('mode'): payload['mode'] = str(config['mode'])
        meta = {'transport': 'bridge', 'requestId': uuid.uuid4().hex, 'provider': provider, 'model': model,
                'status': 'running', 'runId': '', 'host_url': base}
        await progress(meta)
        operation = asyncio.create_task(self.request(base, payload, config, meta))
        self.active.add(operation)
        cancel = asyncio.create_task(stop.wait())
        try:
            done, _ = await asyncio.wait((operation, cancel), return_when=asyncio.FIRST_COMPLETED)
            if cancel in done and stop.is_set():
                operation.cancel()
                raise asyncio.CancelledError()
            result = await operation
            meta['status'] = 'succeeded'
            return result, meta
        finally:
            cancel.cancel()
            operation.cancel()
            await asyncio.gather(cancel, operation, return_exceptions=True)
            self.active.discard(operation)

    async def request(self, base, payload, config, meta):
        import httpx
        started = time.monotonic()
        timeout = max(15, min(3600, float(config.get('timeout', 180))))
        try:
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(timeout, connect=10)) as client:
                    async with client.stream('POST', base + '/tk-annotate/run', json=payload) as response:
                        if response.status_code >= 400:
                            detail = ''
                            try:
                                raw = await response.aread()
                                value = json.loads(raw)
                                detail = str(value.get('error') or '')
                            except Exception:
                                detail = ''
                            meaning = {400: '请求被拒绝', 401: 'token 不匹配', 403: '只接受本机请求', 404: '桥接端点不存在', 503: '宿主未挂载所需服务'}.get(response.status_code, '请求失败')
                            suffix = f'：{detail}' if detail else ''
                            raise NativeFailure(f'DSH 桥接 {meaning}（HTTP {response.status_code}）{suffix}；本次未保存', False)
                        chunks, size, done, failure = [], 0, False, ''
                        async for line in response.aiter_lines():
                            if not line.startswith('data:'):
                                continue
                            data = line[5:].strip()
                            if not data or data == '[DONE]':
                                continue
                            if len(data) > 4 * 1024 * 1024:
                                raise NativeFailure('DSH 桥接响应片段过大；本次未保存', False)
                            value = json.loads(data)
                            if value.get('error'):
                                failure = str(value['error'])
                                break
                            part = value.get('delta')
                            if isinstance(part, str) and part:
                                size += len(part)
                                if size > 2000000:
                                    raise NativeFailure('DSH 桥接正文过大；本次未保存', False)
                                chunks.append(part)
                            if value.get('done'):
                                done = True
                                if value.get('usage'):
                                    meta['usage'] = value['usage']
                        if failure:
                            raise NativeFailure(f'DSH 桥接在生成过程中失败：{failure}；本次未保存，不会自动重发', False)
                        if not done:
                            raise NativeFailure('DSH 桥接未返回完整结束帧；本次未保存，不会自动重发', False)
                        text = ''.join(chunks).strip()
                        if not text:
                            raise NativeFailure('DSH 桥接返回空正文；本次未保存', False)
                        try:
                            result = check_response(text)
                        except ValueError as e:
                            raise NativeFailure(str(e), False) from None
                        meta['elapsed'] = round(time.monotonic() - started, 3)
                        return result
        except (NativeFailure, asyncio.CancelledError):
            raise
        except (asyncio.TimeoutError, httpx.TimeoutException):
            raise NativeFailure('DSH 桥接请求超时；本次未保存、不会自动重发', False) from None
        except Exception:
            raise NativeFailure('DSH 桥接连接或响应解析失败；本次未保存，请检测端口与插件状态', False) from None

    async def models(self, config, provider):
        """List the host's models for one provider, with each model's reasoning efforts."""
        import httpx
        base = self.base(config)
        name = str(provider or '').strip()
        if not name:
            return []
        try:
            async with asyncio.timeout(30):
                async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(30, connect=5)) as client:
                    response = await client.get(base + '/tk-annotate/models', params={'provider': name})
                    value = response.json()
        except Exception:
            raise NativeFailure('读取 DSH 模型列表失败；请确认桥接端口与插件状态', False) from None
        if not isinstance(value, dict) or value.get('ok') is not True:
            detail = value.get('error') if isinstance(value, dict) else None
            raise NativeFailure(f'DSH 未返回该 provider 的模型列表{("：" + str(detail)) if detail else ""}', False)
        return value.get('models') or []

    async def tool(self, config, name, arguments=None):
        """Call one registered plugin tool in the DSH host (evidence that plugins are live)."""
        import httpx
        base = self.base(config)
        try:
            async with asyncio.timeout(30):
                async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(30, connect=5)) as client:
                    response = await client.post(base + '/tk-annotate/tool', json={'name': name, 'arguments': arguments or {}})
                    value = response.json()
        except Exception:
            raise NativeFailure('调用 DSH 插件工具失败；请确认桥接端口与插件状态', False) from None
        if not isinstance(value, dict) or value.get('ok') is not True:
            detail = value.get('error') if isinstance(value, dict) else None
            raise NativeFailure(f'DSH 插件工具 {name} 调用失败：{detail or "未知原因"}', False)
        return value
