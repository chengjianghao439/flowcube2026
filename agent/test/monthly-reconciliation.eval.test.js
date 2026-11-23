import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { FlowError } from '../src/flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const sc = 'SC20261122024', rc = 'RC20261122061', secondRc = 'RC20261122062', foreignRc = 'RC20261122099';
const a = 'SL20261122011', b = 'SL20261122012';
const lookup = '查月结对账单 ' + sc + ' 的分次收款核销，逐单还欠多少';
const prepare = (amount = '56.23元', receiptNo = rc) => '用收款单 ' + receiptNo + ' 继续核销月结对账单 ' + sc + (amount ? ' ' + amount : '');

function fixture(code, model, { statementNo = sc, receiptNo = rc } = {}) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: code, roleName: role.name, permissions: role.after.slice(), warehouseIds: [11] };
  const has = key => actor.permissions.includes(key);
  const reads = [], writes = [], modelCalls = [];
  const state = { status: 2, drift: 0, oldProjection: false, differentCustomer: false, lose: false, hide: false };
  const items = [
    { recordId: 12, orderId: 112, orderNo: a, totalAmount: 100, paidAmount: 45, balance: 55, type: 2, status: 2,
      sourceOrderNo: a, customerId: 25, settlementType: 2, createdAt: '2026-11-01T08:00:00+08:00' },
    { recordId: 11, orderId: 111, orderNo: b, totalAmount: 80, paidAmount: 10, balance: 70, type: 2, status: 2,
      sourceOrderNo: b, customerId: 25, settlementType: 2, createdAt: '2026-11-02T08:00:00+08:00' },
  ];
  const entries = [
    { entryId: 151, recordId: 12, amount: 20, receiptId: 61, receiptNo: rc, statementId: 24 },
    { entryId: 152, recordId: 12, amount: 10, receiptId: 61, receiptNo: rc, statementId: 24 },
    { entryId: 153, recordId: 12, amount: 15, receiptId: 62, receiptNo: secondRc, statementId: 24 },
    { entryId: 154, recordId: 11, amount: 10, receiptId: 62, receiptNo: secondRc, statementId: 24 },
  ];
  const round = value => Math.round(value * 100) / 100;
  const commandReceipts = new Map();
  const source = {
    61: { receiptNo, amount: 90, partyId: 25 },
    62: { receiptNo: secondRc, amount: 30, partyId: 25 },
    99: { receiptNo: foreignRc, amount: 45, partyId: 26 },
  };
  function receipt(id) {
    const body = source[id];
    const allocations = entries.filter(row => row.receiptId === id);
    const paid = round(allocations.reduce((sum, row) => sum + row.amount, 0));
    return { ...body, type: 2, partyName: '月结合成客户', id, settledAmount: paid, balance: round(body.amount - paid),
      status: paid === body.amount ? 3 : paid ? 2 : 1, settlements: allocations.map(entry => {
        const row = items.find(item => item.recordId === entry.recordId);
        return { ...entry, receiptNo: body.receiptNo, orderId: row.orderId, orderNo: row.orderNo, type: 2, orderPaid: row.paidAmount, orderBalance: row.balance, orderTotal: row.totalAmount };
      }) };
  }
  function statement() {
    const paid = round(items.reduce((sum, row) => sum + row.paidAmount, 0));
    const total = round(items.reduce((sum, row) => sum + row.totalAmount, 0));
    return { id: 24, statementNo, type: 2, partyName: '月结合成客户', totalAmount: total,
      settledAmount: paid, balance: round(total - paid), status: state.status, confirmedAt: state.status === 1 ? null : '2026-11-20',
      items: items.map((row, i) => i === 0 ? { ...row, balance: row.balance - state.drift, customerId: state.differentCustomer ? 26 : 25 } : { ...row }),
      trace: { projection: { totalAmount: total, settledAmount: state.oldProjection ? paid - 1 : paid,
        balance: round(total - paid), status: state.status },
        entries: entries.map(entry => {
          if (!entry.receiptId) return entry;
          const head = receipt(entry.receiptId);
          return { ...entry, receiptNo: head.receiptNo, receiptPartyId: head.partyId, receiptType: 2, receiptAmount: head.amount,
            receiptSettledAmount: head.settledAmount, receiptBalance: head.balance };
        }) } };
  }
  const list = rows => ({ list: rows, pagination: { total: rows.length } });
  const client = { baseUrl: 'http://fixture',
    async get(path) {
      reads.push(path);
      assert.ok(has('payment.view'));
      const url = new URL(path, this.baseUrl);
      if (url.pathname === '/api/payments/statements') return list([statement(), { ...statement(), id: 25, statementNo: statementNo + '0' }]);
      if (url.pathname === '/api/payments/statements/24') {
        assert.equal(url.searchParams.get('trace'), '1');
        return statement();
      }
      if (url.pathname === '/api/payments/receipts') return list([receipt(61), receipt(62), receipt(99)]);
      const id = /^\/api\/payments\/receipts\/(61|62|99)$/.exec(url.pathname)?.[1];
      if (id) return receipt(Number(id));
      throw new Error('未知合成调用 ' + path);
    },
    async post(path, body, { requestKey }) {
      assert.ok(has('payment.execute'));
      assert.equal(path, '/api/payments/receipts/61/settle');
      assert.equal(body.expectedAllocation.statement.id, 24);
      assert.equal(body.expectedAllocation.partyId, 25);
      assert.deepEqual(body.allocations, [{ statementId: 24, amount: body.allocations[0].amount }]);
      assert.ok(!commandReceipts.has(requestKey), '不应重发未知请求');
      writes.push({ path, body, requestKey });
      let left = body.allocations[0].amount;
      const applied = [];
      for (const row of items) {
        const amount = round(Math.min(left, row.balance));
        if (!amount) continue;
        row.paidAmount = round(row.paidAmount + amount);
        row.balance = round(row.balance - amount);
        row.status = row.balance ? 2 : 3;
        entries.push({ entryId: entries.length + 151, recordId: row.recordId, amount, receiptId: 61, receiptNo: rc, statementId: 24 });
        applied.push({ recordId: row.recordId, orderNo: row.orderNo, amount, settled: row.status === 3, statementId: 24 });
        left = round(left - amount);
      }
      const { balance, settledAmount, receiptNo } = receipt(61);
      const result = { id: 61, receiptNo, balance, settledAmount, applied };
      commandReceipts.set(requestKey, { status: 'success', resourceId: 61, resourceType: 'payment_receipt', data: result });
      if (state.lose) throw new FlowError('unknown', 'synthetic lost acknowledgement');
      return result;
    },
    async requestStatus(key, action) {
      assert.equal(action, 'payment.receipt.settle.61');
      return state.hide ? null : commandReceipts.get(key);
    },
  };
  const store = new TaskStore(null);
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { modelCalls.push(text); return model; } } });
  const send = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message, taskId }, actor, client });
  const confirm = (task, revision = task.revision) => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/confirm', body: { revision }, actor, client });
  const resume = task => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/resume', body: {}, actor, client });
  return { actor, has, state, items, entries, reads, writes, modelCalls, send, confirm, resume, store };
}

