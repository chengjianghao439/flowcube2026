import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMessage, confirmTask } from '../src/agent.js';
import { TaskStore } from '../src/tasks.js';
import { validateIntent } from '../src/llm.js';
import { createAgentRuntime } from '../src/runtime.js';
import { listTaskViews, safeTaskView } from '../src/task-access.js';

const FULL = { id: 11, username: 'owner', roleId: 2, permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view', 'approval.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true };
const product = (id = 1) => ({ id, type: 'product', title: id === 1 ? '合成铰链·全盖' : '合成铰链·半盖', subtitle: `P${id}`, details: [{ label: '单位', value: '个' }] });
function fixture() {
  const state = { ambiguous: false, allowDecimal: false, price: 1.2345, unassignedCount: 1, records: [], calls: [], writes: [], beforePrice: null };
  const client = { get: async path => {
    state.calls.push(path);
    const url = new URL(path, 'http://fixture');
    if (url.pathname === '/api/search/') {
      return url.searchParams.get('q').includes('客户') ? [{ id: 4, type: 'customer', title: '合成客户' }] : state.ambiguous ? [product(1), product(2)] : [product(1)];
    }
    if (url.pathname === '/api/warehouses') return { list: [{ id: 1, name: '华东一仓' }, { id: 2, name: '华南二仓' }] };
    if (url.pathname === '/api/customers/4') return { id: 4, name: '合成客户', priceLevel: 'A', creditLimit: null };
    if (/^\/api\/products\/\d+$/.test(url.pathname)) { const hit = product(Number(url.pathname.split('/').pop())); return { ...hit, name: hit.title, code: hit.subtitle, unit: '个', allowDecimalQty: state.allowDecimal }; }
    if (url.pathname === '/api/price-lists/customer-price') { if (state.beforePrice) await state.beforePrice(); return { salePrice: state.price, priceLevel: 'A', source: 'price_level' }; }
    if (url.pathname === '/api/inventory/stock') return { list: [{ id: 1, productId: 1, warehouseId: 1, quantity: 60, reserved: 0, available: 60, productCode: 'P1', unit: '个' }] };
    if (url.pathname === '/api/inventory/query-by-product') return { productId: 1, containers: url.searchParams.get('warehouseId') === '1' ? [{ barcode: 'SYNTHETIC-I1', remainingQty: 60 }] : [] };
    if (url.pathname === '/api/payments/') return { list: state.records, pagination: { total: state.records.length } };
    if (url.pathname === '/api/payments/party-ledger') return { summary: { closingBalance: 0 }, unassignedCount: state.unassignedCount, historyStartedAt: '2026-10-01 00:00:00', historyIncomplete: false, list: [] };
    if (url.pathname === '/api/finance/accounts/active') return [{ id: 1, name: '合成账户' }];
    if (url.pathname === '/api/sale/8') return { id: 8, orderNo: 'SL-SYNTHETIC-8', totalAmount: state.writes[0].items.reduce((sum, item) => sum + Math.round(item.unitPrice * item.quantity * 100) / 100, 0) };
    if (url.pathname === '/api/warehouse-tasks/stats') return { picking: 1 };
    if (url.pathname === '/api/warehouse-tasks/sorting-bin-pending') return { list: [{ id: 21, taskNo: 'WT-SYNTHETIC-21', saleOrderNo: 'SL-SYNTHETIC-9', warehouseName: '华东一仓' }], pagination: { total: 1 } };
    if (url.pathname === '/api/inbound-tasks/') return { list: [{ id: 31, taskNo: 'IT-SYNTHETIC-31', supplierName: '合成供应商', status: 2, expectedDate: '2026-10-20' }], pagination: { total: 1 } };
    if (url.pathname === '/api/dashboard/summary') return { totalSkus: 1, totalValue: 75, pendingSaleOrders: 1 };
    if (url.pathname === '/api/dashboard/low-stock') return [{ id: 2, name: '合成低库存商品', warehouseId: 2, warehouseName: '华南二仓', quantity: 0, unit: '个' }];
    if (url.pathname === '/api/dashboard/credit-warning') return { overCount: 1, highRiskCount: 0, top: [{ customerName: '合成授信客户', creditLimit: 100, used: 120, usageRatePct: 120, over: true }] };
    if (url.pathname === '/api/dashboard/incoming-purchases') return { overdue: [{ orderNo: 'PC-SYNTHETIC-1', supplierName: '合成供应商', expectedDate: '2026-10-20' }], dueToday: [], dueThisWeek: [] };
    if (url.pathname === '/api/approvals/pending') return { list: [{ id: 3, bizNo: 'SYNTHETIC-APPROVAL-3', title: '合成审批事项' }], pagination: { total: 1 } };
    throw new Error(`unexpected ${path}`);
  }, post: async (path, body) => { state.writes.push(body); return { id: 8, orderNo: 'SL-SYNTHETIC-8' }; } };
  return { state, client, store: new TaskStore(null) };
}
const rule = { parseIntent: async () => null };
const saleText = '给合成客户开单：合成铰链 2个';

