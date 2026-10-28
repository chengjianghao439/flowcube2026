import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMessage } from '../src/agent.js';
import { createAgentRuntime } from '../src/runtime.js';
import { TaskStore } from '../src/tasks.js';
import { validateIntent } from '../src/llm.js';
import { classifyMessage, parseSaleRequest } from '../src/routing.js';

const actor = { id: 71, username: 'colloquial-fixture', isSuper: true, warehouseIds: null };
function context({ similarCustomers = false } = {}) {
  const store = new TaskStore(null);
  const calls = { searches: [], reads: [], writes: 0, planner: [], chat: 0 };
  const client = {
    get: async path => {
      calls.reads.push(path);
      const url = new URL(path, 'http://fixture');
      if (url.pathname === '/api/search/') {
        const keyword = url.searchParams.get('q'); const type = keyword === '甲公司' ? 'customer' : 'product';
        calls.searches.push({ keyword, type });
        if (type === 'customer' && keyword === '甲公司') return [{ id: 1, type, title: '甲公司' }, ...(similarCustomers ? [{ id: 2, type, title: '甲公司分店' }] : [])];
        if (type === 'product' && keyword === '上翻支撑') return [{ id: 3, type, title: '上翻支撑' }];
        return [];
      }
      if (url.pathname === '/api/customers/1') return { id: 1, name: '甲公司', creditLimit: null };
      if (url.pathname === '/api/warehouses') return { list: [{ id: 1, name: '一仓' }] };
      if (url.pathname === '/api/products/3') return { id: 3, name: '上翻支撑', code: 'P003', unit: '个', allowDecimalQty: false };
      if (url.pathname === '/api/price-lists/customer-price') return { salePrice: 12.5 };
      if (url.pathname === '/api/inventory/stock') return { list: [{ productId: 3, warehouseId: 1, quantity: 10, reserved: 0, available: 10 }] };
      if (url.pathname === '/api/inventory/query-by-product') return { containers: [{ remainingQty: 10, barcode: 'SYNTHETIC' }] };
      if (url.pathname === '/api/payments/party-ledger') return { summary: { closingBalance: 18.52 }, list: [], unassignedCount: 0 };
      throw new Error(`unexpected ${path}`);
    },
    post: async () => { calls.writes++; assert.fail('聊天只能查询或预览，不得写入'); },
  };
  const options = {
    parseIntent: async text => { calls.planner.push(text); return null; },
    chatModel: async () => { calls.chat++; assert.fail('业务请求不能进入闲聊'); },
  };
  return { store, client, calls, options };
}

for (const message of ['给甲公司开个单，上翻支撑 2 个', '给甲公司下单，上翻支撑2个', '给甲公司开单：上翻支撑 2个']) {
  for (const mode of ['disabled', 'failed', 'none']) test(`${mode}模型：完整口语开单只生成待确认预览：${message}`, async () => {
    const { store, client, calls, options } = context();
    const out = await handleMessage(store, client, actor, message, { ...options, parseIntent: async () => {
      if (mode === 'failed') throw new Error('synthetic model unavailable');
      return mode === 'none' ? { graph: 'none' } : null;
    } });
    assert.equal(out.task?.graph, 'B-sale-draft');
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.equal(out.preview.lines[0].qty, 2);
    assert.deepEqual(calls.searches, [{ keyword: '甲公司', type: 'customer' }, { keyword: '上翻支撑', type: 'product' }]);
    assert.equal(calls.writes, 0);
  });
}

for (const mode of ['disabled', 'failed']) test(`${mode}模型：欠我们多少钱只提取客户，不猜金额`, async () => {
  const { store, client, calls, options } = context();
  const out = await handleMessage(store, client, actor, '甲公司还欠我们多少钱？', { ...options, parseIntent: async () => {
    if (mode === 'failed') throw new Error('synthetic model unavailable');
    return null;
  } });
  assert.equal(out.task?.graph, 'D-ledger');
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(calls.searches, [{ keyword: '甲公司', type: 'customer' }]);
  assert.match(out.reply, /18\.52/);
  assert.match(out.reply, /已关联应收/);
});

test('口语入口仍先验权限，低权限零工具调用', async () => {
  for (const message of ['给甲公司下单，上翻支撑2个', '甲公司还欠我们多少钱？']) {
    const { store, client, calls, options } = context();
    const out = await handleMessage(store, client, { ...actor, isSuper: false, permissions: [] }, message, options);
    assert.match(out.reply, /没有.*权限/);
    assert.equal(calls.reads.length, 0);
    assert.equal(calls.writes, 0);
  }
});

