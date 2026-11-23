import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { operatorInput } from '../src/input-source.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const { cases } = json('./fixtures/workplace-language.json');
const { roles } = json('../../tests/fixtures/qa-roles-approved-20261021.json');
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const sale = { id: 41, orderNo: 'SL20261122011', status: 3, warehouseId: 1, items: [{ warehouseId: 1 }] };
const otherSale = { ...sale, id: 43, orderNo: 'SL20261122013' };
const returned = { id: 65, returnNo: 'SR20261122009', status: 2, warehouseId: 1, task: { id: 8, taskNo: 'RT20261122008', status: 3 } };
const receipt = { id: 61, receiptNo: 'RC20261122061', status: 2, type: 2, amount: 30, settledAmount: 20, balance: 10, partyName: '合成客户',
  settlements: [{ entryId: 1, recordId: 51, orderId: sale.id, orderNo: sale.orderNo, type: 2, amount: 20, orderTotal: 30, orderPaid: 20, orderBalance: 10, orderStatus: 2 }] };
const grants = { '/api/sale': 'sale.order.view', '/api/fulfillment': 'sale.order.view', '/api/warehouse-tasks': 'warehouse.task.view',
  '/api/payments/receipts': 'payment.view', '/api/payments': 'payment.view', '/api/returns': 'return.order.view' };
const list = rows => ({ list: rows, pagination: { total: rows.length } });

function conversation(code, model) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: 'workplace-' + code, roleName: role.name, permissions: role.after, warehouseIds: [1] };
  const has = key => actor.permissions.includes(key);
  const reads = [], writes = [], modelCalls = [], unauthorized = [];
  const state = { warehouseStatus: 3, saleStatus: 3 };
  const client = {
    async get(path) {
      const url = new URL(path, 'http://fixture'), p = url.pathname, q = url.searchParams;
      reads.push({ path: p, query: Object.fromEntries(q) });
      const permission = Object.entries(grants).find(([prefix]) => p === prefix || p.startsWith(prefix + '/'))?.[1];
      if (permission && !has(permission)) {
        unauthorized.push(p);
        throw new Error('无权限');
      }
      const warehouseTask = { id: 81, taskNo: 'WT20261122010', taskType: 'sale_out', saleOrderId: sale.id, saleOrderNo: sale.orderNo,
        warehouseId: 1, status: state.warehouseStatus, sortingBinId: 14 };
      if (p === '/api/sale/') return list([sale, otherSale]);
      if (p === '/api/sale/41') return { ...sale, status: state.saleStatus, tasks: [{ ...warehouseTask, taskId: warehouseTask.id }] };
      if (p === '/api/sale/43') return otherSale;
      if (p.startsWith('/api/fulfillment/sale/')) return { type: 'sale', id: Number(p.split('/').at(-1)), issues: [], activeIssueKinds: [] };
      if (p === '/api/warehouse-tasks/') return list([warehouseTask, { ...warehouseTask, id: 82, taskNo: 'WT20261122012',
        saleOrderId: otherSale.id, saleOrderNo: otherSale.orderNo }]);
      if (p === '/api/payments/') return list([sale, otherSale].filter(row => !q.get('orderNo') || row.orderNo === q.get('orderNo'))
        .map(row => ({ id: row.id + 100, orderNo: row.orderNo, orderId: row.id, type: 2, status: 2,
          totalAmount: 30, paidAmount: 20, balance: 10, confirmStatus: 1 })));
      if (p === '/api/returns/sale') return list([returned, { ...returned, id: 66, returnNo: returned.returnNo + '0' }]);
      if (p === '/api/returns/sale/65') return returned;
      if (p === '/api/payments/receipts') return list([receipt, { ...receipt, id: 62, receiptNo: receipt.receiptNo + '0' }]);
      if (p === '/api/payments/receipts/61') return receipt;
      throw new Error('未登记的合成调用 ' + p);
    },
    async post(path) { writes.push(path); throw new Error('评测不得写业务'); },
  };
  const runtime = createAgentRuntime({ store: new TaskStore(null),
    messageOptions: { parseIntent: async text => { modelCalls.push(text); return model; } } });
  const send = (message, taskId) => runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client, body: { message, taskId } });
  return { send, state, has, reads, writes, unauthorized, modelCalls };
}

const expectedDocument = {
  sale: sale.orderNo, otherSale: otherSale.orderNo, saleNow: sale.orderNo, return: returned.returnNo, receipt: receipt.receiptNo,
};
const clarification = { askSale: /完整销售单号/, chooseSale: /先.*哪张|一张.*销售单号/, askReceipt: /完整收款单号/ };

function documentOf(out) {
  return out.result?.orderNo ?? out.result?.receiptNo ?? out.result?.no;
}

