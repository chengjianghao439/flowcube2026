import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { FlowError } from '../src/flow.js';
import { createFixtureFlow } from './fixtures/role-conversation-flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const codes = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const create = (roleCode, model, scope = [1, 2]) => {
  const role = roles.find(row => row.code === roleCode);
  const actor = { id: role.id, username: 'combo-' + role.code, roleName: role.name, permissions: [...role.after], warehouseIds: scope };
  const store = new TaskStore(null);
  const fixture = createFixtureFlow(actor);
  const { client, reads } = fixture;
  let plannerCalls = 0;
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async () => { plannerCalls++; return model; } } });
  const dispatch = (method, pathname, body, who = actor) => runtime.dispatch({ method, pathname, body, actor: who, client });
  const has = (...permissions) => permissions.every(value => actor.permissions.includes(value));
  return { ...fixture, store, actor, plannerCalls: () => plannerCalls,
    say: (message, taskId, choiceId) => dispatch('POST', '/chat', { message, taskId, choiceId }),
    task: async (id, who) => (await dispatch('GET', '/tasks/' + id, {}, who)).task,
    list: async who => (await dispatch('GET', '/tasks', {}, who)).tasks,
    confirm: (id, revision) => dispatch('POST', '/tasks/' + id + '/confirm', { revision }),
    canStock: has('inventory.view', 'product.view', 'warehouse.view', 'dashboard.view'),
    canSale: has('inventory.view', 'product.view', 'warehouse.view', 'dashboard.view', 'sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view'),
    warehousesRead: () => reads.filter(call => call.pathname === '/api/inventory/query-by-product').map(call => call.query.warehouseId),
  };
};
const one = '查一仓的长款铰链库存';
const two = '查二仓的长款铰链库存';
const sequence = '先' + one + '，再' + two + '，最后看经营简报';
const simpleCondition = '先' + two + '，够两个再给远山机电2号店开单';
const separatedCondition = '先' + two + '，如果可用量不少于十个，再给远山机电2号店开单：长款铰链两个';

