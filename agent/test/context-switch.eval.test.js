import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { createFixtureFlow } from './fixtures/role-conversation-flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const buyerA = '远山机电2号店';
const buyerB = '远山机电3号店';
const stockQuery = '只查二仓的长款铰链库存';

function conversation(code, model) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: 'context-' + code, roleName: role.name, permissions: [...role.after], warehouseIds: [1, 2], isSuper: code === 'admin' };
  const store = new TaskStore(null);
  const { client, reads, writes } = createFixtureFlow(actor);
  const planned = [];
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { planned.push(text); return model; } } });
  const post = (pathname, body, owner = actor) => runtime.dispatch({ method: 'POST', pathname, body, actor: owner, client });
  const say = (message, taskId, previousTaskId, candidateKey) => post('/chat', { message, taskId, previousTaskId, candidateKey });
  return {
    actor, store, client, reads, writes, planned, say, post,
    look: async id => (await runtime.dispatch({ method: 'GET', pathname: '/tasks/' + id, actor, client })).task,
    canStock: ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view'].every(key => actor.permissions.includes(key)),
    canSale: ['sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view']
      .every(key => actor.permissions.includes(key)),
    stockReads: () => reads.filter(x => x.pathname === '/api/inventory/query-by-product'),
  };
}

const draft = (h, customer, details = '长款铰链两个', taskId) => h.say('给' + customer + '开单' + (details ? '：' + details : ''), taskId);
const ref = (h, text, current, previous) => h.say(text, current?.task.id, previous?.task.id);

const cases = {
  '当前单独立开给下一位客户，不沿用上单商品': async h => {
    const first = await draft(h, buyerA, '长款铰链');
    const next = await draft(h, buyerB, '', first.task.id);
    assert.notEqual(first.task.id, next.task.id);
    assert.equal(next.task.state, h.canSale ? 'DISAMBIGUATING' : 'FAILED_FINAL');
    if (!h.canSale) return;
    assert.match(next.reply, /远山机电3号店.*商品和数量/);
    assert.match((await h.look(first.task.id)).reply, /长款铰链.*数量/);
    const more = await h.say('短款铰链三个', next.task.id);
    assert.equal(more.preview.customer.id, 8);
    assert.equal(more.preview.lines[0].productId, 12);
  },
  '上一张单按已知切换上下文回到原单': async h => {
    const a = await draft(h, buyerA);
    const b = await draft(h, buyerB, '短款铰链三个');
    const out = await ref(h, '看看上一张单', b, a);
    assert.equal(out.task?.id ?? null, h.canSale ? a.task.id : null, out.reply);
    if (h.canSale) {
      assert.equal(out.preview.customer.id, 7);
      assert.match(out.reply, /远山机电2号店.*待确认/);
      assert.equal((await h.look(b.task.id)).preview.customer.id, 8);
    } else assert.match(out.reply, /哪张单|无法核对|权限/);
  },
  '两张单时刚才那单先问对象并收起确认卡': async h => {
    const a = await draft(h, buyerA);
    const b = await draft(h, buyerB);
    const before = h.reads.length;
    const out = await ref(h, '确认刚才那单', b, a);
    assert.equal(out.task, null);
    assert.equal(out.detachTask, true);
    assert.match(out.reply, /哪张单|哪条记录|无法核对/);
    assert.equal(h.reads.length, before);
  },
  '查库后只剩一个已知单据指代，返回原草稿': async h => {
    const a = await draft(h, buyerA);
    const warehouse = await h.say(stockQuery, a.task.id);
    const before = h.reads.length;
    const out = await ref(h, '刚才那单呢', warehouse, a);
    assert.equal(out.task?.id ?? null, h.canSale ? a.task.id : null, out.reply);
    if (h.canSale) assert.equal(out.preview.customer.id, 7);
    assert.equal(h.reads.length, before);
  },
  '当前候选的第二个按展示顺序绑定到同一客户卡': async h => {
    const pending = await draft(h, '远山');
    const out = await h.say('第二个', pending.task.id, undefined, pending.task.candidateKey);
    assert.equal(out.task?.id ?? null, h.canSale ? pending.task.id : null, out.reply);
    if (h.canSale) {
      assert.equal(out.preview.customer.id, 8);
      assert.equal(out.task.state, 'AWAITING_CONFIRM');
    } else assert.match(out.reply, /候选|权限/);
  },
  '候选之外的第二个不会落到最近记录或补成商品': async h => {
    const pending = await h.say('只查二仓的库存');
    const before = h.reads.length;
    const out = await ref(h, '第二个', pending);
    assert.equal(out.task, null);
    assert.match(out.reply, /候选|第二个/);
    assert.equal(h.reads.length, before);
  },
  '明确说第二个仓库，只查已有结果中对应仓和原商品': async h => {
    const a = await h.say('查一下长款铰链还有几个');
    const count = h.stockReads().length;
    const out = await ref(h, '第二个仓库呢', a);
    if (!h.canStock) {
      assert.equal(out.task, null);
      assert.match(out.reply, /仓库|权限/);
      return;
    }
    assert.equal(out.result?.warehouseId, 2, out.reply);
    assert.equal(out.result.productId, 11);
    assert.deepEqual(h.stockReads().slice(count).map(r => r.query), [{ productId: '11', warehouseId: '2' }]);
  },
  '恢复上一个仓库查询沿原商品和仓，当前客户卡不受影响': async h => {
    const warehouse = await h.say(stockQuery);
    const a = await draft(h, buyerA);
    const out = await ref(h, '还是查上一条的仓库', a, warehouse);
    assert.equal(out.result?.warehouseId ?? null, h.canStock ? 2 : null, out.reply);
    if (h.canStock) assert.equal(out.result.productId, 11);
    if (h.canSale) assert.equal((await h.look(a.task.id)).preview.customer.id, 7);
  },
  '有两个可指代的记录时按原来的只问指哪条': async h => {
    const a = await h.say(stockQuery);
    const b = await h.say('只查一仓的长款铰链库存');
    const count = h.reads.length;
    const out = await ref(h, '还是按原来的', b, a);
    assert.equal(out.task, null);
    assert.match(out.reply, /哪条记录|原来的指/);
    assert.equal(h.reads.length, count);
  },
  '只有一个打开的草稿时沿用当前预览，口头确认不建单': async h => {
    const a = await draft(h, buyerA);
    const out = await ref(h, '还是按原来的，确认吧', a);
    assert.equal(out.task?.id ?? null, h.canSale ? a.task.id : null, out.reply);
    if (h.canSale) {
      assert.equal(out.task.revision, a.task.revision);
      assert.match(out.reply, /点击确认/);
    } else assert.match(out.reply, /哪条记录|无法核对|权限/);
  },
  '当前视图没有账款权限时引用客户仍只走正式权限': async h => {
    const a = await draft(h, buyerA);
    const before = h.reads.length;
    const out = await ref(h, '查这位客户的应收余额', a);
    assert.equal(h.reads.length, before);
    assert.match(out.reply, h.canSale ? /权限/ : /客户|权限/);
  },
};

