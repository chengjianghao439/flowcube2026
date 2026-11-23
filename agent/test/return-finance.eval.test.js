import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { FlowError } from '../src/flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const so = 'SL20261122011', sr = 'SR20261122012', rt = 'RT20261122013', rc = 'RC20261122014', sc = 'SC20261122015';
const rf = 'RF20261122016', doneRf = 'RF20261122017', otherRf = 'RF20261122018', otherRc = 'RC20261122019';
const question = '核对销售单 ' + so + ' 退货后的应收冲减、部分退款和月结差异';

function fixture(code, wrong, allowRefund = false) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: code, roleName: role.name, permissions: role.after.slice(), warehouseIds: [11] };
  if (allowRefund) actor.permissions.push('refund.order.view', 'refund.order.execute');
  const has = key => actor.permissions.includes(key);
  const reads = [], writes = [], modelCalls = [];
  const state = { balance: 15, paid: 60, refundStatus: 2, hide: false, lose: false, drift: false, missingFund: false, hiddenRefunds: false, refundInLedger: 20, statementBalance: undefined };
  const list = rows => ({ list: rows, pagination: { total: rows.length } });
  const record = () => ({ id: 21, type: 2, settlementType: 2, orderId: 31, orderNo: so, totalAmount: 75, paidAmount: state.paid, balance: state.balance, status: 2 });
  const entry = (id, amount, method, receiptId, receiptNo, statementId) => ({ id, entryId: id, recordId: 21, amount, method, receiptId, receiptNo, statementId });
  const entries = () => [entry(201, 80, 'bank', 41, rc, 51), entry(202, -state.refundInLedger, 'refund', null, null, null),
    ...(state.refundStatus === 3 ? [entry(203, -10, 'refund', null, null, null)] : [])];
  const selected = () => ({ id: 61, refundNo: rf, saleOrderId: 31, saleOrderNo: so, amount: 10, accountId: 71,
    refundDate: '2026-11-22', paymentRecordId: 21, status: state.refundStatus,
    trace: { warehouseIds: [11], effectiveDate: '2026-11-22', outgoing: state.refundStatus === 3 ? [10] : [] } });
  const completed = () => ({ ...selected(), id: 62, refundNo: doneRf, amount: 20, status: 3,
    trace: { warehouseIds: [11], effectiveDate: '2026-11-22', outgoing: state.missingFund ? [] : [20] } });
  const foreign = () => ({ ...selected(), id: 63, refundNo: otherRf, saleOrderNo: 'SL20261122099', saleOrderId: 99, paymentRecordId: 99 });
  const retRow = { id: 81, saleOrderId: 31, saleOrderNo: so, returnNo: sr, warehouseId: 11 };
  const sku = { productId: 91, productName: '合成铰链', unit: '件' };
  const receipt = { id: 41, type: 2, receiptNo: rc, partyId: 25, partyName: '合成月结客户', amount: 100, balance: 20, settledAmount: 80, status: 2,
    settlements: [{ entryId: 201, statementId: 51, recordId: 21, orderId: 31, orderNo: so, type: 2, amount: 80 }] };
  const statement = () => ({ id: 51, type: 2, statementNo: sc, status: 2, totalAmount: 75, settledAmount: state.paid,
    balance: 75 - state.paid, items: [{ ...record(), balance: state.statementBalance ?? state.balance, recordId: 21, sourceOrderNo: so, customerId: 25 }],
    trace: { projection: { totalAmount: 75, settledAmount: state.paid, balance: state.drift ? 20 : 75 - state.paid, status: 2 },
      entries: entries().map(row => ({ ...row, receiptPartyId: row.receiptId ? 25 : null, receiptType: row.receiptId ? 2 : null,
        receiptAmount: row.receiptId ? 100 : null, receiptSettledAmount: row.receiptId ? 80 : null, receiptBalance: row.receiptId ? 20 : null })) } });
  let posted;
  const client = { baseUrl: 'http://fixture',
    async get(path) {
      reads.push(path);
      const url = new URL(path, this.baseUrl), p = url.pathname;
      if (p.startsWith('/api/returns') || p.startsWith('/api/return-tasks')) {
        assert.ok(has('return.order.view'));
        if (p === '/api/returns/sale') return list([retRow]);
        if (p === '/api/returns/sale/81') return { ...retRow, status: 3, totalAmount: 50, executedAmount: 25, items: [{ ...sku, quantity: 2 }], task: { id: 82, taskNo: rt, status: 5 } };
        if (p === '/api/return-tasks/82') return { id: 82, returnId: 81, returnNo: sr, taskNo: rt, returnType: 'sale', warehouseId: 11, status: 5,
          items: [{ ...sku, receivedQty: 2, putawayQty: 1, rejectedQty: 1 }] };
      }
      if (p.startsWith('/api/payments')) {
        assert.ok(has('payment.view'));
        if (p === '/api/payments/' || p === '/api/payments') return list([record()]);
        if (p === '/api/payments/21/entries') return entries();
        if (p === '/api/payments/receipts/41') return receipt;
        if (p === '/api/payments/statements') return list([statement()]);
        if (p === '/api/payments/statements/51') return statement();
      }
      if (p.startsWith('/api/refunds')) {
        assert.ok(has('refund.order.view'));
        if (p === '/api/refunds') return list(state.hiddenRefunds ? [] : [selected(), completed(), foreign()]);
        if (p === '/api/refunds/61') return selected();
        if (p === '/api/refunds/62') return completed();
        if (p === '/api/refunds/63') return foreign();
      }
      throw new Error('未知合成调用 ' + path);
    },
    async post(path, body, { requestKey }) {
      assert.ok(has('refund.order.execute'));
      assert.equal(path, '/api/refunds/61/execute');
      assert.equal(body.expectedPreview.paymentRecordId, 21);
      assert.equal(body.expectedPreview.amountCents, 1000);
      assert.ok(!posted);
      writes.push({ path, body, requestKey });
      state.refundStatus = 3;
      state.paid -= 10; state.balance += 10;
      posted = { id: 61, refundNo: rf, amount: 10 };
      if (state.lose) throw new FlowError('unknown', 'simulated receipt loss');
      return posted;
    },
    async requestStatus(_key, action) {
      assert.equal(action, 'refund.execute.61');
      return state.hide ? null : { status: 'success', resourceId: 61, resourceType: 'refund_order', data: posted };
    },
  };
  const store = new TaskStore(null);
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { modelCalls.push(text); return wrong; } } });
  const send = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message, taskId }, actor, client });
  const confirm = (task, revision = task.revision) => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/confirm', body: { revision }, actor, client });
  const resume = task => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/resume', body: {}, actor, client });
  return { has, actor, state, reads, writes, modelCalls, send, confirm, resume, store };
}