test('明确只查二仓库存，跨仓授权也只返回二仓零库存', async () => {
  const { state, client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '只查二仓的合成铰链库存', rule);
  assert.equal(out.result.onHand, 0);
  assert.deepEqual(out.result.warehouses.map(w => w.warehouseId), [2]);
  assert.match(out.reply, /华南二仓/);
  assert.match(out.reply, /该查询范围没有在库容器/);
  assert.equal(state.calls.filter(p => p.startsWith('/api/inventory/query-by-product')).length, 1);
});
test('LLM 库存意图保留明确仓库关键词', async () => {
  const intent = validateIntent({ graph: 'A-inventory', productKeyword: '合成铰链', warehouseKeyword: '二仓' });
  assert.equal(intent.warehouseKeyword, '二仓');
  const { client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '看看二仓的铰链', { parseIntent: async () => intent });
  assert.equal(out.result.onHand, 0);
});
test('指定无权仓库零查库，不回退全部授权仓', async () => {
  const { state, client, store } = fixture();
  const out = await handleMessage(store, client, { ...FULL, warehouseIds: [1], unrestrictedWarehouseScope: false }, '只查二仓的合成铰链库存', rule);
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.equal(state.calls.filter(p => p.startsWith('/api/inventory/query-by-product')).length, 0);
});
test('不存在的明确仓库不会回退全仓查询', async () => {
  const { state, client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '只查三仓的合成铰链库存', rule);
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.equal(state.calls.filter(p => p.startsWith('/api/inventory/query-by-product')).length, 0);
});
test('明确只查未知名称仓库，也不能回退全仓', async () => {
  const { state, client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '只查北京仓的合成铰链库存', rule);
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.equal(state.calls.filter(p => p.startsWith('/api/inventory/query-by-product')).length, 0);
});
test('未归属应收存在且来源关联列表为空，不声称全部结清、不自动关联同名', async () => {
  const { state, client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '合成客户到账 18.52 核销', rule);
  assert.doesNotMatch(out.reply, /应收已全部结清|应收全部结清/);
  assert.match(out.reply, /未归属.*1|1.*未归属/);
  assert.match(out.reply, /来源订单|关联/);
  assert.match(out.reply, /当前关联应收里没查到未结账款，这笔收款先不登记/);
  assert.doesNotMatch(out.reply, /客户 ID|客户ID|台账记录起点|2026-10-01/);
  assert.equal(out.task.result.alreadySettled, false);
  assert.equal(state.calls.some(p => p.includes('partyName=')), false);
  assert.equal(state.writes.length, 0);
});
test('往来台账说明未归属应收是全局提示，余额为零不能证明该客户已全清', async () => {
  const { client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '查一下合成客户应收', rule);
  assert.match(out.reply, /未归属.*1|1.*未归属/);
  assert.match(out.reply, /全局|应收侧/);
  assert.match(out.reply, /不能.*结清|无法.*结清/);
});
test('整数商品 0.5 在预览前拒绝，两位小数商品按当前策略放行', async () => {
  const { state, client, store } = fixture();
  const blocked = await handleMessage(store, client, FULL, '给合成客户开单：合成铰链 0.5个', rule);
  assert.equal(blocked.preview, undefined);
  assert.match(blocked.reply, /不允许小数|不是整数/);
  state.allowDecimal = true;
  const allowed = await handleMessage(store, client, FULL, '给合成客户开单：合成铰链 0.5个', rule);
  assert.equal(allowed.preview.lines[0].qty, 0.5);
  assert.equal(state.writes.length, 0);
});
test('预览后商品改为整数策略，确认明确失效且零写入', async () => {
  const { state, client, store } = fixture(); state.allowDecimal = true;
  const initial = await handleMessage(store, client, FULL, '给合成客户开单：合成铰链 0.5个', rule);
  state.allowDecimal = false;
  const blocked = await confirmTask(store, client, initial.task.id, FULL);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.match(blocked.reply, /不允许小数|不是整数/);
  assert.equal(state.writes.length, 0);
});
test('同名商品保留原任务，选原候选 ID 后安全接续查询', async () => {
  const { state, client, store } = fixture(); state.ambiguous = true;
  const pending = await handleMessage(store, client, FULL, '合成铰链库存', rule);
  assert.equal(pending.task.state, 'DISAMBIGUATING');
  assert.equal(pending.candidates.length, 2);
  const selected = await handleMessage(store, client, FULL, '选择半盖', { ...rule, taskId: pending.task.id, choiceId: 2 });
  assert.equal(selected.task.id, pending.task.id);
  assert.equal(selected.task.state, 'DONE');
  assert.equal(selected.result.productId, 2);
  assert.equal(store.tasks.size, 1);
});
test('候选 ID 不能越过原候选集合，其他用户和撤权后不可选择', async () => {
  const { state, client, store } = fixture(); state.ambiguous = true;
  const pending = await handleMessage(store, client, FULL, '合成铰链库存', rule);
  await assert.rejects(() => handleMessage(store, client, FULL, '选择', { taskId: pending.task.id, choiceId: 999 }), e => e.status === 400);
  await assert.rejects(() => handleMessage(store, client, { ...FULL, id: 12, username: 'other' }, '选择', { taskId: pending.task.id, choiceId: 1 }), e => e.status === 403);
  await assert.rejects(() => handleMessage(store, client, { ...FULL, permissions: [] }, '选择', { taskId: pending.task.id, choiceId: 1 }), e => e.status === 403);
  assert.equal(state.writes.length, 0);
});
test('销售同名商品也能原任务消歧后建预览且保留原客户', async () => {
  const { state, client, store } = fixture(); state.ambiguous = true;
  const pending = await handleMessage(store, client, FULL, saleText, rule);
  assert.equal(pending.task.state, 'DISAMBIGUATING');
  const selected = await handleMessage(store, client, FULL, '选择半盖', { ...rule, taskId: pending.task.id, choiceId: 2 });
  assert.equal(selected.task.id, pending.task.id);
  assert.equal(selected.task.state, 'AWAITING_CONFIRM');
  assert.equal(selected.preview.customer.id, 4);
  assert.equal(selected.preview.lines[0].productId, 2);
});
test('口语修改当前销售预览数量，重读定价并递增 revision，确认旧版被拒', async () => {
  const { state, client, store } = fixture();
  const initial = await handleMessage(store, client, FULL, saleText, rule);
  assert.equal(initial.reply.includes(initial.task.id), false, '预览正文不重复技术任务编号');
  const revision = initial.task.revision;
  state.price = 2.3456;
  const modified = await handleMessage(store, client, FULL, '把刚才的数量改成五个', { ...rule, taskId: initial.task.id });
  assert.equal(modified.task.id, initial.task.id);
  assert.equal(modified.preview.lines[0].qty, 5);
  assert.equal(modified.preview.totalCents, 1173);
  assert.equal(modified.task.revision, revision + 1);
  assert.equal(state.writes.length, 0);
  await assert.rejects(() => confirmTask(store, client, initial.task.id, FULL, { revision }), e => e.status === 409 && e.code === 'PREVIEW_REVISION_CONFLICT');
  const done = await confirmTask(store, client, initial.task.id, FULL, { revision: modified.task.revision });
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].items[0].quantity, 5);
});
test('多行未指明行的改量不猜，执行/结果未知时禁止改量', async () => {
  const { client, store } = fixture();
  const initial = await handleMessage(store, client, FULL, '给合成客户开单：合成铰链 2个，另一种铰链 3个', rule);
  const quantities = initial.preview.lines.map(l => l.qty);
  const blocked = await handleMessage(store, client, FULL, '数量改成五个', { ...rule, taskId: initial.task.id });
  assert.match(blocked.reply, /多.*行|哪.*行|指定.*行/);
  assert.deepEqual(initial.task.preview.lines.map(l => l.qty), quantities);
  initial.task.state = 'RESULT_UNKNOWN';
  await assert.rejects(() => handleMessage(store, client, FULL, '数量改成五个', { ...rule, taskId: initial.task.id }), e => e.status === 409);
});
test('修改和确认共用任务锁，并发确认只创建一次', async () => {
  const { state, client, store } = fixture();
  const initial = await handleMessage(store, client, FULL, saleText, rule);
  let unblock; const held = new Promise(r => { unblock = r; });
  let entered; const enteredPromise = new Promise(r => { entered = r; });
  state.beforePrice = async () => { entered(); await held; };
  const confirming = confirmTask(store, client, initial.task.id, FULL);
  await enteredPromise;
  await assert.rejects(() => handleMessage(store, client, FULL, '数量改成五个', { ...rule, taskId: initial.task.id }), e => e.status === 409);
  await assert.rejects(() => confirmTask(store, client, initial.task.id, FULL), e => e.status === 409);
  unblock();
  await confirming;
  assert.equal(state.writes.length, 1);
});
test('客户端带已选业务taskId的新问题，能另建只读库存任务', async () => {
  const { client, store } = fixture();
  const sale = await handleMessage(store, client, FULL, saleText, rule);
  await confirmTask(store, client, sale.task.id, FULL);
  const query = await handleMessage(store, client, FULL, '只查二仓的合成铰链库存', { ...rule, taskId: sale.task.id });
  assert.equal(query.task.graph, 'A-inventory');
  assert.notEqual(query.task.id, sale.task.id);
  assert.equal(query.result.onHand, 0);
  assert.equal(store.tasks.size, 2);
});
test('待确认销售卡前输入问候可自然接话，旧预览和请求键保持', async () => {
  const { client, store } = fixture();
  const sale = await handleMessage(store, client, FULL, saleText, rule);
  const key = sale.task.requestKey, revision = sale.task.revision;
  const chat = await handleMessage(store, client, FULL, '小满在吗', { ...rule, taskId: sale.task.id });
  assert.equal(chat.task.graph, 'G-chat');
  assert.equal(chat.task.state, 'DONE');
  assert.equal(sale.task.state, 'AWAITING_CONFIRM');
  assert.equal(sale.task.requestKey, key);
  assert.equal(sale.task.revision, revision);
});
test('结果未知时允许新的只读问题，但继续写入仍不能另换键', async () => {
  const { state, client, store } = fixture();
  const sale = await handleMessage(store, client, FULL, saleText, rule);
  sale.task.state = 'RESULT_UNKNOWN';
  const query = await handleMessage(store, client, FULL, '只查二仓的合成铰链库存', { ...rule, taskId: sale.task.id });
  assert.equal(query.result.onHand, 0);
  await assert.rejects(() => handleMessage(store, client, FULL, saleText, { ...rule, taskId: sale.task.id }), error => error.status === 409);
  assert.equal(state.writes.length, 0);
});
test('卡点报告给出当前工具返回的任务号和待分配事实，不编原因', async () => {
  const { client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '仓库有什么卡点', rule);
  assert.match(out.reply, /WT-SYNTHETIC-21/);
  assert.match(out.reply, /IT-SYNTHETIC-31/);
  assert.match(out.reply, /分拣格待分配/);
  assert.doesNotMatch(out.reply, /人员不足|设备故障/);
});
test('查询出库卡点仍是只读作业进度，不能因提到出库而拒绝', async () => {
  const { state, client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '查一下出库卡点', rule);
  assert.ok(out.task);
  assert.equal(out.task.graph, 'E-stuck');
  assert.equal(state.writes.length, 0);
});
test('简报列出真实低库存、授信预警、逾期待入库和待审批单据', async () => {
  const { client, store } = fixture();
  const out = await handleMessage(store, client, FULL, '今日简报', rule);
  assert.match(out.reply, /合成低库存商品/);
  assert.match(out.reply, /合成授信客户/);
  assert.match(out.reply, /PC-SYNTHETIC-1/);
  assert.match(out.reply, /SYNTHETIC-APPROVAL-3/);
});
test('聚合简报虽仅一仓有提醒，撤另一仓后也不能读取原全仓汇总', async () => {
  const { client, store } = fixture();
  await handleMessage(store, client, FULL, '今日简报', rule);
  const restricted = { ...FULL, warehouseIds: [2], unrestrictedWarehouseScope: false };
  assert.equal(listTaskViews(store, restricted).length, 0);
});


