import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { FlowError } from '../src/flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const rc = 'RC20261122061', a = 'SL20261122011', b = 'SL20261122012', foreign = 'SL20261122099';
const question = '查收款单 ' + rc + ' 的分次核销和预收余款';
const preparation = '继续核销收款单 ' + rc + '，' + a + ' 10.01元，' + b + ' 20.02元';

function fixture(code, model) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: code, roleName: role.name, permissions: role.after.slice(), warehouseIds: [11] };
  const store = new TaskStore(null);
  const has = key => actor.permissions.includes(key);
  const reads = [], writes = [], plans = [];
  const context = { partyId: 25, hiddenReceipt: false, oldNonCent: false, omitEntries: false, loseResponse: false, hideReceipt: false, refunds: [] };
  const records = [
    { id: 11, orderId: 111, orderNo: a, type: 2, totalAmount: 100, paidAmount: 55, balance: 45, status: 2, settlementType: 1 },
    { id: 12, orderId: 112, orderNo: b, type: 2, totalAmount: 80, paidAmount: 25, balance: 55, status: 2, settlementType: 1 },
  ];
  const entries = [{ entryId: 51, recordId: 11, amount: 20 }, { entryId: 52, recordId: 12, amount: 15 }, { entryId: 53, recordId: 11, amount: 5 }];
  const money = n => Math.round(n * 100) / 100;
  const current = () => {
    const settledAmount = money(entries.reduce((n, e) => n + e.amount, 0));
    return { id: 61, receiptNo: rc, type: 2, partyId: context.partyId, partyName: '合成客户', amount: context.oldNonCent ? 150.0001 : 150,
      paymentDate: '2026-11-22', reversalBatches: context.reversalBatches, status: settledAmount === 150 ? 3 : 2, settledAmount,
      balance: context.oldNonCent ? Number((150.0001 - settledAmount).toFixed(4)) : money(150 - settledAmount),
      ...(context.omitEntries ? {} : { settlements: entries.map(entry => {
        const row = records.find(record => record.id === entry.recordId);
        return { ...entry, orderId: row.orderId, orderNo: row.orderNo, type: row.type, orderTotal: row.totalAmount,
          orderPaid: row.paidAmount, orderBalance: row.balance, orderStatus: row.status };
      }) }) };
  };
  const list = rows => ({ list: rows, pagination: { total: rows.length } });
  const receipts = new Map();
  const client = { baseUrl: 'http://fixture',
    async get(path) {
      const url = new URL(path, this.baseUrl), p = url.pathname;
      reads.push(path);
      assert.ok(has('payment.view'), '无权限时不得调财务接口');
      if (p === '/api/payments/receipts') return list(context.hiddenReceipt ? [] : [current(), { ...current(), id: 71, receiptNo: rc + '0' }]);
      if (p === '/api/payments/receipts/61') return current();
      const recordId = /^\/api\/payments\/(\d+)\/entries$/.exec(p)?.[1];
      if (recordId) return [...entries.filter(row => row.recordId === Number(recordId)).map(row =>
        ({ ...row, id: row.entryId, receiptId: 61, receiptNo: rc })), ...context.refunds.filter(row => row.recordId === Number(recordId))];
      if (p === '/api/payments/') {
        if (url.searchParams.get('partyId') !== '25') throw new Error('需按原客户 ID 约束');
        const no = url.searchParams.get('orderNo');
        return list(records.filter(row => !no || row.orderNo === no));
      }
      throw new Error('未知合成调用 ' + p);
    },
    async post(path, body, { requestKey }) {
      assert.ok(has('payment.execute'));
      assert.equal(path, '/api/payments/receipts/61/settle');
      if (receipts.has(requestKey)) throw new Error('不应重复发送写请求');
      assert.equal(body.expectedAllocation.partyId, 25);
      writes.push({ path, body, requestKey });
      const applied = body.allocations.map(({ recordId, amount }) => {
        const row = records.find(item => item.id === recordId);
        row.balance = money(row.balance - amount);
        row.paidAmount = money(row.paidAmount + amount);
        row.status = row.balance > 0 ? 2 : 3;
        const entryId = entries.reduce((max, entry) => Math.max(max, entry.entryId), 50) + 1;
        entries.push({ entryId, recordId, amount });
        return { entryId, recordId, amount, orderNo: row.orderNo, settled: row.status === 3 };
      });
      const { balance, settledAmount } = current();
      const result = { id: 61, receiptNo: rc, balance, settledAmount, applied };
      receipts.set(requestKey, { status: 'success', resourceId: 61, resourceType: 'payment_receipt', data: result });
      if (context.loseResponse) throw new FlowError('unknown', 'lost response');
      return result;
    },
    async requestStatus(key, action) {
      assert.equal(action, 'payment.receipt.settle.61');
      return context.hideReceipt ? null : receipts.get(key);
    },
  };
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { plans.push(text); return model; } } });
  const send = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message, taskId }, actor, client });
  const confirm = (task, revision = task.revision) => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/confirm', body: { revision }, actor, client });
  const resume = task => runtime.dispatch({ method: 'POST', pathname: '/tasks/' + task.id + '/resume', body: {}, actor, client });
  return { actor, store, context, records, entries, reads, writes, plans, has, send, confirm, resume };
}

const cases = {
  '一张收款单的分次分录按销售原单累计，余款分开': async h => {
    const out = await h.send(question);
    if (!h.has('payment.view')) return assert.match(out.reply, /权限/);
    assert.equal(out.task?.graph, 'J-receipt-status', out.reply);
    assert.match(out.reply, /已核销 ¥40\.00.*预收余款 ¥110\.00/s);
    assert.match(out.reply, /SL20261122011[^\n]*本收款单已核销 ¥25\.00[^\n]*当前欠款 ¥45\.00/);
    assert.match(out.reply, /SL20261122012[^\n]*本收款单已核销 ¥15\.00[^\n]*当前欠款 ¥55\.00/);
    assert.match(out.reply, /归属.*合成客户|合成客户.*具体销售单.*待分配/s);
  },
  '收款号缺失只问编号，下一轮可补': async h => {
    const missing = await h.send('查这张收款单的分次核销和预收余款');
    if (!h.has('payment.view')) return assert.match(missing.reply, /权限/);
    assert.equal(missing.task?.state, 'DISAMBIGUATING', missing.reply);
    assert.match(missing.reply, /完整收款单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(rc, missing.task.id);
    assert.equal(out.task.id, missing.task.id);
    assert.match(out.reply, /SL20261122011.*当前欠款/s);
  },
  '明确逐单金额时原收款可继续试算': async h => {
    const out = await h.send(preparation);
    if (!h.has('payment.execute')) return assert.match(out.reply, /权限/);
    assert.equal(out.task?.graph, 'D-settle', out.reply);
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.equal(out.preview.receiptNo, rc);
    assert.equal(out.preview.receiptBalanceBeforeCents, 11000);
    assert.equal(out.preview.statementBalanceBeforeCents, undefined);
    assert.equal(out.preview._expectedAllocation, undefined);
    assert.deepEqual(out.preview.allocations.map(row => [row.orderNo, row.amountCents]), [[a, 1001], [b, 2002]]);
    assert.match(out.reply, /预收余款 ¥79\.97/);
  },
  '已知一张目标单缺金额时只问金额': async h => {
    const out = await h.send('继续核销收款单 ' + rc + ' 给 ' + a);
    if (!h.has('payment.execute')) return assert.match(out.reply, /权限/);
    assert.equal(out.task?.state, 'DISAMBIGUATING', out.reply);
    assert.match(out.reply, /SL20261122011.*核销金额/);
    const next = await h.send('12.34元', out.task.id);
    assert.equal(next.task?.state, 'AWAITING_CONFIRM', next.reply);
    assert.equal(next.preview.allocations[0].amountCents, 1234);
  },
  '已登记者口头继续只问目标，跨客户销售单不得分配': async h => {
    const out = await h.send(question);
    if (!h.has('payment.view')) return assert.match(out.reply, /权限/);
    const next = await h.send('接着核销', out.task.id);
    assert.match(next.reply, /完整销售单号.*金额/);
    const other = await h.send(foreign + ' 10元', next.task?.id);
    assert.match(other.reply, /本收款客户.*(?:未能核实|核不到|未找到)|无权/s);
    assert.equal(other.preview, undefined);
  },
};

for (const [name, run] of Object.entries(cases)) for (const code of compared) {
  for (const model of [null, { graph: 'D-receipt', customerKeyword: '别的客户', amountCents: 9988 }]) {
    test(name + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
      const h = fixture(code, model);
      await run(h);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.plans, []);
      if (!h.has('payment.view')) assert.deepEqual(h.reads, []);
    });
  }
}