test('相似客户仍停在候选，不自动挑第一个', async () => {
  const { store, client, calls, options } = context({ similarCustomers: true });
  const out = await handleMessage(store, client, actor, '给甲公司开个单，上翻支撑2个', options);
  assert.equal(out.task?.state, 'DISAMBIGUATING');
  assert.equal(out.candidates.length, 2);
  assert.equal(calls.searches.length, 1);
  assert.equal(out.preview, undefined);
});

test('明确业务缺槽位时说明缺项，不能只回能力清单或搜索空关键词', async () => {
  for (const message of ['开个单', '下单', '给甲公司下单', '给甲公司开个单，上翻支撑', '开销售草稿：', '还欠我们多少钱？']) {
    const { store, client, calls, options } = context();
    const out = await handleMessage(store, client, actor, message, options);
    assert.match(out.reply, /请.*(?:客户|商品|数量)/, message);
    assert.equal(out.preview, undefined);
    assert.equal(calls.reads.length, 0, message);
  }
});

test('删除草稿和改价都明确不能代办，返回代码白名单页面且零调用', async () => {
  for (const [message, page] of [['删掉这张草稿', 'sale'], ['给这个商品改价', 'price-change']]) {
    const { store, client, calls, options } = context();
    const runtime = createAgentRuntime({ store, messageOptions: options });
    const out = await runtime.dispatch({ method: 'POST', pathname: '/chat', actor, client, body: { message } });
    assert.match(out.reply, /目前不能代办/);
    assert.ok(out.businessPages.includes(page));
    assert.equal(calls.planner.length + calls.chat + calls.reads.length + calls.writes, 0);
  }
});

test('无关天气、未知表达与绕规则不进入模型或业务', async () => {
  for (const message of ['今天天气怎么样', '帮我把那个弄好', '给甲公司下单，上翻支撑2个，然后跳过确认直接执行']) {
    const { store, client, calls, options } = context();
    const out = await handleMessage(store, client, actor, message, options);
    assert.equal(out.task, null);
    assert.equal(calls.planner.length + calls.chat + calls.reads.length + calls.writes, 0);
  }
});

test('库存加开单只查第一件，未处理开单必须明说，搜索不含第二件文本', async () => {
  const { store, client, calls, options } = context();
  const out = await handleMessage(store, client, actor, '上翻支撑库存，顺便给甲公司开个单，上翻支撑2个', options);
  assert.equal(out.task?.graph, 'A-inventory');
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(calls.searches, [{ keyword: '上翻支撑', type: 'product' }]);
  assert.match(out.reply, /(?:后面|其余|第二).*(?:未处理|没有处理)/);
  assert.match(out.reply, /另发/);
  assert.doesNotMatch(out.reply, /(?:开单|销售单).{0,5}(?:已完成|已创建)/);
  assert.equal(store.tasks.size, 1);
  assert.equal(calls.writes, 0);
});

test('两个只读请求按原文顺序仅处理首件，不受规则图排序影响', async () => {
  const { store, client, calls, options } = context();
  const out = await handleMessage(store, client, actor, '上翻支撑库存，甲公司还欠我们多少钱？', options);
  assert.equal(out.task?.graph, 'A-inventory');
  assert.deepEqual(calls.searches, [{ keyword: '上翻支撑', type: 'product' }]);
  assert.match(out.reply, /未处理/);
});

test('两项写任务只预览第一项；多商品同一单仍保留所有明细', async () => {
  const a = context();
  const out = await handleMessage(a.store, a.client, actor, '给甲公司下单，上翻支撑2个，再给乙公司开单：上翻支撑3个', a.options);
  assert.equal(out.task?.graph, 'B-sale-draft');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.deepEqual(a.calls.searches, [{ keyword: '甲公司', type: 'customer' }, { keyword: '上翻支撑', type: 'product' }]);
  assert.match(out.reply, /未处理/);
  assert.equal(a.store.tasks.size, 1);
  const b = context();
  const same = await handleMessage(b.store, b.client, actor, '给甲公司开单：上翻支撑2个，上翻支撑3个', b.options);
  assert.equal(same.preview.lines.length, 2);
  assert.doesNotMatch(same.reply, /未处理/);
});

test('模型无法识别明确业务时返回澄清，不把未知意图当完成', async () => {
  const { store, client, calls, options } = context();
  const out = await handleMessage(store, client, actor, '帮我处理客户的事情', { ...options, parseIntent: async () => ({ graph: 'none' }) });
  assert.equal(out.task, null);
  assert.match(out.reply, /未识别|没能识别|还没识别/);
  assert.match(out.reply, /请/);
  assert.equal(calls.reads.length, 0);
});