function expectedAccess(h, out) {
  if (!h.has('return.order.view') && !h.has('payment.view')) return assert.match(out.reply, /权限/);
  assert.equal(out.task?.graph, 'N-return-finance', out.reply);
  assert.equal(out.task.state, 'DONE', out.reply);
}

const samples = {
  '按原单列实物入仓、应收冲减和当前能力可见的资金进度': async h => {
    const out = await h.send(question);
    expectedAccess(h, out);
    if (h.has('return.order.view')) {
      assert.match(out.reply, new RegExp(sr + '[^\\n]*已入仓 1 件[^\\n]*冲减 ¥25\\.00'));
      assert.doesNotMatch(out.reply, /¥60\.00|¥15\.00/);
    }
    if (h.has('payment.view')) {
      assert.match(out.reply, /应收 ¥75\.00.*实收 ¥60\.00.*欠款 ¥15\.00/);
      assert.match(out.reply, /退款冲回 ¥20\.00/);
      assert.match(out.reply, /待退.*退款单查看权限/);
    }
  },
  '缺销售单号只问完整单号并用同个任务续查': async h => {
    const missing = await h.send('查这张销售单退货后的退款和月结差异');
    if (!h.has('return.order.view') && !h.has('payment.view')) return assert.match(missing.reply, /权限/);
    assert.match(missing.reply, /完整销售单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(so, missing.task?.id);
    expectedAccess(h, out);
    assert.equal(out.task.id, missing.task.id);
  },
  '明确原退货、收款单和对账单，按权限核对各自关联': async h => {
    const out = await h.send(question + '，退货单 ' + sr + '、收款单 ' + rc + '、对账单 ' + sc);
    expectedAccess(h, out);
    if (h.has('payment.view')) {
      assert.match(out.reply, new RegExp(rc + '[^\\n]*本销售单[^\\n]*¥80\\.00'));
      assert.match(out.reply, new RegExp(sc + '[^\\n]*已确认[^\\n]*¥15\\.00'));
    }
  },
  '换收款单不能引用其他销售单，需按本人查得的原分录': async h => {
    const out = await h.send(question);
    expectedAccess(h, out);
    if (!h.has('payment.view')) return;
    const focused = await h.send('核对收款单 ' + otherRc, out.task.id);
    assert.match(focused.reply, /未能核实.*原销售单|未核实.*原销售单/);
    assert.doesNotMatch(focused.reply, new RegExp(rc));
  },
  '没有退款执行权限时不生成确认任务': async h => {
    const out = await h.send('继续给销售单 ' + so + ' 的退款单 ' + rf + ' 办理退款');
    assert.match(out.reply, /退款.*权限|权限.*退款/);
    assert.equal(out.preview, undefined);
  },
};

for (const [name, run] of Object.entries(samples)) for (const code of compared) {
  for (const model of [null, { graph: 'D-receipt', customerKeyword: '其他客户', amountCents: 7000 }]) {
    test(name + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
      const h = fixture(code, model);
      await run(h);
      assert.deepEqual(h.modelCalls, []);
      assert.deepEqual(h.writes, []);
    });
  }
}

