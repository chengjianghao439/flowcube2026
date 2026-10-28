// 图 B 选仓回归：仓库列表第一个是空仓时，必须选有货的仓；无库存行时 payload 编码/单位走商品主数据兜底。
// 背景（2026-10-26 真沙箱实测）：二仓建成后列表顺序变 [测试二仓, 华东一仓]，盲取第一个仓 →
// 预览假缺口 + productCode/unit 为 undefined 被后端 zod 拒（"expected string, received undefined"）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask } from '../src/agent.js';

const FULL_ACTOR = { username: 'tester', realName: '测试员', roleId: 2, roleName: '测试全权', permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view', 'print.job.view', 'approval.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };

function makeFlow({ stockInWh1 = true } = {}) {
  const state = { salePosts: [] };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (p === '/api/search/') {
      const kw = url.searchParams.get('q') || '';
      if (kw.includes('上翻支撑')) return ok(res, [{ id: 3, type: 'product', title: '上翻支撑·标准型', subtitle: 'P000003', details: [{ label: '单位', value: '个' }] }]);
      if (kw.includes('演示客户')) return ok(res, [{ id: 1, type: 'customer', title: '演示客户甲公司' }]);
      return ok(res, []);
    }
    if (/^\/api\/products\/\d+$/.test(p)) { const id = Number(p.split('/').pop()); return ok(res, { id, allowDecimalQty: false }); }
    if (p === '/api/customers/1') return ok(res, { id: 1, name: '演示客户甲公司', priceLevel: 'A', creditLimit: null });
    if (p === '/api/warehouses') return ok(res, { list: [{ id: 2, name: '测试二仓' }, { id: 1, name: '华东一仓' }] }); // 空仓排第一（真沙箱现状）
    if (p === '/api/inventory/stock') return ok(res, { list: stockInWh1 ? [{ productId: 3, warehouseId: 1, quantity: 130, reserved: 3, available: 127, productCode: 'P000003', productName: '上翻支撑·标准型', unit: '个' }] : [] });
    if (p === '/api/price-lists/customer-price') return ok(res, { salePrice: 12.5, priceLevel: 'A', source: 'price_level' });
    if (p === '/api/sale/' && req.method === 'POST') {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      state.salePosts.push(body);
      const order = { id: 21, orderNo: 'SO-WH-1', totalAmount: body.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) };
      state.order = order; return ok(res, order);
    }
    if (p === '/api/sale/21') return ok(res, state.order);
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'nf' }));
  });
  return { server, state };
}

async function withFlow(opts, fn) {
  const { server, state } = makeFlow(opts);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const client = new FlowClient(`http://127.0.0.1:${server.address().port}`, 't');
  try { return await fn(client, state); } finally { server.close(); }
}

test('图 B 选仓：第一个仓是空仓 → 选有货的华东一仓，预览无假缺口，确认落单对平', async () => {
  await withFlow({ stockInWh1: true }, async (client, state) => {
    const store = new TaskStore(null);
    const out = await handleMessage(store, client, FULL_ACTOR, '给演示客户甲公司开单：上翻支撑 2个');
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.equal(out.preview.warehouseId, 1);
    assert.equal(out.preview.lines[0].shortage, 0);
    const done = await confirmTask(store, client, out.task.id, FULL_ACTOR);
    assert.equal(done.task.state, 'DONE');
    assert.equal(state.salePosts.length, 1);
    assert.equal(state.salePosts[0].warehouseId, 1);
    assert.equal(state.salePosts[0].items[0].productCode, 'P000003');
    assert.equal(state.salePosts[0].items[0].unit, '个');
  });
});

test('图 B 兜底：全仓无库存行 → 仍建单，编码/单位取商品主数据（不再 undefined 被拒）', async () => {
  await withFlow({ stockInWh1: false }, async (client, state) => {
    const store = new TaskStore(null);
    const out = await handleMessage(store, client, FULL_ACTOR, '给演示客户甲公司开单：上翻支撑 2个');
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.equal(out.preview.lines[0].shortage, 2); // 缺口如实报
    const done = await confirmTask(store, client, out.task.id, FULL_ACTOR);
    assert.equal(done.task.state, 'DONE');
    assert.equal(state.salePosts[0].items[0].productCode, 'P000003');
    assert.equal(state.salePosts[0].items[0].unit, '个');
  });
});