const samples = {
  '按原对账单列已确认、两笔收款和逐单已核销待收': async h => {
    const out = await h.send(lookup);
    if (!h.has('payment.view')) return assert.match(out.reply, /权限/);
    assert.equal(out.task?.state, 'DONE', out.reply);
    assert.match(out.reply, /已确认.*已核销 ¥55\.00.*还欠 ¥125\.00/s);
    assert.match(out.reply, new RegExp(a + '[^\\n]*¥45\\.00[^\\n]*¥55\\.00'));
    assert.match(out.reply, new RegExp(b + '[^\\n]*¥10\\.00[^\\n]*¥70\\.00'));
    assert.match(out.reply, new RegExp(rc + '[^\\n]*¥30\\.00'));
    assert.match(out.reply, new RegExp(secondRc + '[^\\n]*¥25\\.00'));
  },
  '缺对账单号只问单号并按来源续看': async h => {
    const missing = await h.send('查这张月结对账单的分次核销情况');
    if (!h.has('payment.view')) return assert.match(missing.reply, /权限/);
    assert.match(missing.reply, /完整月结对账单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(sc, missing.task?.id);
    assert.equal(out.task?.state, 'DONE', out.reply);
    assert.equal(out.task.id, missing.task.id);
    assert.match(out.reply, /还欠 ¥125\.00/);
  },
  '已确认对账单用明确原收款继续试算按老账顺序落两单': async h => {
    const out = await h.send(prepare());
    if (!h.has('payment.execute')) return assert.match(out.reply, /权限/);
    assert.equal(out.task?.state, 'AWAITING_CONFIRM', out.reply);
    assert.equal(out.preview.statementNo, sc);
    assert.equal(out.preview.receiptBalanceBeforeCents, 6000);
    assert.equal(out.preview.statementBalanceBeforeCents, 12500);
    assert.equal(out.preview._expectedAllocation, undefined);
    assert.deepEqual(out.preview.allocations.map(row => [row.orderNo, row.amountCents]), [[a, 5500], [b, 123]]);
    assert.match(out.reply, /对账单.*还欠 ¥68\.77.*收款单.*余款 ¥3\.77/s);
  },
  '原收款和对账单已知只追问本次金额': async h => {
    const missing = await h.send(prepare(''));
    if (!h.has('payment.execute')) return assert.match(missing.reply, /权限/);
    assert.match(missing.reply, /本次.*核销金额/);
    assert.equal(missing.task?.state, 'DISAMBIGUATING');
    const out = await h.send('10.12元', missing.task.id);
    assert.equal(out.task?.state, 'AWAITING_CONFIRM', out.reply);
    assert.equal(out.preview.totalCents, 1012);
  },
  '差异显示原单、金额和谁核对且停办': async h => {
    h.state.drift = 5;
    const out = await h.send(lookup);
    if (!h.has('payment.view')) return assert.match(out.reply, /权限/);
    assert.match(out.reply, new RegExp(a + '[^\\n]*差异[^\\n]*¥5\\.00'));
    assert.match(out.reply, /财务.*核对/s);
    const pending = await h.send(prepare(), out.task?.id);
    assert.match(pending.reply, /差异.*财务/s);
    assert.ok(!pending.preview);
  },
};

for (const [name, run] of Object.entries(samples)) for (const code of compared) {
  for (const model of [null, { graph: 'D-receipt', customerKeyword: '另一客户', amountCents: 7890 }]) {
    test(name + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
      const h = fixture(code, model);
      await run(h);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.modelCalls, []);
      if (!h.has('payment.view')) assert.deepEqual(h.reads, []);
    });
  }
}

