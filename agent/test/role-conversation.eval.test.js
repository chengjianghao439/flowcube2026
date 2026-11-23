import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { validateIntent } from '../src/llm.js';
import { createFixtureFlow, customer, order, pendingTask } from './fixtures/role-conversation-flow.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { roles: roleCodes, cases } = json('./fixtures/role-conversations.json');
const { roles } = json('../../tests/fixtures/qa-roles-approved-20261021.json');
const permissionLabels = {
  'report.view': '报表查看', 'inventory.view': '库存查看', 'warehouse.view': '仓库查看',
  'sale.order.create': '销售单新建', 'sale.order.view': '销售单查看', 'sale.order.reserve': '销售单占库',
  'warehouse.task.view': '仓储作业查看', 'customer.view': '客户查看',
  'payment.view': '收付款查看', 'payment.execute': '收付款执行', 'purchase.order.create': '采购单新建',
};
const split = process.env.XIAOMAN_EVAL_SPLIT ?? 'all';
assert.ok(['all', 'practice', 'holdout'].includes(split));
const testCases = cases.filter(scenario => split === 'all' || (scenario.split ?? 'practice') === split);

function expected(outcome, role) {
  const graph = { sale: 'B-sale-draft', stock: 'A-inventory', ledger: 'D-ledger', receipt: 'D-receipt' };
  const has = code => role.id === 1 || role.after.includes(code);
  const denial = (name, permission) => ({ graph: graph[name] ?? name, state: 'FAILED_FINAL', permission: permissionLabels[permission] });
  const missing = (...permissions) => permissions.find(permission => !has(permission));
  const saleNeed = missing('sale.order.create', 'inventory.view');
  const inventoryNeed = missing('inventory.view');
  const ledgerNeed = missing('payment.view', 'customer.view');
  const receiptNeed = missing('payment.view', 'payment.execute', 'customer.view');

  if (outcome.startsWith('sale') || outcome === 'customerChoice') {
    if (saleNeed) return denial('sale', saleNeed);
    if (outcome === 'customerChoice') return { graph: graph.sale, state: 'DISAMBIGUATING', choices: [7, 8] };
    if (outcome === 'saleAskBoth') return { graph: graph.sale, state: 'DISAMBIGUATING', reply: /客户.*商品.*(?:数量|各多少)/ };
    if (outcome === 'saleAskItems') return { graph: graph.sale, state: 'DISAMBIGUATING', reply: /远山机电.*还差商品和数量/ };
    if (outcome === 'saleAskQuantity') return { graph: graph.sale, state: 'DISAMBIGUATING', reply: /明确.*数量/ };
    if (outcome === 'saleConfirmed') return { graph: graph.sale, state: 'DONE', orderId: 42, writes: 1 };
    return { graph: graph.sale, state: 'AWAITING_CONFIRM', quantity: outcome === 'sale3' ? 3 : 2 };
  }
  if (outcome.startsWith('stock') || outcome === 'zero' || outcome.startsWith('conditional')) {
    if (inventoryNeed) return denial('stock', inventoryNeed);
    if (outcome === 'stockChoice') return { graph: graph.stock, state: 'DISAMBIGUATING', choices: [11, 12] };
    if (outcome === 'stockScopeDenied') return { graph: graph.stock, state: 'FAILED_FINAL', reply: /指定仓库.*(?:不可访问|范围内)/ };
    if (outcome === 'stockEmptyScope') return { graph: graph.stock, state: 'FAILED_FINAL', reply: /仓库范围为空/ };
    const secondWarehouse = [2, 11, 17, 2, 15];
    if (outcome === 'conditionalSale') return saleNeed
      ? { ...denial('sale', saleNeed), queryWarehouse: 2 }
      : { graph: graph.sale, state: 'AWAITING_CONFIRM', quantity: 2, warehouse: 2, queryWarehouse: 2, reply: /可用 15/ };
    if (outcome === 'conditionalShortage') return { graph: graph.stock, state: 'DONE', stock: secondWarehouse, reply: /不足.*未生成草稿/ };
    if (outcome === 'conditionalUnit') return { graph: graph.stock, state: 'DONE', stock: secondWarehouse, reply: /单位.*个.*未生成草稿/ };
    if (outcome === 'conditionalClarify') return { graph: graph.stock, state: 'DONE', stock: secondWarehouse, reply: /请.*客户.*数量/ };
    const facts = { stock1: [1, 11, 11, 3, 8], stock2: secondWarehouse, zero: [1, 12, 0, 0, 0] };
    return { graph: graph.stock, state: 'DONE', stock: facts[outcome] };
  }
  if (outcome === 'reserve') {
    const need = missing('sale.order.view', 'sale.order.reserve');
    return need ? denial('B2-reserve', need) : { graph: 'B2-reserve', state: 'AWAITING_CONFIRM', reserve: order.orderNo };
  }
  if (outcome === 'ledgerDenied') {
    if (!ledgerNeed) return { graph: graph.ledger, state: 'DONE', reply: /期末 ¥18.52/ };
    const want = denial('ledger', ledgerNeed);
    if (has('payment.view')) want.reply = /客户往来\|\/payments\/receivable/;
    return want;
  }
  if (outcome === 'receiptDenied' || outcome === 'receiptAskAmount') {
    if (receiptNeed) return denial('receipt', receiptNeed);
    return outcome === 'receiptAskAmount'
      ? { graph: graph.receipt, state: 'FAILED_FINAL', reply: /金额.*(?:明确|重述|核对)/ }
      : { graph: graph.receipt, state: 'AWAITING_CONFIRM', receiptCents: 625 };
  }
  if (outcome === 'stuck') {
    const permissions = ['warehouse.task.view', 'warehouse.task.assign', 'inbound.order.view'];
    if (!permissions.some(has)) return denial('E-stuck', 'warehouse.task.view');
    return { graph: 'E-stuck', state: 'DONE',
      reply: has('warehouse.task.view') ? /拣货 1 单.*打包 2 单/ : /收货任务/,
      forbid: has('warehouse.task.assign') ? undefined : pendingTask };
  }
  if (outcome === 'replenishment' || outcome === 'purchaseDraft') {
    const purchase = outcome === 'purchaseDraft';
    const name = purchase ? 'C-purchase-draft' : 'C-replenishment';
    const need = purchase ? missing('purchase.order.create', 'report.view', 'warehouse.view') : missing('report.view', 'warehouse.view');
    if (need) return denial(name, need);
    return { graph: name, state: purchase ? 'AWAITING_CONFIRM' : 'DONE', reply: /建议|草稿/ };
  }
  if (outcome === 'briefing') return { graph: 'F-briefing', state: 'DONE', reply: /有库存商品 1 种/ };
  const replies = { unsupported: /不能代为办理/, askReference: /请说明.*单号/, greeting: /^在。/, outside: /只聊极序相关/ };
  assert.ok(replies[outcome], '样本期望未定义 ' + outcome);
  return { graph: null, state: null, reply: replies[outcome] };
}