test('同组重说和重复确认复用原任务，另核一笔须明确声明', async () => {
  const h = fixture('preset_finance_specialist');
  const one = await h.send(preparation);
  const again = await h.send(preparation, one.task.id);
  assert.equal(again.task.id, one.task.id);
  assert.match((await h.send('确认核销收款单 ' + rc)).reply, /点击确认核销/);
  assert.deepEqual(h.writes, []);
  await assert.rejects(h.confirm(one.task, null), { status: 409 });
  const done = await h.confirm(one.task);
  assert.equal(done.task.state, 'DONE', done.reply);
  assert.equal((await h.confirm(one.task)).task.id, one.task.id);
  const replay = await h.send(preparation);
  assert.match(replay.reply, /原回执.*再核一笔/);
  const second = await h.send('再核一笔：收款单 ' + rc + '，' + a + ' 10.01元，' + b + ' 20.02元');
  assert.notEqual(second.task.id, one.task.id);
  assert.equal(second.task.state, 'AWAITING_CONFIRM');
  const finished = await h.confirm(second.task);
  assert.equal(finished.task.state, 'DONE', finished.reply);
  assert.equal(h.writes.length, 2);
});

test('上笔提交应答丢失时先查原回执，即使后来另一人又核销', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(preparation);
  h.context.loseResponse = true;
  h.context.hideReceipt = true;
  const unknown = await h.confirm(pending.task);
  assert.match(unknown.task.state, /ESCALATED|RESULT_UNKNOWN/);
  h.entries.push({ entryId: 99, recordId: 11, amount: 1 });
  h.records[0].balance -= 1;
  h.records[0].paidAmount += 1;
  h.context.hideReceipt = false;
  const recovered = await h.send('再核一笔：收款单 ' + rc + '，' + a + ' 1元', unknown.task.id);
  assert.equal(recovered.task.id, pending.task.id);
  assert.equal(recovered.task.state, 'DONE', recovered.reply);
  assert.equal(recovered.result.recoveredViaReceipt, true);
  assert.equal(h.writes.length, 1);
});

test('预收余款未绑定客户时只报告待核对，核销缺少归属不出卡', async () => {
  const h = fixture('preset_finance_specialist');
  h.context.partyId = null;
  assert.match((await h.send(question)).reply, /客户归属尚待核对/);
  const outcome = await h.send(preparation);
  assert.match(outcome.reply, /客户归属尚未核实/);
  assert.equal(outcome.preview, undefined);
  assert.deepEqual(h.writes, []);
});

test('历史原值保留四位，缺分录或有非分余额时均不出卡', async () => {
  const h = fixture('preset_finance_specialist');
  h.context.oldNonCent = true;
  assert.match((await h.send(question)).reply, /预收余款 ¥110\.0001/);
  assert.match((await h.send(preparation)).reply, /历史非分金额/);
  h.context.oldNonCent = false;
  h.context.omitEntries = true;
  assert.match((await h.send(question)).reply, /销售单关联尚待核对/);
  assert.match((await h.send(preparation)).reply, /核销分录与已核销总额未能对平/);
  assert.deepEqual(h.writes, []);
});

test('两张收款单待选择时保留明确的逐单指令，只问收款单号', async () => {
  const h = fixture('preset_finance_specialist');
  const another = 'RC20261122062';
  const missing = await h.send('继续核销收款单 ' + rc + ' 或 ' + another + '，' + a + ' 9元');
  assert.match(missing.reply, /选择一张.*完整收款单号/);
  assert.deepEqual(h.reads, []);
  const next = await h.send(rc, missing.task.id);
  assert.equal(next.task?.state, 'AWAITING_CONFIRM', next.reply);
  assert.equal(next.preview.allocations[0].amountCents, 900);
  assert.deepEqual(h.writes, []);
});

test('续办重新核对授权，失去执行权时仍可读原收款单', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(preparation);
  h.actor.permissions = h.actor.permissions.filter(code => code !== 'payment.execute');
  await assert.rejects(h.confirm(pending.task), { status: 403 });
  assert.match((await h.send(question)).reply, /预收余款 ¥110\.00/);
  assert.match((await h.send(preparation)).reply, /没有核销办理权限/);
  assert.deepEqual(h.writes, []);
});

test('带续办上下文的停止指令和金额歧义都不出新核销卡', async () => {
  const h = fixture('preset_finance_specialist');
  const read = await h.send(question);
  const held = await h.send('不要继续核销收款单 ' + rc + '，' + a + ' 10元', read.task.id);
  assert.equal(held.preview, undefined);
  for (const amount of ['0.001元', '0元', '10元或20元']) {
    const ambiguous = await h.send('继续核销收款单 ' + rc + '，' + a + ' ' + amount, read.task.id);
    assert.match(ambiguous.reply, /准确.*金额/);
    assert.equal(ambiguous.preview, undefined);
  }
  assert.deepEqual(h.writes, []);
});

test('补其中一单金额时保留已说清的另一单，直接指定销售单也能试算', async () => {
  const h = fixture('preset_finance_specialist');
  const missing = await h.send('继续核销收款单 ' + rc + '，销售单 ' + a + '，销售单 ' + b + ' 核销 20.02 元');
  assert.match(missing.reply, new RegExp(a + '.*准确核销金额'));
  const completed = await h.send(a + ' 10.01元', missing.task.id);
  assert.deepEqual(completed.preview.allocations.map(row => [row.orderNo, row.amountCents]), [[a, 1001], [b, 2002]]);
  const direct = await h.send('用收款单 ' + rc + '，给销售单 ' + a + ' 核销10.01元，销售单 ' + b + ' 核销20.02元');
  assert.equal(direct.task?.id, completed.task.id, direct.reply);
  assert.deepEqual(h.writes, []);
});

test('详细收款查询参与原有查询序列，混合查询与核销办理时要求分开确认', async () => {
  const h = fixture('preset_finance_specialist');
  const bundle = await h.send('先' + question + '，然后' + question);
  assert.equal(bundle.task?.graph, 'K-sequence', bundle.reply);
  assert.equal(bundle.task.state, 'DONE', bundle.reply);
  assert.equal((bundle.reply.match(/预收余款 ¥110\.00/g) ?? []).length, 2);
  const mixed = await h.send(question + '，再' + preparation);
  assert.match(mixed.reply, /查询和办理单据分开/);
  assert.equal(mixed.preview, undefined);
  assert.deepEqual(h.writes, []);
});

test('同单续办边界 过期核销按原收款与同一目标重算并要求确认新版本', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(preparation);
  const task = h.store.get(pending.task.id);
  task.preview.expiresAt = '2000-01-01T00:00:00Z';
  h.records[0].paidAmount += 1;
  h.records[0].balance -= 1;
  const out = await h.resume(task);
  assert.equal(out.task.id, task.id);
  assert.equal(out.task.revision, pending.task.revision + 1);
  assert.equal(out.preview.receiptNo, rc);
  assert.deepEqual(out.preview.allocations.map(row => [row.orderNo, row.amountCents]), [[a, 1001], [b, 2002]]);
  assert.equal(out.preview.allocations[0].balanceBeforeCents, 4400);
  await assert.rejects(h.confirm(out.task, pending.task.revision), { status: 409 });
  assert.deepEqual(h.writes, []);
});

test('同单续办边界 同一收款单的目标新增核销后停在一个关键问题', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(preparation);
  h.entries.push({ entryId: 99, recordId: 11, amount: 10.01 });
  h.records[0].paidAmount += 10.01;
  h.records[0].balance -= 10.01;
  const out = await h.resume(pending.task);
  assert.equal(out.task.state, 'EXPIRED');
  assert.match(out.reply, /本收款单.*SL20261122011.*¥10\.01.*另(?:核|办)/s);
  assert.equal(out.preview, undefined);
  assert.deepEqual(h.writes, []);
});

test('同单续办边界 口述提交没回音时核对原核销，不送确认或新预览', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(preparation);
  h.context.loseResponse = true;
  h.context.hideReceipt = true;
  const unknown = await h.confirm(pending.task);
  assert.match(unknown.task.state, /ESCALATED|RESULT_UNKNOWN/);
  h.context.hideReceipt = false;
  const out = await h.send('刚才点了提交没回音', pending.task.id);
  assert.equal(out.task?.id, pending.task.id, out.reply);
  assert.equal(out.result?.recoveredViaReceipt, true);
  assert.match(out.reply, /原请求回执/);
  assert.equal(h.writes.length, 1);
});