test('有退款权限只执行已确认的原退款单，重复指令和确认不会重退', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const summary = await h.send(question);
  assert.match(summary.reply, /已出账 ¥20\.00.*待退 ¥10\.00/s);
  const phrase = '继续退款单 ' + rf;
  const pending = await h.send(phrase, summary.task.id);
  assert.equal(pending.task?.state, 'AWAITING_CONFIRM', pending.reply);
  assert.equal(pending.preview.refundNo, rf);
  assert.equal((await h.send(phrase, pending.task.id)).task.id, pending.task.id);
  await assert.rejects(h.confirm(pending.task, null), { status: 409 });
  const done = await h.confirm(pending.task);
  assert.equal(done.task.state, 'DONE', done.reply);
  assert.equal((await h.confirm(pending.task)).task.state, 'DONE');
  assert.match((await h.send(phrase)).reply, /已退|已完成/);
  assert.equal(h.writes.length, 1);
});

test('提交响应丢失后以原退款回执恢复，即使已经推进了账款', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const pending = await h.send('执行退款单 ' + rf);
  h.state.lose = true; h.state.hide = true;
  const unknown = await h.confirm(pending.task);
  assert.match(unknown.task.state, /RESULT_UNKNOWN|ESCALATED/);
  assert.equal(h.writes.length, 1);
  h.state.hide = false;
  const recovered = await h.send('继续退款单 ' + rf, pending.task.id);
  assert.equal(recovered.task.state, 'DONE', recovered.reply);
  assert.equal(recovered.result.recoveredViaReceipt, true);
  assert.equal(h.writes.length, 1);
});

test('月结与应收差异指出金额和责任并禁止续办，外单退款被排除', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.drift = true;
  const report = await h.send(question);
  assert.match(report.reply, /差异.*¥5\.00.*财务.*核对/s);
  const blocked = await h.send('继续退款单 ' + rf, report.task.id);
  assert.match(blocked.reply, /差异.*财务/s);
  assert.ok(!blocked.preview);
  const foreign = await h.send('执行退款单 ' + otherRf, report.task.id);
  assert.match(foreign.reply, /原销售单.*关联|不属于.*原销售单/);
  assert.ok(!foreign.preview);
  assert.deepEqual(h.writes, []);
});

test('原退款确认卡复核当前仓库和执行权限，改变任一项都不提交', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const planned = await h.send('执行退款单 ' + rf);
  h.actor.warehouseIds = [12];
  await assert.rejects(h.confirm(planned.task), { status: 403 });
  h.actor.warehouseIds = [11];
  h.actor.permissions.splice(h.actor.permissions.indexOf('refund.order.execute'), 1);
  await assert.rejects(h.confirm(planned.task), { status: 403 });
  assert.deepEqual(h.writes, []);
});

