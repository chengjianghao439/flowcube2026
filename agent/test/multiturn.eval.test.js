import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { createFixtureFlow } from './fixtures/role-conversation-flow.js';

const { roles } = JSON.parse(readFileSync(new URL('../../tests/fixtures/qa-roles-approved-20261021.json', import.meta.url)));
const compared = ['preset_sales_manager', 'preset_customer_service', 'preset_finance_specialist', 'preset_warehouse_operator', 'viewer'];
const graphs = { sale: 'B-sale-draft', stock: 'A-inventory' };

function conversation(code, model) {
  const role = roles.find(row => row.code === code);
  const actor = { id: role.id, username: 'synthetic-followup-' + code, roleName: role.name, permissions: role.after, warehouseIds: [1, 2] };
  const store = new TaskStore(null);
  const { client, reads, writes } = createFixtureFlow(actor);
  let calls = 0;
  const runtime = createAgentRuntime({ store, messageOptions: { parseIntent: async () => {
    calls++;
    return model;
  } } });
  const post = (pathname, body) => runtime.dispatch({ method: 'POST', pathname, body, actor, client });
  const say = (message, taskId, choiceId) => post('/chat', { message, taskId, choiceId });
  const look = async id => (await runtime.dispatch({ method: 'GET', pathname: '/tasks/' + id, actor, client })).task;
  const canSale = ['sale.order.create', 'sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view']
    .every(code => actor.permissions.includes(code));
  const canStock = ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view'].every(code => actor.permissions.includes(code));
  return { say, look, post, client, reads, writes, canSale, canStock, calls: () => calls };
}

const draftText = '给远山机电2号店开单：长款铰链两个';
async function sale(h, text = draftText) {
  const out = await h.say(text);
  assert.equal(out.task?.graph, graphs.sale, out.reply);
  if (!h.canSale) {
    assert.equal(out.task.state, 'FAILED_FINAL');
    assert.match(out.reply, /权限/);
    assert.equal(h.reads.length, 0);
  }
  return out;
}

