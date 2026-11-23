import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmTask, handleMessage } from '../src/agent.js';
import { parseIntentLLM } from '../src/llm.js';
import { assertTaskAccess, listTaskViews } from '../src/task-access.js';
import { TaskStore } from '../src/tasks.js';

const actor = (permissions, warehouseIds = [7]) => ({ id: 18, username: 'synthetic', permissions, warehouseIds });
const receipt = { id: 41, receiptNo: 'RC20261122041', type: 2, amount: 19.75, settledAmount: 5.25, balance: 14.5, status: 2, accountName: '不得返回的测试字段' };
const returned = { id: 31, returnNo: 'SR20261122031', warehouseId: 7, status: 2, task: { taskNo: 'RT20261122031', statusName: '待检验' }, customerName: '不得返回的测试字段' };
const total = (count, list = []) => ({ list, pagination: { total: count } });

function setup() {
  const store = new TaskStore(null);
  const paths = [];
  const client = {
    post: async () => assert.fail('查询不得提交业务写入'),
    get: async path => {
      const url = new URL(path, 'http://fixture');
      paths.push(url);
      const query = url.searchParams;
      switch (url.pathname) {
        case '/api/search/': return [{ id: 10, type: 'customer', title: query.get('q'), searchRank: 0 }];
        case '/api/payments/party-ledger': return { summary: { closingBalance: 20 } };
        case '/api/dashboard/summary': return { pendingSaleOrders: 3, pendingPurchaseOrders: 8, inventoryValue: 99999 };
        case '/api/warehouse-tasks/stats': return { picking: 1, sorting: 2, checking: 0, packing: 0, shipping: 4 };
        case '/api/inbound-tasks/': return total(1);
        case '/api/returns/purchase': return total(0);
        case '/api/returns/sale': return !query.has('status') || query.get('status') === '2' ? total(1, [returned]) : total(0);
        case '/api/returns/sale/31': return returned;
        case '/api/payments/receipts': return query.has('status') ? total(query.get('status') === '1' ? 2 : 1) : total(1, [receipt]);
        case '/api/payments/receipts/41': return receipt;
        default: throw new Error('unexpected ' + path);
      }
    },
  };
  let planned = 0;
  const read = (who, text, options = {}) => handleMessage(store, client, who, text, {
    parseIntent: async () => { planned++; return { graph: 'D-receipt', customerKeyword: '样例客户' }; },
    ...options,
  });
  return { store, paths, client, read, planned: () => planned };
}

test('模型省略客户前缀时，从原文恢复销售、台账和收款客户', async () => {
  for (const [graph, text, extra] of [
    ['B-sale-draft', '请给样例白榆公司华南门店开销售草稿，密封条 3 个', { lines: [{ productKeyword: '密封条', qty: 3 }] }],
    ['D-ledger', '帮忙看一下样例白榆公司华南门店的应收余额还有多少', {}],
    ['D-receipt', '收到样例白榆公司华南门店打来的 19.75 元，麻烦登记收款再核销', { amount: 19.75 }],
  ]) {
    const content = JSON.stringify({ graph, customerKeyword: '白榆公司', ...extra });
    const intent = await parseIntentLLM(text, {
      baseUrl: 'http://fixture', apiKey: 'fixture', model: 'fixture',
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }),
    });
    assert.equal(intent?.customerKeyword, '样例白榆公司华南门店', text);
  }
});

test('台账和从短模型名恢复的客户以原文为准，无法定位时不查询错客户', async () => {
  const h = setup();
  const finance = actor(['payment.view', 'dashboard.view', 'customer.view']);
  const parseIntent = async () => ({ graph: 'D-ledger', customerKeyword: '白榆公司' });
  const hit = await h.read(finance, '帮忙看一下样例白榆公司华南门店的应收余额还有多少', { parseIntent });
  assert.match(hit.reply, /样例白榆公司华南门店/);
  assert.equal(h.paths[0].searchParams.get('q'), '样例白榆公司华南门店');
  const count = h.paths.length;
  const unclear = await h.read(finance, '查一下它的应收和上次那笔的区别', { parseIntent });
  assert.match(unclear.reply, /客户全称/);
  assert.equal(h.paths.length, count);
});

