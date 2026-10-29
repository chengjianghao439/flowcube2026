import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { FlowClient } from '../src/flow.js';

let directory, agent, flow, base;
let meCalls = 0;
let lastHeaders, lastPath;
const taskId = 'test-owned-task';
const permissions = ['sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view'];
const reply = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jixu-agent-http-'));
  await cp(new URL('../src', import.meta.url), join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await mkdir(join(directory, 'data'));
  await writeFile(join(directory, 'data/tasks.json'), JSON.stringify([{
    id: taskId, graph: 'B-sale-draft', state: 'AWAITING_CONFIRM',
    actor: { id: 11, username: 'owner', permissions, warehouseIds: null },
    requestKey: 'private-request-key', steps: [],
    userText: '合成原任务', reply: '合成原预览', revision: 2,
    createdAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z',
    preview: { customer: { id: 1, name: '合成客户' }, warehouseId: 1, lines: [{ productName: '合成商品', _stockProduct: { private: true } }], payload: { internal: true }, expiresAt: new Date(Date.now() + 600000).toISOString() },
  }, {
    id: 'test-expired-task', graph: 'B-sale-draft', state: 'AWAITING_CONFIRM', actor: { id: 11, username: 'owner', permissions },
    preview: { warehouseId: 1, expiresAt: '2000-01-01T00:00:00.000Z' }, revision: 1,
    createdAt: '2098-01-01T00:00:00.000Z',
  }, {
    id: 'test-choice-task', graph: 'A-inventory', state: 'DISAMBIGUATING', actor: { id: 11, username: 'owner', permissions },
    userText: '合成商品库存', reply: '请选择合成商品', candidates: [{ id: 1, title: '合成商品甲' }, { id: 2, title: '合成商品乙' }],
    selection: { type: 'product', keyword: '合成商品', slot: 'product' }, intent: { graph: 'A-inventory', productKeyword: '合成商品' },
    createdAt: '2097-01-01T00:00:00.000Z',
  }, {
    id: 'test-legacy-chat', graph: 'G-chat', state: 'DONE', actor: { id: 11, username: 'owner', permissions },
    userText: '聊聊阅读习惯', reply: '旧纯闲聊合成回复', createdAt: '2099-12-31T00:00:00.000Z',
  }, ...Array.from({ length: 35 }, (_, index) => ({
    id: `owned-${index}`, graph: 'B-sale-draft', state: 'DONE', actor: { id: 11, username: 'owner', permissions }, userText: `合成任务${index}`, result: { orderNo: `SYNTHETIC-${index}` },
    createdAt: `2026-10-${String((index % 25) + 1).padStart(2, '0')}T00:00:00.000Z`,
  }))]));
  flow = createServer((req, res) => {
    lastHeaders = req.headers; lastPath = req.url;
    if (req.url === '/api/auth/me') {
      meCalls++;
      const other = req.headers.authorization === 'Bearer other';
      const revoked = req.headers.authorization === 'Bearer revoked';
      const scoped = req.headers.authorization === 'Bearer scoped';
      return reply(res, { id: other ? 12 : 11, username: other ? 'other' : 'owner', roleId: 2, roleName: '合成岗位', permissions: revoked ? [] : permissions, hasUnrestrictedWarehouseScope: !scoped });
    }
    if (req.url === '/api/users/me/warehouse-scope') return reply(res, [{ warehouseId: 2 }]);
    if (req.url.startsWith('/api/warehouses')) return reply(res, { list: [{ id: 1, name: '合成一仓' }] });
    if (req.url.startsWith('/api/search/')) {
      const keyword = new URL(req.url, 'http://fixture').searchParams.get('q');
      if (keyword === '合成客户') return reply(res, [{ id: 1, title: '合成客户', type: 'customer' }]);
      if (keyword === '新合成商品') return reply(res, [{ id: 1, title: '新合成商品', type: 'product' }]);
      return reply(res, [{ id: 1, title: '合成商品甲', type: 'product' }, { id: 2, title: '合成商品乙', type: 'product' }]);
    }
    if (req.url === '/api/customers/1') return reply(res, { id: 1, name: '合成客户', priceLevel: 'A', creditLimit: null });
    if (req.url === '/api/products/1') return reply(res, { id: 1, name: '新合成商品', code: 'P1', unit: '件', allowDecimalQty: false });
    if (req.url.startsWith('/api/price-lists/customer-price')) return reply(res, { salePrice: 2.1, priceLevel: 'A', source: 'price_level' });
    if (req.url.startsWith('/api/inventory/stock')) return reply(res, { list: [] });
    if (req.url.startsWith('/api/inventory/query-by-product')) return reply(res, { productId: 2, containers: [] });
    if (req.url.startsWith('/api/system/request-status/')) return reply(res, { status: 'success', resourceId: 8 });
    res.writeHead(404); res.end('{}');
  });
  flow.listen(0, '127.0.0.1'); await once(flow, 'listening');
  const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  agent = spawn(process.execPath, [join(directory, 'src/server.js')], {
    env: { ...process.env, FLOW_BASE_URL: `http://127.0.0.1:${flow.address().port}`, AGENT_PORT: String(port), AGENT_MODEL_API_KEY: 'synthetic-fixture-key', AGENT_MODEL_BASE_URL: `http://127.0.0.1:${flow.address().port}`, AGENT_MODEL_NAME: 'fixture', AGENT_ALLOWED_ORIGINS: 'http://127.0.0.1:5198' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* wait for this process to listen */ }
    if (agent.exitCode !== null) throw new Error('Agent fixture exited before listening');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Agent fixture did not start');
});

after(async () => {
  if (agent && agent.exitCode === null) { agent.kill('SIGTERM'); await once(agent, 'exit'); }
  if (flow) { flow.closeAllConnections(); await new Promise(resolve => flow.close(resolve)); }
  if (directory) await rm(directory, { recursive: true, force: true });
});

const request = (path, token = 'owner', options = {}) => fetch(base + path, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });

test('未登录不能读取已知任务', async () => {
  assert.equal((await request(`/tasks/${taskId}`, '', {})).status, 401);
});
test('其他用户不能读取或代确认原任务', async () => {
  assert.equal((await request(`/tasks/${taskId}`, 'other')).status, 403);
  assert.equal((await request(`/tasks/${taskId}/confirm`, 'other', { method: 'POST' })).status, 403);
});
test('本人任务响应不泄露内部载荷、权限和请求键', async () => {
  const response = await request(`/tasks/${taskId}`);
  assert.equal(response.status, 200);
  const { task } = await response.json();
  assert.equal(task.id, taskId);
  assert.equal(task.actor, undefined);
  assert.equal(task.requestKey, undefined);
  assert.equal(task.preview.payload, undefined);
  assert.equal(task.preview.lines[0]._stockProduct, undefined);
  assert.equal(task.reply, '合成原预览');
  assert.equal(task.userText, '合成原任务');
  assert.equal(task.revision, 2);
});
test('刷新用的任务列表最多30条、最新在前且只含当前用户安全视图', async () => {
  const response = await request('/tasks');
  assert.equal(response.status, 200);
  const { tasks } = await response.json();
  assert.equal(tasks.length, 30);
  assert.equal(tasks[0].id, taskId);
  assert.equal(tasks[1].id, 'test-expired-task');
  assert.equal(tasks[2].id, 'test-choice-task');
  assert.equal(tasks.some(task => task.id === 'test-legacy-chat'), false);
  assert.equal(tasks[0].preview.payload, undefined);
  assert.equal(tasks[0].requestKey, undefined);
  assert.equal((await (await request('/tasks', 'other')).json()).tasks.length, 0);
});
test('旧纯闲聊不提供默认恢复或详情，保留持久化原数据', async () => {
  assert.equal((await request('/tasks/test-legacy-chat')).status, 403);
  const persisted = JSON.parse(await readFile(join(directory, 'data/tasks.json'), 'utf8'));
  assert.equal(persisted.find(task => task.id === 'test-legacy-chat').userText, '聊聊阅读习惯');
});
test('撤查看权限或撤仓后旧任务详情、列表和确认均不泄露快照', async () => {
  for (const token of ['revoked', 'scoped']) {
    assert.equal((await request(`/tasks/${taskId}`, token)).status, 403);
    const list = await request('/tasks', token);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).tasks.length, 0);
    assert.equal((await request(`/tasks/${taskId}/confirm`, token, { method: 'POST' })).status, 403);
  }
});
test('过期任务在恢复视图呈现为EXPIRED', async () => {
  const response = await request('/tasks/test-expired-task');
  assert.equal(response.status, 200);
  const { task } = await response.json();
  assert.equal(task.state, 'EXPIRED');
  assert.match(task.reply, /过期/);
});
test('HTTP确认接收revision，拒绝旧预览版本', async () => {
  const response = await request(`/tasks/${taskId}/confirm`, 'owner', { method: 'POST', body: JSON.stringify({ revision: 1 }) });
  assert.equal(response.status, 409);
});
test('首次HTTP销售预览时间戳与原任务恢复相同，版本一致', async () => {
  const response = await request('/chat', 'owner', { method: 'POST', body: JSON.stringify({ message: '给合成客户开单：新合成商品 2件' }) });
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.task.state, 'AWAITING_CONFIRM');
  assert.equal(first.task.revision, 1);
  assert.ok(first.preview.builtAt);
  assert.ok(first.preview.expiresAt);
  const { task } = await (await request(`/tasks/${first.task.id}`)).json();
  assert.equal(first.preview.builtAt, task.preview.builtAt);
  assert.equal(first.preview.expiresAt, task.preview.expiresAt);
  assert.equal(first.task.revision, task.revision);
});
test('HTTP候选选择原任务接续，越过原候选集合返回400', async () => {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  const invalid = await request('/chat', 'owner', { ...options, body: JSON.stringify({ message: '选择', taskId: 'test-choice-task', choiceId: 999 }) });
  assert.equal(invalid.status, 400);
  const selected = await request('/chat', 'owner', { ...options, body: JSON.stringify({ message: '选择乙', taskId: 'test-choice-task', choiceId: 2 }) });
  assert.equal(selected.status, 200);
  const output = await selected.json();
  assert.equal(output.task.id, 'test-choice-task');
  assert.equal(output.task.state, 'DONE');
  assert.equal(output.result.productId, 2);
  const restored = (await (await request('/tasks/test-choice-task')).json()).task;
  assert.equal(restored.reply, output.reply);
  assert.equal(restored.result.productId, 2);
});
test('HTTP身份问候只在本地短回，不创建可恢复的闲聊任务', async () => {
  const response = await request('/chat', 'owner', { method: 'POST', body: JSON.stringify({ message: '你叫什么名字' }) });
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.equal(output.task, null);
  assert.match(output.reply, /小满/);
  assert.doesNotMatch(output.reply, /助手|Agent/);
  const tasks = (await (await request('/tasks')).json()).tasks;
  assert.equal(tasks.some(task => task.graph === 'G-chat' || task.userText === '你叫什么名字'), false);
  const persisted = JSON.parse(await readFile(join(directory, 'data/tasks.json'), 'utf8'));
  assert.equal(persisted.some(task => task.userText === '你叫什么名字' || (task.graph === 'G-chat' && task.userText !== '聊聊阅读习惯')), false);
});
test('每次请求重新验证当前登录身份，不使用旧权限缓存', async () => {
  const start = meCalls;
  await request('/me'); await request('/me');
  assert.equal(meCalls - start, 2);
});
test('正文格式与类型错误明确返回400', async () => {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
  assert.equal((await request('/chat', 'owner', { ...options, body: '{' })).status, 400);
  assert.equal((await request('/chat', 'owner', { ...options, body: '{"message":{}}' })).status, 400);
});
test('过大正文返回413且未登录先返回401', async () => {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '字'.repeat(40000) }) };
  assert.equal((await request('/chat', 'owner', options)).status, 413);
  assert.equal((await request('/chat', '', options)).status, 401);
});
test('拒绝未经允许的浏览器Origin', async () => {
  assert.equal((await request('/health', '', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
});
test('Flow回执查询携带当前领域action', async () => {
  const client = new FlowClient(`http://127.0.0.1:${flow.address().port}`, 'owner', { clientId: 'synthetic-client' });
  await client.requestStatus('original-request', 'sale.create');
  assert.equal(new URL(lastPath, 'http://fixture').searchParams.get('action'), 'sale.create');
  assert.equal(lastHeaders['x-client-id'], 'synthetic-client');
});
test('启动服务不自动写模型密钥文件', async () => {
  let exists = true;
  try { await readFile(join(directory, '.env.local')); } catch (e) { if (e.code === 'ENOENT') exists = false; else throw e; }
  assert.equal(exists, false);
});
