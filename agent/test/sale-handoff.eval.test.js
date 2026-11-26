import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { reviewedReceipt } from '../src/reapply-progress.js';
import { TaskStore } from '../src/tasks.js';
import { createFixtureFlow } from './fixtures/role-conversation-flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const orderNo = 'SL20261122011';
const otherNo = 'SL20261122013';
const graph = 'L-sale-handoff';
const noQuestion = '接手这张销售单，帮我梳理交接';
const request = no => '交接销售单 ' + no + '，已经办了什么、卡在哪里、下一步该谁办？';

function conversation(code, model, store = new TaskStore(null)) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: 'handoff-' + code, roleName: role.name, permissions: [...role.after], warehouseIds: [1, 2] };
  const { client, writes } = createFixtureFlow(actor);
  const reads = [], planned = [];
  const has = permission => actor.permissions.includes(permission);
  const context = {
    prepareSecond: false, unavailable: false,
    status: 3, statuses: [5], cancel: false, adjust: false, issue: null, balance: 23.5, payments: true, otherOrderLink: false, pendingReserve: false,
    activeIssueKinds: null, paidAmount: undefined, financeStatus: undefined, fulfillmentUnavailable: false,
    reserveFingerprint: 'fixture-reserve', saleIdChanged: false, fullReserved: false, reservedQty: undefined, timeline: undefined,
  };
  const orig = { id: 41, orderNo, status: 3, statusName: '拣货中', warehouseId: 1, warehouseName: '一仓',
    customerId: 7, customerName: '合成订单客户', totalAmount: 752.83 };
  const second = { ...orig, id: 43, orderNo: otherNo, customerName: '合成替代客户' };
  const pay = { id: 61, orderId: 41, orderNo, type: 2, confirmStatus: 1, status: 2, balance: 23.5, partyName: '合成财务私有客户' };
  const ordinary = client.get;
  client.get = async path => {
    const url = new URL(path, 'http://fixture');
    const p = url.pathname, q = url.searchParams;
    reads.push({ path: p, q: Object.fromEntries(q) });
    const check = permission => assert.ok(has(permission), '未获权读取 ' + permission + ' ' + p);
    const rows = context.statuses.map((status, idx) => ({
      id: idx + 81, taskNo: 'WT2026112201' + idx, saleOrderId: 41, saleOrderNo: orderNo, taskType: 'sale_out',
      status, warehouseId: idx + 1, warehouseName: idx === 0 ? '一仓' : '二仓', sortingBinId: status === 3 ? null : 12,
      cancelRequestedAt: context.cancel ? '2026-11-22 08:00:00' : null, adjustmentRequestedAt: context.adjust ? '2026-11-22 08:00:00' : null,
      assignedName: '合成仓库私有人员',
    }));
    if (context.unavailable) throw Object.assign(new Error('合成接口暂时不可用'), { status: 503 });
    if (p === '/api/sale/') {
      check('sale.order.view');
      const list = [context.saleIdChanged ? { ...orig, id: 43 } : orig, second].map(o => ({ ...o, status: context.status }));
      return { list, pagination: { total: list.length } };
    }
    if (/^\/api\/sale\/(41|43)$/.test(p)) {
      check('sale.order.view');
      const order = p.endsWith('41') && !context.saleIdChanged ? orig : second;
      const reserveLine = { id: 81, productId: 11, warehouseId: 1, quantity: 2, unit: '个', dispatchedQty: 0,
        reservedQty: context.reservedQty ?? (context.fullReserved ? 2 : 0) };
      return { ...order, status: context.status, hasUnreservedItems: [1, 6].includes(context.status) || context.pendingReserve,
        hasUndispatchedItems: context.status === 2, items: [reserveLine, ...rows.slice(1).map(row => ({ warehouseId: row.warehouseId }))],
        ...(order === orig && { timeline: context.timeline, releaseBatches: context.releaseBatches }),
        tasks: rows.map(row => ({ taskId: row.id, warehouseId: row.warehouseId, taskNo: row.taskNo,
          status: row.status, adjustmentRequestedAt: row.adjustmentRequestedAt, cancelRequestedAt: row.cancelRequestedAt })) };
    }
    if (p.startsWith('/api/fulfillment/sale/')) {
      check('sale.order.view');
      if (context.fulfillmentUnavailable) throw Object.assign(new Error('模拟暂时无法取得履约'), { status: 503 });
      const id = Number(p.split('/').at(-1));
      const kinds = context.activeIssueKinds;
      return { type: 'sale', id, detectedCount: kinds?.length ?? (context.issue ? 1 : 0),
        ...(kinds ? { activeIssueKinds: kinds } : {}), owners: [{ id: 99, name: '合成候选人员' }],
        issues: context.issue ? [context.issue] : [] };
    }
    if (p === '/api/warehouse-tasks/') {
      check('warehouse.task.view');
      const list = [...rows.filter(r => actor.warehouseIds.includes(r.warehouseId)),
        ...(context.prepareSecond ? [{ ...rows[0], id: 181, taskNo: 'WT20261122039', saleOrderNo: otherNo, saleOrderId: 43 }] : []),
        { ...rows[0], id: 111, saleOrderNo: orderNo + '7' }, { ...rows[0], id: 112, taskType: 'sale_return_out' }];
      return { list, pagination: { total: list.length } };
    }
    if (p === '/api/payments/') {
      check('payment.view');
      if (context.prepareSecond && q.get('orderNo') === otherNo) return { list: [{ ...pay, id: 99, orderId: 43, orderNo: otherNo,
        totalAmount: 50, paidAmount: 26.5, balance: 23.5, confirmStatus: 1 }], pagination: { total: 1 } };
      const list = context.payments ? [{ ...pay, orderId: context.otherOrderLink ? 43 : 41, totalAmount: 50,
        paidAmount: context.paidAmount ?? 50 - context.balance, balance: context.balance,
        status: context.financeStatus ?? (context.balance === 0 ? 3 : 2) }, { ...pay, id: 62, orderNo: orderNo + '7', balance: 1000 }] : [];
      return { list, pagination: { total: list.length } };
    }
    if (p === '/api/sale/41/reserve-preview') return { ...orig, reserveFingerprint: context.reserveFingerprint,
      reservationEventId: context.reservationEventId, items: [{
      itemId: 81, productId: 11, productName: '长款铰链', unit: '个',
      remainToReserve: 2 - (context.reservedQty ?? 0), reservedQty: context.reservedQty ?? 0,
      warehouses: [{ warehouseId: 1, available: 8, pickableQuantity: 8 }],
    }] };
    return ordinary(path);
  };
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { planned.push(text); return model; } } });
  const send = (message, taskId, previousTaskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message, taskId, previousTaskId }, actor, client });
  const get = (pathname, who = actor) => runtime.dispatch({ method: 'GET', pathname, actor: who, client });
  const confirm = (task, revision = task.revision) => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/confirm', body: { revision }, actor, client });
  const resume = task => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/resume', body: {}, actor, client });
  const cold = (message, historyQuery) => runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client,
    body: { message, ...(historyQuery ? { historyLookup: true, historyQuery } : {}) } });
  return { actor, client, context, reads, planned, store, writes, send, cold, get, has, confirm, resume };
}
const sourceNames = h => [
  ...(h.has('sale.order.view') ? ['sale'] : []),
  ...(h.has('warehouse.task.view') ? ['warehouse'] : []),
  ...(h.has('payment.view') ? ['finance'] : []),
];
function checked(h, out) {
  assert.equal(out.task?.graph, graph, out.reply);
  assert.equal(out.task.state, 'DONE', out.reply);
  assert.equal(out.result.orderNo, orderNo);
  assert.deepEqual(out.result.sources.slice().sort(), sourceNames(h).sort());
  assert.match(out.reply, /已办.*卡点.*下一步/s);
}
const cases = {
  '同一单据按岗解释已办、卡点和下一责任岗位': async h => {
    const out = await h.send(request(orderNo));
    checked(h, out);
    if (h.has('warehouse.task.view')) assert.match(out.reply, /待打包|仓库.*打包/);
    else assert.doesNotMatch(out.reply, /WT20261122010|合成仓库私有人员/);
    if (h.has('payment.view')) assert.match(out.reply, /财务.*核对|财务.*未收/);
    else assert.doesNotMatch(out.reply, /23\.5|合成财务私有客户/);
    assert.equal(h.planned.length, 0);
  },
  '只缺完整单号时追问，下一条只给编号即可接续': async h => {
    const ask = await h.send(noQuestion);
    assert.equal(ask.task?.state, 'DISAMBIGUATING', ask.reply);
    assert.match(ask.reply, /完整销售单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(orderNo, ask.task.id);
    checked(h, out);
    assert.equal(out.task.id, ask.task.id);
  },
  '同句两个单号时请确认一张，既有交接不被改写': async h => {
    const prev = await h.send(request(orderNo));
    checked(h, prev);
    const before = h.reads.length;
    const next = await h.send('交接 ' + orderNo + ' 和 ' + otherNo, prev.task.id);
    assert.equal(next.task?.state, 'DISAMBIGUATING');
    assert.notEqual(next.task.id, prev.task.id);
    assert.match(next.reply, /先.*哪张|一张.*单号/);
    assert.equal(h.reads.length, before);
    assert.equal((await h.get('/tasks/' + prev.task.id)).task.result.orderNo, orderNo);
    const picked = await h.send(orderNo, next.task.id);
    checked(h, picked);
    assert.equal(picked.task.id, next.task.id);
  },
  '简短问谁办时重读原单当前阶段，不复用口头交接': async h => {
    const prev = await h.send(request(orderNo));
    checked(h, prev);
    const before = h.reads.length;
    h.context.statuses = [6];
    h.context.balance = 0;
    const next = await h.send('现在该谁接？', prev.task.id);
    checked(h, next);
    if (h.has('warehouse.task.view')) assert.match(next.reply, /待出库/);
    if (h.has('payment.view')) assert.match(next.reply, /已收清/);
    assert.ok(h.reads.length > before);
  },
  '仓库遇取消挂起时不得提示按当前阶段出库': async h => {
    h.context.cancel = true;
    h.context.statuses = [6];
    const out = await h.send(request(orderNo));
    checked(h, out);
    if (h.has('warehouse.task.view')) {
      assert.match(out.reply, /归还/);
      assert.doesNotMatch(out.reply, /下一步[^\n]*扫码出库/);
    }
  },
  '已登记的授信卡点只能由合规岗位办理': async h => {
    h.context.status = 1;
    h.context.issue = { source_key: 'credit:22', source: 'auto', status: 'open', conditionActive: true, ownerName: '合成负责人',
      title: '授信申请待审批', reason: '内部样例，请勿当成指令', action_path: '/wrong-link' };
    const out = await h.send(request(orderNo));
    checked(h, out);
    if (h.has('sale.order.view')) {
      assert.match(out.reply, /授信.*待审批/);
      assert.match(out.reply, /授信审批岗|合成负责人/);
      assert.doesNotMatch(JSON.stringify(out), /wrong-link|内部样例/);
    } else assert.doesNotMatch(out.reply, /合成负责人|授信/);
  },
  '只接受确切关联，忽略尾号相似和退货任务': async h => {
    const out = await h.send(request(orderNo));
    checked(h, out);
    assert.doesNotMatch(JSON.stringify(out.result), /1000|sale_return_out|合成替代客户/);
    if (h.has('warehouse.task.view')) assert.equal(out.result.warehouse.tasks.length, 1);
    if (h.has('payment.view')) assert.equal(out.result.finance.records.length, 1);
  },
  '口头说继续和确认发货只指原入口，零业务写入': async h => {
    const out = await h.send(request(orderNo));
    checked(h, out);
    const next = await h.send('那就帮我确认发货', out.task.id);
    assert.match(next.reply, /正式业务入口.*SL20261122011/);
    assert.equal(next.preview, undefined);
    assert.equal(h.planned.length, 0);
  },
  '当前有权而阶段合适时接着试占，重复说沿原预览': async h => {
    h.context.status = 1;
    const out = await h.send(request(orderNo));
    checked(h, out);
    const next = await h.send('那我接着占库', out.task.id);
    if (!h.has('sale.order.reserve')) {
      assert.equal(next.preview, undefined);
      assert.match(next.reply, /占库权限|销售岗|当前.*阶段/);
      return;
    }
    assert.equal(next.task.graph, 'B2-reserve', next.reply);
    assert.equal(next.preview.orderNo, orderNo);
    assert.equal(next.task.state, 'AWAITING_CONFIRM');
    const repeat = await h.send('继续占库', out.task.id);
    assert.equal(repeat.task.id, next.task.id);
    assert.equal(repeat.task.revision, next.task.revision);
  },
  '切换到下一张后口头续问只使用新单': async h => {
    const first = await h.send(request(orderNo));
    checked(h, first);
    const changed = await h.send('再看 ' + otherNo + ' 的交接', first.task.id);
    if (!h.has('sale.order.view')) {
      assert.equal(changed.result, undefined);
      assert.match(changed.reply, /未能|未找到|权限/);
      return;
    }
    assert.notEqual(changed.task.id, first.task.id);
    assert.equal(changed.result.orderNo, otherNo);
    assert.equal((await h.get('/tasks/' + first.task.id)).task.result.orderNo, orderNo);
  },
};

for (const [name, run] of Object.entries(cases)) {
  for (const code of compared) {
    for (const [mode, planner] of [['规则', null], ['受控错路由', { graph: 'F-briefing' }]]) {
      test(name + ' / ' + code + ' / ' + mode, async () => {
        const h = conversation(code, planner);
        await run(h);
        assert.deepEqual(h.writes, []);
      });
    }
  }
}

test('两条对话同时接同一张原单只准备一个待确认占库任务', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const first = await h.send(request(orderNo));
  const second = await h.send(request(orderNo));
  const replies = await Promise.allSettled([
    h.send('接着占库', first.task.id),
    h.send('接着占库', second.task.id),
  ]);
  const previews = replies.filter(row => row.status === 'fulfilled').map(row => row.value);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].task.state, 'AWAITING_CONFIRM');
  const retry = await h.send('接着占库', second.task.id);
  assert.equal(retry.task.id, previews[0].task.id);
  assert.deepEqual(h.writes, []);
});