const cases = {
  '目的不清先问想办哪件事': async h => {
    const out = await h.say('小满，帮我处理一下');
    assert.equal(out.task, null);
    assert.match(out.reply, /要查什么|想查什么|想办哪件事/);
    assert.equal(h.calls(), 0);
    assert.equal(h.reads.length, 0);
  },
  '两行只缺一行数量，短回复只补该行': async h => {
    const intake = await sale(h, '给远山机电2号店开单：长款铰链两个，短款铰链');
    if (!h.canSale) return;
    assert.match(intake.reply, /短款铰链.*数量/);
    assert.doesNotMatch(intake.reply, /重新说出商品明细/);
    assert.equal(h.reads.length, 0);
    const completed = await h.say('三个', intake.task.id);
    assert.equal(completed.task.id, intake.task.id);
    assert.deepEqual(completed.preview.lines.map(line => [line.productId, line.qty]), [[11, 2], [12, 3]]);
  },
  '明确开单并给商品时只追问客户': async h => {
    const first = await sale(h, '开销售草稿：长款铰链两个');
    if (!h.canSale) return;
    assert.match(first.reply, /商品先记下了.*客户/);
    assert.equal(h.reads.length, 0);
    const next = await h.say('客户是远山机电2号店', first.task.id);
    assert.equal(next.task.id, first.task.id);
    assert.equal(next.preview.customer.id, 7);
    assert.equal(next.preview.lines[0].qty, 2);
  },
  '客户先说、商品后说，数量范围改成准确数字': async h => {
    const first = await sale(h, '给远山机电2号店开单');
    if (!h.canSale) return;
    const follow = await h.say('要长款铰链五到六个', first.task.id);
    assert.equal(follow.task.id, first.task.id);
    assert.match(follow.reply, /长款铰链.*明确数量/);
    assert.equal(h.reads.length, 0);
    const next = await h.say('就六个', first.task.id);
    assert.equal(next.task.id, first.task.id);
    assert.equal(next.preview.lines[0].qty, 6);
    assert.equal(next.preview.lines[0].productId, 11);
  },
  '授权仓先说，库存商品在下一轮补齐': async h => {
    const first = await h.say('只查二仓的库存');
    assert.equal(first.task?.graph, graphs.stock, first.reply);
    if (!h.canStock) {
      assert.equal(first.task.state, 'FAILED_FINAL');
      assert.match(first.reply, /权限/);
      return;
    }
    assert.equal(first.task.state, 'DISAMBIGUATING');
    assert.match(first.reply, /商品.*名称|商品.*编号/);
    assert.equal(h.reads.length, 0);
    const next = await h.say('长款铰链', first.task.id);
    assert.equal(next.task.id, first.task.id);
    assert.equal(next.result.warehouseId, 2);
    assert.equal(next.result.available, 15);
    assert.deepEqual(h.reads.filter(row => row.pathname === '/api/inventory/query-by-product').map(row => row.query.warehouseId), ['2']);
  },
  '临时暂停并独立查库存，原草稿可回来继续': async h => {
    const first = await sale(h, '给远山机电2号店开单');
    const switched = await h.say('这单先放着，另外问下只查一仓的长款铰链库存', first.task.id);
    assert.equal(switched.task?.graph, graphs.stock, switched.reply);
    assert.notEqual(switched.task.id, first.task.id);
    assert.equal(switched.task.state, h.canStock ? 'DONE' : 'FAILED_FINAL');
    if (!h.canSale) return;
    assert.equal((await h.look(first.task.id)).state, 'DISAMBIGUATING');
    const resumed = await h.say('长款铰链两个', first.task.id);
    assert.equal(resumed.task.id, first.task.id);
    assert.equal(resumed.preview.lines[0].qty, 2);
  },
  '明确另一个话题里的改量说法不能改旧卡': async h => {
    const first = await sale(h);
    const fresh = await h.say('换个话题，数量改成三个', first.task.id);
    assert.equal(fresh.task, null);
    assert.equal(fresh.detachTask, true);
    assert.match(fresh.reply, /哪.*(?:单|商品)|具体对象/);
    if (h.canSale) {
      const old = await h.look(first.task.id);
      assert.equal(old.revision, first.task.revision);
      assert.equal(old.preview.lines[0].qty, 2);
    }
  },
  '改口能理解正向数量并拒绝单位不一致和旧版本': async h => {
    const first = await sale(h);
    if (!h.canSale) return;
    const wrongUnit = await h.say('数量改成三箱', first.task.id);
    assert.match(wrongUnit.reply, /单位.*个/);
    assert.equal(wrongUnit.task.revision, first.task.revision);
    assert.equal(wrongUnit.preview.lines[0].qty, 2);
    const change = await h.say('不是两个，是三个', first.task.id);
    assert.equal(change.task.id, first.task.id);
    assert.equal(change.task.revision, first.task.revision + 1);
    assert.equal(change.preview.lines[0].qty, 3);
    await assert.rejects(h.post('/tasks/' + first.task.id + '/confirm', { revision: first.task.revision }), error => error.status === 409);
    await assert.rejects(h.post('/tasks/' + first.task.id + '/confirm', {}), error => error.status === 409);
  },
  '改口换商品重算同一草稿，原版本不能确认': async h => {
    const first = await sale(h);
    if (!h.canSale) return;
    const adjusted = await h.say('不是长款铰链，商品换成短款铰链三个', first.task.id);
    assert.equal(adjusted.task?.id, first.task.id, adjusted.reply);
    assert.equal(adjusted.task.state, 'AWAITING_CONFIRM');
    assert.equal(adjusted.preview.customer.id, 7);
    assert.equal(adjusted.preview.warehouseId, first.preview.warehouseId);
    assert.deepEqual(adjusted.preview.lines.map(line => [line.productId, line.qty]), [[12, 3]]);
    await assert.rejects(h.post('/tasks/' + first.task.id + '/confirm', { revision: first.task.revision }), error => error.status === 409);
  },
  '新的一张销售单独立，已有草稿不被补进去': async h => {
    const first = await sale(h, '给远山机电2号店开单');
    const next = await h.say('另开一张，给远山机电3号店开单：短款铰链两个', first.task.id);
    assert.equal(next.task?.graph, graphs.sale, next.reply);
    assert.notEqual(next.task.id, first.task.id);
    if (h.canSale) {
      assert.equal(next.preview.customer.id, 8);
      assert.equal((await h.look(first.task.id)).state, 'DISAMBIGUATING');
    }
  },
  '笼统登记收款只问付款客户和准确金额': async h => {
    const out = await h.say('有笔收款要登记');
    assert.equal(out.task, null);
    assert.match(out.reply, /客户全称.*金额/);
    assert.equal(h.calls(), 0);
    assert.equal(h.reads.length, 0);
  },
};