test('T13确定只读实体未找到带查询结果标记，权限和写图失败不冒充已答复', async () => {
  for (const text of ['合成铰链库存', '合成客户欠款', saleText]) {
    const { client, store } = fixture();
    const original = client.get;
    client.get = async path => path.startsWith('/api/search/') ? [] : original(path);
    const runtime = createAgentRuntime({ store, messageOptions: rule });
    const out = await runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message: text }, actor: FULL, client });
    assert.equal(out.task.state, 'FAILED_FINAL');
    assert.equal(out.task.queryOutcome, text === saleText ? undefined : 'not_found');
    const detail = await runtime.dispatch({ method: 'GET', pathname: `/tasks/${out.task.id}`, actor: FULL, client });
    assert.equal(detail.task.queryOutcome, out.task.queryOutcome);
    const denied = listTaskViews(store, { ...FULL, permissions: [] });
    assert.equal(denied.length, 0);
    const raw = store.get(out.task.id);
    assert.equal(raw.state, 'FAILED_FINAL');
    assert.equal(raw.requestKey, `agent-${raw.id}`);
    assert.doesNotMatch(JSON.stringify(detail), /requestKey|"actor"|"payload"/);
  }
});
test('T13错误文本不能推导只读未找到，已标记的写图或非失败状态也不暴露该标记', async () => {
  for (const graph of ['A-inventory', 'D-ledger', 'B-sale-draft', 'D-receipt', 'D-settle']) {
    const { store } = fixture();
    const row = store.create({ graph, userText: '合成任务', actor: FULL });
    Object.assign(row, { state: 'FAILED_FINAL', error: '未找到实体或请求失败' });
    assert.equal(safeTaskView(row).queryOutcome, undefined);
    row.queryOutcome = 'not_found';
    assert.equal(safeTaskView(row).queryOutcome, ['A-inventory', 'D-ledger'].includes(graph) ? 'not_found' : undefined);
    row.state = 'DONE';
    assert.equal(safeTaskView(row).queryOutcome, undefined);
  }
});

