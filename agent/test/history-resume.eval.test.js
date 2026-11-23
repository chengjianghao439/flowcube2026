import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { createFixtureFlow } from './fixtures/role-conversation-flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const first = '远山机电2号店';
const second = '远山机电3号店';
const buildHarness = (code, model, initialStore = new TaskStore(null)) => {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: 'history-' + code, roleName: role.name, permissions: [...role.after], warehouseIds: [1, 2], isSuper: code === 'admin' };
  const { client, reads, writes } = createFixtureFlow(actor);
  const planned = [];
  let runtime;
  const reopen = (store = initialStore) => {
    runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async text => { planned.push(text); return model; } } });
  };
  reopen();
  const post = (pathname, body = {}, who = actor) => runtime.dispatch({ method: 'POST', pathname, body, actor: who, client });
  const get = (pathname, who = actor) => runtime.dispatch({ method: 'GET', pathname, actor: who, client });
  return {
    store: initialStore, actor, client, reads, writes, planned, post, get, reopen,
    say: (message, body = {}) => post('/chat', { message, ...body }),
    canSale: ['sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view']
      .every(key => actor.permissions.includes(key)),
    canStock: ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view'].every(key => actor.permissions.includes(key)),
  };
};
const sale = (h, buyer = first, goods = '长款铰链两个') => h.say('给' + buyer + '开单' + (goods ? '：' + goods : ''));
const resume = (h, out) => h.post('/tasks/' + out.task.id + '/resume');
const expire = (h, a) => { h.store.get(a.task.id).preview.expiresAt = new Date(0).toISOString(); h.store.save(h.store.get(a.task.id)); };
const price = (h, amount) => {
  const get = h.client.get;
  h.client.get = path => path.startsWith('/api/price-lists/customer-price?') ? Promise.resolve({ salePrice: amount, priceLevel: 'A', source: 'price_level' }) : get(path);
};

