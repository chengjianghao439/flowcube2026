// 意图覆盖评估门：枚举 llm.js GRAPHS 全部实图（不含 none）× 两种规划器。
// 每图至少一句标准问法，断言 handleMessage 落到该图（task.graph 相符，不是 none、不是别的图）。
// 新增任务图若忘了接规则路由或 LLM 意图校验/分发，这条门会红。
// LLM 路径用 mock 模型响应（经真实 validateIntent 校验），不依赖外部模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage } from '../src/agent.js';
import { GRAPHS, validateIntent } from '../src/llm.js';

const FULL = { username: 't', realName: '测试员', roleId: 2, roleName: '全权', permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view', 'print.job.view', 'approval.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };

function makeMock() {
  const state = {
    prices: { 1: 8.9, 3: 12.5 },
    stock: [
      { productId: 1, warehouseId: 1, quantity: 60, reserved: 0, available: 60, productCode: 'P000001', productName: '缓冲铰链·全盖', unit: '件' },
      { productId: 3, warehouseId: 1, quantity: 130, reserved: 0, available: 130, productCode: 'P000003', productName: '上翻支撑·标准型', unit: '个' },
    ],
    orders: [], purchases: [], reserved: false,
    records: [
      { id: 11, orderNo: 'SL-MOCK-11', totalAmount: 1000, paidAmount: 0, balance: 1000, status: 1, createdAt: '2026-10-01T00:00:00Z' },
      { id: 12, orderNo: 'SL-MOCK-12', totalAmount: 1152, paidAmount: 0, balance: 1152, status: 1, createdAt: '2026-10-02T00:00:00Z' },
    ],
  };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const readBody = async (req) => { const c = []; for await (const ch of req) c.push(ch); return JSON.parse(Buffer.concat(c).toString() || '{}'); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (p === '/api/search/') {
      const kw = url.searchParams.get('q') || ''; const type = url.searchParams.get('type');
      let hits = [];
      if (kw.includes('铰链')) hits = [{ id: 1, type: 'product', title: '缓冲铰链·全盖' }];
      else if (kw.includes('上翻支撑')) hits = [{ id: 3, type: 'product', title: '上翻支撑·标准型' }];
      else if (kw.includes('演示客户')) hits = [{ id: 1, type: 'customer', title: '演示客户甲公司' }];
      return ok(res, type ? hits.filter((h) => h.type === type) : hits);
    }
    if (p === '/api/customers/1') return ok(res, { id: 1, name: '演示客户甲公司', priceLevel: 'A', creditLimit: null });
    if (p === '/api/warehouses') return ok(res, { list: [{ id: 1, name: '华东一仓' }] });
    if (p === '/api/inventory/stock') return ok(res, { list: state.stock });
    if (p === '/api/inventory/query-by-product') {
      const pid = Number(url.searchParams.get('productId'));
      const row = state.stock.find((s) => s.productId === pid);
      return ok(res, { productId: pid, productName: row?.productName, unit: row?.unit, containers: [{ containerId: 1, barcode: 'I000001', locationCode: 'A01-01', remainingQty: row?.quantity ?? 0, lockedByTaskNo: null }] });
    }
    if (p === '/api/price-lists/customer-price') return ok(res, { salePrice: state.prices[Number(url.searchParams.get('productId'))], priceLevel: 'A', source: 'price_level' });
    if (p === '/api/inventory/replenishment') return ok(res, { list: [
      { productId: 1, productCode: 'P000001', productName: '缓冲铰链·全盖', unit: '件', supplierId: 1, supplierName: '演示五金供应公司', warehouseId: 1, onHand: 60, available: 60, inTransit: 0, suggestedQty: 964 },
      { productId: 3, productCode: 'P000003', productName: '上翻支撑·标准型', unit: '个', supplierId: 2, supplierName: '演示二供', warehouseId: 1, onHand: 130, available: 130, inTransit: 0, suggestedQty: 10 },
    ], pagination: {} });
    if (p === '/api/products/1') return ok(res, { id: 1, costPrice: 4.5, allowDecimalQty: false, productCode: 'P000001', unit: '件' });
    if (p === '/api/products/3') return ok(res, { id: 3, costPrice: 6, allowDecimalQty: false, productCode: 'P000003', unit: '个' });
    if (p === '/api/purchase/' && req.method === 'POST') {
      const body = await readBody(req);
      const order = { id: 50 + state.purchases.length, orderNo: `PC-MOCK-${state.purchases.length + 1}`, totalAmount: body.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) };
      state.purchases.push({ body, order }); return ok(res, order);
    }
    if (p.startsWith('/api/purchase/')) { const o = state.purchases.find((x) => x.order.id === Number(p.split('/')[3])); return ok(res, o?.order); }
    if (p === '/api/sale/' && req.method === 'POST') {
      const body = await readBody(req);
      const total = body.items.reduce((s, i) => s + Math.round(i.unitPrice * 100) * i.quantity, 0) / 100;
      const order = { id: 100 + state.orders.length + 1, orderNo: `SO-MOCK-${state.orders.length + 1}`, totalAmount: total, status: 1 };
      state.orders.push(order); return ok(res, order);
    }
    if (p === '/api/sale/' && req.method === 'GET') return ok(res, { list: [{ id: 7, orderNo: 'SL20261026005', customerName: '演示客户甲公司', warehouseId: 1, warehouseName: '华东一仓' }] });
    if (p === '/api/sale/7/reserve-preview') return ok(res, { orderId: 7, warehouseId: 1, warehouseName: '华东一仓', credit: null, items: [{ productId: 3, productName: '上翻支撑·标准型', quantity: 3, reservedQty: state.reserved ? 3 : 0, remainToReserve: state.reserved ? 0 : 3, warehouses: [{ warehouseId: 1, available: 130, pickableQuantity: 130 }] }] });
    if (p === '/api/sale/7') return ok(res, { id: 7, orderNo: 'SL20261026005', items: [{ productId: 3, quantity: 3, reservedQty: state.reserved ? 3 : 0 }] });
    const saleGet = p.match(/^\/api\/sale\/(\d+)$/);
    if (saleGet && req.method === 'GET') { const o = state.orders.find((x) => x.id === Number(saleGet[1])); if (o) return ok(res, o); }
    if (p === '/api/payments/party-ledger') return ok(res, { summary: { closingBalance: state.records.reduce((s, r) => s + r.balance, 0) }, list: [] });
    if (p === '/api/payments/') {
      const unsettledOnly = url.searchParams.get('status') === 'unsettled';
      const list = state.records.filter((r) => !unsettledOnly || (r.balance > 0 && r.status !== 3));
      return ok(res, { list, pagination: { total: list.length } });
    }
    if (p === '/api/finance/accounts/active') return ok(res, [{ id: 1, name: '基本户' }]);
    if (p === '/api/warehouse-tasks/stats') return ok(res, { total: 3, byStatus: {} });
    if (p === '/api/warehouse-tasks/sorting-bin-pending') return ok(res, []);
    if (p === '/api/inbound-tasks/' || p === '/api/return-tasks/') return ok(res, { list: [] });
    if (p === '/api/dashboard/summary') return ok(res, { todaySales: 100 });
    if (p === '/api/dashboard/low-stock') return ok(res, []);
    if (p === '/api/dashboard/credit-warning') return ok(res, []);
    if (p === '/api/dashboard/incoming-purchases') return ok(res, []);
    if (p === '/api/approvals/pending') return ok(res, { list: [] });
    if (p.startsWith('/api/system/request-status/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: '无回执' })); }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'mock 404 ' + p }));
  });
  return { server, state };
}