for (const linked of [true, false]) for (const code of compared) for (const model of [null, { graph: 'D-receipt', amountCents: 9000 }]) {
  test('撤回续办矩阵 核销后的' + (linked ? '同源冲回' : '独立退款') + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
    const h = fixture(code, model);
    if (!h.has('payment.view')) {
      const out = await h.send('接班查收款单 ' + rc + ' 的核销冲回');
      assert.match(out.reply, /权限/);
      assert.deepEqual(h.reads, []);
      return;
    }
    const request = '继续核销收款单 ' + rc + '，' + a + ' 10元';
    let original;
    h.entries.splice(0, h.entries.length, { entryId: 52, recordId: 12, amount: 15 });
    if (h.has('payment.execute')) {
      const start = await h.send(request);
      original = (await h.confirm(start.task)).task;
    } else {
      h.entries.push({ entryId: 53, recordId: 11, amount: 10 });
      h.records[0].paidAmount += 10;
      h.records[0].balance -= 10;
    }
    const row = { id: 78, entryId: 78, recordId: 11, amount: -4, method: 'refund', receiptId: null };
    if (linked) h.entries.push(row);
    else h.context.refunds.push(row);
    h.records[0].paidAmount -= 4;
    h.records[0].balance += 4;
    const out = original ? await h.send('原核销冲回了多少，还欠多少？', original.id)
      : await h.send('接班查收款单 ' + rc + ' 的核销冲回');
    if (original) {
      assert.equal(out.task?.id, original.id, out.reply);
      assert.match(out.reply, /当时.*核销.*¥10\.00/s);
      if (linked) assert.match(out.reply, /冲回 ¥4\.00.*仍有效 ¥6\.00.*欠款 ¥39\.00/s);
      else assert.match(out.reply, /仍有效 ¥10\.00.*退款.*¥4\.00.*欠款 ¥39\.00/s);
      assert.match(out.reply, /财务/);
      assert.equal(h.writes.length, 1);
    } else {
      assert.match(out.reply, new RegExp(rc));
      assert.match(out.reply, linked ? /净核销 ¥6\.00.*冲回 ¥4\.00/s : /本收款单已核销 ¥10\.00/);
      assert.deepEqual(h.writes, []);
    }
    assert.equal(out.preview, undefined);
    assert.deepEqual(h.plans, []);
  });
}

test('撤回续办边界 核销冲回可按原单重办，金额只问一次，后续同源核销用新请求', async () => {
  const h = fixture('preset_finance_specialist');
  h.entries.splice(0, h.entries.length, { entryId: 52, recordId: 12, amount: 15 });
  const old = (await h.send('继续核销收款单 ' + rc + '，' + a + ' 10元')).task;
  await h.confirm(old);
  h.entries.push({ id: 78, entryId: 78, recordId: 11, amount: -4 });
  h.records[0].paidAmount -= 4;
  h.records[0].balance += 4;
  const clarification = await h.send('冲回后重新核销', old.id);
  assert.match(clarification.reply, new RegExp(a + ' 的本次准确核销金额'));
  assert.doesNotMatch(clarification.reply, /完整收款单号/);
  const current = await h.send('4元', clarification.task.id);
  assert.equal(current.task.state, 'AWAITING_CONFIRM', current.reply);
  assert.notEqual(current.task.id, old.id);
  assert.deepEqual(current.preview.allocations.map(row => [row.orderNo, row.amountCents]), [[a, 400]]);
  assert.equal(h.writes.length, 1);
  await h.confirm(current.task);
  assert.notEqual(h.writes[1].requestKey, h.writes[0].requestKey);
  const checked = await h.resume(old);
  assert.match(checked.reply, /冲回 ¥4\.00.*本次仍有效 ¥6\.00.*另有核销 ¥4\.00/s);
  const repeat = await h.send('冲回后重新核销 4元', old.id);
  assert.match(repeat.reply, /核对尚未重办的原冲回金额/);
  assert.equal(repeat.preview, undefined);
  assert.equal(h.writes.length, 2);
});

test('撤回续办边界 负向分录可能对应同单多笔核销时不猜、不新开确认卡', async () => {
  const h = fixture('preset_finance_specialist');
  const old = (await h.send('继续核销收款单 ' + rc + '，' + a + ' 10元')).task;
  await h.confirm(old);
  h.entries.push({ id: 78, entryId: 78, recordId: 11, amount: -4 });
  h.records[0].paidAmount -= 4;
  h.records[0].balance += 4;
  const out = await h.send('冲回后重新核销 4元', old.id);
  assert.match(out.reply, /属于哪次核销.*财务核对/);
  assert.equal(out.preview, undefined);
  assert.equal(h.writes.length, 1);
});

test('撤回续办边界 原收款归属无法核实时不重放旧任务的金额', async () => {
  const h = fixture('preset_finance_specialist');
  const pending = await h.send(preparation);
  await h.confirm(pending.task);
  h.context.partyId = 999;
  const out = await h.resume(pending.task);
  assert.match(out.reply, /身份或当前权限未能核实/);
  assert.doesNotMatch(out.reply, /¥/);
  assert.equal(out.result, undefined);
  assert.equal(out.preview, undefined);
  assert.equal(h.writes.length, 1);
});

for (const finishes of [false, true]) for (const code of compared) for (const model of [null, { graph: 'D-receipt', amountCents: 5 }]) {
  test('多轮撤回矩阵 ' + (finishes ? '冲回跨两笔核销并清零' : '分两次冲回后有新核销') + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
    const h = fixture(code, model);
    if (!h.has('payment.view')) {
      const denied = await h.send('接班核对收款单 ' + rc + ' 的分次冲回和后来核销');
      assert.match(denied.reply, /权限/);
      assert.deepEqual(h.reads, []);
      return;
    }
    h.entries.splice(0, h.entries.length, { entryId: 52, recordId: 12, amount: 15 });
    let original;
    if (h.has('payment.execute')) {
      const pending = await h.send('继续核销收款单 ' + rc + '，' + a + ' 10元');
      original = (await h.confirm(pending.task)).task;
    } else {
      h.entries.push({ entryId: 53, recordId: 11, amount: 10 });
      h.records[0].paidAmount += 10;
      h.records[0].balance -= 10;
    }
    const later = [-3, -2, 2, ...(finishes ? [-7, 4, -1] : [])];
    for (const [i, amount] of later.entries()) {
      h.entries.push({ entryId: 70 + i, recordId: 11, amount });
      h.records[0].paidAmount += amount;
      h.records[0].balance -= amount;
    }
    const out = original ? await h.send('原核销分次冲回后各办了多少？', original.id)
      : await h.send('接班核对收款单 ' + rc + ' 的分次冲回和后来核销');
    assert.match(out.reply, /第 1 笔冲回 ¥3\.00.*第 2 笔冲回 ¥2\.00.*第 2 笔核销 ¥2\.00/s);
    if (finishes) assert.match(out.reply, /第 3 笔冲回 ¥7\.00.*第 3 笔核销 ¥4\.00.*第 4 笔冲回 ¥1\.00/s);
    if (original) assert.match(out.reply, finishes ? /本次仍有效 ¥0\.00.*当前欠款 ¥42\.00/s : /本次仍有效 ¥5\.00.*当前欠款 ¥38\.00/s);
    assert.equal(out.preview, undefined);
    assert.equal(h.writes.length, original ? 1 : 0);
    assert.deepEqual(h.plans, []);
  });
}

