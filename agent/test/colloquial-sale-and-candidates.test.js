import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMessage } from '../src/agent.js';
import { TaskStore } from '../src/tasks.js';
import { createAgentRuntime } from '../src/runtime.js';

const FULL = { id: 11, username: 'owner', roleId: 2, permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'warehouse.view'], warehouseIds: null, unrestrictedWarehouseScope: true };
const rule = { parseIntent: async () => null };

function saleClient() {
  const calls = [];
  const client = { get: async path => {
    calls.push(path);
    const url = new URL(path, 'http://fixture');
    if (url.pathname === '/api/search/') {
      const keyword = url.searchParams.get('q') || '';
      if (keyword.includes('客户')) return [{ id: 4, type: 'customer', title: '合成客户' }];
      if (keyword.includes('铰链')) return [{ id: 1, type: 'product', title: '合成铰链', searchRank: 0 }];
      return [];
    }
    if (url.pathname === '/api/warehouses') return { list: [{ id: 1, name: '华东一仓' }] };
    if (url.pathname === '/api/customers/4') return { id: 4, name: '合成客户', priceLevel: 'A', creditLimit: null };
    if (url.pathname === '/api/products/1') return { id: 1, name: '合成铰链', code: 'P1', unit: '个', allowDecimalQty: false };
    if (url.pathname === '/api/price-lists/customer-price') return { salePrice: 2, priceLevel: 'A', source: 'price_level' };
    if (url.pathname === '/api/inventory/stock') return { list: [{ id: 1, productId: 1, warehouseId: 1, quantity: 20, reserved: 0, available: 20, productCode: 'P1', unit: '个' }] };
    throw new Error(`unexpected ${path}`);
  }, post: () => assert.fail('开单追问不能写入') };
  return { client, calls };
}

test('做个订单、开单、下一单进入销售草稿追问，不回能力清单', async () => {
  for (const message of ['做个订单', '开单', '下一单', '帮我做个订单']) {
    const { client, calls } = saleClient();
    const out = await handleMessage(new TaskStore(null), client, FULL, message, { parseIntent: async () => ({ graph: 'none' }) });
    assert.equal(out.task?.graph, 'B-sale-draft', message);
    assert.equal(out.task.state, 'DISAMBIGUATING', message);
    assert.match(out.reply, /客户/, message);
    assert.match(out.reply, /还没建单/, message);
    assert.doesNotMatch(out.reply, /目前支持|往来台账|功能清单/, message);
    assert.equal(calls.length, 0, message);
  }
});

test('追问后的客户和商品进入同一张销售草稿，不另开能力说明', async () => {
  const { client } = saleClient();
  const store = new TaskStore(null);
  const first = await handleMessage(store, client, FULL, '做个订单', rule);
  const named = await handleMessage(store, client, FULL, '合成客户', { ...rule, taskId: first.task.id });
  assert.equal(named.task.id, first.task.id);
  assert.match(named.reply, /合成客户/);
  assert.match(named.reply, /还差商品/);
  const ready = await handleMessage(store, client, FULL, '合成铰链 2个', { ...rule, taskId: first.task.id });
  assert.equal(ready.task.id, first.task.id);
  assert.equal(ready.task.state, 'AWAITING_CONFIRM');
  assert.equal(ready.preview.lines[0].qty, 2);
  assert.equal(store.tasks.size, 1);
});

test('起草期间的问候、其他话题和缺身份查询不填进原草稿', async () => {
  const { client, calls } = saleClient();
  const store = new TaskStore(null);
  const first = await handleMessage(store, client, FULL, '帮我做一个订单', rule);
  const opts = { ...rule, taskId: first.task.id };
  for (const [message, reply] of [
    ['你好', /在。/],
    ['上海天气怎么样', /只聊极序/],
    ['查一下这张单状态', /请说明要查询的对象/],
    ['换个话题，聊聊读书', /只聊极序/],
  ]) {
    const out = await handleMessage(store, client, FULL, message, opts);
    assert.equal(out.task, null, message);
    assert.match(out.reply, reply);
  }
  assert.equal(first.task.intent.customerKeyword, undefined);
  assert.deepEqual(first.task.intent.lines, []);
  assert.equal(calls.length, 0);
  const named = await handleMessage(store, client, FULL, '合成客户', opts);
  assert.equal(named.task.id, first.task.id);
  assert.equal(named.task.intent.customerKeyword, '合成客户');
});

