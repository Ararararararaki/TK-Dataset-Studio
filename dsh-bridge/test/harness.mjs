/**
 * 离线验收：用一个假的 DSH 上下文把插件跑起来，验证路由、SSE、错误路径。
 * 不接触真实 DSH、不写 ~/.dsh。运行：node test/harness.mjs
 */
import http from 'node:http';
import { apply, inject, name } from '../lib/index.js';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`);
};

/** 假的 webServer：收集路由，稍后交给真 http server 派发。 */
function fakeWebServer() {
  const routes = new Map();
  return {
    routes,
    port: 0,
    getOrigin: () => `http://127.0.0.1:${routes.serverPort ?? 0}`,
    register: (route) => {
      if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`);
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  };
}

/** 假的 llm：按剧本吐出 text-delta 与 finish。 */
function fakeLlm(script) {
  const calls = [];
  return {
    calls,
    listProviders: () => [{ provider: 'stub', models: ['stub-model'] }],
    stream: async function* (options) {
      calls.push(options);
      for (const chunk of script(options)) yield chunk;
    },
  };
}

/** 假的 attachments：真实现是 admitEncodedImages(store, images) → store.saveImages(items)。 */
function fakeAttachments() {
  const admitted = [];
  return {
    admitted,
    saveImages: async (items) => {
      return items.map((item) => {
        const ref = { attachmentId: `att-${admitted.length}`, mediaType: item.mediaType };
        admitted.push({ mediaType: item.mediaType, bytes: item.bytes?.length ?? 0 });
        return ref;
      });
    },
  };
}

function fakeCtx({ llm, attachments, tools }) {
  const webServer = fakeWebServer();
  const effects = [];
  const ctx = {
    webServer,
    llm,
    attachments,
    effect: (factory) => {
      effects.push(factory());
    },
    get: (service) => (service === 'tools' ? tools : undefined),
  };
  return { ctx, webServer, effects };
}

function fakeTools(names) {
  return {
    schemas: () => names.map((toolName) => ({ name: toolName, description: `${toolName} stub` })),
    get: (toolName) => {
      if (!names.includes(toolName)) return undefined;
      return {
        name: toolName,
        execute: async (args) => ({ tool: toolName, received: args, ok: true }),
      };
    },
  };
}

/** 起一个真 http server，把插件注册的 handler 挂上去。 */
async function serve(webServer) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const handler = webServer.routes.get(pathname);
    if (handler === undefined) {
      res.writeHead(404).end('no route');
      return;
    }
    void Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error?.message ?? error));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  webServer.port = server.address().port;
  return server;
}

async function main() {
  const llm = fakeLlm(() => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '1girl, ' },
    { type: 'text-delta', index: 0, text: 'solo, outdoors' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '1girl, solo, outdoors' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const attachments = fakeAttachments();
  const tools = fakeTools(['purge_status', 'purge_apply', 'purge_revert', 'read_file']);
  const { ctx, webServer } = fakeCtx({ llm, attachments, tools });

  apply(ctx, { verbose: false });
  check('插件导出 name/inject', name === 'tk-annotate-bridge' && inject.includes('webServer'));

  const server = await serve(webServer);
  const base = `http://127.0.0.1:${webServer.port}`;
  check('注册了四条路由', webServer.routes.size === 4, [...webServer.routes.keys()].join(','));

  // 1) status
  const status = await (await fetch(`${base}/tk-annotate/status`)).json();
  check('status 报告端口与 provider', status.ok === true && status.port === webServer.port && Array.isArray(status.providers));
  check('status 报告 purge 插件已注册', status.purge === true && status.tools.names.includes('purge_status'), status.tools.names.join(','));

  // 2) run —— 带图，验证 SSE 文本流
  const runResponse = await fetch(`${base}/tk-annotate/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'stub',
      model: 'stub-model',
      system: 'you are an annotator',
      prompt: 'describe',
      images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }],
      maxTokens: 256,
    }),
  });
  check('run 返回 200 + SSE 内容类型', runResponse.status === 200 && String(runResponse.headers.get('content-type')).startsWith('text/event-stream'));
  const streamText = await runResponse.text();
  const frames = streamText.split('\n\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  const joined = frames.filter((frame) => typeof frame.delta === 'string').map((frame) => frame.delta).join('');
  check('SSE 拼回完整文本', joined === '1girl, solo, outdoors', JSON.stringify(joined));
  check('SSE 以 done 收尾', frames.at(-1)?.done === true, JSON.stringify(frames.at(-1)));
  check('图片走了准入路径', attachments.admitted.length === 1 && attachments.admitted[0].mediaType === 'image/png');

  const call = llm.calls.at(-1);
  check('调用带 system 消息', call.messages[0]?.role === 'system');
  check('用户消息含文本块与图片块', call.messages[1].content.some((block) => block.type === 'text') && call.messages[1].content.some((block) => block.type === 'image'));
  check('maxTokens 透传', call.maxTokens === 256);
  check('没有 sessionId —— 无会话', call.sessionId === undefined && call.purpose === undefined);

  // 3) 缺少 provider/model 要 400
  const badRun = await fetch(`${base}/tk-annotate/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x' }) });
  check('缺 provider/model 返回 400', badRun.status === 400);

  // 4) tool 调用
  const toolResponse = await (await fetch(`${base}/tk-annotate/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'purge_status', arguments: { verbose: true } }),
  })).json();
  check('调用 purge_status 成功', toolResponse.ok === true && toolResponse.value.tool === 'purge_status' && toolResponse.value.received.verbose === true, JSON.stringify(toolResponse.value));

  const unknownTool = await fetch(`${base}/tk-annotate/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'nope' }) });
  check('未知工具返回 404', unknownTool.status === 404);

  // 4b) 浏览器驱动攻击面：跨站来源 / 非 JSON 请求体 / 伪造 Host 都必须被挡
  const crossOrigin = await fetch(`${base}/tk-annotate/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ name: 'purge_status', arguments: {} }),
  });
  check('跨站 Origin 被拒', crossOrigin.status === 403, String(crossOrigin.status));

  const simpleType = await fetch(`${base}/tk-annotate/tool`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ name: 'purge_status', arguments: {} }),
  });
  check('非 JSON 请求体被拒', simpleType.status === 415, String(simpleType.status));

  // fetch 不允许改 Host，用 node:http 直发
  const badHostStatus = await new Promise((resolve) => {
    const request = http.request(
      { host: '127.0.0.1', port: webServer.port, path: '/tk-annotate/status', method: 'GET', headers: { host: 'evil.example' } },
      (response) => { response.resume(); resolve(response.statusCode); },
    );
    request.on('error', () => resolve(0));
    request.end();
  });
  check('伪造 Host 被拒', badHostStatus === 403, String(badHostStatus));

  // 5) token 校验
  const guarded = fakeCtx({ llm, attachments, tools });
  apply(guarded.ctx, { token: 'secret' });
  const guardedServer = await serve(guarded.webServer);
  const guardedBase = `http://127.0.0.1:${guarded.webServer.port}`;
  const denied = await fetch(`${guardedBase}/tk-annotate/status`);
  check('配置 token 后无 token 被拒', denied.status === 401);
  const allowed = await fetch(`${guardedBase}/tk-annotate/status`, { headers: { 'x-tk-token': 'secret' } });
  check('带正确 token 放行', allowed.status === 200);

  // 6) 上游错误要变成 error 帧，而不是半截成品
  const failingLlm = fakeLlm(() => {
    throw new Error('upstream 503');
  });
  const failing = fakeCtx({ llm: failingLlm, attachments, tools });
  apply(failing.ctx, {});
  const failingServer = await serve(failing.webServer);
  const failText = await (await fetch(`http://127.0.0.1:${failing.webServer.port}/tk-annotate/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'stub', model: 'stub-model', prompt: 'x' }),
  })).text();
  check('上游失败给 error 帧', failText.includes('"error"') && failText.includes('upstream 503'));

  server.close();
  guardedServer.close();
  failingServer.close();

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
