// 图 C（补货/采购草稿）与图 B2（占库）测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask } from '../src/agent.js';
import { assertTaskAccess } from '../src/task-access.js';

const FULL = { username: 't', realName: '测试员', roleId: 2, roleName: '全权', permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };

function makeMock({ reserveAvailable = 130 } = {}) {
  const state = {
    purchases: [], reserveCalls: 0, reserved: false, cost1: 4.5,
    reserveLineWarehouseId: 1, reserveLineWarehouseName: '华东一仓',
    reserveWarehouseTwoAvailable: reserveAvailable, reserveQueries: [], oldSale: false, reserveFingerprint: 'b'.repeat(64),
    commercialModel: null, commercialRevision: null, reserveRequest: null, loseReserveResponse: false, reserveReceipt: null, reserveReceiptAction: null,
    warehouses: [{ id: 1, name: '华东一仓' }],
    replenishment: new Map([[1, [
      { productId: 1, productCode: 'P000001', productName: '缓冲铰链·全盖', unit: '件', supplierId: 1, supplierName: '演示五金供应公司', warehouseId: 1, onHand: 60, available: 60, inTransit: 0, suggestedQty: 964 },
      { productId: 3, productCode: 'P000003', productName: '上翻支撑·标准型', unit: '个', supplierId: 2, supplierName: '演示二供', warehouseId: 1, onHand: 130, available: 130, inTransit: 0, suggestedQty: 10 },
    ]]]),
    lostWriteReplyForSupplier: null, unavailableReceiptForSupplier: null, wrongWarehouseForSupplier: null,
  };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (p === '/api/search/') return ok(res, []);
    if (p === '/api/warehouses') {
      const size = Number(url.searchParams.get('pageSize'));
      const offset = (Number(url.searchParams.get('page')) - 1) * size;
      return ok(res, { list: state.warehouses.slice(offset, offset + size), pagination: { total: state.warehouses.length } });
    }
    if (p === '/api/inventory/replenishment') return ok(res, {
      list: state.replenishment.get(Number(url.searchParams.get('warehouseId'))) || [],
    });
    if (p === '/api/products/1') return ok(res, { id: 1, costPrice: state.cost1, allowDecimalQty: false, productCode: 'P000001', unit: '件' });
    if (p === '/api/products/3') return ok(res, { id: 3, costPrice: 6, allowDecimalQty: false, productCode: 'P000003', unit: '个' });
    if (p === '/api/products/5') return ok(res, { id: 5, costPrice: 8, allowDecimalQty: false, productCode: 'P000005', unit: '个' });
    if (p === '/api/purchase/' && req.method === 'POST') {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const order = { id: 50 + state.purchases.length, orderNo: `PC-MOCK-${state.purchases.length + 1}`, supplierId: body.supplierId,
        warehouseId: body.warehouseId, totalAmount: body.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) };
      state.purchases.push({ body, order, key: req.headers['x-request-key'] });
      if (body.supplierId === state.lostWriteReplyForSupplier) return res.destroy();
      return ok(res, order);
    }
    if (p.startsWith('/api/system/request-status/')) {
      if (state.reserveReceipt) {
        state.reserveReceiptAction = url.searchParams.get('action');
        if (state.reserveReceiptAction === 'sale.reserve.7') return ok(res, state.reserveReceipt);
      }
      const purchase = state.purchases.find(entry => entry.key === decodeURIComponent(p.split('/').at(-1)));
      if (!purchase) return ok(res, { status: 'not_found' });
      if (purchase.body.supplierId === state.unavailableReceiptForSupplier) return res.destroy();
      return ok(res, { status: 'success', resourceType: 'purchase_order', resourceId: purchase.order.id, data: purchase.order });
    }
    if (p.startsWith('/api/purchase/')) {
      const purchase = state.purchases.find(entry => entry.order.id === Number(p.split('/')[3]));
      return ok(res, purchase?.body.supplierId === state.wrongWarehouseForSupplier
        ? { ...purchase.order, warehouseId: 2 }
        : purchase?.order);
    }
    if (p === '/api/sale/' && req.method === 'GET') {
      const keyword = url.searchParams.get('keyword');
      state.reserveQueries.push(keyword);
      return ok(res, { list: state.oldSale && keyword !== 'SL20261026005' ? [] : [{ id: 7, orderNo: 'SL20261026005', customerName: '演示客户甲公司', warehouseId: 1, warehouseName: '华东一仓' }] });
    }
    if (p === '/api/sale/7/reserve-preview') return ok(res, {
      orderId: 7, warehouseId: 1, warehouseName: '华东一仓', credit: null,
      reserveFingerprint: state.reserveFingerprint, commercialModel: state.commercialModel, commercialRevision: state.commercialRevision,
      items: [{
        itemId: 5, productId: 3, productName: '上翻支撑·标准型', quantity: 3,
        currentWarehouseId: state.reserveLineWarehouseId, currentWarehouseName: state.reserveLineWarehouseName,
        reservedQty: state.reserved ? 3 : 0, remainToReserve: state.reserved ? 0 : 3,
        warehouses: [
          { warehouseId: 1, available: reserveAvailable, pickableQuantity: reserveAvailable },
          { warehouseId: 2, available: state.reserveWarehouseTwoAvailable, pickableQuantity: state.reserveWarehouseTwoAvailable },
        ],
      }],
    });
    if (p === '/api/sale/7/reserve' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      state.reserveRequest = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      state.reserveCalls++;
      state.reserved = true;
      if (state.loseReserveResponse) return res.destroy();
      return ok(res, { reserved: true });
    }
    if (p === '/api/sale/7') return ok(res, { id: 7, orderNo: 'SL20261026005', warehouseId: 1,
      items: [{ id: 5, productId: 3, warehouseId: state.reserveLineWarehouseId, quantity: 3, reservedQty: state.reserved ? 3 : 0 }] });
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