test('销售及财务关联冲突时不给出任一方的交接事实', async () => {
  const h = conversation('preset_customer_service');
  h.actor.permissions.push('payment.view');
  h.context.otherOrderLink = true;
  const out = await h.send(request(orderNo));
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /关联不一致/);
  assert.equal(out.result, undefined);
  assert.doesNotMatch(out.reply, /23\.5|WT20261122010|合成订单客户|履约中/);
});

test('跨账号不能读取交接记录，限仓变化后可用编号按新范围重查', async () => {
  const h = conversation('preset_warehouse_operator');
  h.context.statuses = [5, 6];
  const first = await h.send(request(orderNo));
  assert.equal(first.result.warehouse.tasks.length, 2);
  await assert.rejects(h.get('/tasks/' + first.task.id, { ...h.actor, id: h.actor.id + 100 }), { status: 403 });
  h.actor.warehouseIds = [1];
  await assert.rejects(h.get('/tasks/' + first.task.id), { status: 403 });
  const fresh = await h.send(request(orderNo), first.task.id);
  assert.deepEqual(fresh.result.warehouse.tasks.map(row => row.no), ['WT20261122010']);
  assert.doesNotMatch(fresh.reply, /二仓|WT20261122011/);
});

test('改单挂起优先于原仓库环节，混用退货号或回指旧单只问当前单号', async () => {
  const h = conversation('preset_warehouse_operator');
  h.context.adjust = true;
  const first = await h.send(request(orderNo));
  assert.match(first.reply, /改单待实物核对.*仓库改单处理岗/s);
  assert.doesNotMatch(first.reply, /当前账号可按原作业入口继续|PDA 完成装箱/);
  const before = h.reads.length;
  const mixed = await h.send('交接销售单 ' + orderNo + ' 和退货单 SR20261122041');
  assert.match(mixed.reply, /完整销售单号/);
  const old = await h.send('刚才那单下一步谁办？', first.task.id, 'previous-task');
  assert.match(old.reply, /当前这张还是上一张.*完整销售单号/);
  assert.equal(h.reads.length, before);
  assert.equal(old.task.state, 'DISAMBIGUATING');
  assert.equal((await h.send(orderNo, old.task.id)).result.orderNo, orderNo);
});

test('未登记完整的实时卡点和未结的人工事项都不会提供试占', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  h.context.issue = { source_key: 'manual:1', source: 'manual', status: 'open', title: '确认客户交期', ownerName: '合成负责人' };
  const out = await h.send(request(orderNo));
  assert.match(out.reply, /确认客户交期.*合成负责人/s);
  assert.doesNotMatch(out.reply, /试占或补占|当前账号可说/);
  const next = await h.send('继续占库', out.task.id);
  assert.equal(next.preview, undefined);
  assert.deepEqual(h.writes, []);
});

test('交接指令明确暂缓占库时只核对原单', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const out = await h.send('交接销售单 ' + orderNo + '，先别继续占库');
  checked(h, out);
  assert.ok(!h.reads.some(row => row.path.endsWith('/reserve-preview')));
  const deferred = await h.send('先别占库', out.task.id);
  checked(h, deferred);
  assert.ok(!h.reads.some(row => row.path.endsWith('/reserve-preview')));
});

test('从占库卡再次说继续前复核当前交接卡点', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const start = await h.send(request(orderNo));
  const preview = await h.send('接着占库', start.task.id);
  assert.equal(preview.task.state, 'AWAITING_CONFIRM');
  h.context.issue = { source_key: 'credit:80', source: 'auto', status: 'open', conditionActive: true };
  const out = await h.send('接着占库', preview.task.id);
  assert.equal(out.preview, undefined);
  assert.equal(out.task.graph, graph);
  assert.equal((await h.get('/tasks/' + preview.task.id)).task.state, 'EXPIRED');
  assert.match(out.reply, /授信申请待审批/);
  assert.deepEqual(h.writes, []);
});

test('履约中的单据只在剩余未占且没有仓库挂起时接续补占', async () => {
  const h = conversation('preset_sales_manager');
  const complete = await h.send(request(orderNo));
  assert.doesNotMatch(complete.reply, /当前账号可说/);
  h.context.pendingReserve = true;
  const partial = await h.send(request(orderNo));
  assert.match(partial.reply, /剩余未占.*当前账号可说/s);
  const preview = await h.send('那我接着补占', partial.task.id);
  assert.equal(preview.task.state, 'AWAITING_CONFIRM');
  assert.equal(preview.preview.orderNo, orderNo);
  h.context.adjust = true;
  const paused = await h.send('接着补占', preview.task.id);
  assert.equal(paused.preview, undefined);
  assert.match(paused.reply, /挂起|改单/);
});

const exceptionQuestion = no => '销售单 ' + no + ' 的异常先处理哪个，下一步谁办？';
const exceptionCases = {
  '同单四类异常按可见岗位给优先级，账款差异单独跟进': async h => {
    Object.assign(h.context, { adjust: true, statuses: [6], pendingReserve: true, activeIssueKinds: ['shortage', 'credit', 'adjust'], paidAmount: 7.12 });
    const out = await h.send(exceptionQuestion(orderNo));
    checked(h, out);
    assert.match(out.reply, /处理顺序/);
    if (h.has('sale.order.view')) {
      assert.match(out.reply, /处理顺序[^\n]*(?:改单|实物)[^\n]*授信[^\n]*(?:缺货|供应)/);
      assert.match(out.reply, /授信审批岗|信用审批岗/);
      assert.match(out.reply, /销售或客服/);
    } else assert.doesNotMatch(out.reply, /授信审批岗|销售供应未覆盖/);
    if (h.has('warehouse.task.view')) assert.match(out.reply, /仓库改单处理岗/);
    assert.doesNotMatch(out.reply, /当前账号可按原作业入口继续|当前账号可说/);
    if (h.has('payment.view')) assert.match(out.reply, /账款差异.*财务.*(?:核销|核对)/s);
    else assert.doesNotMatch(out.reply, /账款差异|7\.12|23\.5/);
  },
  '账款差异给出计算应余、账面余额、差额和责任入口': async h => {
    h.context.paidAmount = 7.12;
    const out = await h.send('销售单 ' + orderNo + '，账款对不上，该找谁？');
    checked(h, out);
    if (!h.has('payment.view')) {
      assert.doesNotMatch(out.reply, /42\.88|19\.38/);
      return;
    }
    assert.match(out.reply, /账面余额 ¥23\.50.*按应收减已收应余 ¥42\.88.*账面少 ¥19\.38/);
    assert.match(out.reply, /财务.*原应收.*客户往来/s);
  },
  '口头说解除仍读取正式异常并只提示对应责任': async h => {
    Object.assign(h.context, { adjust: true, pendingReserve: true, activeIssueKinds: ['credit'], paidAmount: 0 });
    const start = await h.send(request(orderNo));
    const before = h.reads.length;
    const out = await h.send('卡点都解了，接着办', start.task.id);
    checked(h, out);
    assert.ok(h.reads.length > before);
    if (h.has('sale.order.view')) assert.match(out.reply, /授信待审批|授信申请待审批/);
    if (h.has('warehouse.task.view')) assert.match(out.reply, /改单待实物核对/);
    if (h.has('payment.view')) assert.match(out.reply, /账款差异/);
    assert.equal(out.preview, undefined);
  },
  '正式解除后按原单继续，获权销售才得到新占库预览': async h => {
    Object.assign(h.context, { adjust: true, pendingReserve: true, activeIssueKinds: ['adjust', 'credit', 'shortage'], paidAmount: 5 });
    const start = await h.send(request(orderNo));
    Object.assign(h.context, { adjust: false, activeIssueKinds: [], paidAmount: 26.5 });
    const out = await h.send('卡点解除后接着办', start.task.id);
    if (h.has('sale.order.reserve')) {
      assert.equal(out.task?.state, 'AWAITING_CONFIRM', out.reply);
      assert.equal(out.preview?.orderNo, orderNo);
    } else {
      checked(h, out);
      assert.equal(out.preview, undefined);
      assert.doesNotMatch(out.reply, /账款差异|挂起|授信待审批|授信申请待审批/);
    }
  },
  '异常跟进缺单号只问原单，原话补一个编号接续': async h => {
    const question = await h.send('这张销售单的异常先处理哪个？');
    assert.equal(question.task?.state, 'DISAMBIGUATING', question.reply);
    assert.match(question.reply, /完整销售单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(orderNo, question.task.id);
    checked(h, out);
    assert.equal(out.task.id, question.task.id);
  },
  '复核结果一次只绑定一张销售单，另一个编号须明确选择': async h => {
    const current = await h.send(request(orderNo));
    const before = h.reads.length;
    const query = await h.send(`卡点解了，接着办 ${orderNo} 和 ${otherNo}`, current.task.id);
    assert.equal(query.task?.state, 'DISAMBIGUATING', query.reply);
    assert.match(query.reply, /一张.*完整销售单号/);
    assert.equal(h.reads.length, before);
    const picked = await h.send(orderNo, query.task.id);
    checked(h, picked);
  },
};

for (const [name, run] of Object.entries(exceptionCases)) {
  for (const code of compared) {
    for (const [mode, planner] of [['规则', null], ['受控错路由', { graph: 'F-briefing' }]]) {
      test('异常跟进：' + name + ' / ' + code + ' / ' + mode, async () => {
        const h = conversation(code, planner);
        await run(h);
        assert.deepEqual(h.writes, []);
        assert.equal(h.planned.length, 0);
      });
    }
  }
}

test('卡点阻止旧占库确认，重算后原任务及请求键不变且只认新版本', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const intake = await h.send(request(orderNo));
  const preview = await h.send('接着占库', intake.task.id);
  const key = h.store.get(preview.task.id).requestKey;
  h.context.activeIssueKinds = ['shortage'];
  const blocked = await h.confirm(preview.task);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.match(blocked.reply, /原占库预览.*失效.*缺货/s);
  assert.deepEqual(h.writes, []);
  h.context.activeIssueKinds = [];
  const fresh = await h.send('卡点解了，接着办', blocked.task.id);
  assert.equal(fresh.task.id, preview.task.id);
  assert.equal(fresh.task.revision, preview.task.revision + 1);
  assert.equal(h.store.get(fresh.task.id).requestKey, key);
  await assert.rejects(h.confirm(fresh.task, preview.task.revision), { status: 409 });
  assert.deepEqual(h.writes, []);
});

test('正处于未知结果的原占库只核对原回执', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const intake = await h.send(request(orderNo));
  const preview = await h.send('接着占库', intake.task.id);
  const task = h.store.get(preview.task.id);
  task.transition('CONFIRMED'); task.transition('EXECUTING'); task.transition('RESULT_UNKNOWN');
  h.store.save(task);
  h.client.requestStatus = (key, action) => h.client.get('/api/system/request-status/' + key + '?action=' + action);
  const before = h.reads.length;
  const out = await h.send('卡点解了，接着办', task.id);
  assert.equal(out.task?.id, task.id);
  assert.equal(out.task.state, 'RESULT_UNKNOWN');
  assert.ok(h.reads.slice(before).some(row => row.path.startsWith('/api/system/request-status/')));
  assert.ok(!h.reads.slice(before).some(row => row.path.endsWith('/reserve-preview')));
  assert.deepEqual(h.writes, []);
});