test('同一原对账单和收款单重复确认仅一次，另一轮按原单另办', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(prepare());
  assert.equal((await h.send(prepare(), pending.task?.id)).task?.id, pending.task?.id);
  await assert.rejects(h.confirm(pending.task, null), { status: 409 });
  const done = await h.confirm(pending.task);
  assert.equal(done.task.state, 'DONE', done.reply);
  assert.equal((await h.confirm(pending.task)).task.state, 'DONE');
  assert.equal(h.writes.length, 1);
  assert.match((await h.send(prepare())).reply, /原回执.*再核一笔/);
  const fresh = await h.send(prepare('2元').replace('继续核销', '再核一笔，核销'));
  assert.equal(fresh.task?.state, 'AWAITING_CONFIRM', fresh.reply);
  assert.equal((await h.confirm(fresh.task)).task.state, 'DONE');
  assert.equal(h.writes.length, 2);
});

test('提交后应答丢失只查询原收款回执，恢复对应的月结预览', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(prepare());
  h.state.lose = true;
  h.state.hide = true;
  const unknown = await h.confirm(pending.task);
  assert.match(unknown.task.state, /ESCALATED|RESULT_UNKNOWN/);
  assert.equal(h.writes.length, 1);
  h.state.hide = false;
  const recovered = await h.send(prepare('2元'), unknown.task.id);
  assert.equal(recovered.task.id, pending.task.id);
  assert.equal(recovered.task.state, 'DONE', recovered.reply);
  assert.equal(recovered.result.recoveredViaReceipt, true);
  assert.equal(h.writes.length, 1);
});