test('第 101 个已授权仓的补货建议也纳入结果', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.warehouses = [
    ...Array.from({ length: 100 }, (_, i) => ({ id: i + 2, name: `测试仓 ${i + 2}` })),
    ...state.warehouses,
  ];
  const out = await handleMessage(store, client, FULL, '补货建议');
  assert.equal(out.task.state, 'DONE');
  assert.ok(out.result.items.some(row => row.warehouseId === 1 && row.suggestedQty === 964));
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

test('同一供应商的跨仓采购草稿在回复和各组预览中分别标注目标仓', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.warehouses.push({ id: 2, name: '华南二仓' });
  const [line] = state.replenishment.get(1);
  state.replenishment.set(2, [{ ...line, warehouseId: 2, warehouseName: '华南二仓' }]);
  const result = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  assert.equal(result.task.state, 'AWAITING_CONFIRM');
  const groups = result.preview.drafts.filter(draft => draft.supplierId === line.supplierId);
  assert.equal(groups.length, 2);
  for (const group of groups) assert.ok(result.reply.includes(`【${group.supplierName} · ${group.warehouseName}】`));
  assert.equal(state.purchases.length, 0);
});

test('第二仓建议缺少仓库身份时，不得落到首仓或给出采购确认', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.warehouses.push({ id: 2, name: '华南二仓' });
  const [line] = state.replenishment.get(1);
  state.replenishment.set(2, [{ ...line, warehouseId: null }]);

  const result = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  assert.equal(result.task.state, 'FAILED_FINAL');
  assert.match(result.reply, /仓库/);
  assert.equal(state.purchases.length, 0);
});

test('现行补货返回无有效供应商的建议时，整批采购试算明确指出缺项', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.replenishment.get(1)[1].supplierId = null;
  state.replenishment.get(1)[1].supplierName = null;

  const result = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  assert.equal(result.task.state, 'FAILED_FINAL');
  assert.match(result.reply, /上翻支撑.*供应商/);
  assert.equal(state.purchases.length, 0);
});