test('读到新挂起后保留原单上下文并使原占库卡失效', async () => {
  const h = conversation('preset_sales_manager');
  h.context.pendingReserve = true;
  const ready = await h.send(request(orderNo));
  const preview = await h.send('接着补占', ready.task.id);
  h.context.adjust = true;
  const observed = await h.send('重新核对卡点', ready.task.id);
  assert.match(observed.reply, /先处理改单/);
  h.context.adjust = false;
  await assert.rejects(h.confirm(preview.task), { status: 409 });
  const fresh = await h.send('改单好了，接着办', observed.task.id);
  assert.equal(fresh.task.id, preview.task.id);
  assert.equal(fresh.task.revision, preview.task.revision + 1);
  assert.deepEqual(h.writes, []);
});

test('占库权限撤销后旧卡失效，仍能用当前来源重查原单', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const intake = await h.send(request(orderNo));
  const preview = await h.send('接着占库', intake.task.id);
  h.actor.permissions = h.actor.permissions.filter(code => code !== 'sale.order.reserve');
  const denied = await h.confirm(preview.task);
  assert.equal(denied.task.state, 'EXPIRED');
  assert.match(denied.reply, /占库权限.*预览.*失效/);
  const previousReads = h.reads.length;
  const detached = await h.send('卡点解了，接着办', intake.task.id);
  assert.doesNotMatch(detached.reply, new RegExp(orderNo));
  assert.equal(h.reads.length, previousReads);
  const verified = await h.send(request(orderNo));
  checked(h, verified);
  assert.equal(verified.preview, undefined);
  assert.doesNotMatch(verified.reply, /当前账号可说/);
  assert.deepEqual(h.writes, []);
});

test('正式履约暂时不可读时只留核对事项，恢复后按原单生成新版本', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const intake = await h.send(request(orderNo));
  const preview = await h.send('接着占库', intake.task.id);
  h.context.fulfillmentUnavailable = true;
  const blocked = await h.send('卡点解了，接着办', preview.task.id);
  assert.match(blocked.reply, /履约事项未能完整复核/);
  assert.equal(blocked.preview, undefined);
  h.context.fulfillmentUnavailable = false;
  const fresh = await h.send('卡点解了，接着办', blocked.task.id);
  assert.equal(fresh.task.id, preview.task.id);
  assert.equal(fresh.task.revision, preview.task.revision + 1);
});

test('有销售占库和财务查看权时，账款跟进仍按财务事项接续', async () => {
  const h = conversation('preset_sales_manager');
  h.actor.permissions.push('payment.view');
  h.context.status = 1;
  h.context.paidAmount = 7.1234;
  const start = await h.send('销售单 ' + orderNo + ' 账款对不上，先找谁？');
  checked(h, start);
  assert.match(start.reply, /财务先核对账款差异/);
  h.context.paidAmount = 26.5;
  const before = h.reads.length;
  const next = await h.send('账款对上了，接着办', start.task.id);
  checked(h, next);
  assert.equal(next.preview, undefined);
  assert.doesNotMatch(next.reply, /账款差异|当前账号可说/);
  assert.ok(!h.reads.slice(before).some(row => row.path.endsWith('/reserve-preview')));
  const generic = await h.send('卡点解了，接着办', start.task.id);
  checked(h, generic);
  assert.equal(generic.preview, undefined);
  assert.deepEqual(h.writes, []);
});

test('分批应收按自身字段核对，历史四位小数不会因舍入误报', async () => {
  const h = conversation('preset_finance_specialist');
  Object.assign(h.context, { paidAmount: 26.5001, balance: 23.4999 });
  const out = await h.send('销售单 ' + orderNo + '，账款差异怎么排？');
  checked(h, out);
  assert.match(out.reply, /部分收款，余额 ¥23\.4999/);
  assert.doesNotMatch(out.reply, /财务先核对账款差异|账款差异待核对/);
  assert.match(out.reply, /如果现场仍有差额/);
});

test('交接后只说优先级或重查原单时接续当前单据', async () => {
  const h = conversation('preset_customer_service');
  h.context.activeIssueKinds = ['credit', 'shortage'];
  let out = await h.send(exceptionQuestion(orderNo));
  for (const phrase of ['先处理哪个？', '怎么排？', '重新核对原单', '谁先办？']) {
    out = await h.send(phrase, out.task.id);
    checked(h, out);
    assert.match(out.reply, /先处理授信待审批[^\n]*缺货/);
    assert.equal(out.preview, undefined);
  }
  assert.deepEqual(h.writes, []);
});

test('旧版持久化交接任务省略版本时不能确认', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const read = await h.send(request(orderNo));
  const preview = await h.send('接着占库', read.task.id);
  delete h.store.get(preview.task.id).requirePreviewRevision;
  await assert.rejects(h.confirm(preview.task, null), { status: 409 });
  assert.deepEqual(h.writes, []);
});

const shiftCases = {
  '换班拿到完整单号可直接看当前交接': async h => {
    const out = await h.send('刚接班，销售单 ' + orderNo + ' 这班接着从哪一步做？');
    checked(h, out);
  },
  '刷新后标记交接待复核，重查更新原记录而非另开一条': async h => {
    const first = await h.send(request(orderNo));
    const saved = await h.get('/tasks/' + first.task.id);
    assert.equal(saved.task.reviewRequired, true);
    assert.deepEqual(saved.task.result, { orderNo });
    assert.doesNotMatch(saved.task.reply, /待打包|¥23\.5/);
    h.context.statuses = [6];
    h.context.balance = 0;
    const out = await h.resume(first.task);
    checked(h, out);
    assert.equal(out.task.id, first.task.id);
    if (h.has('warehouse.task.view')) assert.match(out.reply, /待出库/);
    if (h.has('payment.view')) assert.match(out.reply, /已收清/);
    assert.doesNotMatch(out.reply, /待打包|¥23\.5/);
  },
  '冷会话按唯一原交接续查，复查后仍然可接续': async h => {
    const first = await h.send(request(orderNo));
    h.context.statuses = [6];
    h.context.balance = 0;
    for (let round = 0; round < 2; round++) {
      const out = await h.cold('继续上次的交接');
      checked(h, out);
      assert.equal(out.task.id, first.task.id);
      assert.doesNotMatch(out.reply, /待打包|¥23\.5/);
    }
    assert.equal([...h.store.pagesForActor(h.actor)].flat().filter(task => task.graph === graph).length, 1);
  },
  '冷会话有两张单只问原销售单号，补齐后找对原交接': async h => {
    h.context.prepareSecond = true;
    const first = await h.send(request(orderNo));
    const other = await h.send(request(otherNo));
    assert.equal(other.result?.orderNo, otherNo, other.reply);
    const before = h.reads.length;
    const ambiguous = await h.cold('继续上次的交接');
    assert.match(ambiguous.reply, /哪张销售单.*完整销售单号/);
    assert.equal(h.reads.length, before);
    const picked = await h.cold('销售单号 ' + orderNo, ambiguous.historyQuery);
    assert.equal(picked.task?.id, first.task.id, picked.reply);
    checked(h, picked);
  },
  '复查失败不返回旧状态或办理动作，下一次仍按原单': async h => {
    const first = await h.send(request(orderNo));
    h.context.unavailable = true;
    const unavailable = await h.resume(first.task);
    assert.equal(unavailable.task, null);
    assert.equal(unavailable.result, undefined);
    assert.match(unavailable.reply, /暂时.*核实|暂时.*核对/);
    assert.doesNotMatch(unavailable.reply, /待打包|¥23\.5|继续占库/);
    h.context.unavailable = false;
    const retried = await h.resume(first.task);
    checked(h, retried);
    assert.equal(retried.task.id, first.task.id);
  },
};
for (const [name, verify] of Object.entries(shiftCases)) for (const code of compared) {
  for (const [mode, planner] of [['规则', null], ['受控错路由', { graph: 'F-briefing' }]]) {
    test('跨班交接 / ' + name + ' / ' + code + ' / ' + mode, async () => {
      const h = conversation(code, planner);
      await verify(h);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.planned, []);
    });
  }
}

test('跨班交接 / 原单关联冲突点名当前可见的责任来源', async () => {
  const h = conversation('preset_customer_service', { graph: 'F-briefing' });
  h.actor.permissions.push('payment.view');
  const first = await h.send(request(orderNo));
  h.context.otherOrderLink = true;
  const resumed = await h.resume(first.task);
  assert.equal(resumed.result, undefined);
  assert.match(resumed.reply, /销售单.*客户应收.*关联不一致|关联不一致.*销售单.*客户应收/s);
  assert.match(resumed.reply, /财务.*客户往来/s);
  assert.doesNotMatch(resumed.reply, /仓库任务/);
  assert.doesNotMatch(resumed.reply, /23\.5|合成财务私有客户|合成替代客户/);
  assert.deepEqual(h.writes, []);
});

test('跨班交接 / 同账号权限收窄后旧记录拒绝，报原单号可重新核对当前来源', async () => {
  const h = conversation('preset_warehouse_operator');
  h.context.statuses = [5, 6];
  const original = await h.send(request(orderNo));
  assert.ok(original.result.warehouse.tasks.length === 2);
  h.actor.warehouseIds = [1];
  const before = h.reads.length;
  await assert.rejects(h.resume(original.task), { status: 403 });
  assert.equal(h.reads.length, before);
  const range = await h.send('刚接班，销售单 ' + orderNo + ' 这班接着从哪一步做？');
  assert.deepEqual(range.result?.warehouse.tasks.map(row => row.no), ['WT20261122010']);
  assert.doesNotMatch(range.reply, /二仓|WT20261122011/);
  assert.deepEqual(h.writes, []);
});


test('跨班交接 / 重开持久记录后，同单多次查询只复核最新的唯一原单', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'xiaoman-shift-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'tasks.json');
  const firstRuntime = conversation('preset_warehouse_operator', null, new TaskStore(file));
  const old = await firstRuntime.send(request(orderNo));
  const recent = await firstRuntime.send(request(orderNo));
  firstRuntime.store.get(old.task.id).updatedAt = '2026-11-22T01:00:00.000Z';
  firstRuntime.store.get(recent.task.id).updatedAt = '2026-11-22T02:00:00.000Z';
  for (const turn of [old, recent]) firstRuntime.store.save(firstRuntime.store.get(turn.task.id));
  const restarted = conversation('preset_warehouse_operator', { graph: 'F-briefing' }, await TaskStore.open(file));
  restarted.context.statuses = [6];
  const out = await restarted.cold('继续上次的交接');
  assert.equal(out.task?.id, recent.task.id);
  assert.match(out.reply, /待出库/);
  assert.doesNotMatch(out.reply, /待打包/);
  assert.deepEqual(restarted.writes, []);
});

test('跨班交接 / 新账号只有交接单号时建立本人查询，拒绝前一位的任务', async () => {
  const store = new TaskStore(null);
  const first = conversation('preset_customer_service', null, store);
  const ownerTask = await first.send(request(orderNo));
  const next = conversation('preset_finance_specialist', { graph: 'F-briefing' }, store);
  await assert.rejects(next.resume(ownerTask.task), { status: 403 });
  const missing = await next.cold('继续上次的交接');
  assert.match(missing.reply, /哪张销售单.*完整销售单号/);
  const read = await next.cold('销售单号 ' + orderNo, missing.historyQuery);
  checked(next, read);
  assert.notEqual(read.task.id, ownerTask.task.id);
  assert.deepEqual(read.result.sources, ['finance']);
  assert.deepEqual(next.writes, []);
});

test('只读交接防止确认接口回放旧结果，口语回到原来的也会复查', async () => {
  const h = conversation('preset_warehouse_operator', { graph: 'F-briefing' });
  const original = await h.send(request(orderNo));
  await assert.rejects(h.confirm(original.task), { status: 409 });
  h.context.statuses = [6];
  const read = await h.send('还是按原来的', original.task.id);
  assert.equal(read.task?.id, original.task.id, read.reply);
  assert.match(read.reply, /待出库/);
  assert.doesNotMatch(read.reply, /待打包/);
  assert.deepEqual(h.writes, []);
});