for (const recoveringState of ['CONFIRMED', 'EXECUTING', 'VERIFYING', 'RESULT_UNKNOWN', 'ESCALATED']) {
  test(`最终审查：${recoveringState}确认入口仅查原键回执与原单，零业务POST`, async () => {
    const { state, client, store } = fixture();
    const initial = await handleMessage(store, client, FULL, saleText, rule);
    const task = initial.task, originalKey = task.requestKey, originalId = task.id;
    const receipts = [];
    client.requestStatus = async (key, action) => { receipts.push([key, action]); return { resourceId: 8 }; };
    const originalGet = client.get;
    client.get = async path => {
      if (path === '/api/sale/8') { state.calls.push(path); return { id: 8, orderNo: 'SL-SYNTHETIC-8', totalAmount: task.preview.totalCents / 100 }; }
      return originalGet(path);
    };
    client.post = async () => { assert.fail('原任务恢复不得重发业务POST'); };
    task.state = recoveringState;
    state.calls.length = 0;
    const runtime = createAgentRuntime({ store, messageOptions: rule });
    const out = await runtime.dispatch({ method: 'POST', pathname: `/tasks/${originalId}/confirm`, body: { revision: task.revision }, actor: FULL, client });
    assert.equal(out.task.id, originalId);
    assert.equal(out.task.state, 'DONE');
    assert.equal(out.result.recoveredViaReceipt, true);
    assert.deepEqual(receipts, [[originalKey, 'sale.create']]);
    assert.deepEqual(state.calls, ['/api/sale/8']);
    assert.equal(task.requestKey, originalKey);
    assert.equal(store.tasks.size, 1);
    assert.equal(state.writes.length, 0);
  });
}