test('同题岗位待办逐项授权，只展示可见来源并在撤权后隐藏快照', async () => {
  for (const [perms, included, excluded] of [
    [['dashboard.view', 'sale.order.view'], /待处理销售订单.*3/, /采购|核销|拣货/],
    [['warehouse.task.view', 'inbound.order.view'], /拣货.*1/, /销售订单|核销/],
    [['dashboard.view', 'purchase.order.view'], /待处理采购订单.*8/, /销售订单|核销/],
    [['payment.view'], /待核销收款单.*2/, /销售订单|采购|拣货/],
    [['dashboard.view'], /权限|可见/, /3 单|8 单|核销/],
  ]) {
    const h = setup();
    const who = actor(perms);
    const out = await h.read(who, '小满，我今天先做什么？');
    assert.match(out.reply, included);
    assert.doesNotMatch(out.reply, excluded);
    assert.equal(h.planned(), 0);
    if (out.task?.state === 'DONE') {
      assert.equal(listTaskViews(h.store, who).length, 1);
      assert.throws(() => assertTaskAccess(out.task, actor([])), /权限/);
      assert.doesNotMatch(JSON.stringify(out.result), /99999|不得返回/);
    } else assert.equal(h.paths.length, 0);
  }
});

test('退货卡点走退货权限、分清草稿和关联任务，拒绝仓库范围缩小后的历史', async () => {
  const h = setup();
  const who = actor(['return.order.view']);
  const summary = await h.read(who, '现在有哪些退货卡点？');
  assert.equal(summary.task.state, 'DONE');
  assert.match(summary.reply, /已确认待执行.*1/);
  const exact = await h.read(who, 'sr20261122031 为什么还没退完？', { taskId: summary.task.id });
  assert.match(exact.reply, /RT20261122031.*待检验/);
  assert.doesNotMatch(JSON.stringify(exact.result), /不得返回/);
  assert.throws(() => assertTaskAccess(exact.task, actor(['return.order.view'], [8])), /仓库范围/);
  const count = h.paths.length;
  const denied = await h.read(actor(['dashboard.view']), '查 SR20261122031 的退货进度');
  assert.match(denied.reply, /权限/);
  assert.equal(h.paths.length, count);
  assert.equal(h.planned(), 0);
});

test('收款状态区分已核销与单据余额，只认完整、同类型单号', async () => {
  const h = setup();
  const who = actor(['payment.view'], []);
  const out = await h.read(who, '收款单 rc20261122041 为什么还有钱没核销？');
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /部分核销/);
  assert.match(out.reply, /19\.75.*5\.25.*14\.50/);
  assert.match(out.reply, /收款单.*余额/);
  assert.doesNotMatch(JSON.stringify(out.result), /不得返回/);
  assert.deepEqual(h.paths.map(u => u.pathname), ['/api/payments/receipts', '/api/payments/receipts/41']);
  const replay = await confirmTask(h.store, h.client, out.task.id, who);
  assert.equal(replay.task.state, 'DONE');
  assert.equal(h.paths.length, 2);
  assert.throws(() => assertTaskAccess(out.task, actor([])), /权限/);
  const notFound = await h.read(who, 'RC20261122999 核销了吗？');
  assert.match(notFound.reply, /未找到.*RC20261122999/);
  assert.equal(h.paths.length, 3);
  const missing = await h.read(who, '这张收款单怎么还没核销？');
  assert.match(missing.reply, /完整收款单号/);
  assert.equal(h.paths.length, 3);
  assert.equal(h.planned(), 0);
});

test('多单号、未识别的仓库限定和写入措辞不被当作单条只读查询', async () => {
  const h = setup();
  const who = actor(['return.order.view', 'payment.view', 'dashboard.view']);
  assert.match((await h.read(who, 'RC20261122041 和 RC20261122042 都核销了吗')).reply, /一张|一个/);
  assert.match((await h.read(who, '只看外区仓的退货卡点')).reply, /仓库/);
  assert.match((await h.read(who, '帮我取消 SR20261122031，查下退货状态')).reply, /页面|流程/);
  assert.match((await h.read(who, '请帮我核销收款单 RC20261122041')).reply, /原页面|收款页/);
  assert.equal(h.paths.length, 0);
  assert.equal(h.planned(), 0);
});