function checkTurn(out, want, reads, writes) {
  assert.equal(out.task?.graph ?? null, want.graph, '任务类型');
  assert.equal(out.task?.state ?? null, want.state, '任务状态');
  assert.equal(writes.length, want.writes ?? 0, '正式写入次数');
  if (want.reply) assert.match(out.reply, want.reply, '答复');
  if (want.forbid) assert.ok(!out.reply.includes(want.forbid), '无权读取的单号不得出现在答复中');
  if (want.permission) {
    assert.ok(out.reply.includes(want.permission), '应指出缺少「' + want.permission + '」，收到 ' + out.reply);
    if (!want.queryWarehouse) assert.equal(reads.length, 0, '已知缺权应在查询之前拒绝');
  }
  if (want.choices) assert.deepEqual(out.candidates?.map(c => c.id), want.choices);
  if (want.stock) {
    const { warehouseId, productId, onHand, reserved, available } = out.result ?? {};
    assert.deepEqual([warehouseId, productId, onHand, reserved, available], want.stock, '库存事实');
  }
  assert.deepEqual(reads.filter(r => r.pathname === '/api/inventory/query-by-product')
    .map(r => Number(r.query.warehouseId)), want.stock || want.queryWarehouse ? [want.stock?.[0] ?? want.queryWarehouse] : [], '库存只查指定仓');
  if (want.warehouse) assert.equal(out.preview?.warehouseId, want.warehouse, '销售草稿使用已查证的仓库');
  if (want.receiptCents) assert.equal(out.preview?.amountCents, want.receiptCents);
  if (want.quantity) {
    assert.equal(out.preview?.customer?.id, customer.id);
    assert.equal(out.preview?.lines?.[0]?.qty, want.quantity);
    assert.equal(out.preview?.totalCents, want.quantity * 325);
  }
  if (want.reserve) {
    assert.equal(out.preview?.orderNo, want.reserve);
    assert.equal(out.preview?.lines?.[0]?.warehouseId, 1);
  }
  if (want.orderId) assert.equal(out.result?.orderId, want.orderId, '重放返回原订单');
}

