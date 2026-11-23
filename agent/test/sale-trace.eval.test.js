import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const original = 'SL20261122041';
const unrelated = 'SL20261122075';
const caseText = '追查销售单 ' + original + ' 的仓库任务、部分退货和分笔收款核销';
const whNo = ['WT20261122081','WT20261122082'];
const returnNo = ['SR20261122091','SR20261122092'];
const receiptNo = ['RC20261122071','RC20261122072'];
const permissions = { sale: 'sale.order.view', warehouse: 'warehouse.task.view', returns: 'return.order.view', finance: 'payment.view' };

function fixture(code, wrongModel) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: code, roleName: role.name, permissions: role.after.slice(), warehouseIds: [11, 12] };
  const store = new TaskStore(null);
  const context = { shippedSecond: false, warehouseFailure: false, wrongReturn: false, wrongReceipt: false };
  const reads = [], writes = [], plans = [];
  const has = kind => actor.permissions.includes(permissions[kind]);
  const list = rows => ({ list: rows, pagination: { total: rows.length } });
  const item = { id: 1, productId: 9, productName: '合成长铰链', unit: '个' };
  const sale = { id: 41, orderNo: original, status: 3, warehouseId: 11, warehouseName: '一仓' };
  const warehouse = index => ({ id: 81 + index, taskNo: whNo[index], saleOrderId: sale.id, saleOrderNo: sale.orderNo,
    status: index === 0 || context.shippedSecond ? 7 : 5, shippedAt: index === 0 || context.shippedSecond ? '2026-11-22' : null,
    taskType: 'sale_out', warehouseId: 11 + index, warehouseName: index ? '二仓' : '一仓', sortingBinId: 1 });
  const returned = index => ({ id: 91 + index, returnNo: returnNo[index], saleOrderId: sale.id, saleOrderNo: sale.orderNo, warehouseId: 11,
    status: index ? 1 : 3, totalAmount: index ? 30 : 90 });
  const ar = { id: 61, orderId: sale.id, orderNo: original, type: 2, confirmStatus: 1, status: 2, totalAmount: 85, paidAmount: 50, balance: 35 };
  const entries = [30, 20].map((amount, i) => ({ id: 101 + i, recordId: 61, receiptId: 71 + i, amount }));
  const client = { baseUrl: 'http://fixture',
    async get(path) {
      const url = new URL(path, this.baseUrl), p = url.pathname;
      reads.push(path);
      const requireSource = source => assert.ok(has(source), '未获权读取 ' + p);
      switch (p) {
        case '/api/sale/':
          requireSource('sale');
          return list([sale, { ...sale, id: 75, orderNo: unrelated }]);
        case '/api/sale/41':
          requireSource('sale');
          return { ...sale, hasUnreservedItems: true, hasUndispatchedItems: false,
            items: [0, 1].map(i => ({ ...item, warehouseId: 11 + i, quantity: i ? 6 : 4, reservedQty: 4, dispatchedQty: 4,
              shippedQty: i ? context.shippedSecond ? 4 : 0 : 4 })),
            tasks: [0, 1].map(i => ({ ...warehouse(i), taskId: 81 + i })) };
        case '/api/fulfillment/sale/41':
          requireSource('sale');
          return { id: 41, type: 'sale', activeIssueKinds: [], detectedCount: 0, issues: [] };
        case '/api/warehouse-tasks/':
          requireSource('warehouse');
          return list([...([0,1].map(warehouse).filter(row => actor.warehouseIds.includes(row.warehouseId))), { ...warehouse(0), id: 99, saleOrderNo: original + '0' }]);
        case '/api/warehouse-tasks/81': case '/api/warehouse-tasks/82': {
          requireSource('warehouse');
          const i = p.endsWith('81') ? 0 : 1;
          if (i && context.warehouseFailure) throw Object.assign(new Error('fixture status outage'), { status: 503 });
          return { ...warehouse(i), items: [{ ...item, requiredQty: 4, pickedQty: i && !context.shippedSecond ? 1 : 4 }] };
        }
        case '/api/returns/sale':
          requireSource('returns');
          assert.equal(url.searchParams.get('saleOrderNo'), original);
          return list([returned(0), returned(1), { ...returned(0), id: 99, saleOrderId: 75, saleOrderNo: unrelated }]);
        case '/api/returns/sale/91': case '/api/returns/sale/92': {
          requireSource('returns');
          const i = p.endsWith('91') ? 0 : 1;
          return { ...returned(i), ...(context.wrongReturn ? { saleOrderId: 75 } : {}),
            executedAmount: i ? null : 35, items: [{ ...item, quantity: i ? 1 : 3 }],
            task: i ? null : { id: 51, taskNo: 'RT20261122051', status: 5 } };
        }
        case '/api/return-tasks/51':
          requireSource('returns');
          return { id: 51, taskNo: 'RT20261122051', returnId: 91, returnNo: returnNo[0], returnType: 'sale', warehouseId: 11, status: 5,
            items: [{ ...item, expectedQty: 3, receivedQty: 3, checkedQty: 3, putawayQty: 2, rejectedQty: 1 }] };
        case '/api/payments/':
          requireSource('finance');
          return list([ar, { ...ar, id: 99, orderId: 75, orderNo: unrelated, balance: 9090 }]);
        case '/api/payments/61/entries':
          requireSource('finance');
          return entries;
        case '/api/payments/receipts/71': case '/api/payments/receipts/72': {
          requireSource('finance');
          const i = p.endsWith('71') ? 0 : 1;
          return { id: 71 + i, receiptNo: receiptNo[i], type: 2, amount: i ? 20 : 80, settledAmount: i ? 20 : 70, balance: i ? 0 : 10,
            settlements: [{ entryId: 101 + i, recordId: 61, orderId: context.wrongReceipt ? 75 : 41, orderNo: original, type: 2, amount: entries[i].amount },
              ...(i ? [] : [{ entryId: 123, recordId: 96, orderId: 75, orderNo: unrelated, type: 2, amount: 40 }])] };
        }
      }
      throw new Error('未定义的合成接口 ' + path);
    },
    async post(path) { writes.push(path); throw new Error('该评测阶段应为零业务写入'); },
  };
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { plans.push(text); return wrongModel; } } });
  const send = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', body: { message, taskId }, actor, client });
  const taskView = id => runtime.dispatch({ method: 'GET', pathname: '/tasks/' + id, actor, client });
  return { send, has, reads, writes, plans, context, actor, taskView };
}