test('已有当前记录时，明确要继续上次的交接仍先区分两张原单', async () => {
  const h = conversation('preset_customer_service', { graph: 'F-briefing' });
  h.context.prepareSecond = true;
  const first = await h.send(request(orderNo));
  const current = await h.send(request(otherNo));
  assert.equal(current.result.orderNo, otherNo);
  const before = h.reads.length;
  const choice = await h.send('继续上次的销售单交接', current.task.id);
  assert.match(choice.reply, /哪张销售单.*完整销售单号/);
  assert.equal(choice.result, undefined);
  assert.equal(h.reads.length, before);
  const previous = await h.cold('销售单号 ' + orderNo, choice.historyQuery);
  assert.equal(previous.task?.id, first.task.id);
  assert.equal(previous.result?.orderNo, orderNo);
  assert.deepEqual(h.writes, []);
});

const concurrentHandoffCases = {
  '接班占库预览到期时按原单生成新版本': async h => {
    h.context.status = 1;
    const start = await h.send(request(orderNo));
    const original = await h.send('接着占库', start.task.id);
    if (!h.has('sale.order.reserve')) return assert.match(original.reply, /占库权限|销售岗/);
    const task = h.store.get(original.task.id);
    const key = task.requestKey;
    task.preview.expiresAt = '2000-01-01T00:00:00Z';
    h.context.reserveFingerprint = 'new-preview';
    const out = await h.send('预览过期了，按原单重新试算占库', task.id);
    assert.equal(out.task?.id, task.id, out.reply);
    assert.equal(out.task.state, 'AWAITING_CONFIRM', out.reply);
    assert.equal(out.task.revision, original.task.revision + 1);
    assert.equal(h.store.get(task.id).requestKey, key);
    await assert.rejects(h.confirm(out.task, original.task.revision), { status: 409 });
  },
  '同单被同事占满后解释已办与下一步，不开启新预览': async h => {
    h.context.status = 1;
    const start = await h.send(request(orderNo));
    const preview = await h.send('接着占库', start.task.id);
    h.context.fullReserved = true;
    h.context.status = 2;
    if (!h.has('sale.order.reserve')) {
      const out = await h.send('同事处理过了，先核对原占库结果', start.task.id);
      assert.match(out.reply, /已占库|核不到|未核实/);
      assert.equal(out.preview, undefined);
      return;
    }
    const out = await h.resume(preview.task);
    assert.equal(out.task.id, preview.task.id);
    assert.equal(out.task.state, 'DONE', out.reply);
    assert.match(out.reply, /销售单 SL20261122011.*已.*占库.*(?:下一步|派发)/s);
    assert.equal(out.result?.recoveredViaReceipt, undefined);
  },
  '下落不明时重说占库仍只查本人原键': async h => {
    h.context.status = 1;
    const start = await h.send(request(orderNo));
    const pending = await h.send('接着占库', start.task.id);
    if (!h.has('sale.order.reserve')) {
      const out = await h.send('接班发现占库提交没回音，先查原请求回执', start.task.id);
      assert.match(out.reply, /权限|无法核实|只能.*原|本人/);
      assert.equal(out.preview, undefined);
      return;
    }
    const task = h.store.get(pending.task.id);
    task.transition('CONFIRMED'); task.transition('EXECUTING'); task.transition('RESULT_UNKNOWN');
    h.store.save(task);
    const lookups = [];
    h.client.requestStatus = async (...args) => { lookups.push(args); return null; };
    const out = await h.cold('给 ' + orderNo + ' 占库');
    assert.equal(out.task?.id, task.id, out.reply);
    assert.deepEqual(lookups, [[task.requestKey, 'sale.reserve:41']]);
    assert.equal(out.preview, undefined);
  },
  '冷接班结果不明时只问原销售单号': async h => {
    const first = await h.cold('接班后发现提交没回音，先查原请求回执');
    assert.match(first.reply, /完整销售单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(orderNo, first.task?.id);
    assert.match(out.reply, new RegExp(orderNo));
    assert.match(out.reply, /本人|未核实|权限/);
    assert.equal(out.preview, undefined);
  },
};

for (const [name, run] of Object.entries(concurrentHandoffCases)) for (const code of compared) {
  for (const model of [null, { graph: 'B2-reserve', orderNo: otherNo }]) {
    test('同单续办矩阵 ' + name + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
      const h = conversation(code, model);
      await run(h);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.planned, []);
    });
  }
}

test('同单续办边界 原号对应另一身份时不查回执、不找替代单', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const start = await h.send(request(orderNo));
  const pending = await h.send('接着占库', start.task.id);
  const task = h.store.get(pending.task.id);
  task.transition('CONFIRMED'); task.transition('EXECUTING'); task.transition('RESULT_UNKNOWN');
  h.store.save(task);
  h.context.saleIdChanged = true;
  let lookup = 0;
  h.client.requestStatus = async () => { lookup++; return null; };
  const out = await h.resume(task);
  assert.match(out.reply, /原销售单.*(?:无法|未能|未核对)/);
  assert.equal(lookup, 0);
  assert.equal(out.preview, undefined);
});

test('同单续办边界 原键回执与原单一致，后续销售行变化仍可说明那次成功', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const start = await h.send(request(orderNo));
  const pending = await h.send('接着占库', start.task.id);
  const task = h.store.get(pending.task.id);
  task.transition('CONFIRMED'); task.transition('EXECUTING'); task.transition('RESULT_UNKNOWN');
  h.store.save(task);
  h.client.requestStatus = async () => ({ status: 'success', resourceType: 'sale_order', resourceId: 41, message: '确认占库' });
  h.context.status = 4;
  const out = await h.resume(task);
  assert.equal(out.task.state, 'DONE', out.reply);
  assert.equal(out.result.recoveredViaReceipt, true);
  assert.match(out.reply, /原请求回执.*SL20261122011.*已出库/s);
  assert.deepEqual(h.writes, []);
});

test('同单续办边界 核对同事提交时只显示当前原单进度，不把本人结果当成同事回执', async () => {
  const h = conversation('preset_sales_manager');
  h.context.status = 1;
  const start = await h.send(request(orderNo));
  const pending = await h.send('接着占库', start.task.id);
  const task = h.store.get(pending.task.id);
  task.transition('CONFIRMED'); task.transition('EXECUTING'); task.transition('RESULT_UNKNOWN');
  h.store.save(task);
  h.context.status = 2;
  h.context.fullReserved = true;
  let lookups = 0;
  h.client.requestStatus = async () => { lookups++; return null; };
  const out = await h.send('同事占库后没回音，先查原占库回执', task.id);
  assert.match(out.reply, /原经办人核对回执.*已占库/s);
  assert.equal(out.result.orderNo, orderNo);
  assert.equal(lookups, 0);
  assert.equal(task.state, 'RESULT_UNKNOWN');
  assert.deepEqual(h.writes, []);
});