test('点名打包时只列可见仓库的打包队列，按正式接口顺序标出紧急单', async () => {
  const h = setup();
  const seen = [];
  h.client.get = async path => {
    const url = new URL(path, 'http://fixture');
    seen.push(url);
    assert.equal(url.pathname, '/api/warehouse-tasks/');
    assert.equal(url.searchParams.get('status'), '5');
    assert.equal(url.searchParams.get('pageSize'), '3');
    return total(1, [{ taskNo: 'WT20261122055', status: 5, warehouseId: 7, priority: 1, customerName: '不得返回的测试字段' }]);
  };
  const out = await h.read(actor(['warehouse.task.view']), '我今天负责打包，先看哪几单？');
  assert.equal(out.task?.state, 'DONE');
  assert.match(out.reply, /打包.*1 单/);
  assert.match(out.reply, /WT20261122055.*紧急/);
  assert.match(out.reply, /可见仓库/);
  assert.doesNotMatch(JSON.stringify(out.result), /不得返回/);
  assert.equal(seen.length, 1);
  assert.equal(h.planned(), 0);
});

test('单问采购退货只查采购，收款状态释义无需查单', async () => {
  const h = setup();
  const out = await h.read(actor(['return.order.view']), '采购退货卡点');
  assert.deepEqual(out.result.sources.map(source => source.type), ['PR']);
  assert.deepEqual(h.paths.map(row => row.pathname), ['/api/returns/purchase', '/api/returns/purchase']);
  const concept = await h.read(actor([]), '待核销和部分核销有什么区别？');
  assert.match(concept.reply, /收款已登记/);
  assert.match(concept.reply, /剩余金额仍在收款单上/);
  assert.match(concept.reply, /完整收款单号/);
  assert.equal(h.paths.length, 2);
  assert.equal(h.planned(), 0);
});

test('带业务类型的完整自定义单号仍按原类型精确核对', async () => {
  const h = setup();
  const customReceipt = { ...receipt, receiptNo: 'PAYIN-20261122041' };
  const customReturn = { ...returned, returnNo: 'SRTN-20261122031' };
  h.client.get = async raw => {
    const url = new URL(raw, 'http://fixture');
    h.paths.push(url);
    if (url.pathname === '/api/payments/receipts') {
      assert.equal(url.searchParams.get('type'), '2');
      assert.equal(url.searchParams.get('receiptNo'), customReceipt.receiptNo);
      return total(1, [customReceipt]);
    }
    if (url.pathname === '/api/payments/receipts/41') return customReceipt;
    if (url.pathname === '/api/returns/sale') {
      assert.equal(url.searchParams.get('keyword'), customReturn.returnNo);
      return total(1, [customReturn]);
    }
    if (url.pathname === '/api/returns/sale/31') return customReturn;
    assert.fail('单据类型不应扩大');
  };
  const who = actor(['payment.view', 'return.order.view']);
  assert.match((await h.read(who, '收款单 payin-20261122041 核销了吗？')).reply, /PAYIN-20261122041.*部分核销/);
  assert.match((await h.read(who, '查销售退货单 srtn-20261122031 的进度')).reply, /SRTN-20261122031.*已确认待执行/);
  assert.equal(h.paths.length, 4);
  assert.equal(h.planned(), 0);
});

test('规则模式能用原话中的引号和门店名准备销售草稿', async () => {
  const { createFixtureFlow } = await import('./fixtures/role-conversation-flow.js');
  const who = { ...actor([], [1]), isSuper: true };
  const { client, reads, writes } = createFixtureFlow(who);
  const out = await handleMessage(new TaskStore(null), client, who,
    '请给「远山机电2号店」开销售草稿，长款铰链两个', { parseIntent: async () => null });
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(reads[0].query.q, '远山机电2号店');
  assert.equal(out.preview.customer.name, '远山机电2号店');
  assert.equal(writes.length, 0);
});