for (const [name, scenario] of Object.entries(cases)) {
  for (const code of compared) {
    for (const [mode, planner] of [['规则', null], ['受控错路由', { graph: 'F-briefing' }]]) {
      test(name + ' / ' + code + ' / ' + mode, async () => {
        const h = conversation(code, planner);
        await scenario(h);
        assert.deepEqual(h.writes, []);
      });
    }
  }
}

test('新候选列表和同任务的旧序号不能混用', async () => {
  const h = conversation('preset_customer_service', null);
  const pending = await draft(h, '远山', '铰链两个');
  assert.equal(pending.candidates.length, 2);
  const product = await h.say('第二个', pending.task.id, undefined, pending.task.candidateKey);
  assert.equal(product.candidates.length, 2);
  assert.notEqual(product.task.candidateKey, pending.task.candidateKey);
  const before = h.reads.length;
  const stale = await h.say('第二个', pending.task.id, undefined, pending.task.candidateKey);
  assert.match(stale.reply, /候选.*变|最新候选/);
  assert.equal(h.reads.length, before);
  assert.equal((await h.look(pending.task.id)).preview, undefined);
  const chosen = await h.say('第二个', pending.task.id, undefined, product.task.candidateKey);
  assert.equal(chosen.preview.customer.id, 8);
  assert.equal(chosen.preview.lines[0].productId, 12);
});

test('跨任务客户引用按先前客户 ID 查账，不搜索同名客户', async () => {
  const h = conversation('admin', null);
  const first = await draft(h, buyerA);
  const second = await draft(h, buyerB);
  const before = h.reads.length;
  const out = await ref(h, '查上一位客户的应收余额', second, first);
  assert.equal(out.result.customer.id, 7);
  assert.match(out.reply, /远山机电2号店.*客户应收侧台账/);
  const lookups = h.reads.slice(before);
  assert.equal(lookups.some(row => row.pathname === '/api/search/'), false);
  assert.deepEqual(lookups.filter(row => row.pathname === '/api/payments/party-ledger').map(row => row.query.partyId), ['7']);
});