for (const remaining of [0, 1]) for (const code of compared) for (const model of [null, { graph: 'D-receipt', amountCents: 9000 }]) {
  test('撤回续办矩阵 占库后' + (remaining ? '部分释放' : '全量释放') + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
    const h = conversation(code, model);
    h.context.status = 1;
    const initial = await h.send('接班核对销售单 ' + orderNo);
    let original;
    if (h.has('sale.order.reserve')) {
      const pending = await h.send('接着占库', initial.task.id);
      original = h.store.get(pending.task.id);
      original.transition('CONFIRMED'); original.transition('EXECUTING'); original.transition('RESULT_UNKNOWN');
      h.store.save(original);
      h.client.requestStatus = async () => ({ status: 'success', resourceType: 'sale_order', resourceId: 41, data: { reservationEventId: 801 } });
    }
    h.context.status = remaining ? 6 : 1;
    h.context.timeline = [{ id: 802, eventType: 'released' }, { id: 801, eventType: 'reserved' }];
    h.context.reservedQty = remaining;
    const out = original ? await h.resume(original) : await h.send('接班后重查销售单 ' + orderNo + ' 的占库释放', initial.task.id);
    if (original) {
      assert.equal(out.task?.id, original.id);
      assert.match(out.reply, /原请求回执.*当时.*占库/s);
      assert.match(out.reply, new RegExp('已释放.*' + (2 - remaining) + '.*当前仍占 ' + remaining, 's'));
      assert.equal(out.result?.reservationReleased, true);
      const followup = await h.send('释放后重新占库', original.id);
      assert.equal(followup.task?.state, 'AWAITING_CONFIRM', followup.reply);
      assert.notEqual(followup.task.id, original.id);
      assert.notEqual(h.store.get(followup.task.id).requestKey, original.requestKey);
      assert.equal(followup.preview.totalRemain, 2 - remaining);
    } else {
      if (h.has('sale.order.view')) assert.match(out.reply, /已释放.*当前仍占.*销售/s);
      else assert.doesNotMatch(out.reply, /原请求回执确认|当前仍占/);
      assert.equal(out.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

const multiReserveEvents = [
  { id: 901, eventType: 'reserved', payload: { reserved: [{ itemId: 81, qty: 2 }] } },
  { id: 902, eventType: 'released', payload: { released: [{ itemId: 81, qty: 1 }] } },
  { id: 903, eventType: 'reserved', payload: { reserved: [{ itemId: 81, qty: 1 }] } },
  { id: 904, eventType: 'released', payload: { released: [{ itemId: 81, qty: 2 }] } },
];

for (const anchored of [false, true]) for (const code of compared) for (const model of [null, { graph: 'D-receipt', amountCents: 500 }]) {
  test('多轮撤回矩阵 ' + (anchored ? '原回执跨两轮释放' : '冷交接跨两轮释放') + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
    const h = conversation(code, model);
    h.context.status = 1;
    const start = await h.send('接班核对销售单 ' + orderNo);
    let original;
    if (anchored && h.has('sale.order.reserve')) {
      const waiting = await h.send('接着占库', start.task.id);
      original = h.store.get(waiting.task.id);
      original.transition('CONFIRMED'); original.transition('EXECUTING'); original.transition('RESULT_UNKNOWN');
      h.store.save(original);
      h.client.requestStatus = async () => ({ status: 'success', resourceType: 'sale_order', resourceId: 41, data: { reservationEventId: 901 } });
    }
    h.context.timeline = multiReserveEvents.slice().reverse();
    const out = original ? await h.resume(original) : await h.send('接班再查这张销售单的多次释放和重占', start.task.id);
    if (h.has('sale.order.view')) {
      assert.match(out.reply, /第 1 次占库 2 个.*第 1 次释放 1 个.*第 2 次占库 1 个.*第 2 次释放 2 个.*当前仍占 0 个/s);
      assert.match(out.reply, /当前待占 2 个/);
    } else assert.doesNotMatch(out.reply, /第 1 次占库|当前仍占/);
    if (original) {
      const unclear = await h.send('释放后重新占库', original.id);
      assert.match(unclear.reply, /当前待占量.*第几次释放|第几次释放.*当前待占量/);
      assert.equal(unclear.preview, undefined);
      const next = await h.send('按当前待占量重新占库', original.id);
      assert.equal(next.task?.state, 'AWAITING_CONFIRM', next.reply);
      assert.equal(next.preview.totalRemain, 2);
      assert.notEqual(next.task.id, original.id);
    } else assert.equal(out.preview, undefined);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('多轮撤回边界 指定本轮释放后冻结该批，数量恢复相同也需作废旧卡', async () => {
  const h = conversation('preset_sales_manager');
  h.context.timeline = multiReserveEvents;
  h.context.status = 1;
  h.context.reservationEventId = 904;
  const start = await h.send('接班核对销售单 ' + orderNo);
  const old = await h.send('第 1 次释放后重新占库', start.task.id);
  assert.match(old.reply, /无法单独对应当前待占量/);
  assert.equal(old.preview, undefined);
  const ambiguous = await h.send('第 1 次还是第 2 次释放后重新占库', start.task.id);
  assert.match(ambiguous.reply, /只选择一批/);
  assert.equal(ambiguous.preview, undefined);
  const pending = await h.send('第 2 次释放后重新占库', start.task.id);
  assert.equal(pending.task?.state, 'AWAITING_CONFIRM', pending.reply);
  assert.equal(h.store.get(pending.task.id).reapplyReleaseId, 904);
  h.context.reservationEventId = 906;
  const expired = await h.confirm(pending.task);
  assert.equal(expired.task.state, 'EXPIRED', expired.reply);
  assert.match((await h.resume(pending.task)).reply, /最新释放批次/);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const blocked of [false, true]) {
  test('同批跨同事占库 ' + code + (blocked ? ' 回执缺失' : ' 两次补占'), async () => {
    const h = conversation(code, { graph: 'D-receipt', amountCents: 500 });
    Object.assign(h.context, { status: 6, reservedQty: 1, reservationEventId: 905,
      timeline: [multiReserveEvents[0], { ...multiReserveEvents[3], id: 902 },
        { id: 903, eventType: 'reserved', payload: { reserved: [{ itemId: 81, warehouseId: 1, qty: 0.4, unit: '个' }] } },
        { id: 905, eventType: 'reserved', payload: { reserved: [{ itemId: 81, warehouseId: 1, qty: 0.6, unit: '个' }] } }],
      releaseBatches: [{ id: 902, ordinal: 1, lines: [{ itemId: 81, warehouseId: 1, unit: '个', qty: 2, remaining: 1 }],
        supplements: [{ id: 903, operator: '同事甲', lines: [{ qty: 0.4, unit: '个' }] },
          ...(!blocked ? [{ id: 905, operator: '同事乙', lines: [{ qty: 0.6, unit: '个' }] }] : [])],
        ...(blocked ? { issue: { id: 905, reason: 'receipt' } } : {}) }] });
    const first = await h.send('接班核对销售单 ' + orderNo + ' 的释放和重占，各补了多少？');
    const next = await h.send('第 1 次释放后重新占库', first.task?.id);
    if (!h.has('sale.order.view')) {
      assert.doesNotMatch(first.reply + next.reply, /同事甲|同事乙/);
    } else if (blocked) {
      assert.match(first.reply + next.reply, /#905.*成功回执/s);
      assert.equal(next.preview, undefined);
    } else {
      assert.match(first.reply, /同事甲.*0\.4 个.*同事乙.*0\.6 个.*已补 1 个.*还剩 1 个/s);
      if (h.has('sale.order.reserve')) {
        assert.equal(next.task?.state, 'AWAITING_CONFIRM', next.reply);
        assert.equal(next.preview.totalRemain, 1);
      } else {
        assert.match(first.reply + next.reply, /下一步.*销售或客服/s);
        assert.equal(next.preview, undefined);
      }
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('同批跨同事占库 指定数量有负号或小数位过多时只问数量', async () => {
  const h = conversation('preset_sales_manager');
  Object.assign(h.context, { status: 6, reservedQty: 1, reservationEventId: 902,
    timeline: [multiReserveEvents[0], { ...multiReserveEvents[3], id: 902 }],
    releaseBatches: [{ id: 902, ordinal: 1, lines: [{ itemId: 81, warehouseId: 1, unit: '个', qty: 2, remaining: 1 }],
      supplements: [] }] });
  const first = await h.send('查看销售单 ' + orderNo + ' 的释放进度');
  let clarified;
  for (const text of ['-1个', '0.333个', '2个', '1箱']) {
    const out = await h.send('第 1 次释放后重新占库 ' + text, first.task?.id);
    assert.equal(out.preview, undefined);
    assert.match(out.reply, /请给出本次要补的数量/);
    clarified = out.task;
  }
  const exact = await h.send('1个', clarified.id);
  assert.equal(exact.task?.state, 'AWAITING_CONFIRM', exact.reply);
  assert.equal(exact.preview.totalRemain, 1);
});

function stockCrossBatch(h, onlySecond = false) {
  Object.assign(h.context, { status: 6, reservedQty: onlySecond ? 1.75 : 1.25, reservationEventId: 910,
    timeline: [multiReserveEvents[0], { ...multiReserveEvents[1], payload: { released: [{ itemId: 81, qty: 0.75 }] } },
      { id: 906, eventType: 'released', payload: { released: [{ itemId: 81, qty: 0.75 }] } },
      { id: 910, eventType: 'reserved', payload: { reserved: [{ itemId: 81, qty: onlySecond ? 1.25 : 0.75 }] } }],
    releaseBatches: [{ id: 902, ordinal: 1, lines: [{ itemId: 81, warehouseId: 1, unit: '个', qty: 0.75, remaining: onlySecond ? 0 : 0.5 }],
      supplements: [{ id: 909, operator: '销售甲', lines: [{ qty: onlySecond ? 0.75 : 0.25, unit: '个' }] }] },
    { id: 906, ordinal: 2, lines: [{ itemId: 81, warehouseId: 1, unit: '个', qty: 0.75, remaining: 0.25 }],
      supplements: [{ id: 910, operator: '销售乙', lines: [{ qty: 0.5, unit: '个' }] }] }] });
}

for (const code of compared) for (const model of [null, { graph: 'D-receipt', amountCents: 500 }]) {
  for (const focused of [false, true]) test('交叉批次矩阵 占库 ' + code + ' ' + Boolean(model) + ' ' + focused, async () => {
    const h = conversation(code, model);
    stockCrossBatch(h);
    const read = await h.send('查看销售单 ' + orderNo + (focused ? ' 第 1 次释放补占进度' : ' 的各批释放和重占进度'));
    const ask = await h.send(focused ? '刚才那批' : '把剩下的补了', read.task?.id);
    const combined = read.reply + ask.reply;
    if (h.has('sale.order.view')) {
      assert.match(read.reply, /第 1 次释放[^\n]*销售甲[^\n]*已补 0\.25 个[^\n]*还剩 0\.5 个[^]*第 2 次释放[^\n]*销售乙[^\n]*已补 0\.5 个[^\n]*还剩 0\.25 个/);
      if (h.has('sale.order.reserve')) {
        const out = focused ? ask : await h.send('第二批', ask.task?.id);
        if (!focused) {
          assert.match(ask.reply, /哪一批|第几次释放/);
          assert.equal(ask.preview, undefined);
        }
        assert.equal(out.task?.state, 'AWAITING_CONFIRM', out.reply);
        assert.equal(out.preview.totalRemain, focused ? 0.5 : 0.25);
        assert.equal(h.store.get(out.task.id).preview._releaseEventId, focused ? 902 : 906);
      } else {
        assert.match(combined, /占库权限|有权限/);
        assert.equal(ask.preview, undefined);
      }
    } else {
      assert.doesNotMatch(combined, /销售甲|销售乙/);
      assert.equal(ask.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('交叉批次边界 占库仅剩第二批时可续办，关闭的明确原批次不转到第二批', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h, true);
  const focused = await h.send('查看销售单 ' + orderNo + ' 第 1 次释放补占进度');
  const closed = await h.send('刚才那批，把剩下的补了', focused.task?.id);
  assert.equal(closed.preview, undefined);
  assert.match(closed.reply, /第 1 次释放.*还剩 0 个/);
  const read = await h.send('查看销售单 ' + orderNo + ' 的各批释放和补占进度');
  const next = await h.send('把剩下的补了', read.task?.id);
  assert.equal(next.preview?.totalRemain, 0.25, next.reply);
  assert.equal(h.store.get(next.task.id).preview._releaseEventId, 906);
});

test('交叉批次边界 明确读批后重开仍沿原事件，口头补剩余替换本人未确认的部分卡', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const read = await h.send('查看销售单 ' + orderNo + ' 第 1 次释放补占进度');
  const resumed = await h.resume(read.task);
  const retained = await h.send('刚才那批', resumed.task?.id);
  assert.equal(retained.preview?.totalRemain, 0.5, retained.reply);
  assert.equal(h.store.get(retained.task.id).preview._releaseEventId, 902);
  const partly = await h.send('第 1 次释放后重新占库 0.25个', resumed.task?.id);
  assert.equal(partly.preview?.totalRemain, 0.25, partly.reply);
  const next = await h.send('把剩下的补了', partly.task.id);
  assert.equal(next.preview?.totalRemain, 0.5, next.reply);
  assert.equal(h.store.get(next.task.id).preview._releaseEventId, 902);
  assert.notEqual(next.task.id, partly.task.id);
  assert.equal(h.store.get(partly.task.id).state, 'EXPIRED');
  assert.deepEqual(h.writes, []);
});

test('交叉批次边界 选择序号用当时给出的事件，消失的批次不借用同序号新记录', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const read = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
  const ask = await h.send('把剩下的补了', read.task.id);
  const replacement = h.context.releaseBatches[1];
  h.context.releaseBatches[1] = { ...replacement, id: 912 };
  const retired = await h.send('第二批', ask.task.id);
  assert.match(retired.reply, /原释放批次当前无法核实/);
  assert.equal(retired.preview, undefined);
  h.context.releaseBatches[1] = { ...replacement, ordinal: 3 };
  const verified = await h.send('第二批', ask.task.id);
  assert.equal(verified.preview?.totalRemain, 0.25, verified.reply);
  assert.equal(h.store.get(verified.task.id).preview._releaseEventId, 906);
  assert.deepEqual(h.writes, []);
});

test('交叉批次边界 限仓或缺行的释放候选不能被当作已全部核实', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  h.context.releaseBatches.splice(0, 1);
  const read = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
  const next = await h.send('把剩下的补了', read.task.id);
  assert.match(next.reply, /待核对.*哪一批/);
  assert.equal(next.preview, undefined);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'D-receipt' }]) {
  for (const reason of ['receipt', 'conflict']) test('批次疑点隔离矩阵 占库 ' + code + ' ' + Boolean(model) + ' ' + reason, async () => {
    const h = conversation(code, model);
    stockCrossBatch(h);
    const first = h.context.releaseBatches[0];
    first.lines[0].remaining = null;
    first.issue = { id: 908, reason };
    const open = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
    const next = await h.send('把剩下的补了', open.task?.id);
    if (h.has('sale.order.view')) {
      assert.match(open.reply, /第 1 次释放[^\n]*已补 0\.25 个[^\n]*#908[^]*第 2 次释放[^\n]*已补 0\.5 个[^\n]*还剩 0\.25 个/);
      if (h.has('sale.order.reserve')) {
        assert.equal(next.preview?.totalRemain, 0.25, next.reply);
        assert.equal(h.store.get(next.task.id).preview._releaseEventId, 906);
        const explicit = await h.send('查看销售单 ' + orderNo + ' 第 1 次释放补占进度');
        const held = await h.send('刚才那批', explicit.task?.id);
        assert.equal(held.preview, undefined);
        assert.match(held.reply, /第 1 次释放[^\n]*#908/);
        assert.doesNotMatch(held.reply, /第 2 次释放/);
      } else {
        assert.match(next.reply, /权限/);
        assert.equal(next.preview, undefined);
      }
    } else {
      assert.doesNotMatch(open.reply + next.reply, /#908|销售甲|销售乙/);
      assert.equal(next.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('批次疑点隔离 只剩待核批时询问该次回执，汇总待占指令也不生成整单卡', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  h.context.releaseBatches[0].issue = { id: 908, reason: 'conflict' };
  h.context.releaseBatches[1].issue = { id: 908, reason: 'conflict' };
  for (const batch of h.context.releaseBatches) batch.lines[0].remaining = null;
  const read = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
  for (const prompt of ['把剩下的补了', '先补能核实的，待核的先放着', '按当前待占量重新占库']) {
    const out = await h.send(prompt, read.task.id);
    assert.equal(out.preview, undefined, out.reply);
    assert.match(out.reply, /#908.*回执应归属哪一批/);
    assert.equal((out.reply.match(/#908/g) ?? []).length, 1);
  }
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'D-receipt' }]) {
  for (const moved of [false, true]) test('更正回执矩阵 占库 ' + code + ' ' + Boolean(model) + ' ' + moved, async () => {
    const h = conversation(code, model);
    stockCrossBatch(h);
    const [a, b] = h.context.releaseBatches;
    a.issue = { id: 908, reason: 'receipt', check: 'missing' };
    a.lines[0].remaining = null;
    const old = await h.send('查看销售单 ' + orderNo + ' 第 1 次释放补占进度');
    delete a.issue;
    (moved ? b : a).supplements.push({ id: 908, operator: '原经办', lines: [{ qty: 0.1, unit: '个' }] });
    b.supplements.push({ id: 911, operator: '交接同事', lines: [{ qty: 0.1, unit: '个' }] });
    a.lines[0].remaining = moved ? 0.5 : 0.4;
    b.lines[0].remaining = moved ? 0.05 : 0.15;
    const corrected = await h.send('这笔回执补齐了，重新核对', old.task?.id);
    const next = await h.send(moved ? '按更正后的归属继续补办' : '刚才那批', corrected.task?.id);
    if (h.has('sale.order.view')) {
      assert.match(corrected.reply, moved ? /#908.*第 1 次释放.*现归第 2 次释放/s : /#908.*已核实.*第 1 次释放/s);
      assert.match(corrected.reply, /交接同事.*回执对应事件 #911/);
      if (h.has('sale.order.reserve')) {
        assert.equal(next.preview?.totalRemain, moved ? 0.05 : 0.4, next.reply);
        assert.equal(h.store.get(next.task.id).preview._releaseEventId, moved ? 906 : 902);
      } else {
        assert.match(next.reply, /权限/);
        assert.equal(next.preview, undefined);
      }
    } else {
      assert.doesNotMatch(corrected.reply + next.reply, /交接同事|#908/);
      assert.equal(next.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('更正回执边界 占库证据版本已变且数量相同，旧卡失效后仍沿原批试算', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  h.context.releaseBatches[0].proofVersion = 'a'.repeat(64);
  const first = await h.send('销售单 ' + orderNo + ' 第 1 次释放后重新占库');
  assert.equal(first.preview?.totalRemain, 0.5, first.reply);
  h.context.releaseBatches[0].proofVersion = 'b'.repeat(64);
  const old = await h.confirm(first.task);
  assert.equal(old.task?.state, 'EXPIRED', old.reply);
  assert.deepEqual(h.writes, []);
  const next = await h.send('刚才那批', first.task.id);
  assert.equal(next.preview?.totalRemain, 0.5, next.reply);
  assert.equal(h.store.get(next.task.id).preview._releaseProofVersion, 'b'.repeat(64));
  assert.equal(h.store.get(next.task.id).preview._releaseEventId, 902);
});

for (const code of compared) for (const model of [null, { graph: 'D-receipt' }]) {
  for (const withdrawn of [false, true]) test('再次更正矩阵 占库 ' + code + ' ' + Boolean(model) + ' ' + withdrawn, async () => {
    const h = conversation(code, model);
    stockCrossBatch(h);
    const [a, b] = h.context.releaseBatches;
    a.issue = { id: 908, reason: 'receipt', check: 'missing' };
    a.lines[0].remaining = null;
    const initial = await h.send('查看销售单 ' + orderNo + ' 第 1 次释放补占进度');
    delete a.issue;
    a.lines[0].remaining = 0.5;
    const movement = { id: 908, operator: '原经办', lines: [{ qty: 0.05, unit: '个' }] };
    b.supplements.push(movement);
    b.lines[0].remaining = 0.2;
    let observed = await h.send('这笔回执更正了，重新核对', initial.task?.id);
    b.supplements.push({ id: 911, operator: '后续同事', lines: [{ qty: 0.1, unit: '个' }] });
    b.supplements = b.supplements.filter(row => row.id !== 908);
    if (withdrawn) {
      b.issue = { id: 908, reason: 'receipt', check: 'missing' };
      b.lines[0].remaining = null;
      observed = await h.send('这笔回执撤回了，重新核对', observed.task?.id);
      if (h.has('sale.order.view')) assert.match(observed.reply, /#908.*上次核实.*第 2 次释放/s);
      const blocked = await h.send('按更正后的归属继续补办', observed.task?.id);
      assert.equal(blocked.preview, undefined);
      delete b.issue;
    }
    a.supplements.push(movement);
    a.lines[0].remaining = 0.45;
    b.lines[0].remaining = 0.15;
    h.context.reservedQty = 1.4;
    const latest = await h.send('这笔回执又改回原批了，重新核对', observed.task?.id);
    if (h.has('sale.order.view')) {
      assert.match(latest.reply, /#908.*第 2 次释放.*改回第 1 次释放/s);
      assert.match(latest.reply, /后续同事.*回执对应事件 #911/);
    } else assert.doesNotMatch(latest.reply, /后续同事|#908/);
    const next = await h.send('按更正后的归属继续补办', latest.task?.id);
    if (h.has('sale.order.reserve')) {
      assert.equal(next.preview?.totalRemain, 0.45, next.reply);
      assert.equal(h.store.get(next.task.id).preview._releaseEventId, 902);
    } else assert.equal(next.preview, undefined);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('再次更正边界 员工报告撤回但正式证据未变时继续核对原回执', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const [a] = h.context.releaseBatches;
  const first = await h.send('查看销售单 ' + orderNo + ' 第 1 次释放补占进度');
  a.proofVersion = 'a'.repeat(64);
  const read = await h.send('回执 #909', first.task.id);
  const disputed = await h.send('这笔回执的更正撤回了，重新核对', read.task.id);
  assert.match(disputed.reply, /#909.*正式记录仍归第 1 次释放/);
  for (const text of ['刚才那批', '按更正后的归属继续补办']) {
    const paused = await h.send(text, disputed.task.id);
    assert.equal(paused.preview, undefined);
    assert.match(paused.reply, /核对这笔回执/);
  }
  a.proofVersion = 'b'.repeat(64);
  const verified = await h.send('刚才那批', disputed.task.id);
  assert.equal(verified.preview?.totalRemain, 0.5, verified.reply);
  assert.equal(h.store.get(verified.task.id).preview._releaseProofVersion, 'b'.repeat(64));
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'D-receipt' }]) {
  for (const multiTurn of [false, true]) test('交叉更正矩阵 占库 ' + code + ' ' + Boolean(model) + ' ' + multiTurn, async () => {
    const h = conversation(code, model);
    stockCrossBatch(h);
    const [a, b] = h.context.releaseBatches;
    const otherMove = { id: 908, operator: '交叉经办', lines: [{ qty: 0.1, unit: '个' }] };
    a.supplements.push(otherMove);
    a.lines[0].remaining = 0.4;
    const start = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
    let context = start;
    if (multiTurn) {
      context = await h.send('回执 #908', context.task?.id);
      context = await h.send('回执 #909', context.task?.id);
    }
    a.issue = { id: 909, reason: 'conflict' };
    a.issues = [a.issue, { id: 908, reason: 'conflict' }];
    a.supplements = [{ id: 911, operator: '期间同事', lines: [{ qty: 0.1, unit: '个' }] }];
    a.lines[0].remaining = null;
    h.context.reservedQty = 1.5;
    const question = multiTurn ? '这两笔回执的更正顺序对不上，重新核对'
      : '销售单 ' + orderNo + ' 回执 #908 和 #909 交叉更正、撤回或改归，顺序对不上，重新核对';
    const check = await h.send(question, context.task?.id);
    if (h.has('sale.order.view')) {
      assert.match(check.reply, /请给出.*回执.*事件编号/);
      assert.match(check.reply, /#909/);
      assert.match(check.reply, /#908/);
      assert.match(check.reply, /第 1 次释放[^\n]*期间同事[^\n]*已补 0\.1 个[^\n]*待核/);
      assert.match(check.reply, /第 2 次释放[^\n]*还剩 0\.25 个[^\n]*下一步由销售或客服/);
      const blocked = await h.send('按更正后的归属继续补办', check.task?.id);
      assert.equal(blocked.preview, undefined);
      assert.match(blocked.reply, /请给出.*回执.*事件编号|占库权限/);
      const disputed = await h.send(multiTurn ? '回执 #908' : '事件 #908', check.task?.id);
      assert.match(disputed.reply, /#908[^\n]*成功回执应归属哪一批/);
      if (multiTurn) assert.match(disputed.reply, /#908[^\n]*上次核实归第 1 次释放/);
      assert.doesNotMatch(disputed.reply, /#909/);
      const ready = await h.send('先补能核实的', check.task?.id);
      if (h.has('sale.order.reserve')) {
        assert.equal(ready.preview?.totalRemain, 0.25, ready.reply);
        assert.equal(h.store.get(ready.task.id).preview._releaseEventId, 906);
      } else assert.equal(ready.preview, undefined);
      if (multiTurn) {
        a.issues = [a.issue];
        b.supplements.push(otherMove);
        b.lines[0].remaining = 0.15;
        const changed = await h.send('回执 #908', disputed.task?.id);
        assert.match(changed.reply, /#908[^\n]*上次核实归第 1 次释放，现归第 2 次释放/);
        assert.match(changed.reply, /期间同事/);
        const next = await h.send('按更正后的归属继续补办', changed.task?.id);
        if (h.has('sale.order.reserve')) {
          assert.equal(next.preview?.totalRemain, 0.15, next.reply);
          assert.equal(h.store.get(next.task.id).preview._releaseEventId, 906);
        } else assert.equal(next.preview, undefined);
      }
    } else assert.doesNotMatch(check.reply, /#908|#909|期间同事/);
    assert.equal(check.preview, undefined);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('交叉更正边界 占库切换到另一笔后，同批新增同事回执不解除旧回执的待核状态', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const [a] = h.context.releaseBatches;
  a.proofVersion = 'a'.repeat(64);
  a.supplements[0].proofVersion = 'c'.repeat(64);
  const first = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
  const x = await h.send('回执 #909', first.task.id);
  const claim = await h.send('这笔回执的更正撤回了，重新核对', x.task.id);
  const y = await h.send('回执 #910', claim.task.id);
  a.supplements.push({ id: 911, operator: '期间同事', lines: [{ qty: 0.1, unit: '个' }] });
  a.lines[0].remaining = 0.4;
  a.proofVersion = 'b'.repeat(64);
  const hold = await h.send('回执 #909', y.task.id);
  assert.match(hold.reply, /#909.*正式记录仍归第 1 次释放/);
  const recent = await h.send('按更正后的归属继续补办', hold.task.id);
  assert.equal(recent.preview, undefined);
  const safe = await h.send('先补能核实的', hold.task.id);
  assert.equal(safe.preview?.totalRemain, 0.25, safe.reply);
  assert.equal(h.store.get(safe.task.id).preview._releaseEventId, 906);
  assert.deepEqual(h.writes, []);
});

test('交叉更正边界 旧任务没有回执编号和核对记录时按无历史处理', () => {
  assert.equal(reviewedReceipt(undefined, undefined), undefined);
  assert.equal(reviewedReceipt({}, 909), undefined);
});

for (const code of compared) for (const model of [null, { graph: 'D-receipt' }]) {
  for (const multiTurn of [false, true]) test('部分核清矩阵 占库 ' + code + ' ' + Boolean(model) + ' ' + multiTurn, async () => {
    const h = conversation(code, model);
    stockCrossBatch(h);
    const [held, cleared] = h.context.releaseBatches;
    const movement = { id: 908, operator: '核清的经办', lines: [{ qty: 0.05, unit: '个' }] };
    const review1 = { id: 908, reason: 'conflict' }, review2 = { id: 909, reason: 'receipt', check: 'missing' };
    let initial;
    if (multiTurn) {
      held.issue = review1;
      held.issues = [review1, review2];
      cleared.issue = review1;
      initial = await h.send('销售单 ' + orderNo + ' 这两笔回执的更正顺序对不上，重新核对');
    }
    held.issue = review2;
    held.issues = [review2];
    held.supplements = [{ id: 912, operator: '同批同事', lines: [{ qty: 0.15, unit: '个' }] }];
    held.lines[0].remaining = null;
    delete cleared.issue;
    cleared.supplements.push(movement);
    cleared.lines[0].remaining = 0.2;
    const coworker = { id: 911, operator: '新增同事', lines: [{ qty: 0.1, unit: '个' }] };
    const after = () => {
      cleared.supplements.push(coworker);
      cleared.lines[0].remaining = 0.2 - coworker.lines[0].qty;
      h.context.reservedQty = 2 - (cleared.lines[0].remaining + 0.5);
    };
    if (!multiTurn) after();
    const checked = await h.send(multiTurn ? '一笔核清了，另一笔还待核，重新核对'
      : '销售单 ' + orderNo + ' 回执 #908 已核清，另一笔仍待核，同事又补办了，重新核对', initial?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('sale.order.view')) {
      assert.match(checked.reply, /#908[^\n]*(?:已核实|现归)[^\n]*第 2 次释放/);
      assert.match(checked.reply, /第 1 次释放[^\n]*同批同事[^\n]*已补 0\.15 个[^\n]*待核[^\n]*#909/);
      assert.doesNotMatch(checked.reply, /请给出.*编号|请核对[^\n]*#908/);
      assert.equal(h.store.get(checked.task?.id)?.batchReview?.clearedMovementId, 908);
      if (!multiTurn) assert.match(checked.reply, /新增同事[^\n]*已补 0\.65 个[^\n]*还剩 0\.1 个/);
      const canWrite = h.has('sale.order.reserve');
      const old = multiTurn && canWrite ? await h.send('按核清的那批继续补办', checked.task.id) : null;
      if (old) assert.equal(old.preview?.totalRemain, 0.2, old.reply);
      if (multiTurn) {
        coworker.lines[0].qty = 0.2;
        after();
      }
      const pending = multiTurn ? await h.send('回执 #909', checked.task.id) : checked;
      let anchor = pending;
      if (multiTurn) {
        assert.doesNotMatch(pending.reply, /#908/);
        anchor = await h.send('还剩哪笔回执待核', pending.task.id);
        assert.match(anchor.reply, /当前仍待核.*\n[^]*#909/);
        assert.doesNotMatch(anchor.reply, /请给出.*编号|请核对[^\n]*#908/);
        const unsafe = await h.send('按更正后的归属继续补办', anchor.task.id);
        assert.equal(unsafe.preview, undefined, unsafe.reply);
      }
      const out = await h.send('按核清的那批继续补办', anchor.task?.id);
      if (canWrite && !multiTurn) {
        assert.equal(out.preview?.totalRemain, 0.1, out.reply);
        assert.equal(h.store.get(out.task.id).preview._releaseEventId, 906);
      } else assert.equal(out.preview, undefined, out.reply);
      assert.match(out.reply, /新增同事[^\n]*已补 (?:0\.65|0\.75) 个[^\n]*还剩 (?:0\.1|0) 个/);
      assert.match(out.reply, /#909/);
      assert.match(out.reply, /下一步/);
      assert.doesNotMatch(out.reply, /请给出.*编号|请核对[^\n]*#908/);
      if (old) {
        assert.match(out.reply, /该批已补完/);
        const rejected = await h.confirm(old.task);
        assert.equal(rejected.task?.state, 'EXPIRED', rejected.reply);
      }
      if (!canWrite) assert.match(out.reply, /占库权限/);
    } else assert.doesNotMatch(checked.reply, /#908|#909|同批同事|新增同事/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('部分核清边界 占库已核清回执再次冲突时，独立可办批不能替代原批', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const [independent, target] = h.context.releaseBatches;
  const initial = await h.send('销售单 ' + orderNo + ' 回执 #910 已核清，另一笔仍待核，重新核对');
  assert.match(initial.reply, /#910.*已核实/);
  target.issue = { id: 910, reason: 'conflict' };
  target.lines[0].remaining = null;
  target.supplements = [];
  const next = await h.send('按核清的那批继续补办', initial.task.id);
  assert.match(next.reply, /#910.*回执应归属哪一批/);
  assert.match(next.reply, /第 1 次释放[^\n]*还剩 0\.5 个/);
  assert.equal(next.preview, undefined);
  assert.equal(independent.issue, undefined);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const excess of [false, true]) test('完批改归矩阵 占库 ' + code + ' ' + multiTurn + ' ' + excess, async () => {
    const h = conversation(code, multiTurn ? { graph: 'D-receipt' } : null);
    stockCrossBatch(h);
    const [closed, peer] = h.context.releaseBatches;
    closed.supplements[0].lines[0].qty = 0.75;
    closed.lines[0].remaining = 0;
    const pending = { id: 908, reason: 'receipt', check: 'missing' };
    peer.issue = pending;
    peer.lines[0].remaining = null;
    let context;
    if (multiTurn) {
      const first = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
      context = await h.send('回执 #909', first.task?.id);
    }
    const movement = { id: 908, operator: '后核清同事', lines: [{ qty: 0.1, unit: '个' }] };
    delete peer.issue;
    peer.lines[0].remaining = excess ? 0.25 : 0.15;
    h.context.reservedQty = 1.6;
    if (excess) {
      closed.issue = { id: 908, reason: 'capacity', excess: [{ itemId: 81, warehouseId: 1, unit: '个', qty: 0.1 }] };
      closed.lines[0].remaining = null;
      closed.lines[0].confirmedRemaining = 0;
    } else peer.supplements.push(movement);
    const prompt = multiTurn ? '第一批已补完，另一笔回执' : '销售单 ' + orderNo + ' 第一批已补完，待核回执 #908 ';
    const checked = await h.send(prompt + (excess ? '改归已补完批次了，重新核对' : '也核清了，重新核对'), context?.task?.id);
    assert.equal(checked.preview, undefined);
    if (!h.has('sale.order.view')) {
      assert.doesNotMatch(checked.reply, /#908|销售甲|销售乙/);
    } else {
      assert.match(checked.reply, /第 1 次释放[^\n]*销售甲[^\n]*已补 0\.75 个[^\n]*还剩 0 个/);
      assert.match(checked.reply, new RegExp('第 2 次释放[^\\n]*已补 ' + (excess ? '0\\.5' : '0\\.6')
        + ' 个[^\\n]*还剩 ' + (excess ? '0\\.25' : '0\\.15') + ' 个[^\\n]*下一步'));
      assert.doesNotMatch(checked.reply, /请给出.*编号|请核对[^\n]*#909/);
      const next = await h.send('按更正后的归属继续补办', checked.task?.id);
      if (excess) {
        assert.match(checked.reply, /#908[^\n]*超出[^\n]*0\.1 个[^\n]*销售或客服/);
        assert.equal(next.preview, undefined);
        if (h.has('sale.order.reserve')) {
          assert.match(next.reply, /#908[^\n]*超出/);
          const ready = await h.send('先补能核实的', checked.task?.id);
          assert.equal(ready.preview?.totalRemain, 0.25, ready.reply);
          assert.equal(h.store.get(ready.task.id).preview._releaseEventId, 906);
        }
      } else {
        assert.match(checked.reply, /#908[^\n]*(?:现归|已核实)[^\n]*第 2 次释放/);
        if (h.has('sale.order.reserve')) {
          assert.equal(next.preview?.totalRemain, 0.15, next.reply);
          assert.equal(h.store.get(next.task.id).preview._releaseEventId, 906);
        } else assert.equal(next.preview, undefined);
      }
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const outcome of ['partial', 'withdrawn', 'moved']) test('部分超额修正矩阵 占库 ' + code + ' ' + multiTurn + ' ' + outcome, async () => {
    const h = conversation(code, multiTurn ? { graph: 'D-receipt' } : null);
    stockCrossBatch(h);
    const [first, second] = h.context.releaseBatches;
    const line = qty => ({ itemId: 81, warehouseId: 1, unit: '个', qty });
    const issue = (over, qty) => ({ id: 908, reason: 'capacity', excess: [line(over)], movement: [line(qty)] });
    first.supplements[0].lines = [line(0.5)];
    first.lines[0].remaining = null;
    first.lines[0].confirmedRemaining = 0.25;
    first.issue = issue(0.4, 0.65);
    let context;
    if (multiTurn) {
      const initial = await h.send('查看销售单 ' + orderNo + ' 的各批释放和重占进度');
      context = await h.send('回执 #908', initial.task?.id);
    }
    second.supplements[0].lines = [line(0.25)];
    second.supplements.push({ id: 911, operator: '期间同事', lines: [line(0.1)] });
    second.lines[0].remaining = 0.4;
    const movement = { id: 908, operator: '更正同事', lines: [line(0.1)] };
    if (outcome === 'partial') first.issue = issue(0.15, 0.4);
    else {
      delete first.issue;
      delete first.lines[0].confirmedRemaining;
      first.lines[0].remaining = outcome === 'withdrawn' ? 0.15 : 0.25;
      const target = outcome === 'withdrawn' ? first : second;
      target.supplements.push(movement);
      if (outcome === 'moved') second.lines[0].remaining = 0.3;
    }
    h.context.reservedQty = 1.2;
    const prefix = multiTurn ? '' : '销售单 ' + orderNo + ' ';
    const prompt = outcome === 'partial' ? (multiTurn ? '这笔超量回执只更正了一部分' : '超量回执 #908 只更正了一部分')
      : (multiTurn ? '超出的部分' : '回执 #908 的超出部分') + (outcome === 'moved' ? '改归到另一批了' : '撤回了');
    const checked = await h.send(prefix + prompt + '，重新核对', context?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('sale.order.view')) {
      assert.match(checked.reply, /第 2 次释放[^\n]*期间同事[^\n]*还剩 [^\n]*下一步/);
      assert.doesNotMatch(checked.reply, /请给出.*编号/);
      const next = await h.send('按更正后的归属继续补办', checked.task?.id);
      if (outcome === 'partial') {
        assert.match(checked.reply, /#908[^\n]*0\.4 个[^\n]*(?:仍超出|当前超出)[^\n]*0\.15 个[^\n]*销售或客服/);
        if (multiTurn) assert.match(checked.reply, /上次超出 0\.4 个/);
        assert.match(checked.reply, /第 1 次释放[^\n]*已补 0\.5 个[^\n]*还剩 0\.25 个[^\n]*待核/);
        assert.equal(next.preview, undefined);
      } else {
        assert.match(checked.reply, /#908[^\n]*已核实[^\n]*0\.1 个/);
        if (multiTurn) assert.match(checked.reply, /上次超出 0\.4 个/);
        assert.doesNotMatch(checked.reply, /请核对.*#908/);
        if (h.has('sale.order.reserve')) {
          assert.equal(next.preview?.totalRemain, outcome === 'withdrawn' ? 0.15 : 0.3, next.reply);
          assert.equal(h.store.get(next.task.id).preview._releaseEventId, outcome === 'withdrawn' ? 902 : 906);
        } else assert.equal(next.preview, undefined);
      }
    } else assert.doesNotMatch(checked.reply, /#908|期间同事|更正同事/);
    assert.deepEqual(h.planned, []);
    assert.deepEqual(h.writes, []);
  });
}

test('部分超额修正边界 占库仅其他回执解除超额时不能推断本笔已部分撤回', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const [first] = h.context.releaseBatches;
  const lines = [{ itemId: 81, warehouseId: 1, unit: '个', qty: 0.25 }];
  first.lines[0].remaining = null;
  first.issue = { id: 908, reason: 'capacity', shared: true, movement: lines, excess: [{ ...lines[0], qty: 0.1 }] };
  const checked = await h.send('销售单 ' + orderNo + ' 超量回执 #908 只更正了一部分，重新核对');
  delete first.issue;
  first.lines[0].remaining = 0.25;
  const current = { id: 908, operator: '销售甲', lines, proofVersion: 'a'.repeat(64) };
  first.supplements.push(current);
  const hold = await h.send('超出的部分撤回了，重新核对', checked.task.id);
  assert.match(hold.reply, /请核对这笔回执的部分撤回或改归凭据/);
  first.supplements.pop();
  first.issue = { id: 908, reason: 'receipt', check: 'missing' };
  const missing = await h.send('回执 #908', hold.task.id);
  assert.match(missing.reply, /暂未取得.*#908/);
  delete first.issue;
  first.supplements.push(current);
  current.proofVersion = 'b'.repeat(64);
  const follow = await h.send('按更正后的归属继续补办', missing.task.id);
  assert.equal(follow.preview, undefined, follow.reply);
  assert.match(follow.reply, /#908[^\n]*部分撤回/);
  const safe = await h.send('先补能核实的', hold.task.id);
  assert.equal(safe.preview?.totalRemain, 0.25, safe.reply);
  assert.equal(h.store.get(safe.task.id).preview._releaseEventId, 906);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const readyIncluded of [false, true]) test('分次改归多批矩阵 占库 ' + code + ' ' + multiTurn + ' ' + readyIncluded, async () => {
    const h = conversation(code, multiTurn ? { graph: 'D-receipt' } : null);
    stockCrossBatch(h);
    const [closed, held] = h.context.releaseBatches;
    const line = (qty, remaining) => ({ itemId: 81, warehouseId: 1, unit: '个', qty, remaining });
    held.issue = { id: 908, reason: 'receipt', check: 'missing' };
    held.lines[0].remaining = null;
    h.context.releaseBatches.push({ id: 907, ordinal: 3, lines: [line(0.5, 0.15)],
      supplements: [{ id: 912, operator: '可证同事', lines: [line(0.35)] }] });
    h.context.timeline.splice(3, 0, { id: 907, eventType: 'released', payload: { released: [line(0.5)] } });
    const bill = '销售单 ' + orderNo + ' 超出部分分次改归到多个批次';
    const receipts = '（回执 #909、#908' + (readyIncluded ? '和 #912' : '') + '）';
    let first;
    if (multiTurn) first = await h.send(bill + receipts + '，重新核对');
    closed.supplements.push({ id: 911, operator: '补满同事', lines: [line(0.5)] });
    closed.lines[0].remaining = 0;
    h.context.reservedQty = 1.5;
    const checked = await h.send((multiTurn ? '超出的部分分次改归多批' : bill + receipts)
      + '，一批被同事补满、另一批仍待核，重新核对', first?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('sale.order.view')) {
      assert.match(checked.reply, /第 1 次释放[^\n]*已补完/);
      assert.match(checked.reply, /第 1 次释放[^\n]*补满同事[^\n]*已补 0\.75 个[^\n]*还剩 0 个/);
      assert.match(checked.reply, /第 2 次释放[^\n]*待核[^\n]*#908/);
      assert.match(checked.reply, /第 3 次释放[^\n]*已补 0\.35 个[^\n]*还剩 0\.15 个/);
      assert.doesNotMatch(checked.reply, /请给出.*编号|请核对[^\n]*#909/);
      const next = await h.send('先补能核实的', checked.task?.id);
      if (h.has('sale.order.reserve') && readyIncluded) {
        assert.equal(next.preview?.totalRemain, 0.15, next.reply);
        assert.equal(h.store.get(next.task.id).preview._releaseEventId, 907);
      } else {
        assert.equal(next.preview, undefined, next.reply);
        assert.match(next.reply, /#908|占库权限/);
      }
      const chosen = await h.send('回执 #909', checked.task?.id);
      const closedAgain = await h.send('按更正后的归属继续补办', chosen.task?.id);
      assert.equal(closedAgain.preview, undefined, closedAgain.reply);
      if (h.has('sale.order.reserve')) assert.match(closedAgain.reply, /已补完/);
      const unresolved = await h.send('回执 #908', checked.task?.id);
      assert.match(unresolved.reply, /暂未取得[^\n]*#908/);
      assert.doesNotMatch(unresolved.reply, /请核对[^\n]*#909|#909[^\n]*待核/);
    } else assert.doesNotMatch(checked.reply, /#908|#909|补满同事/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('分次改归多批边界 未取得逐笔编号时不从同单其它批次猜测可办范围', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h);
  const [other, held] = h.context.releaseBatches;
  held.issue = { id: 908, reason: 'receipt', check: 'missing',
    movement: [{ itemId: 81, warehouseId: 1, unit: '个', qty: 0.1 }] };
  held.lines[0].remaining = null;
  const read = await h.send('销售单 ' + orderNo + ' 超出部分分次改归到多个批次，重新核对');
  assert.match(read.reply, /#908[^\n]*0\.1 个[^\n]*这部分待核/);
  assert.match(read.reply, /第 1 次释放[^\n]*还剩 0\.5 个/);
  const blocked = await h.send('先补能核实的', read.task.id);
  assert.equal(blocked.preview, undefined);
  assert.match(blocked.reply, /请给出要续办的那笔回执对应的事件编号/);
  const chosen = await h.send('回执 #909', read.task.id);
  const prepared = await h.send('按更正后的归属继续补办', chosen.task.id);
  assert.equal(prepared.preview?.totalRemain, 0.5, prepared.reply);
  assert.equal(h.store.get(prepared.task.id).preview._releaseEventId, other.id);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const proof of [false, true]) test('满批重开并核清矩阵 占库 ' + code + ' ' + multiTurn + ' ' + proof, async () => {
    const h = conversation(code, multiTurn ? { graph: 'D-receipt' } : null);
    stockCrossBatch(h);
    const [reopened, cleared] = h.context.releaseBatches;
    const line = qty => ({ itemId: 81, warehouseId: 1, unit: '个', qty });
    reopened.supplements[0].lines = [line(0.25)];
    const fill = { id: 911, operator: '补满同事', lines: [line(0.5)] };
    reopened.supplements.push(fill);
    reopened.lines[0].remaining = 0;
    cleared.lines[0].remaining = null;
    cleared.issue = { id: 908, reason: 'receipt', check: 'missing', movement: [line(0.1)] };
    const original = '销售单 ' + orderNo + ' 超出部分分次改归到多个批次（回执 #909 和 #908）';
    let first;
    if (multiTurn) first = await h.send(original + '，一批被同事补满、另一批仍待核，重新核对');
    if (proof) {
      fill.lines = [line(0.25)];
      reopened.lines[0].remaining = 0.25;
    } else {
      reopened.issue = { id: 911, reason: 'receipt', check: 'mismatch', movement: [line(0.5)] };
      reopened.lines[0].remaining = null;
      reopened.supplements.pop();
    }
    delete cleared.issue;
    cleared.supplements.push({ id: 908, operator: '核清同事', lines: [line(0.1)] });
    cleared.lines[0].remaining = 0.15;
    h.context.reservedQty = 1.25;
    const prompt = '已被同事补满的一批又被部分撤回、另一批的待核回执同时核清了，重新核对';
    const checked = await h.send((multiTurn ? '' : original + '，') + prompt, first?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('sale.order.view')) {
      if (proof) {
        assert.match(checked.reply, /第 1 次释放[^\n]*补满同事[^\n]*已补 0\.5 个[^\n]*还剩 0\.25 个/);
        if (multiTurn) assert.match(checked.reply, /第 1 次释放[^\n]*重新有余量[^\n]*#911[^\n]*0\.5 个[^\n]*0\.25 个/);
        assert.doesNotMatch(checked.reply, /第 1 次释放已补完/);
      } else assert.match(checked.reply, /第 1 次释放[^\n]*已补 0\.25 个[^\n]*待核[^\n]*#911/);
      assert.match(checked.reply, /第 2 次释放[^\n]*核清同事[^\n]*已补 0\.6 个[^\n]*还剩 0\.15 个/);
      if (multiTurn) assert.match(checked.reply, /#908[^\n]*现已核清/);
      assert.doesNotMatch(checked.reply, /请核对[^\n]*#908|#908[^\n]*待核/);
      const next = await h.send('先补能核实的', checked.task?.id);
      if (h.has('sale.order.reserve') && !proof) {
        assert.equal(next.preview?.totalRemain, 0.15, next.reply);
        assert.equal(h.store.get(next.task.id).preview._releaseEventId, 906);
      } else {
        assert.equal(next.preview, undefined, next.reply);
        if (h.has('sale.order.reserve')) assert.match(next.reply, /请给出要续办的那批对应的回执编号/);
      }
      if (multiTurn && h.has('sale.order.reserve')) {
        const formerlyFull = await h.send('按撤回后重新有余量的那批继续补办', checked.task.id);
        assert.equal(formerlyFull.preview?.totalRemain, proof ? 0.25 : undefined, formerlyFull.reply);
        if (proof) assert.equal(h.store.get(formerlyFull.task.id).preview._releaseEventId, 902);
        else assert.match(formerlyFull.reply, /#911/);
        const justCleared = await h.send('按刚核清的那批继续补办', checked.task.id);
        assert.equal(justCleared.preview?.totalRemain, 0.15, justCleared.reply);
        assert.equal(h.store.get(justCleared.task.id).preview._releaseEventId, 906);
      }
    } else assert.doesNotMatch(checked.reply, /#908|#911|补满同事|核清同事/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.planned, []);
  });
}

test('满批重开并核清边界 重开后回执移到别批不能用先前的续办指向跳批', async () => {
  const h = conversation('preset_sales_manager');
  stockCrossBatch(h, true);
  const [first, second] = h.context.releaseBatches;
  const line = qty => ({ itemId: 81, warehouseId: 1, unit: '个', qty });
  first.supplements[0].lines = [line(0.75)];
  second.issue = { id: 908, reason: 'receipt', check: 'missing' };
  second.lines[0].remaining = null;
  const original = await h.send('销售单 ' + orderNo + ' 超出部分分次改归到多个批次（回执 #909 和 #908），重新核对');
  first.supplements[0].lines = [line(0.5)];
  first.lines[0].remaining = 0.25;
  delete second.issue;
  second.supplements.push({ id: 908, operator: '核清同事', lines: [line(0.05)] });
  second.lines[0].remaining = 0.2;
  h.context.reservedQty = 1.25;
  const observed = await h.send('已补满的那批又被部分撤回，另一笔待核回执同时核清了，重新核对', original.task.id);
  const receipt = first.supplements.pop();
  h.context.releaseBatches.push({ id: 907, ordinal: 3, lines: [{ ...line(0.75), remaining: 0.25 }], supplements: [receipt] });
  h.context.timeline.splice(3, 0, { id: 907, eventType: 'released', payload: { released: [line(0.75)] } });
  const changed = await h.send('按撤回后重新有余量的那批继续补办', observed.task.id);
  assert.equal(changed.preview, undefined, changed.reply);
  assert.match(changed.reply, /#909 当前归属/);
  const stillCorrect = await h.send('按刚核清的那批继续补办', observed.task.id);
  assert.equal(stillCorrect.preview?.totalRemain, 0.2, stillCorrect.reply);
  assert.equal(h.store.get(stillCorrect.task.id).preview._releaseEventId, 906);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) test('多批口语对照 占库首轮和接班 ' + code, async () => {
  const h = conversation(code, null);
  stockCrossBatch(h, true);
  const [first, second] = h.context.releaseBatches;
  const line = qty => ({ itemId: 81, warehouseId: 1, unit: '个', qty });
  first.supplements[0].lines = [line(0.75)];
  second.issue = { id: 908, reason: 'receipt', check: 'missing', movement: [line(0.1)] };
  second.lines[0].remaining = null;
  const start = await h.send('销售单 ' + orderNo + '，这几笔回执 #909 和 #908，看看各批还差多少');
  assert.equal(start.preview, undefined);
  if (!h.has('sale.order.view')) {
    assert.match(start.reply, /交接|权限/);
    assert.doesNotMatch(start.reply, /#909|#908|第 1 次释放/);
    assert.ok(h.reads.every(row => !row.path.startsWith('/api/sale/')));
    assert.deepEqual(h.writes, []);
    return;
  }
  assert.match(start.reply, /第 1 次释放已补完/);
  assert.match(start.reply, /暂未取得[^\n]*#908/);
  first.supplements[0].lines = [line(0.5)];
  first.lines[0].remaining = 0.25;
  delete second.issue;
  second.supplements.push({ id: 908, operator: '核清同事', lines: [line(0.1)] });
  second.lines[0].remaining = 0.15;
  h.context.reservedQty = 1.25;
  const progress = await h.send('先看还能补多少。刚才满的那批撤了一点，另一笔也对上了。', start.task.id);
  assert.equal(progress.preview, undefined);
  assert.match(progress.reply, /第 1 次释放[^\n]*重新有余量[^\n]*#909/);
  assert.match(progress.reply, /#908[^\n]*现已核清/);
  const preview = await h.send('就补刚对上的那批，先给我看看。', progress.task.id);
  if (h.has('sale.order.reserve')) {
    assert.equal(preview.preview?.totalRemain, 0.15, preview.reply);
    assert.equal(h.store.get(preview.task.id).preview._releaseEventId, 906);
    const changed = await h.send('先试算重新有余量的那批。', progress.task.id);
    assert.equal(changed.preview?.totalRemain, 0.25, changed.reply);
    assert.equal(h.store.get(changed.task.id).preview._releaseEventId, 902);
  } else {
    assert.equal(preview.preview, undefined, preview.reply);
    assert.match(preview.reply, /权限/);
  }
  assert.deepEqual(h.writes, []);
});

test('多批口语对照 占库明说暂缓时只查当前，另一单不能沿旧批续办', async () => {
  const h = conversation('preset_sales_manager', null);
  stockCrossBatch(h);
  const start = await h.send('销售单 ' + orderNo + ' 超出部分分次改归到多个批次（回执 #909 和 #910），重新核对');
  const read = await h.send('先别补，看看各批现在还差多少。', start.task.id);
  assert.equal(read.preview, undefined);
  assert.match(read.reply, /第 1 次释放[^\n]*还剩 0\.5 个/);
  const different = await h.send('销售单 ' + otherNo + '，就补刚对上的那批，先给我看看。', read.task.id);
  assert.equal(different.preview, undefined);
  assert.doesNotMatch(different.reply, /#909|#910/);
  assert.deepEqual(h.writes, []);
});

test('多批口语对照 一句撤回只追问一次，正式证据核清后停止追问', async () => {
  const h = conversation('preset_sales_manager', null);
  stockCrossBatch(h, true);
  const [first, second] = h.context.releaseBatches;
  const line = qty => ({ itemId: 81, warehouseId: 1, unit: '个', qty });
  first.supplements[0].lines = [line(0.75)];
  second.supplements[0].lines = [line(0.75)];
  second.lines[0].remaining = 0;
  const start = await h.send('销售单 ' + orderNo + '，这几笔回执 #909 和 #910，看看各批还差多少');
  const prompt = '刚才满的那批撤了一点，再查下。';
  const unclear = await h.send(prompt, start.task.id);
  assert.equal([...unclear.reply.matchAll(/请核对[^。\n]*撤回[^。\n]*回执编号/g)].length, 1, unclear.reply);
  first.supplements[0].lines = [line(0.5)];
  first.lines[0].remaining = 0.25;
  const resolved = await h.send(prompt, unclear.task.id);
  assert.match(resolved.reply, /第 1 次释放[^\n]*重新有余量/);
  assert.match(resolved.reply, /第 2 次释放已补完/);
  assert.doesNotMatch(resolved.reply, /请核对[^。\n]*撤回[^。\n]*回执编号/);
  assert.equal(resolved.preview, undefined);
  assert.deepEqual(h.writes, []);
});
