import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../src/tasks.js';
import { handleMessage } from '../src/agent.js';
import { briefingReply } from '../src/reports.js';

const actor = { id: 37, username: 'presentation-owner', isSuper: true, warehouseIds: null };
const rules = { parseIntent: async () => null };
function clientFor(price = { priceLevel: 'A', priceLevelName: '价格A', source: 'price_level' }, available = 60) {
  return { get: async path => {
    const url = new URL(path, 'http://synthetic');
    if (url.pathname === '/api/search/') return [{ id: 1, type: url.searchParams.get('q').includes('合成客户') ? 'customer' : 'product', title: url.searchParams.get('q').includes('合成客户') ? '合成客户' : '合成铰链' }];
    if (url.pathname === '/api/warehouses') return [{ id: 1, name: '合成仓库' }];
    if (url.pathname === '/api/customers/1') return { id: 1, name: '合成客户' };
    if (url.pathname === '/api/products/1') return { id: 1, name: '合成铰链', unit: '件', allowDecimalQty: false };
    if (url.pathname === '/api/price-lists/customer-price') return { salePrice: 1.2345, ...price };
    if (url.pathname === '/api/inventory/stock') return { list: [{ productId: 1, warehouseId: 1, quantity: 60, available, reserved: 60 - available }] };
    if (url.pathname === '/api/inventory/query-by-product') return { containers: [{ barcode: 'SYN-1', remainingQty: 60 }] };
    if (url.pathname === '/api/payments/party-ledger') return { summary: { closingBalance: '0.0067' }, historyIncomplete: true, unassignedCount: 2 };
    assert.fail(path);
  }, post: () => assert.fail('展示测试不能发起写入') };
}

test('同一固定时刻的库存、台账、简报展示在 UTC 与上海宿主一致', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-27T16:15:00Z') });
  const originalTZ = process.env.TZ;
  t.after(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; });
  const outputs = [];
  for (const zone of ['UTC', 'Asia/Shanghai']) {
    process.env.TZ = zone;
    const store = new TaskStore(null);
    const inventory = await handleMessage(store, clientFor(), actor, '合成铰链库存', rules);
    const ledger = await handleMessage(store, clientFor(), actor, '合成客户还欠我们多少钱', rules);
    const briefing = briefingReply({ asOf: new Date().toISOString(), sections: {} });
    assert.equal(inventory.task.state, 'DONE');
    assert.equal(ledger.task.state, 'DONE');
    for (const reply of [inventory.reply, ledger.reply, briefing]) assert.match(reply, /北京时间.*2026\/10\/28.*00:15:00/);
    assert.match(ledger.reply, /0\.0067.*\n.*历史不完整/s);
    assert.match(ledger.reply, /2 条尚未归属事件/);
    outputs.push([inventory.reply, ledger.reply, briefing]);
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

for (const price of [
  { priceLevel: 'A', priceLevelName: '价格A', source: 'price_level' },
  { priceLevel: 'B', priceLevelName: '价格B', source: 'price_level' },
  { priceLevel: null, priceLevelName: '合成客户专价表', source: 'price_list' },
  { priceLevel: 'X', priceLevelName: '合成未来来源', source: 'future_source' },
]) test(`客户价来源完整传到预览：${price.source}/${price.priceLevelName}`, async () => {
  const out = await handleMessage(new TaskStore(null), clientFor(price), actor, '给合成客户开单：合成铰链 2个', rules);
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.lines[0].priceSource.name, price.priceLevelName);
  assert.equal(out.preview.lines[0].priceSource.source, price.source);
  assert.equal(out.preview.lines[0].unitPrice, 1.2345);
  assert.doesNotMatch(out.reply, /单价|合成铰链|客户 合成客户|合计 ¥/);
  assert.match(out.reply, /确认/);
});

test('初始销售卡正文精简明细仍保留缺口与后续未执行事项', async () => {
  const out = await handleMessage(new TaskStore(null), clientFor(undefined, 1), actor, '给合成客户开单：合成铰链 2个；然后查合成铰链库存', rules);
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.match(out.reply, /需 2、可用 1、缺 1/);
  assert.match(out.reply, /占库时会被拦/);
  assert.match(out.reply, /尚未处理|尚未执行|还没处理/);
  assert.doesNotMatch(out.reply, /单价/);
});

test('低库存仍有提醒但补货建议为空时解释两种口径，保持空建议且不生成写卡', async () => {
  const client = clientFor();
  const originalGet = client.get;
  client.get = async path => path.startsWith('/api/inventory/replenishment') ? { list: [], pagination: { total: 0 } }
    : path === '/api/dashboard/low-stock' ? [{ id: 1, name: '合成低库存商品', quantity: 5 }] : originalGet(path);
  const out = await handleMessage(new TaskStore(null), client, actor, '补货建议', rules);
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(out.result.items, []);
  assert.equal(out.preview, undefined);
  assert.match(out.reply, /没有补货建议/);
  assert.match(out.reply, /低库存.*提醒阈值.*安全库存.*口径不同/);
});

test('简报缺失、null及空时点显示未返回，不伪造1970年时点', () => {
  for (const asOf of [undefined, null, '', '   ']) {
    const reply = briefingReply({ asOf, sections: {} });
    assert.match(reply, /统计时点未返回/);
    assert.doesNotMatch(reply, /1970|北京时间/);
  }
});

test('授信预警缺失金额保留未知，真实零值和正常金额继续显示', () => {
  for (const [used, expected] of [[null, '金额未返回'], [undefined, '金额未返回'], ['', '金额未返回'], ['   ', '金额未返回'], [0, '¥0.00'], ['0', '¥0.00'], [123.45, '¥123.45'], ['123.45', '¥123.45']]) {
    const single = briefingReply({ asOf: '2026-10-27T16:15:00Z', sections: {
      creditWarning: { ok: true, data: { top: [{ customerName: '合成客户', used }] } },
    } });
    assert.ok(single.includes(`合成客户 已用 ${expected}`), `used=${String(used)}: ${single}`);
  }
});