test('多轮撤回边界 选第二笔再选第一笔，金额和后来分录分别绑定原冲回', async () => {
  const h = fixture('preset_finance_specialist');
  h.entries.splice(0, h.entries.length, { entryId: 52, recordId: 12, amount: 15 });
  const old = (await h.send('继续核销收款单 ' + rc + '，' + a + ' 10元')).task;
  await h.confirm(old);
  h.entries.push({ entryId: 70, recordId: 11, amount: -3 }, { entryId: 71, recordId: 11, amount: -2 });
  h.records[0].paidAmount -= 5;
  h.records[0].balance += 5;
  const ask = await h.send('冲回后重新核销 2元', old.id);
  assert.match(ask.reply, /指定要重办第几笔冲回/);
  const ambiguous = await h.send('第 1 笔还是第 2 笔冲回', ask.task.id);
  assert.match(ambiguous.reply, /只选择一笔/);
  assert.equal(ambiguous.preview, undefined);
  const second = await h.send('第二笔', ambiguous.task.id);
  assert.equal(second.task?.state, 'AWAITING_CONFIRM', second.reply);
  assert.match(second.reply, /按第 2 笔冲回重办/);
  assert.equal(second.preview.totalCents, 200);
  assert.equal(h.writes.length, 1);
  await h.confirm(second.task);
  const repeated = await h.send('第 2 笔冲回后重新核销 2元', old.id);
  assert.equal(repeated.preview, undefined);
  const first = await h.send('第 1 笔冲回后重新核销 3元', old.id);
  assert.equal(first.task?.state, 'AWAITING_CONFIRM', first.reply);
  assert.equal(first.preview.totalCents, 300);
  assert.notEqual(first.task.id, second.task.id);
  assert.match(h.store.get(first.task.id).preview._expectedAllocation.receiptLedgerFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(h.writes.length, 2);
  await h.confirm(first.task);
  await h.confirm(old);
  assert.equal(h.writes.length, 3);
});

for (const code of compared) for (const blocked of [false, true]) {
  test('同批跨同事核销 ' + code + (blocked ? ' 回执对不上' : ' 两次补核销'), async () => {
    const h = fixture(code, { graph: 'D-receipt', amountCents: 500 });
    h.entries.push({ entryId: 70, recordId: 12, amount: -9 },
      { entryId: 71, recordId: 12, amount: 2 }, { entryId: 72, recordId: 12, amount: 3 });
    h.records[1].paidAmount -= 4;
    h.records[1].balance += 4;
    h.context.reversalBatches = [{ id: 70, originalEntryId: 52, recordId: 12, orderNo: b, ordinal: 1, amountCents: 900,
      posted: [{ id: 71, cents: 200, operator: '出纳甲' }, ...(!blocked ? [{ id: 72, cents: 300, operator: '出纳乙' }] : [])],
      open: blocked ? null : 400, ...(blocked ? { issue: { id: 72, reason: 'receipt' } } : {}) }];
    const first = await h.send('接班核对收款单 ' + rc + ' 的分次冲回补办进度');
    const next = await h.send('第 1 笔冲回后重新核销 4元', first.task?.id);
    if (!h.has('payment.view')) {
      assert.match(first.reply, /权限/);
      assert.doesNotMatch(first.reply + next.reply, /出纳甲|出纳乙/);
    } else if (blocked) {
      assert.match(first.reply + next.reply, /#72.*成功回执/s);
      assert.equal(next.preview, undefined);
    } else {
      assert.match(first.reply, /出纳甲.*¥2\.00.*出纳乙.*¥3\.00.*已补 ¥5\.00.*还剩 ¥4\.00/s);
      if (h.has('payment.execute')) {
        assert.equal(next.task?.state, 'AWAITING_CONFIRM', next.reply);
        assert.equal(next.preview.totalCents, 400);
      } else {
        assert.match(first.reply + next.reply, /下一步.*财务/s);
        assert.equal(next.preview, undefined);
      }
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

function cashCrossBatch(h, closedFirst = false) {
  h.entries.push({ entryId: 70, recordId: 12, amount: -5 }, { entryId: 71, recordId: 12, amount: -4 },
    { entryId: 72, recordId: 12, amount: closedFirst ? 5 : 1 }, { entryId: 73, recordId: 12, amount: 2 });
  h.records[1].paidAmount -= closedFirst ? 2 : 6;
  h.records[1].balance += closedFirst ? 2 : 6;
  h.context.reversalBatches = [{ id: 70, originalEntryId: 52, recordId: 12, orderNo: b, ordinal: 1, amountCents: 500,
    posted: [{ id: 72, cents: closedFirst ? 500 : 100, operator: '财务甲' }], open: closedFirst ? 0 : 400 },
  { id: 71, originalEntryId: 52, recordId: 12, orderNo: b, ordinal: 2, amountCents: 400,
    posted: [{ id: 73, cents: 200, operator: '财务乙' }], open: 200 }];
}

for (const code of compared) for (const model of [null, { graph: 'B-sale-draft' }]) {
  for (const focused of [false, true]) test('交叉批次矩阵 核销 ' + code + ' ' + Boolean(model) + ' ' + focused, async () => {
    const h = fixture(code, model);
    cashCrossBatch(h);
    const read = await h.send('核对收款单 ' + rc + (focused ? ' 第 1 笔冲回补办进度' : ' 的各批冲回补办进度'));
    const ask = await h.send(focused ? '刚才那批' : '把剩下的补了', read.task?.id);
    if (h.has('payment.view')) {
      assert.match(read.reply, /第 1 笔冲回[^\n]*财务甲[^\n]*已补 ¥1\.00[^\n]*还剩 ¥4\.00[^]*第 2 笔冲回[^\n]*财务乙[^\n]*已补 ¥2\.00[^\n]*还剩 ¥2\.00/);
      if (h.has('payment.execute')) {
        const out = focused ? ask : await h.send('第二批', ask.task?.id);
        if (!focused) {
          assert.match(ask.reply, /哪一批|第几笔冲回/);
          assert.equal(ask.preview, undefined);
        }
        assert.equal(out.task?.state, 'AWAITING_CONFIRM', out.reply);
        assert.equal(out.preview.totalCents, focused ? 400 : 200);
        assert.equal(h.store.get(out.task.id).preview._expectedAllocation.reversalEntryId, focused ? 70 : 71);
      } else {
        assert.match(ask.reply, /核销办理权限/);
        assert.equal(ask.preview, undefined);
      }
    } else {
      assert.doesNotMatch(read.reply + ask.reply, /财务甲|财务乙/);
      assert.equal(ask.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('交叉批次边界 核销已办完的明确原批不转到其他批，整单只剩一批可出卡', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h, true);
  const focused = await h.send('核对收款单 ' + rc + ' 第 1 笔冲回补办进度');
  const closed = await h.send('刚才那批，把剩下的补了', focused.task?.id);
  assert.equal(closed.preview, undefined);
  assert.match(closed.reply, /第 1 笔冲回.*还剩 ¥0\.00/);
  const read = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
  const next = await h.send('把剩下的补了', read.task?.id);
  assert.equal(next.preview?.totalCents, 200, next.reply);
  assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 71);
});

test('交叉批次边界 两张销售应收同为第一笔时只问原分录，按所选稳定身份出卡', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  h.entries.push({ entryId: 74, recordId: 11, amount: -3 });
  h.records[0].paidAmount -= 3;
  h.records[0].balance += 3;
  h.context.reversalBatches.push({ id: 74, originalEntryId: 51, recordId: 11, orderNo: a, ordinal: 1,
    amountCents: 300, posted: [], open: 300 });
  const read = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
  const asked = await h.send('把剩下的补了', read.task.id);
  assert.match(asked.reply, /同序号请给出分录编号/);
  assert.equal(asked.preview, undefined);
  const sameNumber = await h.send('第一批', asked.task.id);
  assert.match(sameNumber.reply, /给出要补办的冲回分录编号/);
  assert.equal(sameNumber.preview, undefined);
  const next = await h.send('分录 #70', sameNumber.task.id);
  assert.equal(next.preview?.totalCents, 400, next.reply);
  assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 70);
  assert.deepEqual(h.writes, []);
});

test('交叉批次边界 已显示的冲回分录消失时同序号不会被替用', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  const read = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
  const asked = await h.send('把剩下的补了', read.task.id);
  h.context.reversalBatches[1] = { ...h.context.reversalBatches[1], id: 75 };
  const stale = await h.send('第二批', asked.task.id);
  assert.match(stale.reply, /核对.*冲回批次编号/);
  assert.equal(stale.preview, undefined);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'B-sale-draft' }]) {
  for (const reason of ['receipt', 'conflict']) test('批次疑点隔离矩阵 核销 ' + code + ' ' + Boolean(model) + ' ' + reason, async () => {
    const h = fixture(code, model);
    cashCrossBatch(h);
    h.context.reversalBatches[0].open = null;
    h.context.reversalBatches[0].issue = { id: 72, reason };
    const open = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
    const next = await h.send('把剩下的补了', open.task?.id);
    if (h.has('payment.view')) {
      assert.match(open.reply, /第 1 笔冲回[^\n]*已补 ¥1\.00[^\n]*#72[^]*第 2 笔冲回[^\n]*已补 ¥2\.00[^\n]*还剩 ¥2\.00/);
      if (h.has('payment.execute')) {
        assert.equal(next.preview?.totalCents, 200, next.reply);
        assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 71);
        const explicit = await h.send('核对收款单 ' + rc + ' 第 1 笔冲回补办进度');
        const held = await h.send('刚才那批', explicit.task?.id);
        assert.equal(held.preview, undefined);
        assert.match(held.reply, /第 1 笔冲回[^\n]*#72/);
        assert.doesNotMatch(held.reply, /第 2 笔冲回/);
      } else {
        assert.match(next.reply, /权限/);
        assert.equal(next.preview, undefined);
      }
    } else {
      assert.doesNotMatch(open.reply + next.reply, /#72|财务甲|财务乙/);
      assert.equal(next.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('批次疑点隔离 多批共用的冲突只问一笔核销回执，当前没有可办预览', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  for (const batch of h.context.reversalBatches) {
    batch.issue = { id: 74, reason: 'conflict' };
    batch.open = null;
  }
  const read = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
  for (const prompt of ['把剩下的补了', '先补能核实的，待核的先放着']) {
    const out = await h.send(prompt, read.task.id);
    assert.equal(out.preview, undefined, out.reply);
    assert.match(out.reply, /#74.*回执应归属哪一批/);
    assert.equal((out.reply.match(/请核对.*#74/g) ?? []).length, 1);
  }
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'B-sale-draft' }]) {
  for (const moved of [false, true]) test('更正回执矩阵 核销 ' + code + ' ' + Boolean(model) + ' ' + moved, async () => {
    const h = fixture(code, model);
    cashCrossBatch(h);
    const [first, second] = h.context.reversalBatches;
    first.issue = { id: 74, reason: 'receipt', check: 'mismatch' };
    first.open = null;
    const old = await h.send('核对收款单 ' + rc + ' 第 1 笔冲回补办进度');
    delete first.issue;
    (moved ? second : first).posted.push({ id: 74, cents: 50, operator: '原经办' });
    second.posted.push({ id: 75, cents: 50, operator: '交接同事' });
    first.open = moved ? 400 : 350;
    second.open = moved ? 100 : 150;
    h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 }, { entryId: 75, recordId: 12, amount: 0.5 });
    h.records[1].paidAmount += 1; h.records[1].balance -= 1;
    const corrected = await h.send('这笔回执更正了，重新核对', old.task?.id);
    const next = await h.send(moved ? '按更正后的归属继续补办' : '刚才那批', corrected.task?.id);
    if (h.has('payment.view')) {
      assert.match(corrected.reply, moved ? /#74.*第 1 笔冲回.*现归第 2 笔冲回/s : /#74.*已核实.*第 1 笔冲回/s);
      assert.match(corrected.reply, /交接同事.*回执对应分录 #75/);
      if (h.has('payment.execute')) {
        assert.equal(next.preview?.totalCents, moved ? 100 : 350, next.reply);
        assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, moved ? 71 : 70);
      } else {
        assert.match(next.reply, /权限/);
        assert.equal(next.preview, undefined);
      }
    } else {
      assert.doesNotMatch(corrected.reply + next.reply, /原经办|交接同事/);
      assert.equal(next.preview, undefined);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('更正回执边界 核销证据版本已变且分录金额相同，旧卡失效后仍沿原批试算', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  h.context.reversalBatches[0].proofVersion = 'a'.repeat(64);
  const first = await h.send('收款单 ' + rc + ' 第 1 笔冲回后重新核销 4元');
  assert.equal(first.preview?.totalCents, 400, first.reply);
  h.context.reversalBatches[0].proofVersion = 'b'.repeat(64);
  const old = await h.confirm(first.task);
  assert.equal(old.task?.state, 'EXPIRED', old.reply);
  assert.deepEqual(h.writes, []);
  const next = await h.send('刚才那批', first.task.id);
  assert.equal(next.preview?.totalCents, 400, next.reply);
  assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalProofVersion, 'b'.repeat(64));
  assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 70);
});

for (const code of compared) for (const model of [null, { graph: 'B-sale-draft' }]) {
  for (const withdrawn of [false, true]) test('再次更正矩阵 核销 ' + code + ' ' + Boolean(model) + ' ' + withdrawn, async () => {
    const h = fixture(code, model);
    cashCrossBatch(h);
    const [a, b] = h.context.reversalBatches;
    a.issue = { id: 74, reason: 'receipt', check: 'missing' };
    a.open = null;
    const initial = await h.send('核对收款单 ' + rc + ' 第 1 笔冲回补办进度');
    delete a.issue;
    a.open = 400;
    const movement = { id: 74, cents: 50, operator: '原经办' };
    b.posted.push(movement);
    b.open = 150;
    h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 });
    h.records[1].paidAmount += 0.5; h.records[1].balance -= 0.5;
    let observed = await h.send('这笔回执更正了，重新核对', initial.task?.id);
    b.posted.push({ id: 75, cents: 50, operator: '后续财务' });
    b.posted = b.posted.filter(row => row.id !== 74);
    if (withdrawn) {
      b.issue = { id: 74, reason: 'receipt', check: 'missing' };
      b.open = null;
      observed = await h.send('这笔回执撤回了，重新核对', observed.task?.id);
      if (h.has('payment.view')) assert.match(observed.reply, /#74.*上次核实.*第 2 笔冲回/s);
      const blocked = await h.send('按更正后的归属继续补办', observed.task?.id);
      assert.equal(blocked.preview, undefined);
      delete b.issue;
    }
    a.posted.push(movement);
    a.open = 350;
    b.open = 150;
    h.entries.push({ entryId: 75, recordId: 12, amount: 0.5 });
    h.records[1].paidAmount += 0.5; h.records[1].balance -= 0.5;
    const latest = await h.send('这笔回执又改回原批了，重新核对', observed.task?.id);
    if (h.has('payment.view')) {
      assert.match(latest.reply, /#74.*第 2 笔冲回.*改回第 1 笔冲回/s);
      assert.match(latest.reply, /后续财务.*回执对应分录 #75/);
    } else assert.doesNotMatch(latest.reply, /后续财务|#74/);
    const next = await h.send('按更正后的归属继续补办', latest.task?.id);
    if (h.has('payment.execute')) {
      assert.equal(next.preview?.totalCents, 350, next.reply);
      assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 70);
    } else assert.equal(next.preview, undefined);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('再次更正边界 员工报告核销回执撤回后，余额相同且证据未变时仍待核', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  const [a] = h.context.reversalBatches;
  const first = await h.send('核对收款单 ' + rc + ' 第 1 笔冲回补办进度');
  a.proofVersion = 'a'.repeat(64);
  const read = await h.send('回执 #72', first.task.id);
  const disputed = await h.send('这笔回执撤回了，重新核对', read.task.id);
  assert.match(disputed.reply, /#72.*正式记录仍归第 1 笔冲回/);
  for (const text of ['刚才那批', '按更正后的归属继续补办']) {
    const paused = await h.send(text, disputed.task.id);
    assert.equal(paused.preview, undefined);
    assert.match(paused.reply, /核对这笔回执/);
  }
  a.proofVersion = 'b'.repeat(64);
  const verified = await h.send('刚才那批', disputed.task.id);
  assert.equal(verified.preview?.totalCents, 400, verified.reply);
  assert.equal(h.store.get(verified.task.id).preview._expectedAllocation.reversalProofVersion, 'b'.repeat(64));
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'B-sale-draft' }]) {
  for (const multiTurn of [false, true]) test('交叉更正矩阵 核销 ' + code + ' ' + Boolean(model) + ' ' + multiTurn, async () => {
    const h = fixture(code, model);
    cashCrossBatch(h);
    const [first, second] = h.context.reversalBatches;
    const otherMove = { id: 74, cents: 50, operator: '交叉经办' };
    first.posted.push(otherMove);
    first.open = 350;
    const start = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
    let context = start;
    if (multiTurn) {
      context = await h.send('回执 #74', context.task?.id);
      context = await h.send('回执 #72', context.task?.id);
    }
    first.issue = { id: 72, reason: 'conflict' };
    first.issues = [first.issue, { id: 74, reason: 'conflict' }];
    first.posted = [{ id: 75, cents: 50, operator: '期间财务' }];
    first.open = null;
    for (const entryId of [74, 75]) h.entries.push({ entryId, recordId: 12, amount: 0.5 });
    h.records[1].paidAmount += 1;
    h.records[1].balance -= 1;
    const question = multiTurn ? '这两笔回执的更正顺序对不上，重新核对'
      : '收款单 ' + rc + ' 回执 #72 和 #74 的更正先后顺序对不上，重新核对';
    const check = await h.send(question, context.task?.id);
    if (h.has('payment.view')) {
      assert.match(check.reply, /请给出.*回执.*分录编号/);
      assert.match(check.reply, /#72/);
      assert.match(check.reply, /#74/);
      assert.match(check.reply, /第 1 笔冲回[^\n]*期间财务[^\n]*已补 ¥0\.50[^\n]*待核/);
      assert.match(check.reply, /第 2 笔冲回[^\n]*还剩 ¥2\.00[^\n]*下一步由有核销权限的财务/);
      const blocked = await h.send('按更正后的归属继续补办', check.task?.id);
      assert.equal(blocked.preview, undefined);
      assert.match(blocked.reply, /请给出.*回执.*分录编号|核销办理权限/);
      const disputed = await h.send(multiTurn ? '回执 #74' : '74', check.task?.id);
      assert.match(disputed.reply, /#74[^\n]*成功回执应归属哪一批/);
      if (multiTurn) assert.match(disputed.reply, /#74[^\n]*上次核实归第 1 笔冲回/);
      assert.doesNotMatch(disputed.reply, /#72/);
      const ready = await h.send('先补能核实的', check.task?.id);
      if (h.has('payment.execute')) {
        assert.equal(ready.preview?.totalCents, 200, ready.reply);
        assert.equal(h.store.get(ready.task.id).preview._expectedAllocation.reversalEntryId, 71);
      } else assert.equal(ready.preview, undefined);
      if (multiTurn) {
        first.issues = [first.issue];
        second.posted.push(otherMove);
        second.open = 150;
        const changed = await h.send('回执 #74', disputed.task?.id);
        assert.match(changed.reply, /#74[^\n]*上次核实归第 1 笔冲回，现归第 2 笔冲回/);
        assert.match(changed.reply, /期间财务/);
        const next = await h.send('按更正后的归属继续补办', changed.task?.id);
        if (h.has('payment.execute')) {
          assert.equal(next.preview?.totalCents, 150, next.reply);
          assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 71);
        } else assert.equal(next.preview, undefined);
      }
    } else assert.doesNotMatch(check.reply, /#72|#74|期间财务/);
    assert.equal(check.preview, undefined);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('交叉更正边界 核销切换到另一笔后，同批新增同事回执不解除旧回执的待核状态', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  const [first] = h.context.reversalBatches;
  first.proofVersion = 'a'.repeat(64);
  first.posted[0].proofVersion = 'c'.repeat(64);
  const read = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
  const x = await h.send('回执 #72', read.task.id);
  const claim = await h.send('这笔回执撤回了，重新核对', x.task.id);
  const y = await h.send('回执 #73', claim.task.id);
  first.posted.push({ id: 74, cents: 50, operator: '期间财务' });
  first.open = 350;
  first.proofVersion = 'b'.repeat(64);
  h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 });
  h.records[1].paidAmount += 0.5;
  h.records[1].balance -= 0.5;
  const hold = await h.send('回执 #72', y.task.id);
  assert.match(hold.reply, /#72.*正式记录仍归第 1 笔冲回/);
  const follow = await h.send('按更正后的归属继续补办', hold.task.id);
  assert.equal(follow.preview, undefined);
  const safe = await h.send('先补能核实的', hold.task.id);
  assert.equal(safe.preview?.totalCents, 200, safe.reply);
  assert.equal(h.store.get(safe.task.id).preview._expectedAllocation.reversalEntryId, 71);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const model of [null, { graph: 'B-sale-draft' }]) {
  for (const multiTurn of [false, true]) test('部分核清矩阵 核销 ' + code + ' ' + Boolean(model) + ' ' + multiTurn, async () => {
    const h = fixture(code, model);
    cashCrossBatch(h);
    const [held, cleared] = h.context.reversalBatches;
    const movement = { id: 74, cents: 50, operator: '核清的经办' };
    const review1 = { id: 74, reason: 'conflict' }, review2 = { id: 72, reason: 'receipt', check: 'missing' };
    let initial;
    if (multiTurn) {
      held.issue = review1;
      held.issues = [review1, review2];
      cleared.issue = review1;
      initial = await h.send('收款单 ' + rc + ' 这两笔回执的更正顺序对不上，重新核对');
    }
    const post = (entryId, amount) => {
      h.entries.push({ entryId, recordId: 12, amount });
      h.records[1].paidAmount += amount;
      h.records[1].balance -= amount;
    };
    held.issue = review2;
    held.issues = [review2];
    held.posted = [{ id: 76, operator: '同批财务', cents: 25 }];
    held.open = null;
    post(76, 0.25);
    delete cleared.issue;
    cleared.posted.push(movement);
    cleared.open = 150;
    post(74, 0.5);
    const after = cents => {
      cleared.posted.push({ id: 75, operator: '新增财务', cents });
      cleared.open -= cents;
      post(75, cents / 100);
    };
    if (!multiTurn) after(50);
    const checked = await h.send(multiTurn ? '一笔核清了，另一笔还待核，重新核对'
      : '收款单 ' + rc + ' 回执 #74 已核清，另一笔仍待核，同事又补办了，重新核对', initial?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('payment.view')) {
      assert.match(checked.reply, /#74[^\n]*(?:已核实|现归)[^\n]*第 2 笔冲回/);
      assert.match(checked.reply, /第 1 笔冲回[^\n]*同批财务[^\n]*已补 ¥0\.25[^\n]*待核[^\n]*#72/);
      assert.doesNotMatch(checked.reply, /请给出.*编号|请核对[^\n]*#74/);
      assert.equal(h.store.get(checked.task?.id)?.batchReview?.clearedMovementId, 74);
      if (!multiTurn) assert.match(checked.reply, /新增财务[^\n]*已补 ¥3\.00[^\n]*还剩 ¥1\.00/);
      const canWrite = h.has('payment.execute');
      const old = multiTurn && canWrite ? await h.send('按核清的那批继续补办', checked.task.id) : null;
      if (old) assert.equal(old.preview?.totalCents, 150, old.reply);
      if (multiTurn) after(150);
      const pending = multiTurn ? await h.send('回执 #72', checked.task.id) : checked;
      let anchor = pending;
      if (multiTurn) {
        assert.doesNotMatch(pending.reply, /#74/);
        anchor = await h.send('还剩哪笔回执待核', pending.task.id);
        assert.match(anchor.reply, /当前仍待核.*\n[^]*#72/);
        assert.doesNotMatch(anchor.reply, /请给出.*编号|请核对[^\n]*#74/);
        const unsafe = await h.send('按更正后的归属继续补办', anchor.task.id);
        assert.equal(unsafe.preview, undefined, unsafe.reply);
      }
      const out = await h.send('按核清的那批继续补办', anchor.task?.id);
      if (canWrite && !multiTurn) {
        assert.equal(out.preview?.totalCents, 100, out.reply);
        assert.equal(h.store.get(out.task.id).preview._expectedAllocation.reversalEntryId, 71);
      } else assert.equal(out.preview, undefined, out.reply);
      assert.match(out.reply, /新增财务[^\n]*已补 ¥(?:3\.00|4\.00)[^\n]*还剩 ¥(?:1\.00|0\.00)/);
      assert.match(out.reply, /#72/);
      assert.match(out.reply, /下一步/);
      assert.doesNotMatch(out.reply, /请给出.*编号|请核对[^\n]*#74/);
      if (old) {
        assert.match(out.reply, /该批已补完/);
        const rejected = await h.confirm(old.task);
        assert.equal(rejected.task?.state, 'EXPIRED', rejected.reply);
      }
    } else assert.doesNotMatch(checked.reply, /#74|#72|同批财务|新增财务/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('部分核清边界 核销已核清回执再次冲突时，独立可办批不能替代原批', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  const [independent, target] = h.context.reversalBatches;
  const initial = await h.send('收款单 ' + rc + ' 回执 #73 已核清，另一笔仍待核，重新核对');
  assert.match(initial.reply, /#73.*已核实/);
  target.issue = { id: 73, reason: 'conflict' };
  target.open = null;
  target.posted = [];
  const next = await h.send('按核清的那批继续补办', initial.task.id);
  assert.match(next.reply, /#73.*回执应归属哪一批/);
  assert.match(next.reply, /第 1 笔冲回[^\n]*还剩 ¥4\.00/);
  assert.equal(next.preview, undefined);
  assert.equal(independent.issue, undefined);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const excess of [false, true]) test('完批改归矩阵 核销 ' + code + ' ' + multiTurn + ' ' + excess, async () => {
    const h = fixture(code, multiTurn ? { graph: 'B-sale-draft' } : null);
    cashCrossBatch(h, true);
    const [closed, peer] = h.context.reversalBatches;
    peer.issue = { id: 74, reason: 'receipt', check: 'missing' };
    peer.open = null;
    let context;
    if (multiTurn) {
      const first = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
      context = await h.send('回执 #72', first.task?.id);
    }
    const movement = { id: 74, cents: 50, operator: '后核清财务' };
    h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 });
    h.records[1].paidAmount += 0.5;
    h.records[1].balance -= 0.5;
    delete peer.issue;
    peer.open = excess ? 200 : 150;
    if (excess) {
      closed.issue = { id: 74, reason: 'capacity', excessCents: 50 };
      closed.open = null;
      closed.confirmedOpen = 0;
    } else peer.posted.push(movement);
    const prompt = multiTurn ? '第一批已补完，另一笔回执' : '收款单 ' + rc + ' 第一批已补完，待核回执 #74 ';
    const checked = await h.send(prompt + (excess ? '改归已补完批次了，重新核对' : '也核清了，重新核对'), context?.task?.id);
    assert.equal(checked.preview, undefined);
    if (!h.has('payment.view')) {
      assert.doesNotMatch(checked.reply, /#74|财务甲|财务乙/);
    } else {
      assert.match(checked.reply, /第 1 笔冲回[^\n]*财务甲[^\n]*已补 ¥5\.00[^\n]*还剩 ¥0\.00/);
      assert.match(checked.reply, new RegExp('第 2 笔冲回[^\\n]*已补 ¥' + (excess ? '2\\.00' : '2\\.50')
        + '[^\\n]*还剩 ¥' + (excess ? '2\\.00' : '1\\.50') + '[^\\n]*下一步'));
      assert.doesNotMatch(checked.reply, /请给出.*编号|请核对[^\n]*#72/);
      const next = await h.send('按更正后的归属继续补办', checked.task?.id);
      if (excess) {
        assert.match(checked.reply, /#74[^\n]*超出[^\n]*¥0\.50[^\n]*财务/);
        assert.equal(next.preview, undefined);
        if (h.has('payment.execute')) {
          assert.match(next.reply, /#74[^\n]*超出/);
          const ready = await h.send('先补能核实的', checked.task?.id);
          assert.equal(ready.preview?.totalCents, 200, ready.reply);
          assert.equal(h.store.get(ready.task.id).preview._expectedAllocation.reversalEntryId, 71);
        }
      } else {
        assert.match(checked.reply, /#74[^\n]*(?:现归|已核实)[^\n]*第 2 笔冲回/);
        if (h.has('payment.execute')) {
          assert.equal(next.preview?.totalCents, 150, next.reply);
          assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 71);
        } else assert.equal(next.preview, undefined);
      }
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const outcome of ['partial', 'withdrawn', 'moved']) test('部分超额修正矩阵 核销 ' + code + ' ' + multiTurn + ' ' + outcome, async () => {
    const h = fixture(code, multiTurn ? { graph: 'B-sale-draft' } : null);
    cashCrossBatch(h);
    const [first, second] = h.context.reversalBatches;
    const issue = (excessCents, movementCents) => ({ id: 74, reason: 'capacity', excessCents, movementCents });
    first.posted[0].cents = 400;
    first.open = null;
    first.confirmedOpen = 100;
    first.issue = issue(200, 300);
    let context;
    if (multiTurn) {
      const initial = await h.send('核对收款单 ' + rc + ' 的各批冲回补办进度');
      context = await h.send('回执 #74', initial.task?.id);
    }
    const post = (entryId, amount) => {
      h.entries.push({ entryId, recordId: 12, amount });
      h.records[1].paidAmount += amount;
      h.records[1].balance -= amount;
    };
    second.posted.push({ id: 75, operator: '期间财务', cents: 50 });
    second.open = 150;
    post(75, 0.5);
    const movement = { id: 74, operator: '更正财务', cents: 50 };
    if (outcome === 'partial') {
      first.issue = issue(75, 175);
      post(74, 1.75);
    } else {
      delete first.issue;
      delete first.confirmedOpen;
      first.open = outcome === 'withdrawn' ? 50 : 100;
      const target = outcome === 'withdrawn' ? first : second;
      target.posted.push(movement);
      if (outcome === 'moved') second.open = 100;
      post(74, 0.5);
    }
    const prefix = multiTurn ? '' : '收款单 ' + rc + ' ';
    const prompt = outcome === 'partial' ? (multiTurn ? '这笔超量回执只更正了一部分' : '超量回执 #74 只更正了一部分')
      : (multiTurn ? '超出的部分' : '回执 #74 的超出部分') + (outcome === 'moved' ? '改归到另一批了' : '撤回了');
    const checked = await h.send(prefix + prompt + '，重新核对', context?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('payment.view')) {
      assert.match(checked.reply, /第 2 笔冲回[^\n]*期间财务[^\n]*还剩 [^\n]*下一步/);
      assert.doesNotMatch(checked.reply, /请给出.*编号/);
      const next = await h.send('按更正后的归属继续补办', checked.task?.id);
      if (outcome === 'partial') {
        assert.match(checked.reply, /#74[^\n]*¥1\.75[^\n]*(?:仍超出|当前超出)[^\n]*¥0\.75[^\n]*财务/);
        if (multiTurn) assert.match(checked.reply, /上次超出 ¥2\.00/);
        assert.match(checked.reply, /第 1 笔冲回[^\n]*已补 ¥4\.00[^\n]*还剩 ¥1\.00[^\n]*待核/);
        assert.equal(next.preview, undefined);
      } else {
        assert.match(checked.reply, /#74[^\n]*已核实[^\n]*¥0\.50/);
        if (multiTurn) assert.match(checked.reply, /上次超出 ¥2\.00/);
        assert.doesNotMatch(checked.reply, /请核对.*#74/);
        if (h.has('payment.execute')) {
          assert.equal(next.preview?.totalCents, outcome === 'withdrawn' ? 50 : 100, next.reply);
          assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, outcome === 'withdrawn' ? 70 : 71);
        } else assert.equal(next.preview, undefined);
      }
    } else assert.doesNotMatch(checked.reply, /#74|期间财务|更正财务/);
    assert.deepEqual(h.plans, []);
    assert.deepEqual(h.writes, []);
  });
}

test('部分超额修正边界 核销原批金额下调时仍须证明超出部分改归哪一批', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  const [first, second] = h.context.reversalBatches;
  first.open = null;
  first.issue = { id: 74, reason: 'capacity', excessCents: 150, movementCents: 180 };
  const checked = await h.send('收款单 ' + rc + ' 超量回执 #74 只更正了一部分，重新核对');
  delete first.issue;
  first.open = 350;
  const moved = { id: 74, cents: 50, operator: '经办财务', proofVersion: 'a'.repeat(64) };
  first.posted.push(moved);
  h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 });
  h.records[1].paidAmount += 0.5;
  h.records[1].balance -= 0.5;
  const hold = await h.send('超出的部分改归另一批了，重新核对', checked.task.id);
  assert.match(hold.reply, /#74[^\n]*请核对这笔回执的部分撤回或改归凭据/);
  const follow = await h.send('按更正后的归属继续补办', hold.task.id);
  assert.equal(follow.preview, undefined, follow.reply);
  first.posted.pop();
  first.open = 400;
  second.posted.push({ ...moved, proofVersion: 'b'.repeat(64) });
  second.open = 150;
  const restored = await h.send('按更正后的归属继续补办', hold.task.id);
  assert.equal(restored.preview?.totalCents, 150, restored.reply);
  assert.equal(h.store.get(restored.task.id).preview._expectedAllocation.reversalEntryId, 71);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const readyIncluded of [false, true]) test('分次改归多批矩阵 核销 ' + code + ' ' + multiTurn + ' ' + readyIncluded, async () => {
    const h = fixture(code, multiTurn ? { graph: 'B-sale-draft' } : null);
    cashCrossBatch(h);
    const [closed, held] = h.context.reversalBatches;
    held.issue = { id: 74, reason: 'receipt', check: 'missing' };
    held.open = null;
    h.context.reversalBatches.push({ id: 76, orderNo: b, recordId: 12, originalEntryId: 52, ordinal: 3, amountCents: 400,
      open: 100, posted: [{ id: 77, operator: '可证财务', cents: 300 }] });
    const ledger = (entryId, amount) => {
      h.entries.push({ entryId, recordId: 12, amount });
      h.records[1].paidAmount += amount;
      h.records[1].balance -= amount;
    };
    ledger(76, -4);
    ledger(77, 3);
    const bill = '收款单 ' + rc + ' 超出部分分次改归到多个批次';
    const receipts = '（回执 #72、#74' + (readyIncluded ? '和 #77' : '') + '）';
    let first;
    if (multiTurn) first = await h.send(bill + receipts + '，重新核对');
    closed.posted.push({ id: 75, operator: '补满财务', cents: 400 });
    closed.open = 0;
    ledger(75, 4);
    const checked = await h.send((multiTurn ? '超出的部分分次改归多批' : bill + receipts)
      + '，一批被同事补满、另一批仍待核，重新核对', first?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('payment.view')) {
      assert.match(checked.reply, /第 1 笔冲回[^\n]*已补完/);
      assert.match(checked.reply, /第 1 笔冲回[^\n]*补满财务[^\n]*已补 ¥5\.00[^\n]*还剩 ¥0\.00/);
      assert.match(checked.reply, /第 2 笔冲回[^\n]*待核[^\n]*#74/);
      assert.match(checked.reply, /第 3 笔冲回[^\n]*已补 ¥3\.00[^\n]*还剩 ¥1\.00/);
      assert.doesNotMatch(checked.reply, /请给出.*编号|请核对[^\n]*#72/);
      const next = await h.send('先补能核实的', checked.task?.id);
      if (h.has('payment.execute') && readyIncluded) {
        assert.equal(next.preview?.totalCents, 100, next.reply);
        assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 76);
      } else {
        assert.equal(next.preview, undefined, next.reply);
        assert.match(next.reply, /#74|核销办理权限/);
      }
      const chosen = await h.send('回执 #72', checked.task?.id);
      const closedAgain = await h.send('按更正后的归属继续补办', chosen.task?.id);
      assert.equal(closedAgain.preview, undefined, closedAgain.reply);
      if (h.has('payment.execute')) assert.match(closedAgain.reply, /已补完/);
      const unresolved = await h.send('回执 #74', checked.task?.id);
      assert.match(unresolved.reply, /暂未取得[^\n]*#74/);
      assert.doesNotMatch(unresolved.reply, /请核对[^\n]*#72|#72[^\n]*待核/);
    } else assert.doesNotMatch(checked.reply, /#74|#72|补满财务/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('分次改归多批边界 两个改归批次都可办时按准确回执选择并保留原指向', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h);
  const read = await h.send('收款单 ' + rc + ' 超出部分分次改归到多个批次（回执 #72 和 #73），重新核对');
  for (const phrase of ['刚才那批', '先补能核实的', '按更正后的归属继续补办']) {
    const ambiguous = await h.send(phrase, read.task.id);
    assert.equal(ambiguous.preview, undefined, ambiguous.reply);
    assert.match(ambiguous.reply, /请给出要续办的那批对应的回执编号/);
  }
  const chosen = await h.send('回执 #73', read.task.id);
  const prepared = await h.send('按更正后的归属继续补办', chosen.task.id);
  assert.equal(prepared.preview?.totalCents, 200, prepared.reply);
  assert.equal(h.store.get(prepared.task.id).preview._expectedAllocation.reversalEntryId, 71);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) for (const multiTurn of [false, true]) {
  for (const proof of [false, true]) test('满批重开并核清矩阵 核销 ' + code + ' ' + multiTurn + ' ' + proof, async () => {
    const h = fixture(code, multiTurn ? { graph: 'B-sale-draft' } : null);
    cashCrossBatch(h);
    const [reopened, cleared] = h.context.reversalBatches;
    const fill = { id: 75, operator: '补满财务', cents: 400 };
    reopened.posted.push(fill);
    reopened.open = 0;
    cleared.open = null;
    cleared.issue = { id: 74, reason: 'receipt', check: 'missing', movementCents: 50 };
    const post = (entryId, amount) => {
      h.entries.push({ entryId, recordId: 12, amount });
      h.records[1].paidAmount += amount;
      h.records[1].balance -= amount;
    };
    post(75, 4);
    post(74, 0.5);
    const original = '收款单 ' + rc + ' 超出部分分次改归到多个批次（回执 #72 和 #74）';
    let first;
    if (multiTurn) first = await h.send(original + '，一批被同事补满、另一批仍待核，重新核对');
    if (proof) {
      fill.cents = 250;
      h.entries.find(entry => entry.entryId === 75).amount = 2.5;
      h.records[1].paidAmount -= 1.5;
      h.records[1].balance += 1.5;
      reopened.open = 150;
    } else {
      reopened.issue = { id: 75, reason: 'receipt', check: 'mismatch', movementCents: 400 };
      reopened.open = null;
      reopened.posted.pop();
    }
    delete cleared.issue;
    cleared.posted.push({ id: 74, operator: '核清财务', cents: 50 });
    cleared.open = 150;
    const prompt = '已补满的那批又被部分撤回，另一批的待核回执同时核清了，重新核对';
    const checked = await h.send((multiTurn ? '' : original + '，') + prompt, first?.task?.id);
    assert.equal(checked.preview, undefined);
    if (h.has('payment.view')) {
      if (proof) {
        assert.match(checked.reply, /第 1 笔冲回[^\n]*补满财务[^\n]*已补 ¥3\.50[^\n]*还剩 ¥1\.50/);
        if (multiTurn) assert.match(checked.reply, /第 1 笔冲回[^\n]*重新有余量[^\n]*#75[^\n]*¥4\.00[^\n]*¥2\.50/);
        assert.doesNotMatch(checked.reply, /第 1 笔冲回已补完/);
      } else assert.match(checked.reply, /第 1 笔冲回[^\n]*已补 ¥1\.00[^\n]*待核[^\n]*#75/);
      assert.match(checked.reply, /第 2 笔冲回[^\n]*核清财务[^\n]*已补 ¥2\.50[^\n]*还剩 ¥1\.50/);
      if (multiTurn) assert.match(checked.reply, /#74[^\n]*现已核清/);
      assert.doesNotMatch(checked.reply, /请核对[^\n]*#74|#74[^\n]*待核/);
      const next = await h.send('先补能核实的', checked.task?.id);
      if (h.has('payment.execute') && !proof) {
        assert.equal(next.preview?.totalCents, 150, next.reply);
        assert.equal(h.store.get(next.task.id).preview._expectedAllocation.reversalEntryId, 71);
      } else {
        assert.equal(next.preview, undefined, next.reply);
        if (h.has('payment.execute')) assert.match(next.reply, /请给出要续办的那批对应的回执编号/);
      }
      if (multiTurn && h.has('payment.execute')) {
        const formerlyFull = await h.send('按撤回后重新有余量的那批继续补办', checked.task.id);
        assert.equal(formerlyFull.preview?.totalCents, proof ? 150 : undefined, formerlyFull.reply);
        if (proof) assert.equal(h.store.get(formerlyFull.task.id).preview._expectedAllocation.reversalEntryId, 70);
        else assert.match(formerlyFull.reply, /#75/);
        const justCleared = await h.send('按刚核清的那批继续补办', checked.task.id);
        assert.equal(justCleared.preview?.totalCents, 150, justCleared.reply);
        assert.equal(h.store.get(justCleared.task.id).preview._expectedAllocation.reversalEntryId, 71);
      }
    } else assert.doesNotMatch(checked.reply, /#74|#75|补满财务|核清财务/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}

test('满批重开并核清边界 只收到撤回口述而原批仍满时只续办已核清的另一批', async () => {
  const h = fixture('preset_finance_specialist');
  cashCrossBatch(h, true);
  const [first, second] = h.context.reversalBatches;
  second.issue = { id: 74, reason: 'receipt', check: 'missing' };
  second.open = null;
  const original = await h.send('收款单 ' + rc + ' 超出部分分次改归到多个批次，回执 #72 和 #74，重新核对');
  delete second.issue;
  second.posted.push({ id: 74, cents: 50, operator: '核清财务' });
  second.open = 150;
  h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 });
  h.records[1].paidAmount += 0.5;
  h.records[1].balance -= 0.5;
  const observed = await h.send('已补满的那批又被部分撤回，另一笔待核回执同时核清了，重新核对', original.task.id);
  assert.match(observed.reply, /第 1 笔冲回当前仍已补完[^\n]*请核对该批发生部分撤回的回执编号/);
  assert.match(observed.reply, /#74[^\n]*现已核清/);
  assert.doesNotMatch(observed.reply, /请核对[^\n]*#74/);
  const reopened = await h.send('按撤回后重新有余量的那批继续补办', observed.task.id);
  assert.equal(reopened.preview, undefined, reopened.reply);
  const available = await h.send('按刚核清的那批继续补办', observed.task.id);
  assert.equal(available.preview?.totalCents, 150, available.reply);
  assert.equal(h.store.get(available.task.id).preview._expectedAllocation.reversalEntryId, second.id);
  assert.equal(first.open, 0);
  assert.deepEqual(h.writes, []);
});

for (const code of compared) test('多批口语对照 核销首轮和接班 ' + code, async () => {
  const h = fixture(code, null);
  cashCrossBatch(h, true);
  const [first, second] = h.context.reversalBatches;
  second.issue = { id: 74, reason: 'receipt', check: 'missing', movementCents: 50 };
  second.open = null;
  const start = await h.send('收款单 ' + rc + '，这几笔回执 #72 和 #74，看看各批还差多少');
  assert.equal(start.preview, undefined);
  if (!h.has('payment.view')) {
    assert.match(start.reply, /权限/);
    assert.deepEqual(h.reads, []);
    return;
  }
  assert.match(start.reply, /第 1 笔冲回已补完/);
  assert.match(start.reply, /暂未取得[^\n]*#74/);
  first.posted[0].cents -= 150;
  first.open = 150;
  const restored = h.entries.find(entry => entry.entryId === first.posted[0].id);
  restored.amount -= 1.5;
  h.records[1].paidAmount -= 1.5;
  h.records[1].balance += 1.5;
  delete second.issue;
  second.posted.push({ id: 74, cents: 50, operator: '核清财务' });
  second.open = 150;
  h.entries.push({ entryId: 74, recordId: 12, amount: 0.5 });
  h.records[1].paidAmount += 0.5;
  h.records[1].balance -= 0.5;
  const progress = await h.send('另一笔回执对上了，之前补满的那批退回了一点，帮我再查下。', start.task.id);
  assert.equal(progress.preview, undefined);
  assert.match(progress.reply, /第 1 笔冲回[^\n]*重新有余量[^\n]*#72/);
  assert.match(progress.reply, /#74[^\n]*现已核清/);
  const preview = await h.send('刚对上的那批，给我个预览。', progress.task.id);
  if (h.has('payment.execute')) {
    assert.equal(preview.preview?.totalCents, 150, preview.reply);
    assert.equal(h.store.get(preview.task.id).preview._expectedAllocation.reversalEntryId, 71);
    h.actor.permissions = h.actor.permissions.filter(permission => permission !== 'payment.execute');
    const denied = await h.send('先试算重新有余量的那批。', progress.task.id);
    assert.equal(denied.preview, undefined);
    assert.match(denied.reply, /权限/);
  } else {
    assert.equal(preview.preview, undefined, preview.reply);
    assert.match(preview.reply, /权限/);
  }
  assert.deepEqual(h.writes, []);
});