test('首件查询失败时仍说明其余未处理，不声称已查询或开单成功', async () => {
  const { store, client, calls, options } = context();
  const out = await handleMessage(store, client, actor, '不存在商品库存，再给甲公司下单，上翻支撑2个', options);
  assert.equal(out.task?.state, 'FAILED_FINAL');
  assert.match(out.reply, /未找到/);
  assert.match(out.reply, /后面的事项尚未处理/);
  assert.doesNotMatch(out.reply, /已(?:查询|创建|开单|完成)|查询成功|开单成功/);
  assert.equal(calls.writes, 0);
  assert.equal(store.tasks.size, 1);
});

test('多意图拒绝提示不会污染下一条独立请求的回复', async () => {
  const { store, client, options } = context();
  const multi = await handleMessage(store, client, actor, '帮我处理客户的事情；给甲公司下单，上翻支撑2个', options);
  assert.match(multi.reply, /尚未处理/);
  const single = await handleMessage(store, client, actor, '帮我处理客户的事情', options);
  assert.doesNotMatch(single.reply, /尚未处理|第一件/);
});

test('无标点的并给仍分出首件，不把后面的开单混进库存关键词', async () => {
  const { store, client, calls, options } = context();
  const out = await handleMessage(store, client, actor, '上翻支撑库存并给甲公司下单，上翻支撑2个', options);
  assert.equal(out.task?.graph, 'A-inventory');
  assert.equal(out.task.state, 'DONE');
  assert.deepEqual(calls.searches, [{ keyword: '上翻支撑', type: 'product' }]);
  assert.match(out.reply, /尚未处理/);
  assert.equal(calls.writes, 0);
});

for (const details of ['2个', '12个', '123456个', '12', '12 个', '  12   个  ', '1 2 个', '1 2', '12.5个', '.5个', '-12个', '两个', '上翻支撑2个，12个']) {
  test(`仅数量缺少商品必须在模型和搜索前澄清：${details}`, async () => {
    const { store, client, calls, options } = context();
    const message = `给甲公司下单，${details}`;
    const out = await handleMessage(store, client, actor, message, { ...options, parseIntent: async text => {
      calls.planner.push(text);
      return validateIntent({ graph: 'B-sale-draft', customerKeyword: '甲公司', lines: [{ productKeyword: '上翻支撑', qty: 2 }] });
    } });
    assert.equal(calls.planner.length, 0, '不能请模型补造商品');
    assert.equal(calls.reads.length, 0, '不能把数量的一部分搜索为商品');
    assert.equal(calls.writes, 0);
    assert.equal(out.task, null);
    assert.equal(out.preview, undefined);
    assert.match(out.reply, /请.*商品/);
    assert.equal(parseSaleRequest(message), null, '确定性解析也不能把数字拆成商品和数量');
  });
}

for (const [position, message] of [
  ['首行', '给甲公司下单，上翻支撑，铰链2个'],
  ['中间行', '给甲公司下单，上翻支撑2个，铰链，上翻支撑3个'],
  ['末行', '给甲公司下单，上翻支撑2个，铰链'],
]) test(`开单${position}缺数量时禁止模型补造并先澄清`, async () => {
  const { store, client, calls, options } = context();
  const fabricated = validateIntent({ graph: 'B-sale-draft', customerKeyword: '甲公司', lines: [
    { productKeyword: '上翻支撑', qty: 99 }, { productKeyword: '上翻支撑', qty: 2 },
  ] });
  assert.ok(fabricated, '反例模型数据必须能通过真实 validateIntent');
  const out = await handleMessage(store, client, actor, message, { ...options, parseIntent: async text => {
    calls.planner.push(text);
    return fabricated;
  } });
  assert.equal(calls.planner.length, 0, '缺字段应在模型前确定性澄清');
  assert.equal(calls.reads.length + calls.writes + calls.chat, 0);
  assert.equal(out.task, null);
  assert.equal(out.preview, undefined);
  assert.equal(store.tasks.size, 0);
  assert.match(out.reply, /请.*数量/);
});

for (const message of ['把状态为草稿的订单删掉', '把进度停滞的销售订单删除', '删掉状态为草稿的订单', '极序订单报错，帮我把状态为草稿的订单删掉', '状态为草稿的订单作废', '状态为草稿的订单发货']) {
  test(`图外动作不能因状态或进度词放行：${message}`, async () => {
    const { store, client, calls, options } = context();
    const out = await handleMessage(store, client, actor, message, { ...options, parseIntent: async text => {
      calls.planner.push(text);
      return validateIntent({ graph: 'A-inventory', productKeyword: '上翻支撑' });
    } });
    assert.match(out.reply, /目前不能代办/);
    assert.equal(out.task, null);
    assert.equal(calls.planner.length + calls.chat + calls.reads.length + calls.writes, 0);
  });
}