const cases = {
  '同一句按顺序做三项查询': async h => {
    const out = await h.say(sequence);
    assert.equal(out.task?.graph, 'K-sequence', out.reply);
    assert.equal(h.plannerCalls(), 0);
    if (h.canStock) {
      assert.equal(out.task.state, 'DONE');
      assert.deepEqual(h.warehousesRead(), ['1', '2']);
      const paths = h.reads.map(row => row.pathname);
      assert.ok(paths.lastIndexOf('/api/inventory/query-by-product') < paths.indexOf('/api/dashboard/summary'));
      assert.match(out.reply, /一仓[\s\S]*二仓[\s\S]*简报/);
    } else {
      assert.match(out.reply, /权限/);
      assert.deepEqual(h.reads, []);
      assert.equal(out.task.state, 'PAUSED');
    }
  },
  '无先后要求也保留两个显式查询': async h => {
    const out = await h.say('只查一仓的长款铰链库存，顺便查二仓的长款铰链库存');
    assert.equal(out.task?.graph, 'K-sequence');
    assert.deepEqual(h.warehousesRead(), h.canStock ? ['1', '2'] : []);
    assert.equal(h.plannerCalls(), 0);
  },
  '第二步暂时失败，从原进度继续并跳过已完成第一步': async h => {
    const get = h.client.get;
    let failed = 0;
    h.client.get = async path => {
      if (path.startsWith('/api/inventory/query-by-product') && path.includes('warehouseId=2') && failed++ === 0) {
        throw new FlowError('upstream', { status: 503, message: '合成接口暂时不可用' });
      }
      return get(path);
    };
    const paused = await h.say(sequence);
    assert.equal(paused.task?.graph, 'K-sequence', paused.reply);
    assert.equal(paused.task.state, 'PAUSED');
    if (!h.canStock) {
      assert.match(paused.reply, /权限/);
      return;
    }
    assert.match(paused.reply, /[一1].*完成[\s\S]*[二2].*暂停/);
    assert.deepEqual(h.warehousesRead(), ['1']);
    assert.ok(!h.reads.some(row => row.pathname === '/api/dashboard/summary'));
    const resumed = await h.say('继续原任务', paused.task.id);
    assert.equal(resumed.task?.id, paused.task.id, resumed.reply);
    assert.equal(resumed.task.state, 'DONE');
    assert.deepEqual(h.warehousesRead(), ['1', '2']);
  },
  '缺商品时续接原有查询，然后做下一项': async h => {
    const paused = await h.say('先查一仓的库存，再查二仓的短款铰链库存');
    assert.equal(paused.task?.graph, 'K-sequence', paused.reply);
    assert.equal(paused.task.state, 'PAUSED');
    if (!h.canStock) return;
    assert.match(paused.reply, /商品.*名称/);
    assert.deepEqual(h.warehousesRead(), []);
    const out = await h.say('商品是长款铰链', paused.task.id);
    assert.equal(out.task?.id, paused.task.id, out.reply);
    assert.deepEqual(h.warehousesRead(), ['1', '2']);
    assert.equal(out.task.state, 'DONE');
  },
  '后半句不明确时整条追问，无模型也无业务调用': async h => {
    const out = await h.say('先' + one + '，再处理一下那笔款');
    assert.equal(out.task, null);
    assert.match(out.reply, /第.*2.*步|第二步/);
    assert.equal(h.plannerCalls(), 0);
    assert.deepEqual(h.reads, []);
  },
  '一般复合写入要分开，不能把成功读取当成执行许可': async h => {
    const out = await h.say('先' + one + '，再给远山机电2号店登记收款');
    assert.equal(out.task, null);
    assert.match(out.reply, /单独|分开/);
    assert.equal(h.plannerCalls(), 0);
    assert.deepEqual(h.reads, []);
  },
  '库存门槛和本次开单量各按原话': async h => {
    const out = await h.say(separatedCondition);
    assert.deepEqual(h.warehousesRead(), h.canStock ? ['2'] : []);
    if (h.canSale) {
      assert.equal(out.task?.graph, 'B-sale-draft', out.reply);
      assert.equal(out.preview.lines[0].qty, 2);
      assert.equal(out.preview.warehouseId, 2);
      assert.match(out.reply, /可用 15/);
    } else {
      assert.equal(out.task.state, 'FAILED_FINAL');
      assert.match(out.reply, /权限/);
    }
    assert.equal(h.plannerCalls(), 0);
  },
  '查库阶段暂时失败后保留条件，原任务可续办': async h => {
    const get = h.client.get;
    let bounced = false;
    h.client.get = path => {
      if (path.startsWith('/api/inventory/query-by-product') && !bounced) {
        bounced = true;
        throw new FlowError('upstream', { status: 503 });
      }
      return get(path);
    };
    const first = await h.say(simpleCondition);
    assert.equal(first.task?.graph, 'A-inventory');
    if (!h.canStock) { assert.equal(first.task.state, 'FAILED_FINAL'); return; }
    assert.equal(first.task.state, 'PAUSED');
    assert.match(first.reply, /继续/);
    assert.deepEqual(h.warehousesRead(), []);
    const next = await h.say('继续原任务', first.task.id);
    assert.deepEqual(h.warehousesRead(), ['2']);
    assert.equal(next.task?.graph, 'B-sale-draft');
    assert.equal(next.task.state, h.canSale ? 'AWAITING_CONFIRM' : 'FAILED_FINAL');
    if (h.canSale) assert.equal(next.preview.lines[0].qty, 2);
  },
};

for (const [name, scenario] of Object.entries(cases)) {
  for (const code of codes) {
    for (const [mode, intent] of [['规则', null], ['受控错路由', { graph: 'F-briefing' }]]) {
      test(name + ' / ' + code + ' / ' + mode, async () => {
        const h = create(code, intent);
        await scenario(h);
        assert.equal(h.writes.length, 0);
      });
    }
  }
}