async function setup() {
  const { server, state } = makeMock();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, state, client: new FlowClient(`http://127.0.0.1:${server.address().port}`, 't'), store: new TaskStore(null) };
}

// 每图：规则问法 + LLM 意图（mock 模型响应原文，经真实 validateIntent 校验）
const CASES = [
  { graph: 'A-inventory', ruleText: '缓冲铰链还剩多少', llmText: '那个铰链仓库里还有货吗', intent: { graph: 'A-inventory', productKeyword: '缓冲铰链' } },
  { graph: 'B-sale-draft', ruleText: '给演示客户甲公司开单：缓冲铰链 10个', llmText: '帮甲公司订 10 个铰链', intent: { graph: 'B-sale-draft', customerKeyword: '演示客户', lines: [{ productKeyword: '缓冲铰链', qty: 10 }] } },
  { graph: 'B2-reserve', ruleText: '给 SL20261026005 占库', llmText: '把那张五号销售单的货先占上', intent: { graph: 'B2-reserve', orderNo: 'SL20261026005' } },
  { graph: 'C-replenishment', ruleText: '补货建议', llmText: '哪些货该补了', intent: { graph: 'C-replenishment' } },
  { graph: 'C-purchase-draft', ruleText: '按补货建议建采购草稿', llmText: '照着补货建议把采购草稿建出来', intent: { graph: 'C-purchase-draft' } },
  { graph: 'D-ledger', ruleText: '查一下演示客户甲公司应收', llmText: '甲公司那边的账怎么样', intent: { graph: 'D-ledger', customerKeyword: '演示客户' } },
  { graph: 'D-receipt', ruleText: '演示客户甲公司到账 100 核销', llmText: '甲公司刚打了一百块过来入账核销', intent: { graph: 'D-receipt', customerKeyword: '演示客户', amount: 100 } },
  { graph: 'E-stuck', ruleText: '仓库有什么卡点', llmText: '仓里活儿都顺不顺', intent: { graph: 'E-stuck' } },
  { graph: 'F-briefing', ruleText: '今日简报', llmText: '今天生意怎么样', intent: { graph: 'F-briefing' } },
];

test('门：用例表覆盖 GRAPHS 全部实图（加图必须同步加用例）', () => {
  const expected = GRAPHS.filter((g) => g !== 'none').sort();
  assert.deepEqual(CASES.map((c) => c.graph).sort(), expected);
});

for (const c of CASES) {
  test(`门·规则规划器：${c.graph}`, async () => {
    const { server, client, store } = await setup();
    // 注入恒 null 的 parseIntent：LLM 分支落空 → 强制走规则规划器（与是否配 key 无关）
    const out = await handleMessage(store, client, FULL, c.ruleText, { parseIntent: async () => null });
    assert.ok(out.task, `规则问法未建任务（回复：${out.reply}）`);
    assert.equal(out.task.graph, c.graph, `规则问法落到了 ${out.task.graph}（回复：${out.reply}）`);
    server.close();
  });

  test(`门·LLM 规划器（mock 模型）：${c.graph}`, async () => {
    const { server, client, store } = await setup();
    const validated = validateIntent(c.intent);
    assert.ok(validated, `用例意图未通过 validateIntent：${JSON.stringify(c.intent)}`);
    const out = await handleMessage(store, client, FULL, c.llmText, { parseIntent: async () => validated });
    assert.ok(out.task, `LLM 意图未建任务（回复：${out.reply}）`);
    assert.equal(out.task.graph, c.graph, `LLM 意图落到了 ${out.task.graph}（回复：${out.reply}）`);
    server.close();
  });
}
