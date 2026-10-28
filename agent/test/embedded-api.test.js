import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const express = backendRequire('express');
const jwt = backendRequire('jsonwebtoken');
const AppError = backendRequire('./src/utils/AppError');
const { successResponse } = backendRequire('./src/utils/response');
const { validateBodyBudget } = backendRequire('./src/middleware/apiIngress');
const full = ['dashboard.view', 'report.view', 'inventory.view', 'warehouse.view', 'product.view', 'sale.order.view', 'sale.order.create', 'customer.view', 'price.list.view'];
const syntheticSecret = 'synthetic-assistant-jwt-only-for-test';

function loadBackend(relative, overrides = {}) {
  const filename = fileURLToPath(new URL(`../../backend/src/${relative}`, import.meta.url));
  const localRequire = createRequire(filename), module = { exports: {} };
  const require_ = name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name);
  const compiled = vm.compileFunction(readFileSync(filename, 'utf8'), ['require', 'module', 'exports', '__dirname', '__filename'], { filename });
  compiled(require_, module, module.exports, dirname(filename), filename);
  return module.exports;
}

async function fixture({ dataDir, seed = [], defaultLoader = false } = {}) {
  const directory = dataDir || await mkdtemp(join(tmpdir(), 'xiaoman-embedded-'));
  try {
  if (seed.length) await writeFile(join(directory, 'tasks.json'), JSON.stringify(seed), { mode: 0o600 });
  const users = new Map([[11, { id: 11, username: 'owner', real_name: '合成甲', role_id: 2, role_name: '合成岗位', token_version: 1, permissions: [...full], warehouseIds: null }],
    [12, { id: 12, username: 'other', real_name: '合成乙', role_id: 3, role_name: '另一岗位', token_version: 1, permissions: [...full], warehouseIds: null }]]);
  let loads = 0;
  const auth = loadBackend('middleware/auth.js', {
    './opLogger': (_req, _res, next) => next(),
    './loadRolePermissions': { loadRolePermissions: (req, _res, next) => { req.user.permissions = [...users.get(req.user.userId).permissions]; next(); } },
    '../config/env': { env: { JWT_SECRET: syntheticSecret } },
    '../modules/auth/currentAuthUser': { getCurrentAuthUser: async id => {
      const user = users.get(Number(id));
      if (!user || user.disabled) throw new AppError('账号已停用', 401, 'AUTH_SESSION_INVALID');
      return user;
    } },
    '../modules/auth/sessionFamilies': { assertActiveFamily: async () => {} },
    '../modules/auth/auth-audit.service': { recordAuthAudit: async () => {}, AUTH_AUDIT_EVENT: { PERMISSION_DENIED: 'DENIED' } },
    '../utils/requestContext': { updateRequestContext: () => {} },
    '../utils/warehouseScope': { loadUserWarehouseScope: async id => users.get(id).warehouseIds },
  });
  const { createAssistantService } = backendRequire('./src/modules/assistant/assistant.service');
  const service = createAssistantService({ dataDir: directory, ...(defaultLoader ? {} : { loadRuntime: async () => {
    loads++;
    const module = await import('../src/runtime.js');
    return { ...module, createAgentRuntime: options => module.createAgentRuntime({ ...options, messageOptions: { parseIntent: async () => null, chatModel: async () => { throw new Error('synthetic-private-model-detail'); } } }) };
  } }) });
  const { createAssistantController } = backendRequire('./src/modules/assistant/assistant.controller');
  const controller = createAssistantController(service);
  const router = loadBackend('modules/assistant/assistant.routes.js', { '../../middleware/auth': auth, './assistant.controller': controller });
  const app = express(), flowCalls = [];
  app.use('/api/assistant', router);
  app.use(express.json({ limit: '2mb' }), validateBodyBudget);
  app.use('/api', auth.authMiddleware);
  app.use('/api', (req, _res, next) => { flowCalls.push({ method: req.method, path: req.originalUrl, authorization: req.headers.authorization, clientId: req.headers['x-client-id'] }); next(); });
  app.get('/api/search/', (_req, res) => successResponse(res, [{ id: 7, type: 'product', title: '合成铰链' }]));
  app.get('/api/warehouses', (_req, res) => successResponse(res, [{ id: 1, name: '一仓' }, { id: 2, name: '二仓' }]));
  app.get('/api/inventory/query-by-product', (req, res) => successResponse(res, { productId: 7, productName: '合成铰链', unit: '件', containers: [{ id: 20, warehouseId: Number(req.query.warehouseId), remainingQty: 5, barcode: 'SYNTHETIC-SCOPE-TWO' }] }));
  app.get('/api/inventory/stock', (_req, res) => successResponse(res, { list: [1, 2].map(warehouseId => ({ id: warehouseId, warehouseId, productId: 7, quantity: 5, reserved: 0, available: 5 })) }));
  app.get('/api/customers/4', (_req, res) => successResponse(res, { id: 4, name: '合成客户', priceLevel: 'A', creditLimit: null }));
  app.get('/api/products/7', (_req, res) => successResponse(res, { id: 7, name: '合成铰链', unit: '个', code: 'SYNTHETIC-7', allowDecimalQty: false }));
  app.get('/api/price-lists/customer-price', (_req, res) => successResponse(res, { salePrice: 2, priceLevel: 'A' }));
  app.get('/api/system/request-status/:key', (req, res) => successResponse(res, { status: 'success', resourceId: 8 }));
  app.get('/api/sale/8', (_req, res) => successResponse(res, { id: 8, orderNo: 'SL-SYNTHETIC-RECOVERED', totalAmount: 1, status: 0 }));
  app.post('/api/sale/', () => assert.fail('恢复不应重发创建'));
  const errorHandler = loadBackend('middleware/errorHandler.js', {
    '../utils/logger': { warn() {}, error() {} }, '../config/env': { env: { NODE_ENV: 'test' } },
    '../utils/errorTracking': { initializeErrorTracking() {}, captureUnexpectedError() {} },
  });
  app.use(errorHandler);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const token = id => jwt.sign({ userId: id, tokenVersion: 1, familyId: 'synthetic-family', tokenType: 'access' }, syntheticSecret, { expiresIn: 3600 });
  const request = async (path, { id = 11, method = 'GET', body, raw, headers = {}, chunked = false } = {}) => {
    const payload = raw ?? (body !== undefined ? JSON.stringify(body) : undefined);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant${path}`, { method,
      headers: { ...(id ? { Authorization: `Bearer ${token(id)}` } : {}), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: chunked ? Readable.from([payload.slice(0, 12000), payload.slice(12000)]) : payload,
      ...(chunked ? { duplex: 'half' } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { users, directory, service, request, flowCalls, loads: () => loads,
    close: async () => { await new Promise(resolve => server.close(resolve)); if (!dataDir) await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    if (!dataDir) await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
async function usingFixture(run, options) { const f = await fixture(options); try { await run(f); } finally { await f.close(); } }

test('正式模块导入与挂载不启动监听、不读任务或加载模型运行时', () => usingFixture(async f => {
  assert.equal(f.loads(), 0);
  const out = await f.request('/health', { id: null });
  assert.equal(out.status, 401);
  assert.equal(f.loads(), 0);
}));
test('健康、任务、聊天与确认均先认证，畸形大正文不能越过身份检查', () => usingFixture(async f => {
  for (const path of ['/health', '/tasks', '/tasks/unknown', '/chat', '/tasks/unknown/confirm', '/tasks/unknown/cancel']) {
    const write = path.includes('chat') || /\/(confirm|cancel)$/.test(path);
    const out = await f.request(path, { id: null, method: write ? 'POST' : 'GET', raw: write ? '{'.repeat(40000) : undefined });
    assert.equal(out.status, 401, path);
    assert.equal(out.body.success, false);
  }
  assert.equal(f.loads(), 0);
}));
test('实时岗位缺少两个入口权限时，先拒绝再解析正文或加载运行时', () => usingFixture(async f => {
  f.users.get(11).permissions = ['inventory.view'];
  for (const path of ['/health', '/chat', '/tasks/unknown/confirm', '/tasks/unknown/cancel']) {
    const out = await f.request(path, { method: path === '/health' ? 'GET' : 'POST', raw: path === '/health' ? undefined : '{'.repeat(40000) });
    assert.equal(out.status, 403);
    assert.equal(out.body.code, 'PERMISSION_DENIED');
  }
  assert.equal(f.loads(), 0);
}));
test('取消入口沿正式32KiB、结构预算、JSON及压缩限制，零业务调用', () => usingFixture(async f => {
  const path = '/tasks/original/cancel';
  for (const chunked of [false, true]) assert.equal((await f.request(path, { method: 'POST', body: { padding: 'x'.repeat(40000) }, chunked })).status, 413);
  assert.equal(f.loads(), 0);
  for (const raw of ['{', '[]', 'null']) assert.equal((await f.request(path, { method: 'POST', raw })).status, 400);
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]) assert.equal((await f.request(path, { method: 'POST', body: {}, headers })).status, 415);
  const deep = {}; let node = deep;
  for (let n = 0; n < 35; n++) { node.next = {}; node = node.next; }
  assert.equal((await f.request(path, { method: 'POST', body: deep })).status, 400);
  assert.equal(f.flowCalls.length, 0);
}));

const pendingPreview = () => ({ id: 'preview-control', graph: 'B-sale-draft', state: 'AWAITING_CONFIRM', actor: { id: 11, username: 'owner', permissions: full, warehouseIds: null },
  userText: '合成预览', requestKey: 'synthetic-original-private-key', revision: 1, steps: [], preview: { customer: { id: 4, name: '合成客户' }, warehouseId: 1, warehouseName: '一仓', totalCents: 400,
    lines: [{ productId: 7, productName: '合成铰链', qty: 2 }], payload: { synthetic: true }, expiresAt: '2099-01-01T00:00:00Z' } });
test('正式HTTP改量失败冻结，恢复后旧版409，取消幂等且持久恢复', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoman-preview-http-'));
  try {
    await usingFixture(async f => {
      const path = '/tasks/preview-control';
      const failed = await f.request('/chat', { method: 'POST', body: { taskId: 'preview-control', message: '改成-3个' } });
      assert.equal(failed.status, 200);
      assert.ok(failed.body.data.task.confirmationBlocked);
      assert.equal((await f.request(`${path}/confirm`, { method: 'POST', body: { revision: 1 } })).body.code, 'PREVIEW_CONFIRMATION_BLOCKED');
      const fixed = await f.request('/chat', { method: 'POST', body: { taskId: 'preview-control', message: '改成3个吧' } });
      assert.equal(fixed.body.data.task.revision, 2);
      assert.equal(fixed.body.data.task.confirmationBlocked, null);
      assert.equal((await f.request(`${path}/confirm`, { method: 'POST', body: { revision: 1 } })).body.code, 'PREVIEW_REVISION_CONFLICT');
      assert.equal((await f.request(`${path}/cancel`, { id: 12, method: 'POST', body: {} })).status, 403);
      f.users.get(11).permissions = full.filter(p => p !== 'sale.order.create');
      assert.equal((await f.request(`${path}/cancel`, { method: 'POST', body: {} })).status, 403);
      f.users.get(11).permissions = [...full];
      for (let n = 0; n < 2; n++) assert.equal((await f.request(`${path}/cancel`, { method: 'POST', body: {} })).body.data.task.state, 'CANCELLED');
      assert.equal((await f.request(`${path}/confirm`, { method: 'POST', body: { revision: 2 } })).status, 409);
      assert.equal(f.flowCalls.some(call => call.method !== 'GET'), false);
      const persisted = JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8'))[0];
      assert.equal(persisted.requestKey, 'synthetic-original-private-key');
    }, { dataDir: directory, seed: [pendingPreview()] });
    await usingFixture(async f => {
      const detail = await f.request('/tasks/preview-control');
      assert.equal(detail.body.data.task.state, 'CANCELLED');
      assert.doesNotMatch(JSON.stringify(detail.body), /synthetic-original-private-key|"payload"|"actor"/);
      assert.equal((await f.request('/tasks/preview-control/cancel', { method: 'POST', body: {} })).body.data.task.state, 'CANCELLED');
    }, { dataDir: directory });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('入口支持报表权限，健康走正式成功信封且不泄漏密钥或原始配置', () => usingFixture(async f => {
  f.users.get(11).permissions = ['report.view'];
  const out = await f.request('/health', { headers: { Host: 'untrusted.invalid:9999', 'X-Forwarded-Host': 'untrusted.invalid' } });
  assert.equal(out.status, 200);
  assert.equal(out.body.success, true);
  assert.equal(out.body.data.ok, true);
  assert.match(out.body.data.flow, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.doesNotMatch(JSON.stringify(out.body), /untrusted|synthetic-assistant-jwt|apiKey|Authorization|model\.baseUrl/);
  assert.equal(f.loads(), 1);
}));
test('正式32KiB解析、结构深度和JSON类型约束均在业务前拒绝', () => usingFixture(async f => {
  const tooLarge = await f.request('/chat', { method: 'POST', body: { message: '在吗', padding: 'x'.repeat(32768) } });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(f.loads(), 0);
  for (const raw of ['{', '[]', 'null']) assert.equal((await f.request('/chat', { method: 'POST', raw })).status, 400);
  const deep = { message: '在吗' }; let node = deep;
  for (let n = 0; n < 35; n++) { node.next = {}; node = node.next; }
  assert.equal((await f.request('/chat', { method: 'POST', body: deep })).status, 400);
  assert.equal(f.flowCalls.length, 0);
}));
test('缺Content-Length的分块正文仍限32KiB，非JSON和压缩正文不能执行', () => usingFixture(async f => {
  const large = await f.request('/chat', { method: 'POST', body: { message: '在吗', padding: 'x'.repeat(40000) }, chunked: true });
  assert.equal(large.status, 413);
  assert.equal(large.body.code, 'PAYLOAD_TOO_LARGE');
  for (const headers of [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]) {
    const out = await f.request('/chat', { method: 'POST', body: { message: '在吗' }, headers });
    assert.equal(out.status, 415);
    assert.equal(out.body.success, false);
  }
  assert.equal(f.loads(), 0);
}));
test('正文伪造actor、token、权限和scope无效，持久化不含凭据', () => usingFixture(async f => {
  const out = await f.request('/chat', { method: 'POST', body: { message: '小满在吗', actor: { id: 12, roleId: 1, isSuper: true, permissions: full, warehouseIds: null }, token: 'SYNTHETIC-BODY-TOKEN' } });
  assert.equal(out.status, 200);
  assert.equal(out.body.data.task.graph, 'G-chat');
  const id = out.body.data.task.id;
  assert.equal((await f.request(`/tasks/${id}`, { id: 12 })).status, 403);
  assert.equal((await f.request('/tasks', { id: 12 })).body.data.tasks.length, 0);
  assert.equal((await f.request('/tasks')).body.data.tasks[0].id, id);
  const persisted = await readFile(join(f.directory, 'tasks.json'), 'utf8');
  assert.equal(JSON.parse(persisted)[0].actor.id, 11);
  assert.doesNotMatch(persisted, /SYNTHETIC-BODY-TOKEN|Authorization|synthetic-assistant-jwt|familyId/);
}));
test('范围和权限使用本次auth事实，旧快照/正文不能撤销撤仓撤权', () => usingFixture(async f => {
  const out = await f.request('/chat', { method: 'POST', body: { message: '二仓合成铰链库存' }, headers: { 'X-Client-Id': 'synthetic-workstation', Host: 'untrusted.invalid' } });
  assert.equal(out.status, 200);
  assert.equal(out.body.data.task.state, 'DONE');
  const id = out.body.data.task.id;
  assert.ok(f.flowCalls.length > 0);
  assert.ok(f.flowCalls.every(call => call.authorization?.startsWith('Bearer ') && call.clientId === 'synthetic-workstation'));
  f.users.get(11).warehouseIds = [1];
  assert.equal((await f.request(`/tasks/${id}`)).status, 403);
  assert.equal((await f.request('/tasks')).body.data.tasks.length, 0);
  const blocked = await f.request('/chat', { method: 'POST', body: { message: '二仓合成铰链库存', actor: { warehouseIds: null, isSuper: true } } });
  assert.equal(blocked.body.data.task.state, 'FAILED_FINAL');
  f.users.get(11).warehouseIds = null;
  f.users.get(11).permissions = ['dashboard.view'];
  assert.equal((await f.request(`/tasks/${id}`)).status, 403);
}));
test('停用账号与失效访问令牌不能恢复旧任务', () => usingFixture(async f => {
  f.users.get(11).token_version = 2;
  assert.equal((await f.request('/tasks')).status, 401);
  f.users.get(11).token_version = 1; f.users.get(11).disabled = true;
  assert.equal((await f.request('/tasks')).status, 401);
}));
test('并行首次请求只建立一个运行实例，各用户任务不会互相覆盖', () => usingFixture(async f => {
  const results = await Promise.all([11, 12].map(id => f.request('/chat', { id, method: 'POST', body: { message: '小满在吗' } })));
  assert.ok(results.every(out => out.status === 200));
  assert.equal(f.loads(), 1);
  for (const id of [11, 12]) assert.equal((await f.request('/tasks', { id })).body.data.tasks.length, 1);
  assert.equal(JSON.parse(await readFile(join(f.directory, 'tasks.json'), 'utf8')).length, 2);
}));
test('正式任务重启恢复本人记录且原键恢复不重新发写入', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoman-embedded-restore-'));
  const owner = { id: 11, username: 'owner', permissions: full, warehouseIds: null };
  try {
    await usingFixture(async f => {
      const out = await f.request('/tasks/original/confirm', { method: 'POST', body: {} });
      assert.equal(out.body.data.task.state, 'DONE');
      assert.equal(out.body.data.result.recoveredViaReceipt, true);
      const lookup = f.flowCalls.find(call => call.path.startsWith('/api/system/request-status/'));
      assert.match(lookup.path, /original-private-key\?action=sale.create/);
      assert.equal(f.flowCalls.filter(call => call.method !== 'GET').length, 0);
      assert.doesNotMatch(JSON.stringify(out.body), /original-private-key|"payload"|"actor"/);
    }, { dataDir: directory, seed: [{ id: 'original', graph: 'B-sale-draft', state: 'EXECUTING', actor: owner, userText: '合成销售', requestKey: 'original-private-key', preview: { totalCents: 100 }, steps: [] }] });
    await usingFixture(async f => {
      assert.equal((await f.request('/tasks/original')).body.data.task.state, 'DONE');
      assert.equal((await f.request('/tasks/original', { id: 12 })).status, 403);
    }, { dataDir: directory });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('默认lazy loader使用固定源码路径且不会接收自定义模块地址', () => usingFixture(async f => {
  const out = await f.request('/health');
  assert.equal(out.status, 200);
  assert.equal(out.body.data.ok, true);
}, { defaultLoader: true }));
test('损坏持久化历史返回脱敏503并保留原文，不能覆盖成空历史', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoman-history-error-'));
  const original = '{SYNTHETIC-PRIVATE-HISTORY';
  try {
    await writeFile(join(directory, 'tasks.json'), original, { mode: 0o600 });
    await usingFixture(async f => {
      const out = await f.request('/chat', { method: 'POST', body: { message: '小满在吗' } });
      assert.equal(out.status, 503);
      assert.equal(out.body.success, false);
      assert.equal(out.body.code, 'ASSISTANT_HISTORY_UNAVAILABLE');
      assert.match(out.body.message, /管理员.*修复/);
      assert.doesNotMatch(JSON.stringify(out.body), /SYNTHETIC-PRIVATE-HISTORY|xiaoman-history-error|SyntaxError/);
      assert.equal(await readFile(join(directory, 'tasks.json'), 'utf8'), original);
    }, { dataDir: directory });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('固定lazy入口不打开第二监听，合成模型密钥与内部异常不进入返回值', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoman-loader-secret-'));
  try {
    const servicePath = fileURLToPath(new URL('../../backend/src/modules/assistant/assistant.service.js', import.meta.url));
    const script = `
      const assert = require('node:assert/strict');
      const service = require(${JSON.stringify(servicePath)}).createAssistantService({dataDir:${JSON.stringify(directory)}});
      const req = { user:{userId:11,username:'synthetic',roleId:2,permissions:['dashboard.view'],warehouseIds:null},headers:{authorization:'Bearer synthetic-access'},socket:{localPort:39999},body:{} };
      (async()=>{const out=await service.dispatch(req,{method:'GET',pathname:'/health'});
        assert.equal(out.modelConfigured,true);assert.equal(out.flow,'http://127.0.0.1:39999');
        assert.equal(process._getActiveHandles().filter(handle=>handle.constructor.name==='Server').length,0);
        process.stdout.write(JSON.stringify(out));})().catch(()=>process.exit(1));`;
    const child = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8', env: { ...process.env,
      AGENT_MODEL_API_KEY: 'SYNTHETIC-MODEL-SECRET', AGENT_MODEL_BASE_URL: 'https://synthetic.invalid', AGENT_MODEL_NAME: 'synthetic-model', AGENT_RUNTIME_MODULE: 'file:///must-not-load.js',
    } });
    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stdout, /SYNTHETIC-MODEL-SECRET|synthetic-access|must-not-load|apiKey/);
  } finally { await rm(directory, { recursive: true, force: true }); }
  await usingFixture(async f => {
    const out = await f.request('/chat', { method: 'POST', body: { message: '极序的页面设计怎么更清楚' } });
    assert.equal(out.body.data.task.state, 'FAILED_FINAL');
    assert.doesNotMatch(JSON.stringify(out.body), /synthetic-private-model-detail/);
  });
});

test('正式挂载在大解析前并沿用全局入口守卫，镜像只复制运行源码与私有持久化卷', () => {
  const read = relative => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
  const app = read('backend/src/app.js');
  const mount = app.indexOf("app.use('/api/assistant'");
  assert.ok(mount > app.indexOf("app.use('/api', createRequestConcurrencyGuard())"));
  assert.ok(mount < app.indexOf("express.json({ limit: '2mb' })"));
  const dockerfile = read('Dockerfile.backend');
  assert.match(dockerfile, /COPY[^\n]*agent\/package\.json[^\n]*\/opt\/flowcube-agent\//);
  assert.match(dockerfile, /COPY[^\n]*agent\/src[^\n]*\/opt\/flowcube-agent\/src/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]*agent\/\s/);
  const compose = read('docker-compose.yml');
  assert.match(compose, /AGENT_DATA_DIR: \/var\/lib\/flowcube\/assistant/);
  assert.match(compose, /assistant_data:\/var\/lib\/flowcube\/assistant/);
  assert.match(compose, /AGENT_MODEL_API_KEY: \$\{AGENT_MODEL_API_KEY:-\}/);
  assert.doesNotMatch(compose, /^  (?:agent|assistant):/m);
  for (const path of ['.dockerignore', '.gitignore']) assert.match(read(path), /agent\/data\//);
});
