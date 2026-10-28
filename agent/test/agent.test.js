// Agent 测试：mock Flow（实现真实接口形状与关键失败模式）+ 守卫/状态机/恢复协议。
// 对应评估集：G1/G2 黄金任务、A3 新鲜度、A4 结果未知恢复、A7 消歧、精度探针。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask } from '../src/agent.js';
import { validateQty, diffPreview } from '../src/guards.js';
const FULL_ACTOR = { username: 'tester', realName: '测试员', roleId: 2, roleName: '测试全权', permissions: ['dashboard.view','inventory.view','report.view','product.view','customer.view','price.list.view','sale.order.view','sale.order.create','sale.order.reserve','purchase.order.create','payment.view','payment.execute','finance.account.view','warehouse.view','warehouse.task.view','print.job.view','approval.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };


function makeMock() {
  const state = {
    prices: { 1: 8.9, 2: 36 },
    stock: [
      { productId: 1, warehouseId: 1, quantity: 60, reserved: 0, available: 60, productCode: 'P000001', productName: '缓冲铰链·全盖', unit: '件' },
      { productId: 2, warehouseId: 1, quantity: 100, reserved: 68, available: 32, productCode: 'P000002', productName: '三节滑轨·45', unit: '条' },
    ],
    orders: [], byRequestKey: new Map(), dropNextSalePost: false,
  };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/api/search/') {
      const kw = url.searchParams.get('q') || '';
      let hits = [];
      if (kw.includes('通用')) hits = [
        { id: 1, type: 'product', title: '缓冲铰链·全盖' },
        { id: 2, type: 'product', title: '三节滑轨·45' },
      ];
      else if (kw.includes('铰链')) hits = [{ id: 1, type: 'product', title: '缓冲铰链·全盖' }];
      else if (kw.includes('滑轨')) hits = [{ id: 2, type: 'product', title: '三节滑轨·45' }];
      else if (kw.includes('演示客户')) hits = [{ id: 1, type: 'customer', title: '演示客户甲公司' }];
      const type = url.searchParams.get('type');
      return ok(res, type ? hits.filter(h => h.type === type) : hits);
    }
    if (/^\/api\/products\/\d+$/.test(p)) { const id = Number(p.split('/').pop()); return ok(res, { id, allowDecimalQty: false }); }
    if (p === '/api/customers/1') return ok(res, { id: 1, name: '演示客户甲公司', priceLevel: 'A', creditLimit: null });
    if (p === '/api/warehouses') return ok(res, { list: [{ id: 1, name: '华东一仓' }] });
    if (p === '/api/inventory/stock') return ok(res, { list: state.stock });
    if (p === '/api/inventory/query-by-product') {
      const pid = Number(url.searchParams.get('productId'));
      const row = state.stock.find(s => s.productId === pid);
      return ok(res, {
        productId: pid, productName: row?.productName, unit: row?.unit,
        containers: [{ containerId: 1, barcode: 'I000001', locationCode: 'A01-01', remainingQty: row?.quantity ?? 0, lockedByTaskNo: null }],
      });
    }
    if (p === '/api/price-lists/customer-price') {
      const pid = Number(url.searchParams.get('productId'));
      return ok(res, { salePrice: state.prices[pid], priceLevel: 'A', source: 'price_level' });
    }
    if (p === '/api/sale/' && req.method === 'POST') {
      const key = req.headers['x-request-key'];
      if (key && state.byRequestKey.has(key)) return ok(res, state.byRequestKey.get(key));
      const chunks = []; for await (const ch of req) chunks.push(ch);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const total = body.items.reduce((s, i) => s + Math.round(i.unitPrice * 100) * i.quantity, 0) / 100;
      const order = { id: 100 + state.orders.length + 1, orderNo: `SO-MOCK-${state.orders.length + 1}`, totalAmount: total, status: 1 };
      state.orders.push(order);
      if (key) state.byRequestKey.set(key, order);
      if (state.dropNextSalePost) { state.dropNextSalePost = false; res.socket.destroy(); return; }
      return ok(res, order);
    }
    const saleGet = p.match(/^\/api\/sale\/(\d+)$/);
    if (saleGet && req.method === 'GET') {
      const o = state.orders.find(x => x.id === Number(saleGet[1]));
      if (o) return ok(res, o);
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: '不存在' }));
    }
    if (p.startsWith('/api/system/request-status/')) {
      const key = decodeURIComponent(p.split('/').pop());
      const o = state.byRequestKey.get(key);
      if (o) return ok(res, { resourceId: o.id, status: 'success' });
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: '无回执' }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'mock 404 ' + p }));
  });
  return { server, state };
}

