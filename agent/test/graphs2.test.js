// 图 C（补货/采购草稿）与图 B2（占库）测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask } from '../src/agent.js';

const FULL = { username: 't', realName: '测试员', roleId: 2, roleName: '全权', permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };

function makeMock({ reserveAvailable = 130 } = {}) {
  const state = { purchases: [], reserveCalls: 0, reserved: false, cost1: 4.5 };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (p === '/api/search/') return ok(res, []);
    if (p === '/api/warehouses') return ok(res, { list: [{ id: 1, name: '华东一仓' }] });
    if (p === '/api/inventory/replenishment') return ok(res, { list: [
      { productId: 1, productCode: 'P000001', productName: '缓冲铰链·全盖', unit: '件', supplierId: 1, supplierName: '演示五金供应公司', warehouseId: 1, onHand: 60, available: 60, inTransit: 0, suggestedQty: 964 },
      { productId: 3, productCode: 'P000003', productName: '上翻支撑·标准型', unit: '个', supplierId: 2, supplierName: '演示二供', warehouseId: 1, onHand: 130, available: 130, inTransit: 0, suggestedQty: 10 },
    ], pagination: {} });
    if (p === '/api/products/1') return ok(res, { id: 1, costPrice: state.cost1, allowDecimalQty: false, productCode: 'P000001', unit: '件' });
    if (p === '/api/products/3') return ok(res, { id: 3, costPrice: 6, allowDecimalQty: false, productCode: 'P000003', unit: '个' });
    if (p === '/api/purchase/' && req.method === 'POST') {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const order = { id: 50 + state.purchases.length, orderNo: `PC-MOCK-${state.purchases.length + 1}`, totalAmount: body.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) };
      state.purchases.push({ body, order }); return ok(res, order);
    }
    if (p.startsWith('/api/purchase/')) { const o = state.purchases.find(x => x.order.id === Number(p.split('/')[3])); return ok(res, o?.order); }
    if (p === '/api/sale/' && req.method === 'GET') return ok(res, { list: [{ id: 7, orderNo: 'SL20261026005', customerName: '演示客户甲公司', warehouseId: 1, warehouseName: '华东一仓' }] });
    if (p === '/api/sale/7/reserve-preview') return ok(res, { orderId: 7, warehouseId: 1, warehouseName: '华东一仓', credit: null, items: [{ productId: 3, productName: '上翻支撑·标准型', quantity: 3, reservedQty: state.reserved ? 3 : 0, remainToReserve: state.reserved ? 0 : 3, warehouses: [{ warehouseId: 1, available: reserveAvailable, pickableQuantity: reserveAvailable }] }] });
    if (p === '/api/sale/7/reserve' && req.method === 'POST') { state.reserveCalls++; state.reserved = true; return ok(res, { reserved: true }); }
    if (p === '/api/sale/7') return ok(res, { id: 7, orderNo: 'SL20261026005', items: [{ productId: 3, quantity: 3, reservedQty: state.reserved ? 3 : 0 }] });
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'nf ' + p }));
  });
  return { server, state };
}
async function ctx(opts) {
  const { server, state } = makeMock(opts);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, state, client: new FlowClient(`http://127.0.0.1:${server.address().port}`, 't'), store: new TaskStore(null) };
}

test('图 C1 补货建议：按供应商分组呈现', async () => {
  const { server, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '补货建议');
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /演示五金供应公司/);
  assert.match(out.reply, /建议补 964/);
  server.close();
});

test('图 C2 采购草稿：预览按供应商拆单合计对平 → 确认逐张落单核验', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.drafts.length, 2);
  assert.equal(out.preview.grandTotalCents, 964 * 450 + 10 * 600);
  const done = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.purchases.length, 2);
  assert.match(done.reply, /PC-MOCK-1/);
  assert.match(done.reply, /PC-MOCK-2/);
  server.close();
});

test('图 C2 新鲜度：成本价变了 → 确认拦截，零落单', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  state.cost1 = 5.0;
  const blocked = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.equal(state.purchases.length, 0);
  server.close();
});

test('图 C2 权限：无 purchase.order.create → 拒绝', async () => {
  const { server, state, client, store } = await ctx();
  const actor = { ...FULL, permissions: FULL.permissions.filter(p => p !== 'purchase.order.create') };
  const out = await handleMessage(store, client, actor, '按补货建议建采购草稿');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /采购单新建/);
  assert.equal(state.purchases.length, 0);
  server.close();
});

test('图 B2 占库：试占预览 → 确认 → 执行 → 回查待占 0', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.totalRemain, 3);
  const done = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.reserveCalls, 1);
  server.close();
});

test('图 B2 缺口：可用不足 → 不给确认、不部分占库', async () => {
  const { server, state, client, store } = await ctx({ reserveAvailable: 2 });
  const out = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /占不了库/);
  assert.equal(state.reserveCalls, 0);
  server.close();
});

test('图 B2 已全占：直接告知无需操作', async () => {
  const { server, state, client, store } = await ctx();
  state.reserved = true;
  const out = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /已全部占库/);
  assert.equal(state.reserveCalls, 0);
  server.close();
});