test('补退款单号只恢复已确认原单，跨收款引用不能复用旧卡', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const pending = await h.send('继续给销售单 ' + so + ' 办理退款');
  assert.match(pending.reply, /完整退款单号/);
  const card = await h.send(rf, pending.task.id);
  assert.equal(card.task.state, 'AWAITING_CONFIRM', card.reply);
  const mismatched = await h.send('执行退款单 ' + rf + '，收款单 ' + otherRc, card.task.id);
  assert.match(mismatched.reply, /指定收款单与原销售单的关联/);
  assert.ok(!mismatched.preview);
  assert.equal(h.writes.length, 0);
});

test('退货单有明确来源时可追到原销售，草稿退款须先确认', async () => {
  const h = fixture('preset_sales_manager');
  const fromReturn = await h.send('查退货单 ' + sr + ' 的应收冲减');
  assert.match(fromReturn.reply, new RegExp(so + '[\\s\\S]*' + sr + '[^\\n]*¥25\\.00'));
  assert.equal(fromReturn.result.saleOrderNo, so);
  const finance = fixture('preset_finance_specialist', null, true);
  finance.state.refundStatus = 1;
  const draft = await finance.send('执行退款单 ' + rf);
  assert.match(draft.reply, /草稿.*确认/);
  assert.equal(draft.preview, undefined);
});

test('已完成登记但无原出账凭据时注明缺口，后续退款先停办', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.missingFund = true;
  const report = await h.send(question);
  assert.match(report.reply, /实际出账未核实/);
  assert.doesNotMatch(report.reply, /已出账 ¥20\.00/);
  const more = await h.send('执行退款单 ' + rf);
  assert.match(more.reply, /退款出账与账款有差异.*财务核对/s);
  assert.ok(!more.preview);
  assert.deepEqual(h.writes, []);
});

test('当前仓库不可见原退款时不会把未知出账和待退说成零', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.hiddenRefunds = true;
  const report = await h.send(question);
  assert.match(report.reply, /当前可见范围未找到原退款单.*待核实/);
  assert.doesNotMatch(report.reply, /待退 ¥0\.00/);
  assert.match(report.reply, /账款退款冲回 ¥20\.00/);
});


test('原收款、退款出账与月结行各自报告可核对的两边金额和差额', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.refundInLedger = 22.25;
  h.state.statementBalance = 13.75;
  const report = await h.send(question);
  assert.match(report.reply, /原应收.*净收款分录差异 ¥2\.25.*账面净实收 ¥60\.00.*分录净额 ¥57\.75/);
  assert.match(report.reply, /对账单 SC20261122015.*欠款.*¥13\.75.*原应收.*¥15\.00.*差.*¥1\.25/);
  assert.match(report.reply, /退款出账与应收退款冲回有差异.*出账 ¥20\.00.*退款分录 ¥22\.25.*差.*¥2\.25/);
  assert.match(report.reply, /下一步由财务.*客户往来/s);
  assert.ok(!(await h.send('执行退款单 ' + rf)).preview);
  assert.deepEqual(h.writes, []);
});

test('同单续办边界 过期退款按原销售和原退款恢复最新版确认卡', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const planned = await h.send('准备退款单 ' + rf + ' 出账');
  assert.equal(planned.task?.state, 'AWAITING_CONFIRM', planned.reply);
  h.store.get(planned.task.id).preview.expiresAt = '2000-01-01T00:00:00Z';
  const out = await h.resume(planned.task);
  assert.equal(out.task.id, planned.task.id);
  assert.equal(out.task.revision, planned.task.revision + 1);
  assert.equal(out.preview.refundNo, rf);
  assert.equal(out.preview.saleOrderNo, so);
  await assert.rejects(h.confirm(out.task, planned.task.revision), { status: 409 });
  assert.deepEqual(h.writes, []);
});

test('同单续办边界 同事在原退款单完成后只报告已有出账事实', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const planned = await h.send('准备退款单 ' + rf + ' 出账');
  h.state.refundStatus = 3;
  h.state.balance += 10;
  h.state.paid -= 10;
  const out = await h.resume(planned.task);
  assert.equal(out.task.state, 'DONE', out.reply);
  assert.equal(out.result.recoveredViaReceipt, undefined);
  assert.match(out.reply, /RF20261122016 已退 ¥10\.00.*出账凭据/);
  assert.deepEqual(h.writes, []);
});