test('不能使用别人的上一张或以当前单替代已撤仓的来源', async () => {
  const h = conversation('preset_customer_service', null);
  const a = await draft(h, buyerA);
  const second = { ...h.actor, id: 999, username: 'synthetic-second-actor' };
  const before = h.reads.length;
  const reply = await h.post('/chat', { message: '看上一张单', previousTaskId: a.task.id }, second);
  assert.equal(reply.task, null);
  assert.doesNotMatch(reply.reply, /远山/);
  assert.equal(h.reads.length, before);
  const stock = await h.say(stockQuery);
  h.actor.warehouseIds = [1];
  const denied = await ref(h, '还是查上一条的仓库', a, stock);
  assert.equal(denied.task, null);
  assert.match(denied.reply, /范围|无法核对|不可访问/);
  assert.equal(h.stockReads().length, 1);
});

test('消歧后用上一张回到原稿，隐藏期间普通改量不作用于任一草稿', async () => {
  const h = conversation('preset_customer_service', null);
  const first = await draft(h, buyerA);
  const second = await draft(h, buyerB);
  const unclear = await ref(h, '确认刚才那单', second, first);
  assert.equal(unclear.keepReferences, true);
  const context = { referenceTaskId: second.task.id, previousTaskId: first.task.id };
  const edit = await h.post('/chat', { ...context, message: '数量改成三个' });
  assert.equal(edit.task, null);
  const out = await h.post('/chat', { ...context, message: '上一张单' });
  assert.equal(out.task.id, first.task.id);
  assert.equal(out.preview.lines[0].qty, 2);
  assert.equal((await h.look(second.task.id)).preview.lines[0].qty, 2);
  assert.deepEqual(h.writes, []);
});

test('指明单据类型时，上一笔收款和上一张销售单不能互换', async () => {
  const h = conversation('admin', null);
  const sale = await draft(h, buyerA);
  const receipt = h.store.create({ graph: 'D-receipt', userText: '合成收款', actor: h.actor });
  receipt.transition('DRY_RUNNING');
  receipt.setPreview({ customer: { id: 8, name: buyerB } });
  receipt.transition('AWAITING_CONFIRM');
  h.store.save(receipt);
  const wrong = await h.say('看上一张销售单', sale.task.id, receipt.id);
  assert.equal(wrong.task, null);
  assert.doesNotMatch(wrong.reply, /远山/);
  const restored = await h.say('看上一笔收款', sale.task.id, receipt.id);
  assert.equal(restored.task.id, receipt.id);
  assert.equal(restored.preview.customer.id, 8);
});

test('原库存记录含两个仓时只追问仓名或顺序，并切回库存记录', async () => {
  const h = conversation('preset_customer_service', null);
  const multi = await h.say('查一下长款铰链还有几个');
  const sale = await draft(h, buyerA);
  const before = h.stockReads().length;
  const ask = await ref(h, '还是查上一条的仓库', sale, multi);
  assert.equal(ask.task.id, multi.task.id);
  assert.match(ask.reply, /多个仓库.*第几个仓库/);
  assert.equal(h.stockReads().length, before);
  const done = await ref(h, '第二个仓库呢', multi);
  assert.equal(done.result.warehouseId, 2);
  const byName = await ref(h, '仓库是二仓', multi);
  assert.equal(byName.result.warehouseId, 2);
  assert.equal((await h.look(sale.task.id)).preview.customer.id, 7);
});

test('指代里另写了完整单号时，不把未建单的草稿当那张单', async () => {
  const h = conversation('preset_customer_service', null);
  const pending = await draft(h, buyerA);
  const before = h.reads.length;
  const out = await ref(h, '刚才那单，我是说 SL20261122009', pending);
  assert.equal(out.task, null);
  assert.match(out.reply, /哪张单|完整单号/);
  assert.equal(h.reads.length, before);
  assert.equal((await h.look(pending.task.id)).preview.customer.id, 7);
});

test('带确认字样的候选序号只进入待确认预览', async () => {
  const h = conversation('preset_customer_service', null);
  const pending = await draft(h, '远山');
  const out = await h.say('选第 ２ 个，确认吧', pending.task.id, undefined, pending.task.candidateKey);
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.customer.id, pending.candidates[1].id);
  assert.deepEqual(h.writes, []);
});