const cases = {
  '无当前卡时恢复唯一的原销售草稿': async h => {
    const a = await sale(h);
    h.reopen();
    const out = await h.say('继续上次的任务');
    assert.equal(out.task?.id ?? null, h.canSale ? a.task.id : null, out.reply);
    if (h.canSale) {
      assert.equal(out.preview.customer.id, 7);
      assert.equal(out.task.revision, a.task.revision);
      assert.match(out.reply, /核对|复核/);
    } else assert.match(out.reply, /原任务|记录/);
  },
  '两张待办先问哪位客户，补一项就恢复对应草稿': async h => {
    const a = await sale(h);
    const b = await sale(h, second);
    h.reopen();
    const answer = await h.say('接着办');
    assert.equal(answer.task, null);
    if (h.canSale) {
      assert.equal(answer.historyLookup, true);
      assert.match(answer.reply, /客户全称|单号/);
    }
    const chosen = await h.say('客户是' + second, { historyLookup: true });
    assert.equal(chosen.task?.id ?? null, h.canSale ? b.task.id : null, chosen.reply);
    if (h.canSale) {
      assert.equal(chosen.preview.customer.id, 8);
      assert.equal((await h.get('/tasks/' + a.task.id)).task.preview.customer.id, 7);
    }
  },
  '指定历史客户优先于打开的另一张草稿': async h => {
    const a = await sale(h);
    const b = await sale(h, second);
    const out = await h.say('继续' + first + '的销售草稿', { taskId: b.task.id });
    assert.equal(out.task?.id ?? null, h.canSale ? a.task.id : null, out.reply);
    if (h.canSale) assert.equal(out.preview.customer.id, 7);
  },
  '恢复唯一的缺项库存记录，保留原仓等待商品': async h => {
    const a = await h.say('只查二仓的库存');
    h.reopen();
    const out = await h.say('继续上次的库存查询');
    assert.equal(out.task?.id ?? null, h.canStock ? a.task.id : null, out.reply);
    if (h.canStock) {
      assert.match(out.reply, /二仓.*商品.*编号/);
      const next = await h.say('长款铰链', { taskId: out.task.id });
      assert.equal(next.result.warehouseId, 2);
    }
  },
  '过期销售草稿仅在原任务按原客户商品和仓重算': async h => {
    const a = await sale(h);
    if (!h.canSale) return assert.equal((await h.say('继续上次的任务')).task, null);
    expire(h, a);
    price(h, 8.5);
    h.reopen();
    const out = await h.say('继续原任务');
    assert.equal(out.task?.id, a.task.id, out.reply);
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.equal(out.task.revision, a.task.revision + 1);
    assert.equal(out.preview.customer.id, 7);
    assert.equal(out.preview.lines[0].productId, 11);
    assert.equal(out.preview.warehouseId, a.preview.warehouseId);
    assert.equal(out.preview.totalCents, 1700);
    assert.match(out.reply, /过期|重算|重新试算/);
  },
  '未到期但价格已变，续办先显示新版本': async h => {
    const a = await sale(h);
    if (!h.canSale) return assert.equal((await h.say('继续上次的任务')).task, null);
    price(h, 6.5);
    const out = await resume(h, a);
    assert.equal(out.task.id, a.task.id);
    assert.equal(out.task.revision, a.task.revision + 1);
    assert.equal(out.preview.totalCents, 1300);
    await assert.rejects(() => h.post('/tasks/' + a.task.id + '/confirm', { revision: a.task.revision }), { status: 409 });
    await assert.rejects(() => h.post('/tasks/' + a.task.id + '/confirm'), { status: 409 });
  },
  '写权限撤回后续办只给提示，未提交': async h => {
    const a = await sale(h);
    if (!h.canSale) return assert.equal((await h.say('继续上次的任务')).task, null);
    h.actor.permissions = h.actor.permissions.filter(key => key !== 'sale.order.create');
    const before = h.reads.length;
    const out = await resume(h, a);
    assert.equal(out.task.id, a.task.id);
    assert.equal(out.task.reviewRequired, true);
    assert.match(out.reply, /权限/);
    assert.equal(h.reads.length, before);
  },
  '仓库授权变化时拒绝恢复旧记录且不改查别仓': async h => {
    const a = await h.say('只查二仓的库存');
    if (!h.canStock) return assert.equal((await h.say('继续上次的库存查询')).task, null);
    h.actor.warehouseIds = [1];
    const out = await h.say('继续上次的库存查询');
    assert.equal(out.task, null);
    assert.doesNotMatch(out.reply, /二仓/);
    await assert.rejects(() => resume(h, a), { status: 403 });
  },
  '只在续办追问中消费裸客户答案': async h => {
    const a = await sale(h);
    h.reopen();
    assert.equal((await h.say(first)).task, null);
    const picked = await h.say(first, { historyLookup: true });
    assert.equal(picked.task?.id ?? null, h.canSale ? a.task.id : null, picked.reply);
  },
  '取数短时失败先暂停复核，重试仍保留原版本和请求键': async h => {
    const a = await sale(h);
    if (!h.canSale) return assert.equal((await h.say('继续上次的任务')).task, null);
    const get = h.client.get;
    const key = h.store.get(a.task.id).requestKey;
    h.client.get = path => path.startsWith('/api/price-lists/customer-price?')
      ? Promise.reject(Object.assign(new Error('合成暂时失败'), { status: 503 })) : get(path);
    const held = await resume(h, a);
    assert.equal(held.task.reviewRequired, true);
    assert.match(held.reply, /暂时|稍后/);
    h.client.get = get;
    const out = await resume(h, a);
    assert.equal(out.task.revision, a.task.revision);
    assert.notEqual(out.task.reviewRequired, true);
    assert.equal(h.store.get(a.task.id).requestKey, key);
  },
};

for (const [name, scenario] of Object.entries(cases)) {
  for (const code of compared) {
    for (const [mode, planner] of [['规则', null], ['受控错路由', { graph: 'F-briefing' }]]) {
      test(name + ' / ' + code + ' / ' + mode, async () => {
        const h = buildHarness(code, planner);
        await scenario(h);
        assert.deepEqual(h.writes, []);
      });
    }
  }
}

test('从磁盘重新打开后，唯一未知任务只查原键回执，详情不匹配时不认成新单', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'xiaoman-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'tasks.json');
  const initial = new TaskStore(file);
  const h = buildHarness('preset_customer_service', null, initial);
  const pending = await sale(h);
  const task = initial.get(pending.task.id);
  task.transition('CONFIRMED'); task.transition('EXECUTING'); task.transition('RESULT_UNKNOWN');
  initial.save(task);
  const calls = [];
  h.client.requestStatus = async (key, action) => {
    calls.push([key, action]);
    return { resourceType: 'sale_order', resourceId: 42 };
  };
  const get = h.client.get;
  let foundCustomer = 8;
  h.client.get = path => path === '/api/sale/42' ? Promise.resolve({
    id: 42, orderNo: 'SL20261122009', customerId: foundCustomer, warehouseId: task.preview.warehouseId, status: 1, statusName: '草稿', totalAmount: 6.5,
    items: [{ productId: 11, warehouseId: task.preview.warehouseId, quantity: 2 }],
  }) : get(path);
  h.reopen(await TaskStore.open(file));
  const mismatch = await h.say('查询原任务结果');
  assert.equal(mismatch.task.id, pending.task.id);
  assert.equal(mismatch.task.state, 'RESULT_UNKNOWN');
  assert.match(mismatch.reply, /身份|不符/);
  foundCustomer = 7;
  const recovered = await h.say('查询原任务结果');
  assert.equal(recovered.task.id, pending.task.id);
  assert.equal(recovered.task.state, 'DONE');
  assert.equal(recovered.result.orderId, 42);
  assert.deepEqual(calls, [[task.requestKey, 'sale.create'], [task.requestKey, 'sale.create']]);
  assert.deepEqual(h.writes, []);
});

