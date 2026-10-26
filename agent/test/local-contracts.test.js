import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSalePreview, confirmTask } from '../src/agent.js';
import { diffPreview } from '../src/guards.js';
import { TaskStore } from '../src/tasks.js';
import { TOOLS } from '../src/tools.js';
import { FlowError } from '../src/flow.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTaskViews } from '../src/task-access.js';

const actor = { id: 11, username: 'owner', isSuper: true, unrestrictedWarehouseScope: true };
test('销售单价保留来源精度，100乘1.2345应为123.45元', async () => {
  const client = { get: async path => {
    if (path.startsWith('/api/customers/')) return { id: 1, name: '合成客户' };
    if (path === '/api/products/2') return { id: 2, allowDecimalQty: false };
    if (path.startsWith('/api/search/')) return [{ id: 2, type: 'product', title: '合成商品', subtitle: 'P2', details: [{ label: '单位', value: '个' }] }];
    if (path.startsWith('/api/price-lists/')) return { salePrice: '1.2345', priceLevel: 'A', source: 'price_level' };
    if (path.startsWith('/api/inventory/stock')) return { list: [{ productId: 2, warehouseId: 1, available: 100, productCode: 'P2', unit: '个' }] };
    throw new Error('unexpected request ' + path);
  } };
  const preview = await buildSalePreview(client, { customerHit: { id: 1 }, lines: [{ productKeyword: '合成商品', qty: 100 }], warehouseId: 1 }, actor);
  assert.equal(preview.lines[0].unitPrice, 1.2345);
  assert.equal(preview.totalCents, 12345);
});
test('新鲜度复核能发现小于一分的单价变化', () => {
  const line = { productId: 2, unitPrice: 1.2345, unitPriceCents: 123, available: 100 };
  assert.ok(diffPreview({ lines: [line] }, { lines: [{ ...line, unitPrice: 1.2346 }] }).length > 0);
});
test('直接确认入口也验证本人归属', async () => {
  const store = new TaskStore(null);
  const task = store.create({ graph: 'B-sale-draft', actor });
  task.state = 'AWAITING_CONFIRM';
  await assert.rejects(() => confirmTask(store, {}, task.id, { ...actor, id: 12, username: 'other' }), error => error.status === 403);
});
test('重复确认已完成任务返回原结果', async () => {
  const store = new TaskStore(null);
  const task = store.create({ graph: 'B-sale-draft', actor });
  task.state = 'DONE'; task.result = { orderId: 8 };
  const output = await confirmTask(store, {}, task.id, actor);
  assert.equal(output.task.result.orderId, 8);
});
test('重启读取没有updatedAt的旧任务时按原创建时间排序', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoman-order-'));
  try {
    const file = join(directory, 'tasks.json');
    writeFileSync(file, JSON.stringify([
      { id: 'older', actor, graph: 'B-sale-draft', state: 'DONE', createdAt: '2000-01-01T00:00:00.000Z' },
      { id: 'newer', actor, graph: 'B-sale-draft', state: 'DONE', createdAt: '2001-01-01T00:00:00.000Z' },
    ]));
    const restored = new TaskStore(file);
    assert.equal(restored.get('older').updatedAt, '2000-01-01T00:00:00.000Z');
    assert.deepEqual(listTaskViews(restored, actor).map(task => task.id), ['newer', 'older']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('收款第一段响应丢失，重查返回已经持久化的第二段核销卡', async () => {
  const store = new TaskStore(null);
  const first = store.create({ graph: 'D-receipt', actor });
  const second = store.create({ graph: 'D-settle', actor });
  second.state = 'AWAITING_CONFIRM'; second.preview = { title: '核销分配', lines: [], totalCents: 100 };
  first.state = 'DONE'; first.result = { stage2TaskId: second.id };
  const output = await confirmTask(store, {}, first.id, actor);
  assert.equal(output.task.id, second.id);
  assert.equal(output.preview.title, '核销分配');
  assert.equal(store.tasks.size, 2);
});
test('重启遗留的销售执行任务只查原回执，绝不重新提交', async () => {
  const store = new TaskStore(null);
  const task = store.create({ graph: 'B-sale-draft', actor });
  task.state = 'EXECUTING'; task.preview = { totalCents: 100 };
  const calls = [];
  const client = {
    requestStatus: async (...args) => { calls.push(args); return { status: 'success', resourceId: 8 }; },
    get: async () => ({ id: 8, orderNo: 'SYNTHETIC-8', totalAmount: 1 }),
    post: () => assert.fail('不得重新提交'),
  };
  const output = await confirmTask(store, client, task.id, actor);
  assert.equal(output.task.state, 'DONE');
  assert.deepEqual(calls, [[task.requestKey, 'sale.create']]);
});
test('收款候选完整读取超过100笔账款，不能漏掉老账', async () => {
  let calls = 0;
  const client = { get: async path => {
    calls++;
    const page = Number(new URL(path, 'http://fixture').searchParams.get('page'));
    return { list: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({ id: (page - 1) * 100 + i + 1, balance: 1 })), pagination: { page, pageSize: 100, total: 101 }, summary: { balance: 101 } };
  } };
  const records = await TOOLS['payments.receipt_suggest'].candidates(client, { customerId: 1 });
  assert.equal(records.length, 101);
  assert.equal(calls, 2);
});
test('销售写入成功后回查无权仍保留创建回执，不报告写入被拒', async () => {
  const output = await TOOLS['sale.create_draft'].run({
    post: async () => ({ id: 8, orderNo: 'SYNTHETIC-8' }),
    get: async () => { throw new FlowError('auth', { status: 403, message: '无查看权限' }); },
  }, { payload: {}, requestKey: 'original-key' });
  assert.equal(output.created.id, 8);
  assert.equal(output.verified, null);
  assert.match(output.verificationError, /查看/);
});
