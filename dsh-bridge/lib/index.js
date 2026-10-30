/**
 * tk-annotate-bridge — DSH 插件。
 *
 * 给 TK Dataset Studio 提供一个「端口直连、无会话」的打标端点：
 *   POST /tk-annotate/run      单次模型调用（可带图），返回 SSE 文本流
 *   GET  /tk-annotate/status   报告端口、可用 provider、已注册插件工具
 *   POST /tk-annotate/tool     通过注册表调用一个插件工具（如 purge_status）
 *
 * 设计要点：
 *   * 不创建 DSH 会话、不写会话文件、不产生对话记录；
 *   * 走 ctx.llm.stream()，因此用的是 DSH profile 里已加载的 provider 适配器
 *     （workbuddy / deepseek / pi-ai 等）和它们的凭据解析；
 *   * 因为本体是 DSH 插件，插件层的工具注册表与提示词装配对宿主生效；
 *   * 图片经 ctx.attachments 正规化为 durable 引用，和浏览器上传走同一条准入路径。
 *
 * 安全边界：只接受回环地址请求；可选共享 token（config.token 或环境变量
 * TK_ANNOTATE_TOKEN），配置了就强制校验。
 */

import { readFileSync } from 'node:fs';

export const name = 'tk-annotate-bridge';

/** 依赖的宿主服务。tools 是可选的，单独用 ctx.get 取。 */
export const inject = ['webServer', 'llm', 'attachments'];

const PREFIX = '/tk-annotate';
const MAX_BODY_BYTES = 96 * 1024 * 1024;

/** 插件版本从 package.json 读，避免与 TK 应用版本各写一处而漂移。 */
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

let llmModule;
let attachmentModule;

/** 懒加载 dsh-llm，避免插件加载期因解析失败直接崩掉宿主。 */
async function llmApi() {
  if (llmModule === undefined) llmModule = await import('@deepseek-ai/dsh-llm');
  return llmModule;
}

/** 懒加载 dsh-attachment（图片准入）。 */
async function attachmentApi() {
  if (attachmentModule === undefined) attachmentModule = await import('@deepseek-ai/dsh-attachment');
  return attachmentModule;
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** 读完整个请求体并解析 JSON。超过上限直接拒绝，避免内存被灌爆。 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error(`请求体超过 ${MAX_BODY_BYTES} 字节上限`);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  return JSON.parse(text);
}

/** 把 finish 原因翻成错误；非正常收尾时抛，避免把半截文本当成品。 */
function finishError(finish) {
  if (finish === undefined) return undefined;
  // FinishReason 的已知取值：stop / max-tokens / tool-calls / aborted。
  if (finish.kind === 'stop' || finish.kind === 'max-tokens') return undefined;
  if (finish.kind === 'tool-calls') return new Error('模型请求了工具调用，单次打标通道不支持工具循环');
  if (finish.kind === 'aborted') return new Error(`模型调用被中断：${finish.failure?.message ?? 'aborted'}`);
  return new Error(`模型流异常结束：${String(finish.kind)}`);
}

/** 组装一条用户消息的内容块：文本 + 图片引用。 */
function buildContent(prompt, refs) {
  const content = [];
  if (prompt !== '') content.push({ type: 'text', text: prompt });
  for (const ref of refs) content.push({ type: 'image', attachment: ref });
  return content;
}

