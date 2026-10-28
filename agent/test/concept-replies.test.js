import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMessage } from '../src/agent.js';
import { TaskStore } from '../src/tasks.js';
import { unverifiedChatReply } from '../src/persona.js';

const actor = { id: 11, username: 'concept-owner', permissions: [], warehouseIds: [] };
const noFlow = { get: () => assert.fail('概念或范围外话题不能读取业务数据'), post: () => assert.fail('不能写业务') };
const concept = '预占只是先把可承诺数量留给销售单，并不代表已经发货，也不等于收款完成。现存看在库余量，列表可用看现存扣除预占；是否能直接拣货还要看实际容器和任务锁。';
const design = '建议把极序页面的主要操作放在清晰的位置，查询条件集中收起；单据列表用“待确认”和“发货完成”等状态标签帮助辨认。详情先展示客户、仓库和金额，再展开明细。这些是设计建议，不表示界面已经改好，也没有执行发货。';
const example = '举个纯假设的例子：库存有100件，预占20件，可用80件；这些数字只用于解释，不是本系统查询结果。';

test('否定执行含义的真实风格概念解释不会被当成已执行事实', () => {
  assert.equal(unverifiedChatReply(concept), false);
});
test('页面建议里的业务状态标签不会被当成执行完成', () => {
  assert.equal(unverifiedChatReply(design), false);
  assert.equal(unverifiedChatReply('建议把发货完成作为状态文案，与待出库区分。'), false);
});
test('明确标为假设的算术示例不会被当成实时库存', () => {
  assert.equal(unverifiedChatReply(example), false);
});
test('执行声称、未限定实时数字及借示例掩盖的实际声称仍被拦截', () => {
  for (const reply of ['已帮你取消订单并完成付款。', '我已经替你发货。', '这张销售单已经付款完成。', '这张销售单的状态标签显示发货完成。', '当前库存有100件。', '库存有100件。', '假设库存有100件，但实际上当前库存有60件。', '这是示例。我已经替你发货。', '极序支持自动审批和自动发货。', '当前系统版本为9.99。']) {
    assert.equal(unverifiedChatReply(reply), true, reply);
  }
});
test('预占及现存可用核心概念提供稳定解释，不依赖模型或业务查询', async () => {
  for (const message of ['极序里预占库存是什么意思？', '极序里现存和可用库存有什么区别？']) {
    let modelCalls = 0;
    const out = await handleMessage(new TaskStore(null), noFlow, actor, message, { parseIntent: async () => null, chatModel: async () => { modelCalls++; throw new Error('不应调用模型'); } });
    assert.equal(out.task?.state, 'DONE');
    assert.match(out.reply, /预占/);
    assert.match(out.reply, /不会.*扣减.*实存/);
    assert.match(out.reply, /不.*发货/);
    assert.match(out.reply, /现存/);
    assert.match(out.reply, /可用/);
    assert.match(out.reply, /预计|可承诺/);
    assert.equal(modelCalls, 0);
  }
});
test('极序页面设计真实风格回答可通过实际消息入口', async () => {
  let modelCalls = 0;
  const out = await handleMessage(new TaskStore(null), noFlow, actor, '极序的页面设计怎样更清楚？', { parseIntent: async () => null, chatModel: async () => { modelCalls++; return design; } });
  assert.equal(out.task?.state, 'DONE');
  assert.equal(out.reply, design);
  assert.equal(modelCalls, 1);
});
test('气温问法不会被裸有多少路由为库存，零模型和Flow调用', async () => {
  for (const message of ['今天有多少度？', '外面还有多少度？']) {
    let modelCalls = 0;
    const out = await handleMessage(new TaskStore(null), noFlow, actor, message, { parseIntent: async () => { modelCalls++; return null; }, chatModel: async () => { modelCalls++; return ''; } });
    assert.equal(out.task, null);
    assert.match(out.reply, /只聊极序相关/);
    assert.equal(modelCalls, 0);
  }
});
test('极序审批概念本地解释区分业务审批、收款确认与核销，实际审批仍拒绝', async () => {
  let modelCalls = 0;
  const explanation = '审批是对业务申请进行复核的环节。具体节点和人员取决于实际配置，我没有读取你当前的审批配置；这里仅解释含义，不代审批。';
  const opts = { parseIntent: async () => null, chatModel: async () => { modelCalls++; return explanation; } };
  const out = await handleMessage(new TaskStore(null), noFlow, actor, '极序里的审批是什么意思？', opts);
  assert.equal(out.task?.state, 'DONE');
  assert.match(out.reply, /有权人员/);
  assert.match(out.reply, /不等于.*预览.*确认/);
  assert.match(out.reply, /收款.*确认后.*入账/);
  assert.match(out.reply, /核销.*(?:另|再次).*确认/);
  assert.match(out.reply, /跨期|原系统.*配置/);
  const blocked = await handleMessage(new TaskStore(null), noFlow, actor, '帮我审批这张单', opts);
  assert.equal(blocked.task, null);
  assert.equal(modelCalls, 0);
});