test('同题评测覆盖约定的全部角色，各样本编号唯一且保留独立集合', () => {
  assert.deepEqual([...new Set(roleCodes)].sort(), roles.map(role => role.code).sort());
  assert.equal(new Set(cases.map(scenario => scenario.id)).size, cases.length);
  assert.ok(cases.length >= 50 && cases.filter(scenario => scenario.split === 'holdout').length >= 8);
  for (const code of roleCodes) assert.ok(roles.find(role => role.code === code)?.after.length);
});

test('自定义财务有客户查看权时能查台账，撤销后旧任务不能继续回看', async () => {
  const finance = roles.find(role => role.code === 'preset_finance_specialist');
  const actor = { id: 501, username: 'eval-custom-finance', permissions: [...finance.after, 'customer.view'], warehouseIds: [1] };
  const { client, writes } = createFixtureFlow(actor);
  const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async () => null } });
  const out = await runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client,
    body: { message: '帮我查一下远山机电2号店的欠款' } });
  assert.equal(out.task.state, 'DONE');
  assert.equal(out.result.ledger.summary.closingBalance, 18.52);
  assert.equal(writes.length, 0);
  await assert.rejects(runtime.dispatch({ method: 'GET', pathname: '/tasks/' + out.task.id,
    actor: { ...actor, permissions: finance.after }, client }), { status: 403 });
});

test('暂停开单并查询库存后，原客服草稿能继续补商品', async () => {
  const role = roles.find(entry => entry.code === 'preset_customer_service');
  const actor = { id: role.id, username: 'eval-cs-deferred', permissions: role.after, warehouseIds: [1] };
  const { client, writes } = createFixtureFlow(actor);
  const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async () => null } });
  const chat = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client, body: { message, taskId } });
  const draft = await chat('给远山机电2号店开单');
  const inventory = await chat('只查一仓的长款铰链库存，先别开单', draft.task.id);
  assert.notEqual(inventory.task.id, draft.task.id);
  assert.equal(inventory.result.onHand, 11);
  const resumed = await chat('长款铰链 两个', draft.task.id);
  assert.equal(resumed.task.id, draft.task.id);
  assert.equal(resumed.preview.customer.id, customer.id);
  assert.equal(resumed.preview.lines[0].qty, 2);
  assert.equal(writes.length, 0);
});

test('已核对的条件草稿换商品时须重新查库，商品单位变化后不能确认', async () => {
  const role = roles.find(entry => entry.code === 'preset_customer_service');
  const actor = { id: role.id, username: 'eval-conditional-change', permissions: role.after, warehouseIds: [1, 2] };
  const { client, writes } = createFixtureFlow(actor);
  const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async () => null } });
  const post = (pathname, body) => runtime.dispatch({ method: 'POST', pathname, actor, client, body });
  const draft = await post('/chat', { message: '先查二仓的长款铰链库存，够两个再给远山机电2号店开单' });
  assert.equal(draft.task.state, 'AWAITING_CONFIRM');
  await assert.rejects(post('/tasks/' + draft.task.id + '/sale-draft', { action: 'reselect', revision: draft.task.revision }), { status: 409 });
  const get = client.get;
  client.get = async url => {
    const data = await get(url);
    return url === '/api/products/11' ? { ...data, unit: '箱' } : data;
  };
  const confirmation = await post('/tasks/' + draft.task.id + '/confirm', { revision: draft.task.revision });
  assert.equal(confirmation.task.state, 'EXPIRED');
  assert.equal(writes.length, 0);
});