export function apply(ctx, config = {}) {
  const log = (...args) => {
    if (config.verbose === true) console.log('[tk-annotate-bridge]', ...args);
  };

  const sharedToken = String(config.token ?? process.env.TK_ANNOTATE_TOKEN ?? '');

  /** 统一的准入检查：回环 + token。 */
  function admit(req, res) {
    if (!isLoopback(req)) {
      sendJson(res, 403, { error: '只接受本机回环地址的请求' });
      return false;
    }
    if (sharedToken !== '') {
      const given = String(req.headers['x-tk-token'] ?? '');
      if (given !== sharedToken) {
        sendJson(res, 401, { error: 'token 不匹配' });
        return false;
      }
    }
    return true;
  }

  /** 列出当前宿主里已注册的插件工具名，用于证明插件确实加载了。 */
  function registeredTools() {
    const tools = ctx.get?.('tools');
    if (tools === undefined || tools === null) return { available: false, names: [] };
    try {
      const schemas = tools.schemas();
      return { available: true, names: schemas.map((schema) => schema.name).sort() };
    } catch (error) {
      return { available: false, names: [], error: String(error?.message ?? error) };
    }
  }

  async function handleStatus(req, res) {
    if (!admit(req, res)) return;
    let providers = [];
    let providerError;
    try {
      providers = ctx.llm.listProviders();
    } catch (error) {
      providerError = String(error?.message ?? error);
    }
    const tools = registeredTools();
    sendJson(res, 200, {
      ok: true,
      service: name,
      version: VERSION,
      port: ctx.webServer.port,
      origin: typeof ctx.webServer.getOrigin === 'function' ? ctx.webServer.getOrigin() : undefined,
      providers,
      ...(providerError === undefined ? {} : { providerError }),
      tools,
      purge: tools.names.includes('purge_status'),
      tokenRequired: sharedToken !== '',
    });
  }

  /** 列出某个 provider 可选的模型与每个模型可选的思考等级。 */
  async function handleModels(req, res) {
    if (!admit(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const provider = String(url.searchParams.get('provider') ?? '').trim();
    if (provider === '') return sendJson(res, 400, { ok: false, error: '需要 provider 参数' });
    try {
      const list = await ctx.llm.listModels(provider);
      const models = [];
      for (const item of list ?? []) {
        const id = String(item?.id ?? item?.model ?? '');
        if (id === '') continue;
        let reasoning = [];
        try {
          const info = await ctx.llm.resolveModelInfo(provider, id);
          reasoning = (info?.reasoning?.efforts ?? info?.reasoningEfforts ?? []).map((effort) => ({
            id: String(effort?.id ?? effort?.value ?? ''),
            label: String(effort?.label ?? effort?.name ?? effort?.id ?? ''),
          })).filter((effort) => effort.id !== '');
        } catch {
          reasoning = [];
        }
        models.push({ id, name: String(item?.name ?? id), reasoning });
      }
      sendJson(res, 200, { ok: true, provider, models });
    } catch (error) {
      // 未知 provider 走 404：空/缺参数是 400，调用方可以只凭状态码区分三种情况。
      sendJson(res, 404, { ok: false, provider, models: [], error: String(error?.message ?? error) });
    }
  }

  /** 单次打标：不建会话，直接一次 ctx.llm.stream。 */
  async function handleRun(req, res) {
    if (!admit(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: `请求体解析失败：${String(error?.message ?? error)}` });
      return;
    }

    const provider = String(body.provider ?? '');
    const model = String(body.model ?? '');
    if (provider === '' || model === '') {
      sendJson(res, 400, { error: 'provider 与 model 必填' });
      return;
    }

    const controller = new AbortController();
    // 客户端断开就取消上游请求，避免继续烧 token。
    req.on('close', () => controller.abort());

    let refs;
    try {
      const images = Array.isArray(body.images) ? body.images : [];
      if (images.length === 0) {
        refs = [];
      } else {
        const { admitEncodedImages } = await attachmentApi();
        refs = await admitEncodedImages(
          ctx.attachments,
          images.map((image) => ({
            mediaType: String(image.mediaType ?? 'image/png'),
            data: String(image.data ?? ''),
            ...(typeof image.name === 'string' && image.name !== '' ? { name: image.name } : {}),
          })),
        );
      }
    } catch (error) {
      sendJson(res, 400, { error: `图片准入失败：${String(error?.message ?? error)}` });
      return;
    }

    const { BlockAssembler, createSystemMessage, createUserMessage } = await llmApi();
    const messages = [];
    const system = String(body.system ?? '');
    if (system !== '') messages.push(createSystemMessage(system));
    messages.push(createUserMessage({ content: buildContent(String(body.prompt ?? ''), refs) }));

    const maxTokens = Number(body.maxTokens);
    const effort = String(body.reasoningEffort ?? '').trim();
    const options = {
      provider,
      model,
      messages,
      ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens: Math.trunc(maxTokens) } : {}),
      ...(effort !== '' ? { reasoningEffort: effort } : {}),
      signal: controller.signal,
    };

    // 一旦开始流式响应就不能再改状态码，所以先握手成功再开流。
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });

    const assembler = new BlockAssembler();
    let sent = 0;
    try {
      for await (const chunk of ctx.llm.stream(options)) {
        assembler.push(chunk);
        if (chunk.type === 'text-delta' && chunk.text !== '') {
          sent += chunk.text.length;
          res.write(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`);
        }
      }
      const failure = finishError(assembler.finish);
      if (failure !== undefined) throw failure;
      const usage = assembler.usage;
      res.write(
        `data: ${JSON.stringify({
          done: true,
          chars: sent,
          ...(usage === undefined ? {} : { usage }),
        })}\n\n`,
      );
      res.end();
      log('run ok', provider, model, sent);
    } catch (error) {
      const message = String(error?.message ?? error);
      try {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      } catch {
        // 客户端已经断开时忽略。
      }
      res.end();
      log('run failed', message);
    }
  }

  /** 直接调用一个已注册的插件工具（用于证明 dsh-purge 之类插件确实可用）。 */
  async function handleTool(req, res) {
    if (!admit(req, res)) return;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: `请求体解析失败：${String(error?.message ?? error)}` });
      return;
    }
    const toolName = String(body.name ?? '');
    if (toolName === '') {
      sendJson(res, 400, { error: 'name 必填' });
      return;
    }
    const tools = ctx.get?.('tools');
    if (tools === undefined || tools === null) {
      sendJson(res, 503, { error: '宿主没有挂载 tools 服务' });
      return;
    }
    let definition;
    try {
      definition = tools.get(toolName);
    } catch (error) {
      sendJson(res, 404, { error: `工具不存在或不可见：${String(error?.message ?? error)}` });
      return;
    }
    if (definition === undefined || definition === null) {
      sendJson(res, 404, { error: `工具不存在或不可见：${toolName}` });
      return;
    }
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    try {
      const value = await definition.execute(body.arguments ?? {}, {
        signal: controller.signal,
        cwd: process.cwd(),
        callId: `tk-bridge-${Date.now().toString(36)}`,
      });
      sendJson(res, 200, { ok: true, name: toolName, value });
    } catch (error) {
      sendJson(res, 500, { ok: false, name: toolName, error: String(error?.message ?? error) });
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/status`, handler: handleStatus }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/run`, handler: handleRun }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/models`, handler: handleModels }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/tool`, handler: handleTool }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, 'tk-annotate-bridge: routes');

  log('routes mounted at', `${PREFIX}/*`, 'port', ctx.webServer.port);
}

export default { name, inject, apply };