test('未确认、跨客户和抬头账款差异逐项停办', async () => {
  const h = fixture('preset_finance_specialist');
  h.state.status = 1;
  assert.match((await h.send(prepare())).reply, /草稿.*有.*确认权限/s);
  h.state.status = 2;
  assert.match((await h.send(prepare('12元', foreignRc))).reply, /客户归属.*不一致/);
  h.state.oldProjection = true;
  assert.match((await h.send(prepare())).reply, /对账单.*差异.*财务/s);
  assert.equal(h.writes.length, 0);
});

test('已知对账单缺原收款时只问原收款，分辨两张收款单不继承旧金额', async () => {
  const h = fixture('preset_finance_specialist');
  const missing = await h.send('核销月结对账单 ' + sc + ' 10元');
  assert.match(missing.reply, /一张完整原收款单号/);
  const plan = await h.send(rc, missing.task.id);
  assert.equal(plan.task?.state, 'AWAITING_CONFIRM', plan.reply);
  const ambiguous = await h.send('继续核销月结对账单 ' + sc + '，收款单 ' + rc + ' 或 ' + secondRc);
  assert.match(ambiguous.reply, /一张完整原收款单号/);
  const onlyAmount = await h.send(secondRc, ambiguous.task.id);
  assert.match(onlyAmount.reply, /本次.*核销金额/);
  assert.equal(h.writes.length, 0);
});

test('带待核条件时提示财务先核实，指定一张销售单时说明原老账顺序', async () => {
  const h = fixture('preset_finance_specialist');
  const hold = await h.send('如果银行到账再' + prepare());
  assert.match(hold.reply, /财务核实条件/);
  assert.ok(!hold.preview);
  const restricted = await h.send(prepare().replace('56.23元', '只给 ' + b + ' 56.23元'));
  assert.match(restricted.reply, /老账顺序.*金额/);
  assert.ok(!restricted.preview);
  const ready = await h.send('金额为 10.12元', restricted.task.id);
  assert.equal(ready.preview?.allocations[0].orderNo, a, ready.reply);
  assert.deepEqual(h.writes, []);
});

test('退款负向分录计入应收净额，保留原收款核销凭据', async () => {
  const h = fixture('preset_finance_specialist');
  h.items[0].paidAmount -= 5;
  h.items[0].balance += 5;
  h.entries.push({ entryId: 180, recordId: 12, amount: -5, method: 'refund' });
  const out = await h.send(lookup);
  assert.match(out.reply, /已核销 ¥50\.00.*还欠 ¥130\.00/s);
  assert.match(out.reply, /退款已冲回 ¥5\.00/);
  assert.match(out.reply, new RegExp(rc + ' 已对本对账单核销 ¥30\\.00'));
  assert.equal(out.result.hasDifferences, false);
});

test('旧版本、原明细变化和执行权撤回都不能发送资金请求', async () => {
  const h = fixture('preset_finance_specialist');
  const planned = await h.send(prepare());
  h.actor.permissions = h.actor.permissions.filter(code => code !== 'payment.execute');
  await assert.rejects(h.confirm(planned.task), { status: 403 });
  assert.match((await h.send(lookup)).reply, /还欠 ¥125\.00/);
  h.actor.permissions.push('payment.execute');
  h.state.drift = 1;
  assert.equal((await h.confirm(planned.task)).task.state, 'EXPIRED');
  assert.deepEqual(h.writes, []);
});

test('对账明细超过列表一页也按全量成员核对', async () => {
  const h = fixture('preset_finance_specialist');
  for (let i = 0; i < 201; i++) {
    const no = 'SL20261123' + String(i).padStart(3, '0');
    h.items.push({ recordId: i + 500, orderId: i + 800, orderNo: no, sourceOrderNo: no, type: 2, settlementType: 2,
      totalAmount: 1, balance: 1, paidAmount: 0, customerId: 25, status: 1, createdAt: '2026-11-03T08:00:00+08:00' });
  }
  const out = await h.send(prepare('1元'));
  assert.equal(out.task?.state, 'AWAITING_CONFIRM', out.reply);
  assert.deepEqual(out.preview.allocations.map(row => row.orderNo), [a]);
  await h.confirm(out.task);
  assert.equal(h.writes[0].body.expectedAllocation.targets.length, 203);
});

