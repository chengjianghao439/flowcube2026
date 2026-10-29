import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMessage } from '../src/agent.js';
import { TaskStore } from '../src/tasks.js';

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