for (const [name, scenario] of Object.entries(cases)) {
  for (const code of compared) {
    for (const [mode, model] of [['规则', null], ['模型给出不相关意图', { graph: 'F-briefing' }]]) {
      test(name + ' / ' + code + ' / ' + mode, async () => {
        const h = conversation(code, model);
        await scenario(h);
        assert.equal(h.writes.length, 0);
      });
    }
  }
}

test('货号末尾数字是商品的一部分，下一轮明确数量才开始试算', async () => {
  const h = conversation('preset_customer_service', { graph: 'F-briefing' });
  const first = await h.say('给远山机电2号店开单：P110001');
  assert.match(first.reply, /P110001.*数量/);
  assert.equal(h.reads.length, 0);
  const next = await h.say('两个', first.task.id);
  assert.equal(next.preview.lines[0].productId, 11);
  assert.equal(next.preview.lines[0].qty, 2);
});

test('正在消歧可以换商品，旧候选不能提交或写入', async () => {
  const h = conversation('preset_customer_service', null);
  const first = await h.say('给远山机电2号店开单：铰链两个');
  assert.equal(first.task.state, 'DISAMBIGUATING');
  assert.deepEqual(first.candidates.map(row => row.id), [11, 12]);
  const next = await h.say('商品换成短款铰链三个', first.task.id);
  assert.equal(next.task.id, first.task.id);
  assert.equal(next.preview.lines[0].productId, 12);
  assert.equal(next.preview.lines[0].qty, 3);
  await assert.rejects(h.say('选这个', first.task.id, 11), error => error.status === 400);
  assert.equal(h.writes.length, 0);
});

test('查单号的新问题不能被当成正在追问的商品', async () => {
  const h = conversation('preset_customer_service', null);
  const first = await h.say('给远山机电2号店开单');
  const next = await h.say('帮我看看SL20261122011的状态', first.task.id);
  assert.equal(next.task, null);
  const after = await h.say('长款铰链两个', first.task.id);
  assert.equal(after.task.id, first.task.id);
  assert.deepEqual(after.preview.lines.map(row => row.productId), [11]);
  assert.equal(h.writes.length, 0);
});

test('补错单位后继续同一草稿，只再问该行数量', async () => {
  const h = conversation('preset_customer_service', null);
  const first = await h.say('给远山机电2号店开单：长款铰链两个，短款铰链');
  const wrong = await h.say('三箱', first.task.id);
  assert.equal(wrong.task.state, 'DISAMBIGUATING');
  assert.match(wrong.reply, /短款铰链.*单位.*个/);
  const next = await h.say('三个', first.task.id);
  assert.equal(next.task.id, first.task.id);
  assert.deepEqual(next.preview.lines.map(row => row.qty), [2, 3]);
  assert.equal(h.writes.length, 0);
});

test('口头否定能按原卡辨认客户与唯一商品，不重填其余行', async () => {
  const h = conversation('preset_customer_service', null);
  const first = await h.say('给远山机电2号店开单：长款铰链两个，短款铰链一个');
  const next = await h.say('不是远山机电2号店，是远山机电3号店', first.task.id);
  assert.equal(next.task?.id, first.task.id);
  assert.equal(next.preview.customer.id, 8);
  // 改同一商品的数量保留另一行，并继续拒绝用原卡确认。
  const changed = await h.say('长款铰链不是两个，是三个', first.task.id);
  assert.equal(changed.preview.customer.id, 8);
  assert.deepEqual(changed.preview.lines.map(row => [row.productId, row.qty]), [[11, 3], [12, 1]]);
  assert.equal(h.writes.length, 0);
});

test('明确否定并更换一件商品时只替换所指的行', async () => {
  const h = conversation('preset_customer_service', null);
  const first = await h.say('给远山机电2号店开单：长款铰链两个，短款铰链一个');
  const waiting = await h.say('不是长款铰链，换成P110001', first.task.id);
  assert.equal(waiting.task?.id, first.task.id);
  assert.equal(waiting.task.state, 'DISAMBIGUATING');
  assert.match(waiting.reply, /P110001.*数量/);
  const result = await h.say('就三个', first.task.id);
  assert.deepEqual(result.preview.lines.map(row => [row.productId, row.qty]), [[11, 3], [12, 1]]);
  assert.equal(h.writes.length, 0);
});