test('写入响应未知时，续办只查询原回执；回执已知而详情暂不可读仍留在原任务', async () => {
  const h = create('preset_customer_service', null);
  const draft = await h.say('给远山机电2号店开单：长款铰链两个');
  const saved = h.store.get(draft.task.id);
  const post = h.client.post;
  h.client.post = async (...args) => {
    await post(...args);
    throw new FlowError('unknown');
  };
  const lookups = [];
  let showReceipt = false;
  h.client.requestStatus = async (key, action) => {
    lookups.push([key, action]);
    return showReceipt ? { resourceId: 42 } : null;
  };
  const first = await h.confirm(draft.task.id, draft.task.revision);
  assert.equal(first.task.state, 'RESULT_UNKNOWN');
  showReceipt = true;
  const get = h.client.get;
  let failDetail = true;
  h.client.get = path => {
    if (path === '/api/sale/42' && failDetail) throw new FlowError('upstream', { status: 503 });
    return get(path);
  };
  const held = await h.say('继续原任务', draft.task.id);
  assert.equal(held.task?.id, draft.task.id, held.reply);
  assert.equal(held.task.state, 'RESULT_UNKNOWN');
  assert.match(held.reply, /回执.*详情/);
  failDetail = false;
  const done = await h.say('查询原任务结果', draft.task.id);
  assert.equal(done.task.state, 'DONE');
  assert.equal(done.result.orderId, 42);
  assert.ok(lookups.length >= 3 && lookups.every(([key, action]) => key === saved.requestKey && action === 'sale.create'));
  assert.equal(h.writes.length, 1);
});

test('只说继续原任务不会确认仍待确认的预览', async () => {
  const h = create('preset_customer_service', null);
  const draft = await h.say('给远山机电2号店开单：长款铰链两个');
  const out = await h.say('继续原任务', draft.task.id);
  assert.equal(out.task?.id, draft.task.id);
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.match(out.reply, /确认/);
  assert.equal(h.writes.length, 0);
});

test('候选失效仍停在原步骤，选择合法候选后才做后续查询', async () => {
  const h = create('preset_customer_service', null);
  const paused = await h.say('先查一仓的铰链库存，再查二仓的长款铰链库存');
  assert.equal(paused.task.state, 'PAUSED');
  assert.deepEqual(paused.candidates.map(row => row.id), [11, 12]);
  assert.deepEqual(h.warehousesRead(), []);
  await assert.rejects(h.say('选这个', paused.task.id, 999), err => err.status === 400);
  assert.equal((await h.task(paused.task.id)).state, 'PAUSED');
  const out = await h.say('选长款铰链', paused.task.id, 11);
  assert.equal(out.task.id, paused.task.id);
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(h.warehousesRead(), ['1', '2']);
  assert.equal((await h.list()).length, 1);
});

test('条件查询经候选消歧后只为原仓和原商品准备草稿', async () => {
  const h = create('preset_customer_service', null);
  const paused = await h.say('先查二仓的铰链库存，够两个再给远山机电2号店开单');
  assert.equal(paused.task.state, 'DISAMBIGUATING');
  const next = await h.say('选长款', paused.task.id, 11);
  assert.equal(next.task.graph, 'B-sale-draft');
  assert.equal(next.preview.lines[0].productId, 11);
  assert.equal(next.preview.warehouseId, 2);
  assert.deepEqual(h.warehousesRead(), ['2']);
  assert.equal(h.writes.length, 0);
});