test('批次读失败和来源仓撤销时只报告当前已核实的批次', async () => {
  const h = fixture('preset_warehouse_operator');
  const start = await h.send(caseText);
  trace(h, start);
  h.context.warehouseFailure = true;
  const failed = await h.send('重新核对原单', start.task.id);
  assert.match(failed.reply, /部分可见批次还需/);
  assert.match(failed.reply, /WT20261122081[^\n]*实出 4 个/);
  assert.doesNotMatch(failed.reply, /WT20261122082[^\n]*已拣 1 个/);
  h.actor.warehouseIds = [11];
  await assert.rejects(h.taskView(failed.task.id), { status: 403 });
  const limited = await h.send('重新核对原单', failed.task.id);
  assert.doesNotMatch(limited.reply, /WT20261122082|二仓/);
});

test('退货详情和核销分录关联不符时不拼入本单', async () => {
  const returns = fixture('preset_customer_service');
  const a = await returns.send(caseText);
  returns.context.wrongReturn = true;
  const wrongReturn = await returns.send(returnNo[0], a.task.id);
  assert.match(wrongReturn.reply, /原单.*未能核实/);
  assert.doesNotMatch(wrongReturn.reply, /¥35|已入仓|SR20261122092/);
  const finance = fixture('preset_finance_specialist');
  const b = await finance.send(caseText);
  finance.context.wrongReceipt = true;
  const wrongReceipt = await finance.send(receiptNo[0], b.task.id);
  assert.match(wrongReceipt.reply, /原单.*未能核实/);
  assert.doesNotMatch(wrongReceipt.reply, /本单核销|其他单/);
});

test('核销跟进复查已有关联并给正式入口，不重登或替用户提交', async () => {
  const h = fixture('preset_finance_specialist');
  const start = await h.send(caseText);
  const out = await h.send('接着核销 ' + receiptNo[0], start.task.id);
  assert.match(out.reply, /本单核销 ¥30.*当前账号可在原收款单核对后按正式流程办理/s);
  assert.equal(out.preview, undefined);
  assert.deepEqual(h.writes, []);
});

test('短句追问原单实发，指定退货单时给出同单办公入口', async () => {
  const h = fixture('preset_customer_service');
  const start = await h.send(caseText);
  const again = await h.send('原单发了几批？', start.task.id);
  trace(h, again);
  assert.match(again.reply, /实发 4 个/);
  const result = await h.send('接着核对 ' + returnNo[1], again.task.id);
  assert.deepEqual(result.result.sources, ['returns']);
  assert.equal(result.result.returnId, 92);
  assert.match(result.reply, /草稿待确认.*有退货确认权限的销售岗/s);
  assert.doesNotMatch(result.reply, /SR20261122091|WT20261122081/);
});