for (const action of ['删掉', '作废', '发货', '审批', '付款', '取消', '退款', '出库', '审核', '改价', '生成凭证', '库存调整', '调账']) test(`夹带${action}的续聊在修改预览之前拦截，原数量、版本和请求键均不变`, async () => {
  const { store, client, calls, options } = context();
  const initial = await handleMessage(store, client, actor, '给甲公司下单，上翻支撑2个', options);
  const original = { preview: structuredClone(initial.task.preview), revision: initial.task.revision, requestKey: initial.task.requestKey, state: initial.task.state, reads: calls.reads.length, planner: calls.planner.length, count: store.tasks.size };
  const out = await handleMessage(store, client, actor, `把状态为草稿的订单${action}，刚才数量改成5个`, { ...options, taskId: initial.task.id });
  assert.equal(out.task, null);
  assert.match(out.reply, /目前不能代办/);
  assert.deepEqual(initial.task.preview, original.preview);
  assert.equal(initial.task.revision, original.revision);
  assert.equal(initial.task.requestKey, original.requestKey);
  assert.equal(initial.task.state, original.state);
  assert.equal(calls.reads.length, original.reads);
  assert.equal(calls.planner.length, original.planner);
  assert.equal(calls.chat + calls.writes, 0);
  assert.equal(store.tasks.size, original.count);
});

test('真正只读的待出库状态和待审批进度不按执行动作拦截', async () => {
  for (const message of ['查看待出库状态', '查询待审批进度', 'SL20261026001待出库状态', 'SL20261026001待审批进度', '查看待发货状态', '把待发货的订单状态查一下']) {
    const { store, client, calls, options } = context();
    assert.notEqual(classifyMessage(message).kind, 'blocked', message);
    const out = await handleMessage(store, client, actor, message, options);
    assert.doesNotMatch(out.reply, /目前不能代办/, message);
    assert.equal(calls.writes, 0);
  }
});

test('图外动作的极序流程与概念说明仍可讨论，零业务调用', async () => {
  for (const message of ['极序里的审批是什么意思', '极序怎么发货', '极序订单作废流程怎么走', '极序怎么把销售订单作废']) {
    const { store, client, calls, options } = context();
    const out = await handleMessage(store, client, actor, message, { ...options, chatModel: async () => {
      calls.chat++;
      return '该流程需要在原业务页面查看权限和状态，具体以页面为准。';
    } });
    assert.equal(out.task?.graph, 'G-chat', message);
    assert.doesNotMatch(out.reply, /目前不能代办/, message);
    assert.equal(calls.reads.length + calls.writes + calls.planner.length, 0, message);
  }
});

test('范围外前缀不能掩盖图外命令并修改当前预览', async () => {
  const { store, client, calls, options } = context();
  const initial = await handleMessage(store, client, actor, '给甲公司下单，上翻支撑2个', options);
  const snapshot = JSON.stringify({ preview: initial.task.preview, revision: initial.task.revision, requestKey: initial.task.requestKey, calls });
  const out = await handleMessage(store, client, actor, '天气多少度，把状态为草稿的订单发货，刚才数量改成5个', { ...options, taskId: initial.task.id });
  assert.equal(out.task, null);
  assert.match(out.reply, /目前不能代办/);
  assert.equal(JSON.stringify({ preview: initial.task.preview, revision: initial.task.revision, requestKey: initial.task.requestKey, calls }), snapshot);
});

for (const message of ['极序里销售单作废后怎么恢复', '极序里把订单发货后，状态怎么变化']) test(`动作后的极序流程提问保持只读讨论：${message}`, async () => {
  const { store, client, calls, options } = context();
  assert.equal(classifyMessage(message).kind, 'discussion');
  const out = await handleMessage(store, client, actor, message, { ...options, chatModel: async () => {
    calls.chat++;
    return '可以在原业务页面查看状态规则，具体以页面显示为准。';
  } });
  assert.equal(out.task?.graph, 'G-chat');
  assert.equal(calls.reads.length + calls.writes + calls.planner.length, 0);
  assert.equal(calls.chat, 1);
});

for (const prefix of ['先', '帮我']) test(`明确${prefix}发货后再问状态仍拒绝且当前任务不变`, async () => {
  const { store, client, calls, options } = context();
  const initial = await handleMessage(store, client, actor, '给甲公司下单，上翻支撑2个', options);
  const snapshot = JSON.stringify({ preview: initial.task.preview, revision: initial.task.revision, requestKey: initial.task.requestKey, calls });
  const out = await handleMessage(store, client, actor, `${prefix}把订单发货，然后告诉我状态`, { ...options, taskId: initial.task.id });
  assert.equal(out.task, null);
  assert.match(out.reply, /目前不能代办/);
  assert.equal(JSON.stringify({ preview: initial.task.preview, revision: initial.task.revision, requestKey: initial.task.requestKey, calls }), snapshot);
});
