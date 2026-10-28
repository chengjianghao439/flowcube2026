// 角色权限测试：无权零执行且明确拒绝；有权照常；仓库范围过滤；确认时复验权限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask } from '../src/agent.js';

const BASE_PERMS = ['dashboard.view', 'product.view', 'customer.view', 'price.list.view', 'warehouse.view'];
const mkActor = (permissions, extra = {}) => ({
  username: 'u', realName: '某用户', roleId: 9, roleName: '受限角色',
  permissions, warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false, ...extra,
});

function makeFlowMock() {
  const state = { orders: [], ledgerCalls: 0 };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (p === '/api/search/') {
      const kw = url.searchParams.get('q') || '';
      let hits = [];
      if (kw.includes('上翻支撑')) hits = [{ id: 3, type: 'product', title: '上翻支撑·标准型' }];
      else if (kw.includes('缓冲铰链')) hits = [{ id: 1, type: 'product', title: '缓冲铰链·全盖' }];
      else if (kw.includes('演示客户')) hits = [{ id: 1, type: 'customer', title: '演示客户甲公司' }];
      return ok(res, hits);
    }
    if (/^\/api\/products\/\d+$/.test(p)) { const id = Number(p.split('/').pop()); return ok(res, { id, allowDecimalQty: false }); }
    if (p === '/api/customers/1') return ok(res, { id: 1, name: '演示客户甲公司', priceLevel: 'A', creditLimit: null });
    if (p === '/api/warehouses') return ok(res, { list: [{ id: 1, name: '华东一仓' }, { id: 2, name: '华南二仓' }] });
    if (p === '/api/inventory/query-by-product') {
      const wid = Number(url.searchParams.get('warehouseId'));
      return ok(res, { onHand: wid === 1 ? 60 : 0, containers: wid === 1 ? [{ barcode: 'I000003', locationCode: 'A01', remainingQty: 60 }] : [], containersTotal: wid === 1 ? 60 : 0 });
    }
    if (p === '/api/inventory/stock') return ok(res, { list: [{ productId: 1, warehouseId: 1, quantity: 60, reserved: 0, available: 60, productCode: 'P1', productName: '缓冲铰链·全盖', unit: '个' }, { productId: 3, warehouseId: 1, quantity: 130, reserved: 0, available: 130, productCode: 'P3', productName: '上翻支撑·标准型', unit: '个' }] });
    if (p === '/api/price-lists/customer-price') return ok(res, { salePrice: 12.5, priceLevel: 'A', source: 'price_level' });
    if (p === '/api/payments/party-ledger') { state.ledgerCalls++; return ok(res, { summary: {}, entries: [] }); }
    if (p === '/api/sale/' && req.method === 'POST') {
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const order = { id: 9, orderNo: 'SO-PERM-1', totalAmount: body.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) };
      state.orders.push(order); return ok(res, order);
    }
    if (p === '/api/sale/9') return ok(res, state.orders[0]);
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'nf' }));
  });
  return { server, state };
}
async function ctx() {
  const { server, state } = makeFlowMock();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, state, client: new FlowClient(`http://127.0.0.1:${server.address().port}`, 't'), store: new TaskStore(null) };
}

test('无 payment.view 查台账 → 明确拒绝且零台账调用', async () => {
  const { server, state, client, store } = await ctx();
  const actor = mkActor(BASE_PERMS);
  const out = await handleMessage(store, client, actor, '演示客户甲公司的应收结清了吗');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /没有「收付款查看」权限/);
  assert.equal(state.ledgerCalls, 0);
  server.close();
});

test('无 sale.order.create 开单 → 预览都不生成，零落单', async () => {
  const { server, state, client, store } = await ctx();
  const actor = mkActor([...BASE_PERMS, 'inventory.view']);
  const out = await handleMessage(store, client, actor, '给演示客户甲公司开单：上翻支撑 2个');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /销售单新建/);
  assert.equal(state.orders.length, 0);
  server.close();
});

test('只有库存权限而缺正式搜索权限时明确拒绝，简报也被拒', async () => {
  const { server, client, store } = await ctx();
  const actor = mkActor(['inventory.view', 'warehouse.view']);
  const inv = await handleMessage(store, client, actor, '缓冲铰链还剩多少');
  assert.equal(inv.task.state, 'FAILED_FINAL');
  assert.match(inv.reply, /dashboard.view/);
  const brief = await handleMessage(store, client, actor, '今日简报');
  assert.equal(brief.task.state, 'FAILED_FINAL');
  assert.match(brief.reply, /经营看板查看/);
  server.close();
});

test('仓库范围：仅华南二仓的用户查铰链 → 按范围仓统计（0），不泄露华东仓数据', async () => {
  const { server, client, store } = await ctx();
  const actor = mkActor([...BASE_PERMS, 'inventory.view'], { warehouseIds: [2], unrestrictedWarehouseScope: false });
  const out = await handleMessage(store, client, actor, '缓冲铰链还剩多少');
  assert.equal(out.task.state, 'DONE');
  assert.equal(out.result.warehouseId, 2);
  assert.equal(out.result.onHand, 0);
  server.close();
});

test('确认时权限已被收回 → 拒绝执行，任务保留待确认', async () => {
  const { server, state, client, store } = await ctx();
  const full = mkActor([...BASE_PERMS, 'inventory.view', 'sale.order.create', 'sale.order.view']);
  const out = await handleMessage(store, client, full, '给演示客户甲公司开单：上翻支撑 2个');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  const revoked = mkActor([...BASE_PERMS, 'inventory.view', 'sale.order.view']); // 只撤 create，仍可读原任务
  const blocked = await confirmTask(store, client, out.task.id, revoked);
  assert.match(blocked.reply, /销售单新建/);
  assert.equal(blocked.task.state, 'AWAITING_CONFIRM');
  assert.equal(state.orders.length, 0);
  server.close();
});
