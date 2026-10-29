import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMessage } from '../src/agent.js';
import { TaskStore } from '../src/tasks.js';
import { DISCUSSION_CLOSED_REPLY } from '../src/routing.js';

const actor = { id: 11, username: 'routing-owner', isSuper: true, warehouseIds: null };
function context() {
  const store = new TaskStore(null);
  const calls = { chat: [], searches: [], ledger: 0, flow: 0, planner: 0 };
  const client = { get: async path => {
    calls.flow++;
    const url = new URL(path, 'http://fixture');
    if (url.pathname === '/api/search/') {
      const keyword = url.searchParams.get('q'); calls.searches.push(keyword);
      return keyword === '合成甲' ? [{ id: 7, type: 'customer', title: '合成甲' }] : [];
    }
    if (url.pathname === '/api/payments/party-ledger') { calls.ledger++; return { summary: { closingBalance: 18.52 }, unassignedCount: 0, list: [] }; }
    throw new Error(`unexpected ${path}`);
  }, post: () => assert.fail('路由测试不能执行业务写入') };
  const options = {
    parseIntent: async () => { calls.planner++; return null; },
    chatModel: async input => { calls.chat.push(input); return '可以从信息层级和使用场景来理解这个问题。'; },
  };
  return { store, calls, client, options };
}

test('欠款查询进入已有台账规则，完整提取客户关键词，零闲聊调用', async () => {
  const { store, calls, client, options } = context();
  const out = await handleMessage(store, client, actor, '帮我查一下合成甲的欠款', options);
  assert.equal(out.task?.graph, 'D-ledger');
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(calls.searches, ['合成甲']);
  assert.equal(calls.ledger, 1);
  assert.equal(calls.chat.length, 0);
});

test('这张单、这笔款和刚才对象缺少身份时先澄清，零模型和工具调用', async () => {
  for (const message of ['查一下这张单的状态', '这笔款还有多少没收', '帮我核对它的余额', '看一下刚才那张', '帮我查一下上笔还有多少']) {
    const { store, calls, client, options } = context();
    const out = await handleMessage(store, client, actor, message, options);
    assert.equal(out.task, null, message);
    assert.match(out.reply, /请.*(?:单号|对象|类型|客户|商品|编号)/, message);
    assert.equal(calls.chat.length, 0, message);
    assert.equal(calls.planner, 0, message);
    assert.equal(calls.flow, 0, message);
  }
});

test('正式单据和主数据编号查询保守进业务，不发给普通聊天模型', async () => {
  for (const message of ['SL20261026001现在怎么样', 'P000123在哪', 'C000123余额是多少']) {
    const { store, calls, client, options } = context();
    const out = await handleMessage(store, client, actor, message, { ...options, parseIntent: async () => ({ graph: 'none' }) });
    assert.notEqual(out.task?.graph, 'G-chat', message);
    assert.equal(calls.chat.length, 0, message);
  }
});

test('苹果公司和泛科技设计不属于极序交流，直接婉拒且零调用', async () => {
  for (const message of ['你怎么看苹果公司的产品设计？', '聊聊科技公司的极简设计']) {
    const { store, calls, client, options } = context();
    const out = await handleMessage(store, client, actor, message, options);
    assert.equal(out.task, null, message);
    assert.match(out.reply, /只聊极序相关/);
    assert.equal(calls.chat.length, 0);
    assert.equal(calls.planner, 0);
    assert.equal(calls.flow, 0);
  }
});

test('已有本地概念解释不进模型，页面设计和用法讨论直接拒绝', async () => {
  for (const message of ['极序里预占库存是什么意思']) {
    const { calls, client, options, store } = context();
    const out = await handleMessage(store, client, actor, message, options);
    assert.equal(out.task, null, message);
    assert.match(out.reply, /预占/);
    assert.equal(calls.chat.length, 0);
    assert.equal(calls.planner, 0);
    assert.equal(calls.flow, 0);
  }
  for (const message of ['极序的页面设计怎么更清楚', '请解释一下极序销售订单的状态机设计', '极序怎么查询欠款']) {
    const { calls, client, options, store } = context();
    const out = await handleMessage(store, client, actor, message, options);
    assert.equal(out.task, null, message);
    assert.equal(out.reply, DISCUSSION_CLOSED_REPLY, message);
    assert.equal(calls.chat.length, 0);
    assert.equal(calls.planner, 0);
    assert.equal(calls.flow, 0);
  }
});

test('选中历史闲聊后，新的完整欠款查询仍走正式业务规则', async () => {
  const { store, calls, client, options } = context();
  const previous = store.create({ graph: 'G-chat', actor, userText: '小满在吗' });
  previous.state = 'DONE';
  const out = await handleMessage(store, client, actor, '帮我查一下合成甲的欠款', { ...options, taskId: previous.id });
  assert.equal(out.task?.graph, 'D-ledger');
  assert.notEqual(out.task.id, previous.id);
  assert.equal(out.task.state, 'DONE');
  assert.equal(calls.chat.length, 0);
  assert.equal(calls.ledger, 1);
});

test('业务问句里提到讨论也不把当前业务事实请求转去闲聊', async () => {
  const { store, calls, client, options } = context();
  const out = await handleMessage(store, client, actor, '帮我查一下这张单的库存状态，再聊聊设计', options);
  assert.notEqual(out.task?.graph, 'G-chat');
  assert.match(out.reply, /请.*(?:单号|对象|类型|商品)/);
  assert.equal(calls.chat.length, 0);
  assert.equal(calls.flow, 0);
});