test('销售追问接受前置和后置中文整数数量，继续原任务', async () => {
  for (const [message, qty] of [['合成铰链 两个', 2], ['十二个合成铰链', 12], ['合成铰链 一百零五个', 105]]) {
    const { client } = saleClient();
    const store = new TaskStore(null);
    const first = await handleMessage(store, client, FULL, '给合成客户开单。', rule);
    const ready = await handleMessage(store, client, FULL, message, { ...rule, taskId: first.task.id });
    assert.equal(ready.task.id, first.task.id);
    assert.equal(ready.task.state, 'AWAITING_CONFIRM', message);
    assert.equal(ready.preview.lines[0].qty, qty, message);
    assert.equal(store.tasks.size, 1);
  }
});

test('单独中文数量及不明确的中文连读不猜成客户、商品或改量', async () => {
  const { client, calls } = saleClient();
  const store = new TaskStore(null);
  const first = await handleMessage(store, client, FULL, '帮我做一个订单', rule);
  const opts = { ...rule, taskId: first.task.id };
  for (const text of ['两个', '二三个合成铰链']) {
    const partial = await handleMessage(store, client, FULL, text, opts);
    assert.equal(partial.task.state, 'DISAMBIGUATING');
    assert.equal(partial.task.intent.customerKeyword, undefined);
    assert.deepEqual(partial.task.intent.lines, []);
    assert.equal(calls.length, 0);
  }
  const ready = await handleMessage(store, client, FULL, '给合成客户开单：合成铰链 2个', opts);
  assert.equal(ready.task.state, 'AWAITING_CONFIRM');
  const revision = ready.task.revision;
  const uncertain = await handleMessage(store, client, FULL, '数量改成二三个', opts);
  assert.equal(uncertain.task.revision, revision);
  assert.equal(uncertain.preview.lines[0].qty, 2);
});

test('先补商品和数量时保留原任务，等客户补齐后试算', async () => {
  for (const [answer, customerKeyword] of [['合成客户', '合成客户'], ['客户是合成客户02', '合成客户02']]) {
    const { client, calls } = saleClient();
    const store = new TaskStore(null);
    const first = await handleMessage(store, client, FULL, '做个订单', rule);
    const opts = { ...rule, taskId: first.task.id };
    const quantityOnly = await handleMessage(store, client, FULL, '12个', opts);
    assert.deepEqual(quantityOnly.task.intent.lines, []);
    const goods = await handleMessage(store, client, FULL, '合成铰链 2个', opts);
    assert.equal(goods.task.id, first.task.id);
    assert.equal(goods.task.state, 'DISAMBIGUATING');
    assert.match(goods.reply, /商品先记下了.*客户是谁/);
    assert.equal(calls.length, 0);

    const ready = await handleMessage(store, client, FULL, answer, opts);
    assert.equal(ready.task.id, first.task.id);
    assert.equal(ready.task.state, 'AWAITING_CONFIRM');
    assert.equal(ready.task.intent.customerKeyword, customerKeyword);
    assert.equal(ready.preview.lines[0].qty, 2);
    assert.equal(store.tasks.size, 1);
  }
});