test('精确客户可以找到 30 条最近列表之外的任务', async () => {
  const h = buildHarness('preset_customer_service', null);
  const old = await sale(h, first, '');
  h.store.get(old.task.id).updatedAt = new Date(0).toISOString();
  for (let i = 0; i < 32; i++) await sale(h, second, '');
  const history = await h.get('/tasks');
  assert.equal(history.tasks.some(row => row.id === old.task.id), false);
  assert.equal(history.resumeAmbiguous, true);
  const out = await h.say('继续' + first + '的销售草稿');
  assert.equal(out.task?.id, old.task.id);
  assert.match(out.reply, /商品和数量/);
});

test('历史定位只看本人，撤权的同类任务不被其余草稿替代', async () => {
  const h = buildHarness('preset_customer_service', null);
  const a = await h.say('只查二仓的库存');
  const b = await h.say('只查一仓的库存');
  const foreign = { ...h.actor, id: 999, username: 'other-history' };
  const empty = await h.post('/chat', { message: '继续上次的任务' }, foreign);
  assert.equal(empty.task, null);
  h.actor.warehouseIds = [1];
  const out = await h.say('继续上次的库存查询');
  assert.equal(out.task, null);
  assert.doesNotMatch(out.reply, /二仓/);
  assert.notEqual(out.task?.id, b.task.id);
  assert.notEqual(a.task.id, b.task.id);
});

test('续办中提到另一位客户或两个单号时，不回退到唯一草稿', async () => {
  const h = buildHarness('preset_customer_service', null);
  await sale(h, first);
  const before = h.reads.length;
  const different = await h.say('继续上次的' + second);
  assert.equal(different.task, null);
  const both = await h.say('继续单号是 SL20261122001 和 SL20261122002');
  assert.equal(both.task, null);
  assert.equal(h.reads.length, before);
});

test('复核失败时当前版本也不能确认，恢复核对后只接受明确版本', async () => {
  const h = buildHarness('preset_customer_service', null);
  const original = await sale(h);
  const route = '/tasks/' + original.task.id + '/confirm';
  const get = h.client.get;
  h.client.get = path => path.includes('/api/price-lists/customer-price?')
    ? Promise.reject(Object.assign(new Error('合成失败'), { status: 503 })) : get(path);
  await resume(h, original);
  h.client.get = get;
  await assert.rejects(() => h.post(route, { revision: original.task.revision }), { status: 409 });
  const checked = await resume(h, original);
  assert.equal(checked.task.revision, original.task.revision);
  await assert.rejects(() => h.post(route), { status: 409 });
  assert.deepEqual(h.writes, []);
});

test('重登后从原收款续办核销，外部已核销时不恢复旧确认卡', async () => {
  const h = buildHarness('admin', null);
  const parent = h.store.create({ graph: 'D-receipt', actor: h.actor, userText: first + '到账 18.52 元，登记收款再核销' });
  parent.transition('DRY_RUNNING'); parent.transition('AWAITING_CONFIRM'); parent.transition('CONFIRMED');
  parent.transition('EXECUTING'); parent.transition('VERIFYING');
  const receiptNo = 'RC20261122017';
  const next = h.store.createRelated(parent, { graph: 'D-settle', actor: h.actor, userText: parent.userText }, (child, source) => {
    child.transition('DRY_RUNNING');
    child.setPreview({ receiptId: 17, receiptNo, customer: { id: 7, name: first }, amountCents: 1852,
      allocations: [{ recordId: 51, balanceBeforeCents: 1852 }], totalCents: 1852 });
    child.transition('AWAITING_CONFIRM');
    source.result = { receiptNo, receiptId: 17, stage2TaskId: child.id };
    source.transition('DONE');
  });
  const get = h.client.get;
  h.client.get = path => path === '/api/payments/receipts/17' ? Promise.resolve({
    id: 17, receiptNo, amount: 18.52, partyId: 7, type: 2, balance: 0, settledAmount: 18.52, status: 3,
  }) : get(path);
  h.reopen();
  const out = await h.post('/tasks/' + parent.id + '/resume');
  assert.equal(out.task.id, next.id);
  assert.equal(out.task.state, 'EXPIRED');
  assert.match(out.reply, /收款单.*已登记/);
  assert.equal(h.store.get(parent.id).state, 'DONE');
  assert.deepEqual(h.writes, []);
});