test('复合查询重启后只接着未完成的步骤，历史复核所涉仓库', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'xiaoman-sequence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'tasks.json');
  const h = create('preset_customer_service', null);
  const get = h.client.get;
  let bounced = false;
  h.client.get = path => {
    if (path.startsWith('/api/inventory/query-by-product') && path.includes('warehouseId=2') && !bounced) {
      bounced = true;
      throw new FlowError('upstream', { status: 503 });
    }
    return get(path);
  };
  const make = () => createAgentRuntime({ store: new TaskStore(file), messageOptions: { parseIntent: async () => assert.fail('复合查询无需模型') } });
  const paused = await make().dispatch({ method: 'POST', pathname: '/chat', body: { message: sequence }, actor: h.actor, client: h.client });
  const pathname = '/tasks/' + paused.task.id;
  const changed = { ...h.actor, warehouseIds: [2] };
  await assert.rejects(make().dispatch({ method: 'GET', pathname, actor: changed, client: h.client }), error => error.status === 403);
  assert.deepEqual(h.warehousesRead(), ['1']);
  const done = await make().dispatch({ method: 'POST', pathname: pathname + '/resume', body: {}, actor: h.actor, client: h.client });
  assert.equal(done.task.id, paused.task.id);
  assert.equal(done.task.state, 'DONE');
  assert.deepEqual(h.warehousesRead(), ['1', '2']);
  assert.equal(h.writes.length, 0);
});

test('实际可用量低于门槛时，即使可满足制单量也停在确认前', async () => {
  const h = create('preset_customer_service', null);
  const first = await h.say(separatedCondition);
  assert.equal(first.preview.lines[0].qty, 2);
  const get = h.client.get;
  h.client.get = async path => {
    const data = await get(path);
    if (!path.startsWith('/api/inventory/stock')) return data;
    return { ...data, list: data.list.map(row => Number(row.warehouseId) === 2 ? { ...row, available: 8, reserved: 9 } : row) };
  };
  const out = await h.confirm(first.task.id, first.task.revision);
  assert.equal(out.task.state, 'EXPIRED');
  assert.match(out.reply, /不再满足原条件/);
  assert.equal(h.writes.length, 0);
});

test('独立门槛缺开单量时先问，清晰的有货条件可以准备明确数量的草稿', async () => {
  const h = create('preset_customer_service', null);
  const unclear = await h.say('先查二仓的长款铰链库存，至少十个再给远山机电2号店开单');
  assert.equal(unclear.task.graph, 'A-inventory');
  assert.match(unclear.reply, /明确.*数量/);
  assert.equal(unclear.preview, undefined);
  const ready = await h.say('先查二仓的长款铰链库存，有货就给远山机电2号店开单：两个长款铰链');
  assert.equal(ready.preview.lines[0].qty, 2);
  assert.equal(ready.preview.warehouseId, 2);
  assert.equal(h.writes.length, 0);
});

test('普通“查”指令中未授权具名仓也必须拒绝，不能跳到有权仓', async () => {
  const h = create('preset_customer_service', null, [1]);
  const out = await h.say('查远郊仓的长款铰链库存');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /指定仓库.*不可访问/);
  assert.deepEqual(h.warehousesRead(), []);
  assert.ok(!h.reads.some(row => row.pathname === '/api/search/'));
});

test('暂缓开单时仍按顺序完成同句明确要求的两项查询', async () => {
  const h = create('preset_customer_service', { graph: 'B-sale-draft', customerKeyword: '远山机电' });
  const out = await h.say('只查一仓的长款铰链库存，顺便看经营简报，先别开单');
  assert.equal(out.task.graph, 'K-sequence', out.reply);
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(h.warehousesRead(), ['1']);
  assert.equal(h.plannerCalls(), 0);
  assert.equal(h.writes.length, 0);
});

test('原条件任务复核同一待确认草稿，未变化时保留版本且不写业务', async () => {
  const h = create('preset_customer_service', null);
  const draft = await h.say(separatedCondition);
  const inventory = (await h.list()).find(row => row.graph === 'A-inventory');
  const reads = h.reads.length;
  assert.ok(inventory);
  const resumed = await h.say('继续原任务', inventory.id);
  assert.equal(resumed.task?.id, draft.task.id);
  assert.equal(resumed.task.state, 'AWAITING_CONFIRM');
  assert.equal(resumed.task.revision, draft.task.revision);
  assert.ok(h.reads.slice(reads).some(row => row.pathname === '/api/price-lists/customer-price'));
  assert.ok(h.reads.slice(reads).some(row => row.pathname === '/api/inventory/stock'));
  assert.equal(h.writes.length, 0);
});
