import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMessage, confirmTask } from '../src/agent.js';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';

const actor = { id: 11, username: 'owner', roleId: 2, permissions: ['dashboard.view', 'inventory.view', 'warehouse.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'payment.view', 'payment.execute', 'finance.account.view'], warehouseIds: null, unrestrictedWarehouseScope: true };
const rule = { parseIntent: async () => null };
function fixture(file = null) {
  const store = new TaskStore(file);
  const state = { writes: [], calls: [], price: 2, allowDecimal: false, fail: false, beforePrice: null };
  const client = { get: async path => {
    state.calls.push(path);
    const url = new URL(path, 'http://synthetic');
    if (url.pathname === '/api/search/') return url.searchParams.get('q').includes('客户')
      ? [{ id: 4, type: 'customer', title: '合成客户' }]
      : [{ id: url.searchParams.get('q').includes('拉手') ? 2 : 1, type: 'product', title: url.searchParams.get('q').includes('拉手') ? '合成拉手' : '合成铰链' }];
    if (url.pathname === '/api/warehouses') return [{ id: 1, name: '合成一仓' }];
    if (url.pathname === '/api/customers/4') return { id: 4, name: '合成客户', priceLevel: 'A', creditLimit: null };
    if (url.pathname.startsWith('/api/products/')) {
      if (state.fail) throw new Error('合成商品读取失败');
      const id = Number(url.pathname.split('/').at(-1));
      return { id, name: id === 2 ? '合成拉手' : '合成铰链', code: `SYNTHETIC-${id}`, unit: '个', allowDecimalQty: state.allowDecimal };
    }
    if (url.pathname === '/api/price-lists/customer-price') { if (state.beforePrice) await state.beforePrice(); return { salePrice: state.price, priceLevel: 'A' }; }
    if (url.pathname === '/api/inventory/stock') return { list: [1, 2].map(productId => ({ productId, warehouseId: 1, quantity: 20, reserved: 0, available: 20 })) };
    if (url.pathname === '/api/sale/8') return { id: 8, orderNo: 'SL-SYNTHETIC-8', totalAmount: state.writes[0].items.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0) };
    throw new Error(`unexpected ${path}`);
  }, post: async (_path, body) => { state.writes.push(body); return { id: 8, orderNo: 'SL-SYNTHETIC-8' }; } };
  const runtime = createAgentRuntime({ store, messageOptions: rule });
  const send = (task, message, who = actor) => handleMessage(store, client, who, message, { ...rule, taskId: task.id });
  const cancel = (task, who = actor) => runtime.dispatch({ method: 'POST', pathname: `/tasks/${task.id}/cancel`, body: {}, actor: who, client });
  const sale = async (multiple = false) => (await handleMessage(store, client, actor, `给合成客户开单：合成铰链2个${multiple ? '，合成拉手4个' : ''}`, rule)).task;
  return { state, store, client, runtime, send, cancel, sale };
}

for (const message of ['改成3个吧', '多了，改5个', '第1行改成3个', '合成铰链改成3个']) {
  test(`当前销售预览优先接续口语改量：${message}`, async () => {
    const f = fixture(), task = await f.sale();
    const oldRevision = task.revision, key = task.requestKey;
    f.state.price = 3;
    const out = await f.send(task, message);
    assert.equal(out.task.id, task.id);
    assert.equal(task.preview.lines[0].qty, message.includes('5') ? 5 : 3);
    assert.equal(task.preview.lines[0].unitPrice, 3);
    assert.equal(task.revision, oldRevision + 1);
    assert.match(out.reply, /2\s*→\s*[35]/);
    assert.equal(task.requestKey, key);
    assert.equal(f.state.writes.length, 0);
    await assert.rejects(() => confirmTask(f.store, f.client, task.id, actor, { revision: oldRevision }), e => e.code === 'PREVIEW_REVISION_CONFLICT');
  });
}

for (const [raw, qty] of [['三', 3], ['两', 2], ['十', 10], ['十二', 12], ['二十', 20], ['一百', 100], ['一百零二', 102], ['一百一十二', 112], ['两百', 200], ['一千零二', 1002], ['一千零一十', 1010], ['两千三百零四', 2304]]) {
  test(`规范中文数量按原义修改：${raw}`, async () => {
    const f = fixture(), task = await f.sale();
    const revision = task.revision;
    const out = await f.send(task, `改成${raw}个吧`);
    assert.equal(out.task.preview.lines[0].qty, qty);
    assert.equal(task.revision, revision + 1);
    assert.equal(task.confirmationBlocked, null);
    assert.equal(f.state.writes.length, 0);
  });
}

for (const message of ['改成一二个', '改成十十个', '改成零三个', '改成二百二个', '改成百个', '改成两十个', '改成一千二个', '改成一百百个', '第一二行改成3个', '第零二行改成3个', '第二一行改成3个', '第零一行改成3个']) {
  test(`歧义中文数量或行号不猜值，保留原版并暂停：${message}`, async () => {
    const f = fixture(), task = await f.sale(true);
    const original = structuredClone(task.preview), revision = task.revision, userText = task.userText;
    const out = await f.send(task, message.startsWith('改成') ? `第2行${message}` : message);
    assert.deepEqual(task.preview, original);
    assert.equal(task.revision, revision);
    assert.equal(task.userText, userText);
    assert.ok(task.confirmationBlocked);
    assert.match(out.reply, /阿拉伯数字/);
    await assert.rejects(() => confirmTask(f.store, f.client, task.id, actor, { revision }), error => error.code === 'PREVIEW_CONFIRMATION_BLOCKED');
    assert.equal(f.state.writes.length, 0);
  });
}

test('规范中文行号只修改指定行', async () => {
  const f = fixture(), task = await f.sale(true);
  await f.send(task, '第二行改成三个');
  assert.deepEqual(task.preview.lines.map(line => line.qty), [2, 3]);
  assert.equal(task.confirmationBlocked, null);
});

for (const [message, multiple] of [['改成3个吧', true], ['第9行改3个', false], ['改成-3个', false], ['改成1.001个', false], ['改成1.000000001个', false], ['改成0.5个', false], ['改成零个', false], ['改成很多个', false], ['不存在的商品改成3个', false], ['第1行合成拉手改3个', true], ['第1行和第2行改3个', true]]) {
  test(`无法安全改量时保留正文和预览并服务端冻结：${message}/${multiple}`, async () => {
    const f = fixture(), task = await f.sale(multiple), original = structuredClone(task.preview), text = task.userText, revision = task.revision;
    const out = await f.send(task, message);
    assert.equal(out.task.id, task.id);
    assert.deepEqual(task.preview, original);
    assert.equal(task.userText, text);
    assert.equal(task.revision, revision);
    assert.ok(task.confirmationBlocked);
    assert.match(out.reply, /尚未修改|未修改/);
    assert.match(out.reply, /暂停/);
    await assert.rejects(() => confirmTask(f.store, f.client, task.id, actor, { revision }), e => e.status === 409 && e.code === 'PREVIEW_CONFIRMATION_BLOCKED');
    assert.equal(f.state.writes.length, 0);
  });
}

test('失败阻断经持久化恢复，继续原版必须重新读取后才能解除', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoman-preview-'));
  try {
    const file = join(directory, 'tasks.json'), f = fixture(file), task = await f.sale();
    f.state.fail = true;
    const out = await f.send(task, '改成3个吧');
    assert.match(out.reply, /未修改/);
    const restored = fixture(file), original = restored.store.get(task.id);
    assert.ok(original.confirmationBlocked);
    const view = await restored.runtime.dispatch({ method: 'GET', pathname: `/tasks/${task.id}`, actor, client: restored.client });
    assert.ok(view.task.confirmationBlocked);
    restored.state.price = 4;
    const fresh = await restored.send(original, '继续原版');
    assert.equal(fresh.task.confirmationBlocked, null);
    assert.equal(fresh.preview.lines[0].qty, 2);
    assert.equal(fresh.preview.lines[0].unitPrice, 4);
    assert.equal(fresh.task.revision, task.revision + 1);
    assert.equal(restored.state.writes.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('澄清行号成功重新试算解除阻断；单价不被当数量', async () => {
  const f = fixture(), task = await f.sale(true);
  await f.send(task, '改成3个吧');
  const fixed = await f.send(task, '第2行改成3个吧');
  assert.equal(fixed.task.confirmationBlocked, null);
  assert.deepEqual(task.preview.lines.map(line => line.qty), [2, 3]);
  const original = structuredClone(task.preview);
  const price = await f.send(task, '单价改3');
  assert.match(price.reply, /不能代办|不支持|不.*改价/);
  assert.deepEqual(task.preview, original);
  assert.equal(f.state.writes.length, 0);
});

test('文字确认只引导卡片，不执行销售或两段资金写入', async () => {
  const f = fixture(), task = await f.sale();
  for (const graph of ['B-sale-draft', 'D-receipt', 'D-settle']) {
    task.graph = graph;
    const out = await f.send(task, '确认');
    assert.equal(out.task.id, task.id);
    assert.match(out.reply, /卡片|预览.*按钮/);
    assert.equal(task.state, 'AWAITING_CONFIRM');
  }
  assert.equal(f.state.writes.length, 0);
});

test('放弃预览幂等且保留请求键、正文、原预览，取消后不可确认', async () => {
  const f = fixture(), task = await f.sale(), key = task.requestKey, preview = structuredClone(task.preview);
  const out = await f.cancel(task);
  assert.equal(out.task.state, 'CANCELLED');
  assert.equal((await f.cancel(task)).task.state, 'CANCELLED');
  assert.equal(task.requestKey, key);
  assert.deepEqual(task.preview, preview);
  await assert.rejects(() => confirmTask(f.store, f.client, task.id, actor), e => e.status === 409);
  assert.equal(f.state.writes.length, 0);
});
test('取消复核属主、当前读写权限和过期；未授权零变更', async () => {
  const f = fixture(), task = await f.sale();
  for (const who of [{ ...actor, id: 12 }, { ...actor, permissions: ['dashboard.view'] }, { ...actor, permissions: actor.permissions.filter(p => p !== 'sale.order.create') }]) {
    await assert.rejects(() => f.cancel(task, who), e => e.status === 403);
    assert.equal(task.state, 'AWAITING_CONFIRM');
  }
  task.preview.expiresAt = '2000-01-01T00:00:00Z';
  await assert.rejects(() => f.cancel(task), e => e.status === 409);
  assert.equal(f.state.writes.length, 0);
});
test('执行中及未知结果不能取消；已完成结果不被隐藏', async () => {
  const f = fixture(), task = await f.sale();
  for (const state of ['CONFIRMED', 'EXECUTING', 'RESULT_UNKNOWN', 'VERIFYING', 'ESCALATED', 'DONE']) {
    task.state = state;
    task.result = { orderId: 8, orderNo: 'SL-SYNTHETIC-8' };
    await assert.rejects(() => f.cancel(task), e => e.status === 409);
    assert.equal(task.state, state);
    assert.equal(task.result.orderId, 8);
  }
});
test('取消与确认共用锁，确认先行时取消不隐藏执行结果', async () => {
  const f = fixture(), task = await f.sale();
  let release, entered;
  const held = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  f.state.beforePrice = async () => { entered(); await held; };
  const running = confirmTask(f.store, f.client, task.id, actor);
  await ready;
  try { await assert.rejects(() => f.cancel(task), e => e.code === 'TASK_BUSY'); }
  finally { release(); }
  assert.equal((await running).task.state, 'DONE');
  assert.equal(f.state.writes.length, 1);
});
test('取消先行的并发确认被同一任务锁拒绝，零业务写入', async () => {
  const f = fixture(), task = await f.sale();
  const cancelling = f.cancel(task);
  await assert.rejects(() => confirmTask(f.store, f.client, task.id, actor), e => e.code === 'TASK_BUSY');
  assert.equal((await cancelling).task.state, 'CANCELLED');
  assert.equal(f.state.writes.length, 0);
});
test('只有严格单一预览取消意图可接续，业务取消及混合命令不可借道', async () => {
  for (const message of ['放弃预览', '放弃当前预览', '取消这份预览']) {
    const f = fixture(), task = await f.sale();
    assert.equal((await f.send(task, message)).task.state, 'CANCELLED');
  }
  for (const message of ['取消订单', '删掉草稿', '放弃预览，然后取消订单', '取消这份预览，再给合成客户开单：合成铰链3个']) {
    const f = fixture(), task = await f.sale();
    await f.send(task, message);
    assert.equal(task.state, 'AWAITING_CONFIRM', message);
    assert.equal(f.store.tasks.size, 1);
    assert.equal(f.state.writes.length, 0);
  }
});
test('放弃核销只取消第二段预览，已登记的收款结果和原请求键保留', async () => {
  const f = fixture(), stage1 = await f.sale();
  stage1.graph = 'D-receipt'; stage1.state = 'DONE'; stage1.result = { receiptId: 7, receiptNo: 'RC-SYNTHETIC-7', amountCents: 400 };
  const stage2 = f.store.create({ graph: 'D-settle', userText: '合成客户到账4元核销', actor });
  stage2.transition('DRY_RUNNING'); stage2.setPreview({ receiptId: 7, receiptNo: 'RC-SYNTHETIC-7', customer: { id: 4, name: '合成客户' } }); stage2.transition('AWAITING_CONFIRM');
  stage1.result.stage2TaskId = stage2.id;
  const before = structuredClone(stage1.result), key = stage2.requestKey;
  const out = await f.cancel(stage2);
  assert.equal(stage2.state, 'CANCELLED');
  assert.equal(stage2.requestKey, key);
  assert.deepEqual(stage1.result, before);
  assert.equal(stage1.state, 'DONE');
  assert.match(out.reply, /收款已登记|收款已经登记/);
  assert.doesNotMatch(out.reply, /收款已取消/);
  const restored = await confirmTask(f.store, f.client, stage1.id, actor);
  assert.match(restored.reply, /核销预览已放弃/);
  assert.equal(restored.result.receiptId, 7);
  assert.equal(f.state.writes.length, 0);
});
test('修订读取尚未返回时，磁盘恢复的旧版本也必须暂停确认', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xiaoman-preview-inflight-'));
  try {
    const file = join(directory, 'tasks.json'), f = fixture(file), task = await f.sale();
    let release, entered;
    const held = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
    f.state.beforePrice = async () => { entered(); await held; };
    const revising = f.send(task, '改成3个吧');
    await ready;
    const restored = fixture(file);
    try { await assert.rejects(() => confirmTask(restored.store, restored.client, task.id, actor), e => e.code === 'PREVIEW_CONFIRMATION_BLOCKED'); }
    finally { release(); await revising; }
    assert.equal(f.state.writes.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('T13真实修订跨旧TTL可由EXPIRED1恢复AWAITING2，旧确认版不能授权新数量', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(), task = await f.sale(), originalRevision = task.revision, originalKey = task.requestKey;
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  f.state.beforePrice = async () => { entered(); await held; };
  const editing = f.send(task, '改成9个吧');
  await ready;
  now = Date.parse(task.preview.expiresAt) + 1;
  const expiredView = await f.runtime.dispatch({ method: 'GET', pathname: `/tasks/${task.id}`, actor, client: f.client });
  assert.equal(expiredView.task.state, 'EXPIRED');
  assert.equal(expiredView.task.revision, originalRevision);
  release(); await editing;
  f.state.beforePrice = null;
  const currentView = await f.runtime.dispatch({ method: 'GET', pathname: `/tasks/${task.id}`, actor, client: f.client });
  assert.equal(currentView.task.state, 'AWAITING_CONFIRM');
  assert.equal(currentView.task.revision, originalRevision + 1);
  assert.equal(currentView.task.preview.lines[0].qty, 9);
  assert.equal(task.requestKey, originalKey);
  await assert.rejects(() => confirmTask(f.store, f.client, task.id, actor, { revision: originalRevision }), error => error.code === 'PREVIEW_REVISION_CONFLICT');
  assert.equal(f.state.writes.length, 0);
  // 真正显式授权新版会首次写数量9：前端“查询原结果”绝不能代为发送该版本。
  const done = await confirmTask(f.store, f.client, task.id, actor, { revision: task.revision });
  assert.equal(done.task.state, 'DONE');
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].items[0].quantity, 9);
});