test('自定义前缀按单据类型定位，保留原编号大小写，盘点单号不进入月结', async () => {
  const statementNo = 'Yd20261122024', receiptNo = 'Hk20261122061';
  const h = fixture('preset_finance_specialist', null, { statementNo, receiptNo });
  h.items[0].orderNo = a.toLowerCase();
  h.items[0].sourceOrderNo = a.toLowerCase();
  const read = await h.send('查月结对账单 ' + statementNo);
  assert.equal(read.result?.statementNo, statementNo, read.reply);
  const next = await h.send('用收款单 ' + receiptNo + ' 继续核销 10元', read.task.id);
  assert.equal(next.preview?.receiptNo, receiptNo, next.reply);
  assert.equal(next.preview.allocations[0].orderNo, a.toLowerCase());
  const done = await h.confirm(next.task);
  assert.equal(done.task.state, 'DONE', done.reply);
  const count = h.reads.length;
  const inventory = await h.send('查盘点单 ' + sc + ' 的进度');
  assert.notEqual(inventory.task?.graph, 'M-monthly-reconciliation');
  assert.ok(!h.reads.slice(count).some(path => path.includes('/payments/statements')));
});

test('同单续办边界 月结核销过期保留原对账单顺序、原收款和金额', async () => {
  const h = fixture('preset_finance_specialist');
  const previous = await h.send(prepare());
  const task = h.store.get(previous.task.id);
  task.preview.expiresAt = '2000-01-01T00:00:00Z';
  const out = await h.resume(task);
  assert.equal(out.task.id, task.id);
  assert.equal(out.task.revision, previous.task.revision + 1);
  assert.equal(out.preview.receiptNo, rc);
  assert.equal(out.preview.statementNo, sc);
  assert.deepEqual(out.preview.allocations, previous.preview.allocations);
  assert.deepEqual(h.writes, []);
});

test('撤回续办边界 月结对账和收款的同源负向核销可对平，按当前欠款和原收款余额试算', async () => {
  const h = fixture('preset_finance_specialist');
  h.entries.push({ entryId: 155, recordId: 12, amount: -4, receiptId: 61, receiptNo: rc, statementId: 24 });
  h.items[0].paidAmount -= 4;
  h.items[0].balance += 4;
  const read = await h.send(lookup);
  assert.match(read.reply, /净核销 ¥26\.00.*冲回 ¥4\.00/);
  assert.match(read.reply, /还欠 ¥129\.00/);
  assert.equal(read.result.hasDifferences, false);
  const fresh = await h.send(prepare('4元'), read.task.id);
  assert.equal(fresh.task.state, 'AWAITING_CONFIRM', fresh.reply);
  assert.equal(fresh.preview.statementNo, sc);
  assert.equal(fresh.preview.receiptNo, rc);
  assert.equal(fresh.preview.allocations[0].balanceBeforeCents, 5900);
  assert.deepEqual(h.writes, []);
});

test('多轮撤回边界 月结按原收款和销售单逐次展示同源冲回', async () => {
  const h = fixture('preset_finance_specialist');
  h.entries.push({ entryId: 155, recordId: 12, amount: -3, receiptId: 61, receiptNo: rc, statementId: 24 },
    { entryId: 156, recordId: 12, amount: -2, receiptId: 61, receiptNo: rc, statementId: 24 },
    { entryId: 157, recordId: 12, amount: 1, receiptId: 61, receiptNo: rc, statementId: 24 });
  h.items[0].paidAmount -= 4;
  h.items[0].balance += 4;
  const out = await h.send(lookup);
  assert.equal(out.result.hasDifferences, false);
  assert.match(out.reply, /第 1 笔冲回 ¥3\.00.*第 2 笔冲回 ¥2\.00.*第 3 笔核销 ¥1\.00/s);
  assert.equal(out.result.balance, 129);
  assert.deepEqual(h.writes, []);
});