test('财务继续办理权限撤回后不重放历史中的办理提示', async () => {
  const h = fixture('preset_finance_specialist');
  const report = await h.send(caseText);
  const before = await h.send('接着核销 ' + receiptNo[0], report.task.id);
  assert.match(before.reply, /当前账号可在原收款单/);
  h.actor.permissions = h.actor.permissions.filter(code => code !== 'payment.execute');
  await assert.rejects(h.taskView(before.task.id), { status: 403 });
  const now = await h.send('接着核对 ' + receiptNo[0], before.task.id);
  assert.match(now.reply, /本单核销 ¥30.*请由财务在原收款单核对/s);
  assert.doesNotMatch(now.reply, /当前账号可在原收款单/);
});
function trace(h, out) {
  assert.equal(out.task?.graph, 'L-sale-handoff', out.reply);
  assert.equal(out.task.state, 'DONE', out.reply);
  assert.equal(out.result.orderNo, original);
  assert.ok(out.result.trace, out.reply);
  assert.match(out.reply, /已办.*卡点.*下一步/s);
}
const cases = {
  '五岗位同题只见已授权链路和独立数量金额': async h => {
    const out = await h.send(caseText);
    trace(h, out);
    assert.deepEqual(out.result.sources.slice().sort(), Object.keys(permissions).filter(h.has).sort());
    if (h.has('sale')) assert.match(out.reply, /订购 10 个.*实发 4 个.*未发 6 个/);
    if (h.has('warehouse')) assert.match(out.reply, /WT20261122081.*实出 4 个.*WT20261122082.*待打包/s);
    else assert.doesNotMatch(out.reply, /WT2026112208/);
    if (h.has('returns')) assert.match(out.reply, /SR20261122091.*申请 3 个.*已入仓 2 个.*实际冲减 ¥35.*SR20261122092.*草稿/s);
    else assert.doesNotMatch(out.reply, /SR2026112209|实际冲减/);
    if (h.has('finance')) assert.match(out.reply, /应收 ¥85.*已收 ¥50.*未结 ¥35.*RC20261122071.*本单核销 ¥30.*RC20261122072.*本单核销 ¥20/s);
    else assert.doesNotMatch(out.reply, /RC2026112207|¥85|¥50/);
    assert.doesNotMatch(out.reply, new RegExp(unrelated + '|9090|本单核销 ¥70|本单核销 ¥80'));
  },
  '缺原单号只追问，补一个编号追查同一条': async h => {
    const missing = await h.send('追查这张销售单的退货和分笔收款');
    assert.equal(missing.task?.state, 'DISAMBIGUATING', missing.reply);
    assert.match(missing.reply, /完整销售单号/);
    assert.equal(h.reads.length, 0);
    const out = await h.send(original, missing.task.id);
    trace(h, out);
    assert.equal(out.task.id, missing.task.id);
  },
  '短问重新核对原单时更新真实阶段与数量': async h => {
    const start = await h.send(caseText);
    trace(h, start);
    h.context.shippedSecond = true;
    const out = await h.send('重新核对原单', start.task.id);
    trace(h, out);
    if (h.has('sale')) assert.match(out.reply, /实发 8 个.*未发 2 个/);
    if (h.has('warehouse')) assert.match(out.reply, /WT20261122082.*已出库.*实出 4 个/);
  },
  '不确定第二笔属于哪一类时只问关联号码': async h => {
    const start = await h.send(caseText);
    const before = h.reads.length;
    const unsure = await h.send('看看第二笔', start.task?.id);
    assert.match(unsure.reply, /完整.*号/);
    assert.equal(h.reads.length, before);
  },
  '指定关联收款只读原单 allocations 并阻止别单': async h => {
    const start = await h.send(caseText);
    trace(h, start);
    const out = await h.send('接着核对 ' + receiptNo[0], start.task.id);
    if (h.has('finance')) {
      assert.match(out.reply, /RC20261122071.*本单核销 ¥30/s);
      assert.doesNotMatch(out.reply, /本单核销 ¥70|RC20261122072|SL20261122075/);
    } else assert.match(out.reply, /权限|范围内未能/);
    const foreign = await h.send('接着核对 RC20261122999', start.task.id);
    assert.match(foreign.reply, /原单.*(?:未核实|未能核实|未找到)|权限/);
    assert.ok(!h.reads.some(path => path.includes('22999')));
  },
};

for (const [name, run] of Object.entries(cases)) for (const code of compared) {
  for (const model of [null, { graph: 'F-briefing' }]) test(name + ' / ' + code + (model ? ' / 受控错路由' : ' / 规则'), async () => {
    const h = fixture(code, model);
    await run(h);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.plans, []);
  });
}
