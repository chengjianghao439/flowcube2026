import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { FlowError } from '../src/flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const so = 'SL20260920001', sr = 'SR20261002002', rc = 'RC20260928004', sc = 'SC20261002005', rf = 'RF20261009006', bf = 'BF-20261122-0007';
const otherBf = 'BF-20261122-0008';
const question = '核对销售单 ' + so + ' 跨月退货、退款和补录分别记哪一期';
const apply = '为退款单 ' + rf + ' 申请跨期补录，原因：银行回单迟到';
const checklist = ['finance.period.backfill', 'finance.period.backfill.approve', 'refund.order.view', 'refund.order.execute', 'accounting.voucher.view'];
function fixture(code, model, elevated = false) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: code, roleName: role.name, permissions: role.after.slice(), warehouseIds: [11] };
  if (elevated) actor.permissions.push(...checklist, 'return.order.view');
  const has = key => actor.permissions.includes(key);
  const reads = [], writes = [], modelCalls = [];
  const state = { phase: null, applicantId: actor.id + 2000, lose: false, hide: false, advance: false, closed: true, expectedReceipt: null };
  const origin = { id: 61, refundNo: rf, saleOrderId: 31, saleOrderNo: so, amount: 10, accountId: 71, refundDate: '2026-09-30', paymentRecordId: 21,
    get status() { return state.phase === 'posted' || state.phase === 'voucher' ? 3 : 2; },
    get trace() { return { warehouseIds: [11], effectiveDate: '2026-09-30', businessPeriod: '202609', periodClosed: state.closed,
      outgoing: this.status === 3 ? [10] : [], fundTransactions: this.status === 3 ? [{ id: 99, businessDate: '2026-09-30', postingDate: '2026-11-22', backfillId: 7 }] : [] }; },
  };
  const app = (id = 7) => ({ id, applicationNo: id === 7 ? bf : otherBf, bizId: id === 7 ? 61 : 62, bizNo: id === 7 ? rf : 'RF20261009007',
    bizType: 'refund', period: '202609', businessDate: '2026-09-30', amount: 10, applicantId: state.applicantId,
    status: state.phase === 'pending' ? 0 : state.phase === 'rejected' ? 2 : 1,
    approvedAt: state.phase === 'pending' ? null : '2026-11-22', approvalPeriodClosed: Boolean(state.approvalPeriodClosed), postingPeriod: ['posted', 'voucher'].includes(state.phase) ? '202611' : null,
    executedAt: ['posted', 'voucher'].includes(state.phase) ? '2026-11-22' : null,
    executedBizId: ['posted', 'voucher'].includes(state.phase) ? 61 : null,
    voucherPending: state.phase === 'voucher', voucherGeneratedAt: state.phase === 'posted' ? '2026-11-22' : null,
    requestSnapshot: { orderId: id === 7 ? 61 : 62, body: { saleOrderNo: id === 7 ? so : 'SL20260920009' } } });
  const order = () => ({ id: 21, orderId: 31, orderNo: so, type: 2, settlementType: 2, totalAmount: 70, paidAmount: origin.status === 3 ? 20 : 30,
    balance: origin.status === 3 ? 50 : 40, status: 2 });
  const entries = () => [{ id: 201, recordId: 21, receiptId: 41, receiptNo: rc, statementId: 51, method: 'bank', amount: 30 },
    ...(origin.status === 3 ? [{ id: 202, recordId: 21, method: 'refund', amount: -10 }] : [])];
  const statement = () => ({ id: 51, statementNo: sc, type: 2, status: 2, periodStart: '2026-09-01', periodEnd: '2026-09-30',
    totalAmount: 70, settledAmount: order().paidAmount, balance: order().balance,
    items: [{ ...order(), recordId: 21, sourceOrderNo: so, customerId: 25 }],
    trace: { projection: { totalAmount: 70, settledAmount: order().paidAmount, balance: order().balance, status: 2 },
      entries: entries().map(row => ({ ...row, entryId: row.id, receiptType: 2, receiptPartyId: 25, receiptAmount: 40, receiptSettledAmount: 30, receiptBalance: 10 })) } });
  const receipt = { id: 41, receiptNo: rc, type: 2, amount: 40, settledAmount: 30, balance: 10, partyId: 25,
    paymentDate: '2026-09-28', settlements: [{ entryId: 201, orderId: 31, orderNo: so, type: 2, recordId: 21, statementId: 51, amount: 30 }] };
  const ret = { id: 81, returnNo: sr, saleOrderId: 31, saleOrderNo: so, warehouseId: 11, status: 3, items: [{ productId: 90, productName: '铰链', unit: '个', quantity: 1 }],
    totalAmount: 25, executedAmount: 25, executedAt: '2026-10-02', postingBasisDate: '2026-10-02' };
  const list = rows => ({ list: rows, pagination: { total: rows.length } });
  const client = { baseUrl: 'http://synthetic',
    async get(path) {
      reads.push(path);
      const url = new URL(path, this.baseUrl), p = url.pathname;
      if (p.startsWith('/api/returns')) {
        assert.ok(has('return.order.view'));
        if (p === '/api/returns/sale') return list([ret]);
        if (p === '/api/returns/sale/81') return ret;
      }
      if (p.startsWith('/api/payments')) {
        assert.ok(has('payment.view'));
        if (p === '/api/payments/') return list([order()]);
        if (p === '/api/payments/21/entries') return entries();
        if (p === '/api/payments/receipts/41') return receipt;
        if (p === '/api/payments/statements') return list([statement()]);
        if (p === '/api/payments/statements/51') return statement();
      }
      if (p === '/api/sale/') return list([{ id: 31, orderNo: so }]);
      if (p.startsWith('/api/refunds')) {
        assert.ok(has('refund.order.view'));
        if (p === '/api/refunds') return list([origin]);
        if (p === '/api/refunds/61') return origin;
      }
      if (p === '/api/accounting/vouchers') {
        assert.ok(has('accounting.voucher.view'));
        const type = url.searchParams.get('sourceType');
        return list(type === 'sale_revenue' ? [{ id: 90, sourceType: type, sourceId: 31, sourceNo: so, status: 2, isReversal: 0, period: '202609' }]
          : type === 'sale_return' ? [{ id: 91, sourceType: type, sourceId: 81, sourceNo: sr, status: 2, isReversal: 0, period: '202610' }] : []);
      }
      if (p.startsWith('/api/accounting/backfills')) {
        assert.ok(has('finance.period.backfill') || has('finance.period.backfill.approve'));
        if (state.hide) throw new FlowError('network', 'synthetic unavailable');
        if (p === '/api/accounting/backfills') {
          if (url.searchParams.get('requestKey') && url.searchParams.get('requestKey') !== state.expectedReceipt) return list([]);
          if (url.searchParams.get('applicationNo') === otherBf) return list([app(8)]);
          return list(state.phase ? [app()] : []);
        }
        if (p.endsWith('/7')) return app();
        if (p.endsWith('/8')) return app(8);
      }
      throw new Error('未知合成接口 ' + path);
    },
    async post(path, body, { requestKey } = {}) {
      writes.push({ path, body, requestKey });
      if (path === '/api/refunds/61/execute') {
        assert.ok(has('finance.period.backfill'));
        assert.equal(body.backfillRequest, true);
        assert.equal(body.backfillReason, '银行回单迟到');
        assert.ok(requestKey);
        assert.equal(state.phase, null);
        state.phase = 'pending';
        state.applicantId = actor.id;
        state.expectedReceipt = requestKey;
        if (state.lose) { state.hide = true; throw new FlowError('unknown', 'answer lost'); }
        return { id: 7, applicationNo: bf, period: '202609', businessDate: '2026-09-30' };
      }
      const action = path.split('/').at(-1);
      assert.match(path, /^\/api\/accounting\/backfills\/7\/(approve|execute|regenerate-voucher)$/);
      assert.ok(has('finance.period.backfill.approve'));
      if (action === 'approve') assert.notEqual(state.applicantId, actor.id);
      state.phase = 'posted';
      if (state.lose) { state.hide = true; throw new FlowError('unknown', 'answer lost'); }
      return { id: 7, applicationNo: bf, executed: true, postingPeriod: '202611', application: app() };
    }
  };
  const runtime = createAgentRuntime({ store: new TaskStore(null), messageOptions: { parseIntent: async text => { modelCalls.push(text); return model; } } });
  const send = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message, taskId }, actor, client });
  const confirm = (task, revision = task.revision) => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/confirm', body: { revision }, actor, client });
  return { actor, has, reads, writes, modelCalls, state, send, confirm };
}
const cases = {
  '跨月原销售问句按实际权限分别解释冲减和收款期间': async h => {
    const out = await h.send(question);
    if (!h.has('payment.view') && !h.has('return.order.view')) return assert.match(out.reply, /权限/);
    assert.equal(out.task?.graph, 'Q-cross-period', out.reply);
    if (h.has('return.order.view')) assert.match(out.reply, new RegExp(sr + '[^\\n]*2026年10月.*冲减'));
    if (h.has('payment.view')) {
      assert.match(out.reply, new RegExp(rc + '[^\\n]*2026年9月'));
      assert.match(out.reply, new RegExp(sc + '[^\\n]*对账区间.*2026-09-01'));
    }
    assert.doesNotMatch(out.reply, /已批准·已记账/);
  },
  '缺销售单号只问原销售单号，补号保留多轮': async h => {
    const open = await h.send('查这张销售单跨月退货和退款该记哪一期');
    if (!h.has('payment.view') && !h.has('return.order.view')) return assert.match(open.reply, /权限/);
    assert.match(open.reply, /完整销售单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(so, open.task.id);
    assert.equal(out.task?.graph, 'Q-cross-period', out.reply);
    assert.equal(out.task.id, open.task.id);
  },
  '跟进补录没有查看权限则不调补录接口': async h => {
    const out = await h.send('查跨期补录申请 ' + bf + ' 卡在哪一步');
    assert.match(out.reply, /补录.*权限|权限.*补录/);
    assert.equal(h.reads.length, 0);
  },
  '请求在闭期补录没有权限时不出卡': async h => {
    const out = await h.send(apply);
    assert.match(out.reply, /补录.*权限|权限.*补录/);
    assert.equal(out.preview, undefined);
  },
  '口头批准既有补录没有审批权限时不出卡': async h => {
    const out = await h.send('批准补录申请 ' + bf);
    assert.match(out.reply, /补录.*权限|权限.*补录/);
    assert.equal(out.preview, undefined);
  },
};
for (const [name, run] of Object.entries(cases)) for (const code of compared) {
  for (const model of [null, { graph: 'D-receipt', amountCents: 4000, customerKeyword: '其他客户' }]) {
    test(name + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
      const h = fixture(code, model);
      await run(h);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.modelCalls, []);
    });
  }
}
test('有权提交闭期退款申请只创建待审批，未知响应按原键恢复', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const pending = await h.send(apply);
  assert.equal(pending.task?.state, 'AWAITING_CONFIRM', pending.reply);
  await assert.rejects(h.confirm(pending.task, null), { status: 409 });
  h.state.lose = true;
  const unknown = await h.confirm(pending.task);
  assert.match(unknown.task.state, /RESULT_UNKNOWN|ESCALATED/);
  h.state.hide = false;
  const recovered = await h.send(apply, unknown.task.id);
  assert.equal(recovered.task.state, 'DONE', recovered.reply);
  assert.match(recovered.reply, /待审批/);
  assert.equal(h.writes.length, 1);
});
test('批准须他人，已批准待执行和已记账待凭证分开说明', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.phase = 'pending';
  h.state.applicantId = h.actor.id;
  assert.match((await h.send('批准补录申请 ' + bf)).reply, /本人|自己|他人/);
  h.state.applicantId++;
  h.state.phase = 'voucher';
  const out = await h.send('查跨期补录申请 ' + bf);
  assert.match(out.reply, /已记账.*凭证待生成/s);
  h.state.phase = 'approved';
  const todo = await h.send('查跨期补录申请 ' + bf);
  assert.match(todo.reply, /已批准.*待执行.*2026年11月/s);
  const preview = await h.send('重试执行补录申请 ' + bf, todo.task.id);
  assert.equal(preview.task?.state, 'AWAITING_CONFIRM', preview.reply);
  assert.equal((await h.confirm(preview.task)).task.state, 'DONE');
  assert.equal(h.writes.length, 1);
});
test('指定核对的销售退款与补录必须同源，不串到另一张已批准申请', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.phase = 'approved';
  const look = await h.send(question);
  const wrong = await h.send('重试执行补录申请 ' + otherBf, look.task?.id);
  assert.match(wrong.reply, /原销售单.*关联|不属于.*原销售单/);
  assert.equal(wrong.preview, undefined);
  assert.deepEqual(h.writes, []);
});
test('缺补录原因只问原因，转述和口头确认不创建申请', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const request = '为退款单 ' + rf + ' 申请跨期补录';
  const needed = await h.send(request);
  assert.match(needed.reply, /原因/);
  assert.doesNotMatch(needed.reply, /完整退款单号/);
  const card = await h.send('原因是银行回单迟到', needed.task.id);
  assert.equal(card.preview.refundNo, rf);
  assert.equal((await h.send(apply, card.task.id)).task.id, card.task.id);
  assert.ok(!(await h.send('客户转发原话：' + apply)).preview);
  assert.match((await h.send('确认跨期补录', card.task.id)).reply, /点击确认/);
  assert.deepEqual(h.writes, []);
});
test('原审批月份已结账或原申请已执行时不再发预览', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.phase = 'approved';
  h.state.approvalPeriodClosed = true;
  const retry = '重试执行补录申请 ' + bf;
  const held = await h.send(retry);
  assert.match(held.reply, /已批准，待执行.*原审批期间已结账.*财务负责人/s);
  assert.ok(!held.preview);
  h.state.approvalPeriodClosed = false;
  const preview = await h.send(retry);
  h.state.phase = 'posted';
  const old = await h.confirm(preview.task);
  assert.equal(old.task.state, 'EXPIRED');
  assert.match((await h.send(retry)).reply, /已记账.*凭证已生成/);
  assert.deepEqual(h.writes, []);
});
test('预览后无执行权限、原业务期间重开或原申请换阶段时停下', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const prep = await h.send(apply);
  h.state.closed = false;
  assert.equal((await h.confirm(prep.task)).task.state, 'EXPIRED');
  h.state.closed = true;
  const current = await h.send(apply);
  h.actor.permissions = h.actor.permissions.filter(code => code !== 'finance.period.backfill');
  await assert.rejects(h.confirm(current.task), { status: 403 });
  assert.deepEqual(h.writes, []);
});
test('历史补录可以按原申请号续办，显式换单单独核对', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  h.state.phase = 'approved';
  const preview = await h.send('重试执行补录申请 ' + bf);
  const resumed = await h.send('继续刚才的补录申请 ' + bf);
  assert.equal(resumed.task?.id, preview.task.id, resumed.reply);
  const foreign = await h.send('换个话题，查跨期补录申请 ' + otherBf, resumed.task.id);
  assert.match(foreign.reply, new RegExp(otherBf));
  assert.doesNotMatch(foreign.reply, new RegExp(bf));
  assert.deepEqual(h.writes, []);
});
test('按口语冲减月份查询或用完整申请号授权续办', async () => {
  const h = fixture('preset_finance_specialist', null, true);
  const original = await h.send('销售单 ' + so + ' 的退货冲减在哪一期');
  assert.equal(original.task?.graph, 'Q-cross-period', original.reply);
  assert.match(original.reply, /2026年10月.*应收冲减/);
  h.state.phase = 'pending';
  const status = await h.send(bf);
  assert.match(status.reply, /待审批/);
  const approve = await h.send('批准 ' + bf);
  assert.equal(approve.preview.applicationNo, bf);
  assert.deepEqual(h.writes, []);
});
