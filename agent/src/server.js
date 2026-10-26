// 本地独立服务。权限实时取自原登录人；任务只能由本人读取及确认。
import { createServer } from 'node:http';
import { config } from './config.js';
import { buildHealth, plannerMode } from './health.js';
import { createAgentRuntime, FlowClient } from './runtime.js';
const runtime = createAgentRuntime();
const failure = (status, message) => Object.assign(new Error(message), { status });
async function resolveActor(client, token) {
  if (!token) throw failure(401, '请先登录极序 Flow');
  const me = await client.get('/api/auth/me');
  if (!me?.username) throw failure(401, '登录身份已失效，请重新登录');
  let warehouseIds = null;
  if (!me.hasUnrestrictedWarehouseScope) {
    const data = await client.get('/api/users/me/warehouse-scope');
    const list = data?.list ?? (Array.isArray(data) ? data : []);
    warehouseIds = list.map(w => Number(w.warehouseId));
  }
  return { id: me.id, username: me.username, realName: me.realName, roleId: me.roleId, roleName: me.roleName,
    permissions: me.permissions || [], warehouseIds, unrestrictedWarehouseScope: Boolean(me.hasUnrestrictedWarehouseScope), isSuper: Number(me.roleId) === 1 };
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (Number(req.headers['content-length']) > 32768) throw failure(413, '输入内容过长，请缩短后重试');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw failure(413, '输入内容过长，请缩短后重试');
    chunks.push(chunk);
  }
  try {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw failure(400, '请求内容格式不正确'); }
}
const server = createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) throw failure(403, '此页面未获准连接小满');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, buildHealth());
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const client = new FlowClient(config.flowBaseUrl, token, { clientId: req.headers['x-client-id'] });
    const actor = await resolveActor(client, token);
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    return json(res, 200, await runtime.dispatch({ method: req.method, pathname: url.pathname, body, actor, client }));
  } catch (error) {
    json(res, error.status || (error.kind === 'auth' ? 401 : 500), { error: error.message, kind: error.kind || 'request', code: error.code });
  }
});
server.requestTimeout = 30000; server.headersTimeout = 10000;
server.listen(config.port, config.host, () => {
  console.log(`jixu-agent listening on ${config.host}:${server.address().port}`);
  console.log(`[self-check] planner=${plannerMode()} model=${config.model.name || '(未配置)'} keySource=${config.modelKeySource || 'none'}`);
});