test('库存容器读取失败时给出故障和重试提示，保留明确失败任务', async () => {
  const role = roles.find(entry => entry.code === 'preset_customer_service');
  const actor = { id: role.id, username: 'eval-stock-outage', permissions: role.after, warehouseIds: [1] };
  const { client, writes } = createFixtureFlow(actor);
  const get = client.get;
  client.get = url => {
    if (url.startsWith('/api/inventory/query-by-product')) throw Object.assign(new Error('库存接口暂时不可用'), { status: 503 });
    return get(url);
  };
  const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async () => null } });
  const out = await runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client,
    body: { message: '只查一仓的长款铰链库存' } });
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /库存取数失败.*重查/);
  assert.equal(out.result, undefined);
  assert.equal(writes.length, 0);
});

test('查账和收款保留原文完整客户名，模型删去前缀时也不换搜索对象', async () => {
  const actor = { id: 1, username: 'eval-source-customer', isSuper: true, permissions: [], warehouseIds: [1] };
  for (const [message, graph, want] of [
    ['远山机电2号店应收余额还有多少', 'D-ledger', 'DONE'],
    ['远山机电2号店打来 6.25 元，麻烦登记收款再核销', 'D-receipt', 'AWAITING_CONFIRM'],
  ]) {
    const { client, reads, writes } = createFixtureFlow(actor);
    const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: {
      parseIntent: async () => ({ graph, customerKeyword: '机电2号店', ...(graph === 'D-receipt' ? { amountCents: 625 } : {}) }),
    } });
    const out = await runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client, body: { message } });
    assert.equal(out.task.state, want, out.reply);
    assert.deepEqual(reads.filter(r => r.pathname === '/api/search/').map(r => r.query.q), [customer.name]);
    assert.equal(writes.length, 0);
  }
});

test('报价式数量范围只追问数量，不把区间端点拿去搜商品或生成草稿', async () => {
  const actor = { id: 1, username: 'eval-quantity-range', isSuper: true, permissions: [], warehouseIds: [1] };
  for (const quantity of ['五到六个', '5-6个', '3.5 至 4.5 个']) {
    const { client, reads, writes } = createFixtureFlow(actor);
    const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async () => null } });
    const out = await runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client,
      body: { message: '给远山机电2号店开单：长款铰链' + quantity } });
    assert.equal(out.task.state, 'DISAMBIGUATING');
    assert.match(out.reply, /明确数量/);
    assert.equal(reads.length, 0);
    assert.equal(writes.length, 0);
  }
});

for (const scenario of testCases) {
  for (const code of roleCodes) {
    for (const mode of ['规则', '受控模型']) {
      test(`${scenario.id} / ${code} / ${mode}`, async () => {
        const role = roles.find(r => r.code === code);
        const actor = { id: role.id, username: 'eval-' + code, roleName: role.name, isSuper: role.id === 1, permissions: role.after, warehouseIds: scenario.scope ?? [1] };
        const { client, reads, writes } = createFixtureFlow(actor);
        let model, task, blocked = false;
        const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async () => {
          if (mode === '规则' || model == null) return null;
          if (model === 'timeout') throw new Error('合成模型超时');
          return validateIntent(model);
        } } });
        for (const turn of scenario.turns) {
          if (blocked && (turn.continue || turn.confirm)) continue;
          model = turn.model;
          const readStart = reads.length;
          const want = expected(turn.expect, role);
          const request = turn.confirm ? { pathname: '/tasks/' + task.id + '/confirm', body: { revision: task.revision } }
            : { pathname: '/chat', body: { message: turn.say, taskId: turn.continue ? task?.id : undefined, choiceId: turn.choiceId } };
          const out = await runtime.dispatch({ method: 'POST', actor, client, ...request });
          checkTurn(out, want, reads.slice(readStart), writes);
          if (turn.continue && out.task && !want.permission) assert.equal(out.task.id, task?.id, '继续原任务');
          if (out.task) task = out.task;
          blocked = Boolean(want.permission);
        }
      });
    }
  }
}