async function setup() {
  const { server, state } = makeMock();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, state, client: new FlowClient(base, 'test-token'), store: new TaskStore(null) };
}

test('守卫：数量精度（整数/两位小数/尾零）', () => {
  assert.equal(validateQty(0.5, { allowDecimal: false })?.code, 'QTY_INTEGER_REQUIRED');
  assert.equal(validateQty(1.234)?.code, 'QTY_DECIMALS_EXCEEDED');
  assert.equal(validateQty(1.23), null);
  assert.equal(validateQty('1.230'), null);
  assert.equal(validateQty(0)?.code, 'QTY_INVALID');
});

test('守卫：预览差异检测（价格/可用量）', () => {
  const before = { lines: [{ productId: 1, unitPriceCents: 890, available: 60 }] };
  const after = { lines: [{ productId: 1, unitPriceCents: 990, available: 60 }] };
  const d = diffPreview(before, after);
  assert.equal(d.length, 1); assert.equal(d[0].field, 'unitPriceCents');
});

test('G1 查库存：数字来自工具且核验对平', async () => {
  const { server, client, store } = await setup();
  const out = await handleMessage(store, client, FULL_ACTOR, '缓冲铰链还剩多少');
  assert.equal(out.task.state, 'DONE');
  assert.equal(out.result.onHand, 60);
  assert.equal(out.result.available, 60);
  assert.match(out.reply, /60/);
  server.close();
});

test('A7 消歧：同名多命中停在消歧不默认选', async () => {
  const { server, client, store } = await setup();
  const out = await handleMessage(store, client, FULL_ACTOR, '通用还剩多少');
  assert.equal(out.task.state, 'DISAMBIGUATING');
  assert.equal(out.candidates.length, 2);
  server.close();
});

test('G2 建销售单：试算→预览→确认→核验，合计按分对平', async () => {
  const { server, state, client, store } = await setup();
  const out = await handleMessage(store, client, FULL_ACTOR, '给演示客户甲公司开单：缓冲铰链 10个');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.task.preview.totalCents, 8900);
  const done = await confirmTask(store, client, out.task.id, FULL_ACTOR);
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.orders.length, 1);
  assert.equal(state.orders[0].totalAmount, 89);
  server.close();
});

test('A3 新鲜度：预览后价格变化，确认被拦截且零建单', async () => {
  const { server, state, client, store } = await setup();
  const out = await handleMessage(store, client, FULL_ACTOR, '给演示客户甲公司开单：缓冲铰链 10个');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  state.prices[1] = 9.9; // 预览后价格被他人改动
  const blocked = await confirmTask(store, client, out.task.id, FULL_ACTOR);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.ok(blocked.diffs?.length >= 1);
  assert.equal(state.orders.length, 0);
  server.close();
});

test('A4 结果未知：响应丢失后查回执恢复，不重复建单', async () => {
  const { server, state, client, store } = await setup();
  const out = await handleMessage(store, client, FULL_ACTOR, '给演示客户甲公司开单：缓冲铰链 10个');
  state.dropNextSalePost = true; // 服务端已执行，但响应在路上丢失
  const done = await confirmTask(store, client, out.task.id, FULL_ACTOR);
  assert.equal(done.task.state, 'DONE');
  assert.equal(done.task.result.recoveredViaReceipt, true);
  assert.equal(state.orders.length, 1); // 只落一单
  server.close();
});

test('图外意图：明确婉拒，不拼凑操作', async t => {
  const { server, client, store, state } = await setup();
  t.after(() => server.close());
  const out = await handleMessage(store, client, FULL_ACTOR, '帮我把铰链的价格改成 5 块');
  assert.equal(out.task, null);
  assert.match(out.reply, /不能代办.*没有执行操作/);
  assert.deepEqual(out.businessPages, ['price-change']);
  assert.equal(state.orders.length, 0);
});