test('只报客户的开单句保留客户，明确报客户时可以更正', async () => {
  const { client, calls } = saleClient();
  const store = new TaskStore(null);
  const first = await handleMessage(store, client, FULL, '给合成客户开单。', rule);
  assert.equal(first.task.state, 'DISAMBIGUATING');
  assert.equal(first.task.intent.customerKeyword, '合成客户');
  assert.match(first.reply, /还差商品和数量/);

  const opts = { ...rule, taskId: first.task.id };
  const corrected = await handleMessage(store, client, FULL, '客户是合成客户02', opts);
  assert.equal(corrected.task.id, first.task.id);
  assert.equal(corrected.task.intent.customerKeyword, '合成客户02');
  assert.equal(corrected.task.state, 'DISAMBIGUATING');
  assert.equal(calls.length, 0);

  const ready = await handleMessage(store, client, FULL, '合成铰链 2个', opts);
  assert.equal(ready.task.id, first.task.id);
  assert.equal(ready.task.intent.customerKeyword, '合成客户02');
  assert.equal(ready.task.state, 'AWAITING_CONFIRM');
  assert.equal(ready.preview.lines[0].qty, 2);
  assert.equal(store.tasks.size, 1);
});

test('重选商品保留客户和原任务，只有新试算版本可以确认', async () => {
  const { client, calls } = saleClient();
  const actor = { ...FULL, warehouseIds: [1], unrestrictedWarehouseScope: false };
  const store = new TaskStore(null);
  const runtime = createAgentRuntime({ store, messageOptions: rule });
  const request = (pathname, body) => runtime.dispatch({ method: body ? 'POST' : 'GET', pathname, body, actor, client });
  const first = await request('/chat', { message: '给合成客户开单：合成铰链 2个' });
  assert.equal(first.task.state, 'AWAITING_CONFIRM');
  const { id, revision } = first.task;
  const path = `/tasks/${id}`;
  const callCount = calls.length;
  await store.exclusive(id, async () => {
    await assert.rejects(request(`${path}/sale-draft`, { action: 'reselect', revision }), { code: 'TASK_BUSY' });
  });
  const reopened = await request(`${path}/sale-draft`, { action: 'reselect', revision });
  assert.equal(reopened.task.id, id);
  assert.equal(reopened.task.state, 'DISAMBIGUATING');
  assert.equal(reopened.preview, undefined);
  assert.match(reopened.reply, /合成客户.*商品和数量/);
  assert.equal((await request(path)).task.preview, undefined);
  await assert.rejects(request(`${path}/confirm`, { revision }), { status: 409 });
  assert.equal(calls.length, callCount);

  const replacement = await request('/chat', { taskId: id, message: '合成铰链 3个' });
  assert.equal(replacement.task.id, id);
  assert.equal(replacement.task.state, 'AWAITING_CONFIRM');
  assert.equal(replacement.preview.lines[0].qty, 3);
  assert.ok(replacement.task.revision > revision);
  await assert.rejects(request(`${path}/confirm`, { revision }), { code: 'PREVIEW_REVISION_CONFLICT' });
  await assert.rejects(request(`${path}/confirm`, {}), { code: 'PREVIEW_REVISION_CONFLICT' });
});

test('采购说法不进销售草稿，并指向采购菜单', async () => {
  const { client, calls } = saleClient();
  const out = await handleMessage(new TaskStore(null), client, FULL, '做个采购订单', rule);
  assert.equal(out.task, null);
  assert.match(out.reply, /\[\[采购订单\|\/purchase\]\]/);
  assert.doesNotMatch(out.reply, /目前支持查库存/);
  assert.equal(calls.length, 0);
});

test('改价、审批、付款、发货的拒答各自指向菜单', async () => {
  const cases = [
    ['帮我把铰链价格改成5块', /\/products/],
    ['帮我审批这张单', /\/approvals\/pending/],
    ['给供应商付款', /\/payments\/payable/],
    ['直接帮我发货', /\/warehouse-shipping/],
    ['帮我取消这张订单', /\/sale/],
  ];
  for (const [message, path] of cases) {
    const out = await handleMessage(new TaskStore(null), { get: () => assert.fail('拒答不能查业务'), post: () => assert.fail('拒答不能写') }, FULL, message, rule);
    assert.equal(out.task, null, message);
    assert.match(out.reply, /不能代为办理/, message);
    assert.match(out.reply, path, message);
    assert.match(out.reply, /\[\[.+?\|\/.+?\]\]/, message);
  }
});

