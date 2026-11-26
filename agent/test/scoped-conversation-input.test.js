import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../src/tasks.js';
import { handleMessage } from '../src/agent.js';
import { FlowClient } from '../src/flow.js';
import { forwardedMessage } from '../src/input-source.js';
import { createFixtureFlow, stock } from './fixtures/role-conversation-flow.js';

const actor = { id: 871, username: '测试业务员', isSuper: true, warehouseIds: [1, 2] };
const sale = '给远山机电2号店开单：长款铰链 2个，短款铰链 3个';
function context() { return { store: new TaskStore(null), ...createFixtureFlow(actor) }; }

test('同轮开单保留明示单位', async () => {
  const { client, store } = context();
  const out = await handleMessage(store, client, actor, '给远山机电2号店开单：长款铰链 2箱');
  assert.equal(out.preview, undefined);
  assert.match(out.reply, /单位/);
});

test('建议的商品行以原话配对的商品、数量、单位为准', async () => {
  const { client, store } = context();
  const proposed = { graph: 'B-sale-draft', customerKeyword: '远山机电2号店',
    lines: [{ productKeyword: '短款铰链', qty: 5 }] };
  const out = await handleMessage(store, client, actor, '远山机电2号店要订两个长款铰链，帮我先把单子建出来', { parseIntent: async () => proposed });
  if (out.preview) {
    assert.deepEqual(out.preview.lines.map(row => [row.productId, row.qty, row.unit]), [[11, 2, '个']]);
  } else assert.match(out.reply, /原文|原话|商品|数量/);
});

test('超过两千条库存时，多行草稿仅请求本单商品', async () => {
  const { client, store } = context();
  const original = client.get.bind(client), stockCalls = [];
  client.get = async path => {
    const { pathname, searchParams } = new URL(path, 'http://fixture');
    if (pathname !== '/api/inventory/stock') return original(path);
    stockCalls.push(searchParams);
    const ids = searchParams.get('productIds')?.split(',').map(Number);
    const rows = ids ? stock.filter(r => ids.includes(r.productId)) : Array.from({ length: 2101 }, (_, i) => ({ id: i + 1, productId: i + 100, warehouseId: 1 }));
    const offset = (Number(searchParams.get('page')) - 1) * 100;
    return { list: rows.slice(offset, offset + 100), pagination: { total: rows.length } };
  };
  const out = await handleMessage(store, client, actor, sale);
  assert.equal(out.preview?.lines.length, 2);
  assert.ok(stockCalls.length <= 2);
  assert.ok(stockCalls.every(q => q.get('productIds') === '11,12'));
});

test('已选上下文先核对任务归属', async () => {
  const { store, client, reads } = context();
  const task = store.create({ graph: 'J-receipt-status', userText: '收款进度', actor });
  const another = { ...actor, id: 872 };
  await assert.rejects(handleMessage(store, client, another, '看这笔最近一次', { taskId: task.id }), e => e.status === 403);
  assert.equal(reads.length, 0);
});

for (const [graph, preview] of [
  ['L-sale-handoff', {}], ['B2-reserve', {}], ['N-return-finance', {}],
  ['D-settle', { _explicit: true, _monthly: true }], ['J-receipt-status', {}],
]) {
  test(graph + ' 的当前读取权限须先于批次元数据核对', async () => {
    const { store, client } = context();
    const task = store.create({ graph, userText: '业务核对', actor });
    task.preview = preview;
    let metadataReads = 0;
    Object.defineProperty(task, 'batchReview', { get() { metadataReads++; } });
    const restricted = { ...actor, isSuper: false, permissions: [], warehouseIds: [] };
    const out = await handleMessage(store, client, restricted, '看这笔最近一次', { taskId: task.id });
    assert.equal(metadataReads, 0);
    assert.equal(out.task, null);
    assert.equal(out.detachTask, true);
    assert.equal(out.preview, undefined);
  });
}

test('引号开头的普通尾注仍属于引用，闭合的嵌套引语允许另行说明要求', () => {
  assert.ok(forwardedMessage('「库存情况」以上为转述'));
  const input = '客户留言：「产品“甲型”有货吗？」\n我的要求：查一仓库存';
  assert.equal(forwardedMessage(input).instruction, '查一仓库存');
});

for (const [open, close] of [['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’'], ['«', '»'], ['"', '"']]) {
  test('转述后续再次沿用同一对引号时要求单独说明 ' + open + close, () => {
    const quote = value => open + value + close;
    assert.equal(forwardedMessage('客户留言：' + quote('色号甲') + '\n我的要求：备注' + quote('色号乙')).instruction, null);
    assert.equal(forwardedMessage('客户留言：' + quote('色号甲') + '\n我的要求：记录色号').instruction, '记录色号');
  });
}

for (const status of [408, 409, 429]) {
  test('回执查询保留 HTTP ' + status, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: false }), { status }));
    const client = new FlowClient('http://fixture', null);
    await assert.rejects(client.requestStatus('fixture', 'sale.create'), e => e.status === status);
  });
}
test('只有明确的未找到回执返回空值', async t => {
  let response = '<html>网关暂不可用</html>';
  t.mock.method(globalThis, 'fetch', async () => new Response(response));
  const client = new FlowClient('http://fixture', null);
  await assert.rejects(client.requestStatus('fixture', 'sale.create'), e => e.kind === 'unknown');
  response = JSON.stringify({ success: true, data: { status: 'not_found' } });
  assert.equal(await client.requestStatus('fixture', 'sale.create'), null);
});