test('批量采购成功一部分后断线，仍列出能核实的原采购单，缺回执时不补建', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.replenishment.get(1).push({ ...state.replenishment.get(1)[1], productId: 5, productCode: 'P000005', productName: '演示配件', supplierId: 3, supplierName: '演示三供' });
  state.lostWriteReplyForSupplier = 2;
  state.unavailableReceiptForSupplier = 1;
  const preview = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  assert.equal(preview.preview.drafts.length, 3);

  const partial = await confirmTask(store, client, preview.task.id, FULL);
  assert.equal(partial.task.state, 'RESULT_UNKNOWN');
  assert.deepEqual(partial.result.orders.map(order => order.orderNo), ['PC-MOCK-2']);
  assert.match(partial.reply, /PC-MOCK-2/);

  state.unavailableReceiptForSupplier = null;
  const recovered = await confirmTask(store, client, preview.task.id, FULL);
  assert.equal(recovered.task.state, 'RESULT_UNKNOWN');
  assert.deepEqual(recovered.result.orders.map(order => order.orderNo), ['PC-MOCK-1', 'PC-MOCK-2']);
  assert.equal(state.purchases.length, 2);
});

test('金额相同但回查仓库与原采购预览不符时保留待核对状态', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.wrongWarehouseForSupplier = 1;
  const preview = await handleMessage(store, client, FULL, '按补货建议建采购草稿');
  const unverified = await confirmTask(store, client, preview.task.id, FULL);
  assert.equal(unverified.task.state, 'ESCALATED');
  const recovered = await confirmTask(store, client, preview.task.id, FULL);
  assert.equal(recovered.task.state, 'RESULT_UNKNOWN');
  assert.deepEqual(recovered.result.orders, []);
  assert.equal(state.purchases.length, 1);
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
  assert.deepEqual(state.reserveRequest, { expectedReserveFingerprint: state.reserveFingerprint });
  server.close();
});

test('套单占库使用原商业版本，断线后按套单 action 核对原回执', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.commercialModel = 'kit-v1';
  state.commercialRevision = 4;
  state.loseReserveResponse = true;
  state.reserveReceipt = { status: 'success', resourceType: 'sale_order', resourceId: 8 };
  const out = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  const unknown = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(unknown.task.state, 'ESCALATED');
  state.reserveReceipt.resourceId = 7;
  const recovered = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(recovered.task.state, 'DONE');
  assert.deepEqual(state.reserveRequest, { expectedReserveFingerprint: state.reserveFingerprint, commercialModel: 'kit-v1', expectedRevision: 4 });
  assert.equal(state.reserveReceiptAction, 'sale.reserve.7');
  assert.equal(state.reserveCalls, 1);
});

test('按完整单号查到不在首页的销售单', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.oldSale = true;
  const out = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.deepEqual(state.reserveQueries, ['SL20261026005']);
});

test('占库以销售行仓为准，行仓变化且数量相同也须重新预览', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.reserveLineWarehouseId = 2;
  state.reserveLineWarehouseName = '华南二仓';
  const preview = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  assert.equal(preview.task.state, 'AWAITING_CONFIRM');
  state.reserveLineWarehouseId = 1;
  state.reserveLineWarehouseName = '华东一仓';
  const blocked = await confirmTask(store, client, preview.task.id, FULL);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.equal(state.reserveCalls, 0);
  assert.match(preview.reply, /华南二仓/);
});

test('占库不会把有货的订单头仓当成缺货的销售行仓', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.reserveLineWarehouseId = 2;
  state.reserveLineWarehouseName = '华南二仓';
  state.reserveWarehouseTwoAvailable = 2;
  const out = await handleMessage(store, client, FULL, '给 SL20261026005 占库');
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /华南二仓.*缺 1/);
  assert.equal(state.reserveCalls, 0);
});

test('占库缺货历史在丢失订单头仓权限后不可读取', async t => {
  const { server, state, client, store } = await ctx();
  t.after(() => server.close());
  state.reserveLineWarehouseId = 2;
  state.reserveLineWarehouseName = '华南二仓';
  state.reserveWarehouseTwoAvailable = 2;
  const actor = { ...FULL, warehouseIds: [1, 2], unrestrictedWarehouseScope: false };
  const out = await handleMessage(store, client, actor, '给 SL20261026005 占库');
  assert.match(out.reply, /缺 1/);
  assert.throws(() => assertTaskAccess(out.task, { ...actor, warehouseIds: [2] }), { status: 403 });
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