function inventoryClient(hits, stock) {
  const calls = [];
  const client = { get: async path => {
    calls.push(path);
    const url = new URL(path, 'http://fixture');
    if (url.pathname === '/api/search/') return hits;
    if (url.pathname === '/api/warehouses') return { list: [{ id: 1, name: '华东一仓' }, { id: 9, name: '无权仓' }] };
    if (url.pathname === '/api/inventory/stock') return { list: stock };
    if (url.pathname === '/api/inventory/query-by-product') return { productId: 1, containers: [{ barcode: 'SYNTHETIC', remainingQty: 8 }] };
    throw new Error(`unexpected ${path}`);
  }, post: () => assert.fail('候选测试不能写入') };
  return { client, calls };
}
const product = (id, title, extra = {}) => ({ id, type: 'product', title, subtitle: `P${id}`, searchRank: 2, ...extra });

test('单条近似商品只给候选，不自动换成那一个', async () => {
  const { client, calls } = inventoryClient([product(1, '缓冲铰链·全盖')], []);
  const out = await handleMessage(new TaskStore(null), client, FULL, '铰链还剩多少', rule);
  assert.equal(out.task.state, 'DISAMBIGUATING');
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].id, 1);
  assert.match(out.reply, /不会自动换成某一个/);
  assert.equal(calls.some(path => path.startsWith('/api/inventory/query-by-product')), false);
});

test('精确唯一编码仍直接查询', async () => {
  const { client } = inventoryClient([{ id: 1, type: 'product', title: '缓冲铰链', subtitle: 'P1', searchRank: 0 }], [{ id: 1, productId: 1, warehouseId: 1, quantity: 8, reserved: 0, available: 8 }]);
  const out = await handleMessage(new TaskStore(null), client, FULL, '铰链还剩多少', rule);
  assert.equal(out.task.state, 'DONE');
  assert.equal(out.result.productId, 1);
});

test('近似候选不出现无权仓库的商品，范围内的一条也不自动替', async () => {
  const actor = { ...FULL, warehouseIds: [1], unrestrictedWarehouseScope: false };
  const hits = [product(1, '铰链·权限内'), product(9, '铰链·无权仓', { warehouseId: 9 })];
  const stock = [
    { id: 1, productId: 1, warehouseId: 1, quantity: 4, reserved: 0, available: 4 },
    { id: 9, productId: 9, warehouseId: 9, quantity: 4, reserved: 0, available: 4 },
  ];
  const { client, calls } = inventoryClient(hits, stock);
  const store = new TaskStore(null);
  const out = await handleMessage(store, client, actor, '铰链还剩多少', rule);
  assert.equal(out.task.state, 'DISAMBIGUATING');
  assert.deepEqual(out.candidates.map(item => item.id), [1]);
  assert.match(out.reply, /不会自动换成某一个/);
  assert.equal(calls.some(path => path.startsWith('/api/inventory/query-by-product')), false);
  await assert.rejects(() => handleMessage(store, client, actor, '选那个', { ...rule, taskId: out.task.id, choiceId: 9 }), error => error.status === 400);
});

test('相近商品都在无权仓库时说明原因，不给候选也不改查', async () => {
  const actor = { ...FULL, warehouseIds: [1], unrestrictedWarehouseScope: false };
  const { client, calls } = inventoryClient([product(9, '铰链·无权仓')], [{ id: 9, productId: 9, warehouseId: 9, quantity: 4, reserved: 0, available: 4 }]);
  const out = await handleMessage(new TaskStore(null), client, actor, '铰链还剩多少', rule);
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.equal(out.candidates, undefined);
  assert.match(out.reply, /不在你的仓库范围内/);
  assert.match(out.reply, /不会改用其他仓库/);
  assert.equal(calls.some(path => path.startsWith('/api/inventory/query-by-product')), false);
});