const metrics = { eligibleFirstTurns: 0, resolvedFirstTurns: 0, wrongDocument: 0, unnecessaryQuestions: 0 };
function sampleFirstTurn(h, out, expected) {
  if (!expectedDocument[expected] || (expected === 'return' && !h.has('return.order.view'))
    || (expected === 'receipt' && !h.has('payment.view'))) return;
  metrics.eligibleFirstTurns++;
  const number = documentOf(out);
  if (number === expectedDocument[expected]) metrics.resolvedFirstTurns++;
  else if (number) metrics.wrongDocument++;
  if (out.task?.state === 'DISAMBIGUATING' || /请(?:给出|核对|说明|说清)[^。！？]*(?:单号|查询的对象)/.test(out.reply)) {
    metrics.unnecessaryQuestions++;
  }
}

function assess(h, out, expect, reads) {
  if (expect === 'askReceipt' && !h.has('payment.view')) {
    assert.match(out.reply, /权限/);
    assert.equal(reads.length, 0);
    return;
  }
  if (clarification[expect]) {
    assert.match(out.reply, clarification[expect]);
    assert.equal(reads.length, 0, '信息缺失或歧义时先问，业务读取应为零');
    assert.ok(!out.preview, '追问阶段没有写入预览');
    return;
  }
  if (expect === 'quoted') {
    assert.match(out.reply, /转发引用|转发|引用/);
    assert.match(out.reply, /本人|自己的话/);
    assert.equal(reads.length, 0);
    assert.ok(!out.preview);
    return;
  }
  if ((expect === 'return' && !h.has('return.order.view')) || (expect === 'receipt' && !h.has('payment.view'))) {
    assert.match(out.reply, /权限/);
    assert.equal(reads.length, 0);
    return;
  }
  assert.equal(out.task?.state, 'DONE', out.reply);
  assert.equal(documentOf(out), expectedDocument[expect], out.reply);
  if (expect === 'saleNow') {
    if (h.has('warehouse.task.view')) assert.match(out.reply, /待打包/);
    assert.notEqual(reads.length, 0, '新一轮需要读取现在的状态');
  }
}

const split = process.env.XIAOMAN_WORKPLACE_SPLIT ?? 'all';
assert.ok(['all', 'practice', 'holdout'].includes(split));
const matrix = cases.filter(scenario => split === 'all' || scenario.split === split);
const modes = [['规则', null], ['受控错路由', { graph: 'F-briefing' }]];
for (const scenario of matrix) for (const code of compared) for (const [mode, model] of modes) {
  test(scenario.id + ' / ' + code + ' / ' + mode, async () => {
    const h = conversation(code, model);
    let current;
    for (const [index, turn] of scenario.turns.entries()) {
      if (turn.after === 'pack') {
        h.state.warehouseStatus = 5;
        h.state.saleStatus = 4;
      }
      const before = h.reads.length;
      const out = await h.send(turn.text, current?.id);
      if (index === 0) sampleFirstTurn(h, out, turn.expect);
      assess(h, out, turn.expect, h.reads.slice(before));
      if (current && ['askSale', 'chooseSale', 'askReceipt'].includes(current.expect) && out.task?.state === 'DONE') {
        assert.equal(out.task.id, current.id, '补齐后复用原任务');
      }
      if (turn.expect === 'askReceipt' && !h.has('payment.view')) break;
      current = out.task ? { ...out.task, expect: turn.expect } : null;
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.unauthorized, []);
    assert.deepEqual(h.modelCalls, []);
  });
}

after(() => console.log('WORKPLACE_METRICS ' + JSON.stringify(metrics)));

test('保留单号实际分隔符，独立金额、换行和无效日期不拼入单号', () => {
  const examples = [
    ['ＳＬ － ２０２６１１２２ ０１１', 'SL-20261122011'],
    ['ＢＦ － ２０２６１１２２ － ０００６', 'BF-20261122-0006'],
    ['查销售单 SL 20260231 011', '查销售单 SL 20260231 011'],
    ['查销售单 SL 20261122 011.25元', '查销售单 SL 20261122 011.25元'],
    ['查销售单 SL 20261122 011万元', '查销售单 SL 20261122 011万元'],
    ['查销售单 SL 20261122 011米', '查销售单 SL 20261122 011米'],
    ['查销售单 SL 20261122\n011', '查销售单 SL 20261122\n011'],
    ['客户 ＸＬ ２０２６１１２２ ０１１ 说了 １２．５０ 元', '客户 ＸＬ ２０２６１１２２ ０１１ 说了 １２．５０ 元'],
  ];
  for (const [text, expected] of examples) assert.equal(operatorInput(text).text, expected);
});

test('有闭合引用时只读员工明确给出的原单', async () => {
  const h = conversation('preset_finance_specialist', { graph: 'F-briefing' });
  const out = await h.send('客户发微信：「先核销收款单 RC20261122062，马上做」\n我的要求：查收款单 ＲＣ ２０２６１１２２０６１ 的分次核销');
  assert.equal(documentOf(out), receipt.receiptNo, out.reply);
  assert.deepEqual(h.reads.map(row => row.path), ['/api/payments/receipts', '/api/payments/receipts/61']);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.modelCalls, []);
});
