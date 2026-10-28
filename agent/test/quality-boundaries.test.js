import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../src/tools.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask, tryAccountSelection, buildReceiptPreview } from '../src/agent.js';
import { unverifiedChatReply, FLOW_CHAT_SCOPE } from '../src/persona.js';
import { listTaskViews } from '../src/task-access.js';

const actor = { id: 37, username: 'quality-owner', isSuper: true, warehouseIds: null };
const rules = { parseIntent: async () => null };

test('简报并发后段先失败时 Node22 子进程仍存活并保留各段结果', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { TOOLS } from ${JSON.stringify(new URL('../src/tools.js', import.meta.url).href)};
    const client = { get: async path => {
      if (path.endsWith('/summary')) { await new Promise(resolve => setTimeout(resolve, 40)); return { pending: 2 }; }
      if (path.endsWith('/credit-warning')) throw new Error('synthetic 503');
      return [];
    } };
    const out = await TOOLS['dashboard.briefing'].run(client);
    assert.equal(out.sections.summary.ok, true);
    assert.equal(out.sections.creditWarning.ok, false);
    assert.match(out.sections.creditWarning.error, /503/);
    process.stdout.write('sections preserved');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /sections preserved/);
});

for (const status of [403, 503]) {
  for (const message of ['有哪些商品需要补货', '按补货建议建采购草稿']) {
    test(`补货主读取 ${status} 不伪装空建议：${message}`, async () => {
      const client = { get: async path => {
        if (path.startsWith('/api/warehouses')) return [{ id: 2, name: '合成二仓' }];
        if (path.startsWith('/api/inventory/replenishment')) throw Object.assign(new Error(`synthetic ${status}`), { status });
        if (path === '/api/dashboard/low-stock') return [];
        assert.fail(path);
      }, post: () => assert.fail('补货读取失败不能写入') };
      const out = await handleMessage(new TaskStore(null), client, actor, message, rules);
      assert.equal(out.task?.state, 'FAILED_FINAL');
      assert.match(out.reply, new RegExp(String(status)));
      assert.equal(out.preview, undefined);
      assert.equal(out.task.preview, null);
      assert.doesNotMatch(out.reply, /当前没有补货建议|建议量.*全.*0/);
    });
  }
}
test('成功读取的空补货集合仍可明确报告没有建议', async () => {
  const client = { get: async path => path.startsWith('/api/warehouses') ? [{ id: 2, name: '合成二仓' }] : { list: [], total: 0 } };
  const out = await handleMessage(new TaskStore(null), client, actor, '有哪些商品需要补货', rules);
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /没有补货建议/);
});

for (const reply of ['当前库存：**100** 件。', '该客户的应收余额为 ¥120.00。', '该销售单已创建成功。', '该客户的应收余额为 ¥-120.00。']) {
  test(`交流模型不能以常见排版声称业务事实：${reply}`, async () => {
    assert.equal(unverifiedChatReply(reply), true);
    const noFlow = { get: () => assert.fail('讨论不能查业务'), post: () => assert.fail('讨论不能写业务') };
    const out = await handleMessage(new TaskStore(null), noFlow, actor, '极序的页面设计怎样更清楚？', { ...rules, chatModel: async () => reply });
    assert.equal(out.task.state, 'FAILED_FINAL');
    assert.notEqual(out.reply, reply);
  });
}
test('规范化后明确示例、否定关系及状态文案仍可解释', () => {
  for (const reply of ['假设库存：**100** 件，预占20件，仅为算术示例。', '预占不代表该销售单已创建成功，也不等于已经发货。', '建议用“已创建成功”作为状态标签，别把确认按钮当作审批。']) assert.equal(unverifiedChatReply(reply), false, reply);
});

for (const message of ['我不用极序，如何设计一场生日派对？', '在极序里聊聊苹果公司的产品设计', '极序先放一边，聊聊今天北京的天气和旅游页面设计']) {
  test(`提到极序不能放行无关讨论：${message}`, async () => {
    const store = new TaskStore(null);
    const noCalls = () => assert.fail('范围外不能调用任何模型或业务工具');
    const out = await handleMessage(store, { get: noCalls, post: noCalls }, actor, message, { parseIntent: noCalls, chatModel: noCalls });
    assert.equal(out.task, null);
    assert.match(out.reply, /只聊极序相关/);
    assert.equal(store.tasks.size, 0);
  });
}
for (const message of ['极序的页面先不谈，换个话题聊聊苹果公司的产品设计', '极序的页面设计很清楚，换个话题聊聊苹果公司的产品设计', '你叫什么名字，换个话题聊聊苹果公司的产品设计']) {
  test(`明确换话题不能沿用前半句极序归属：${message}`, async () => {
    const noCalls = () => assert.fail('换到范围外话题不能调用模型或业务工具');
    const store = new TaskStore(null);
    const out = await handleMessage(store, { get: noCalls, post: noCalls }, actor, message, { parseIntent: noCalls, chatModel: noCalls });
    assert.equal(out.task, null);
    assert.match(out.reply, /只聊极序相关/);
    assert.equal(store.tasks.size, 0);
  });
}
test('换话题后的明确极序审批或流程仍可说明，模型只收到当前相关目标', async () => {
  for (const topic of ['极序里的审批是什么意思', '极序发货流程怎么走']) {
    let messages;
    const store = new TaskStore(null);
    const noFlow = () => assert.fail('概念或流程讨论不能调用业务工具');
    const out = await handleMessage(store, { get: noFlow, post: noFlow }, actor, `苹果公司的设计先不谈，换个话题聊聊${topic}`, { ...rules, chatModel: async input => { messages = input.messages; return '发货应在原系统按有权人员确认的作业流程办理，我没有读取具体订单和当前配置。'; } });
    assert.equal(out.task?.state, 'DONE');
    if (messages) assert.doesNotMatch(JSON.stringify(messages), /苹果公司/);
  }
});
test('旧范围标记也不能恢复或再传已被排除的无关交流', async () => {
  const store = new TaskStore(null);
  const legacy = store.create({ graph: 'G-chat', userText: '在极序里聊聊苹果公司的产品设计', actor });
  Object.assign(legacy, { state: 'DONE', discussionScope: FLOW_CHAT_SCOPE, discussionKind: 'product', reply: 'SYNTHETIC_UNRELATED_DESIGN' });
  assert.equal(listTaskViews(store, actor).length, 0);
  let messages;
  const out = await handleMessage(store, {}, actor, '极序的页面设计怎么更清楚？', { ...rules, chatModel: async input => { messages = input.messages; return '建议把极序单据的主要操作集中展示。'; } });
  assert.equal(out.task.state, 'DONE');
  assert.doesNotMatch(JSON.stringify(messages), /SYNTHETIC_UNRELATED_DESIGN|苹果公司/);
});

function receiptContext() {
  const store = new TaskStore(null);
  const searches = [];
  const client = { get: async path => {
    const url = new URL(path, 'http://synthetic');
    if (url.pathname === '/api/search/') { searches.push(url.searchParams.get('q')); return [{ id: 7, type: 'customer', title: '合成客户' }]; }
    if (url.pathname === '/api/customers/7') return { id: 7, name: '合成客户' };
    if (url.pathname === '/api/payments/') return { list: [{ id: 11, orderNo: 'SL20261026007', totalAmount: 100, paidAmount: 0, balance: 100, status: 1 }], total: 1 };
    if (url.pathname === '/api/payments/party-ledger') return { summary: { closingBalance: 100 }, unassignedCount: 0 };
    if (url.pathname === '/api/finance/accounts/active') return [{ id: 5, name: '合成基本户' }, { id: 6, name: '合成现金户' }];
    assert.fail(path);
  }, post: () => assert.fail('金额回归不能写入') };
  return { store, client, searches };
}
for (const raw of ['-5', '0', '0.001', '−5', '负5', '负五元', '- 5', '-.5元', '五元', '五', '若干元', '5万元', '--5', '5e2', '1,000']) {
  test(`显式无效到账金额不能变正数或按全额：${raw}`, async () => {
    for (const parseIntent of [rules.parseIntent, async () => ({ graph: 'D-receipt', customerKeyword: '合成客户', amountCents: 500 }), async () => { throw new Error('synthetic invalid intent'); }]) {
      const { store, client } = receiptContext();
      const out = await handleMessage(store, client, actor, `合成客户到账 ${raw} 核销`, { parseIntent });
      assert.equal(out.task?.graph, 'D-receipt');
      assert.equal(out.task.state, 'FAILED_FINAL');
      assert.equal(out.preview, undefined);
      assert.equal(out.task.preview, null);
      assert.match(out.reply, /金额|数字/);
    }
  });
}
test('前导小数按原意为五角，省略金额仍按未结全额', async () => {
  for (const [message, cents] of [['合成客户到账 .5元 核销', 50], ['合成客户到账 核销', 10000]]) {
    const { store, client } = receiptContext();
    const out = await handleMessage(store, client, actor, message, rules);
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.equal(out.preview.amountCents, cents);
  }
});
test('模型给出的非法分值同样不能出预览', async () => {
  for (const amountCents of [0, -500, 0.1]) {
    const { store, client } = receiptContext();
    const out = await handleMessage(store, client, actor, '合成客户到账 核销', { parseIntent: async () => ({ graph: 'D-receipt', customerKeyword: '合成客户', amountCents }) });
    assert.equal(out.task.state, 'FAILED_FINAL');
    assert.equal(out.task.preview, null);
  }
});
test('旧无效收款预览不能通过选择账户或确认绕过金额检查', async () => {
  for (const operation of ['select', 'confirm']) {
    const { store, client } = receiptContext();
    const out = await handleMessage(store, client, actor, '合成客户到账 5 核销', rules);
    out.task.preview.amountCents = 0;
    out.task.preview.payload.amount = 0;
    if (operation === 'select') await assert.rejects(tryAccountSelection(store, actor, '2', client, out.task), /金额/);
    else {
      const result = await confirmTask(store, client, out.task.id, actor);
      assert.match(result.reply, /金额/);
      assert.equal(result.task.state, 'EXPIRED');
    }
    assert.equal(out.task.preview.account, null);
  }
});
test('旧版丢负号的正金额快照或载荷差异不能被选户和确认沿用', async () => {
  for (const operation of ['select', 'confirm']) {
    for (const invalidPart of ['original', 'payload']) {
      const { store, client } = receiptContext();
      const out = await handleMessage(store, client, actor, '合成客户到账 5 核销', rules);
      if (invalidPart === 'original') out.task.userText = '合成客户到账 −5 核销';
      else out.task.preview.payload.amount = 7;
      if (operation === 'select') await assert.rejects(tryAccountSelection(store, actor, '2', client, out.task), /金额/);
      else {
        const result = await confirmTask(store, client, out.task.id, actor);
        assert.match(result.reply, /金额/);
        assert.equal(result.task.state, 'EXPIRED');
      }
      assert.equal(out.task.preview.account, null);
    }
  }
});
test('直接构造收款预览也先拒绝非正或非整分金额', async () => {
  for (const amountCents of [0, -1, 0.1]) await assert.rejects(buildReceiptPreview({ get: () => assert.fail('UNEXPECTED_READ') }, actor, { customerHit: { id: 7 }, amountCents }), /金额/);
});

for (const message of ['合成客户5元到账，核销', '合成客户到账5元核销', '合成客户 5 到账，核销']) {
  test(`到账前后明确数字金额都保留原值：${message}`, async () => {
    for (const parseIntent of [rules.parseIntent, async () => ({ graph: 'D-receipt', customerKeyword: '合成客户', amountCents: 500 }), async () => { throw new Error('synthetic intent failure'); }]) {
      const { store, client, searches } = receiptContext();
      const out = await handleMessage(store, client, actor, message, { parseIntent });
      assert.equal(out.task.state, 'AWAITING_CONFIRM');
      assert.equal(out.preview.amountCents, 500);
      assert.deepEqual(searches, ['合成客户']);
    }
  });
}
for (const message of ['合成客户五元到账，核销', '合成客户-5元到账，核销']) {
  test(`到账前显式无效金额不能当省略：${message}`, async () => {
    for (const parseIntent of [rules.parseIntent, async () => ({ graph: 'D-receipt', customerKeyword: '合成客户', amountCents: 500 }), async () => { throw new Error('synthetic intent failure'); }]) {
      const { store, client, searches } = receiptContext();
      const out = await handleMessage(store, client, actor, message, { parseIntent });
      assert.equal(out.task.state, 'FAILED_FINAL');
      assert.equal(out.task.preview, null);
      assert.match(out.reply, /金额|数字/);
      assert.deepEqual(searches, []);
    }
  });
}
test('确实省略金额仍按全额，客户编码数字不当作到账额', async () => {
  for (const message of ['合成客户到账，核销', '合成客户C000123到账，核销']) {
    for (const parseIntent of [rules.parseIntent, async () => ({ graph: 'D-receipt', customerKeyword: '合成客户C000123' })]) {
      const { store, client } = receiptContext();
      const out = await handleMessage(store, client, actor, message, { parseIntent });
      assert.equal(out.task.state, 'AWAITING_CONFIRM');
      assert.equal(out.preview.amountCents, 10000);
    }
  }
});
test('模型提供金额但原文没有证明或金额不一致时停步，不能按全额', async () => {
  for (const message of ['合成客户到账，核销', '合成客户6元到账，核销']) {
    const { store, client, searches } = receiptContext();
    const out = await handleMessage(store, client, actor, message, { parseIntent: async () => ({ graph: 'D-receipt', customerKeyword: '合成客户', amountCents: 500 }) });
    assert.equal(out.task.state, 'FAILED_FINAL');
    assert.equal(out.task.preview, null);
    assert.match(out.reply, /金额/);
    assert.deepEqual(searches, []);
  }
});
test('到账前金额的旧全额错误快照在选户和确认时重新核对原文', async () => {
  for (const original of ['合成客户5元到账，核销', '合成客户五元到账，核销', '合成客户-5元到账，核销']) {
    for (const operation of ['select', 'confirm']) {
      const { store, client } = receiptContext();
      const out = await handleMessage(store, client, actor, '合成客户到账5元核销', rules);
      out.task.userText = original;
      out.task.preview.amountCents = 10000;
      out.task.preview.payload.amount = 100;
      if (operation === 'select') await assert.rejects(tryAccountSelection(store, actor, '2', client, out.task), /金额/);
      else {
        const result = await confirmTask(store, client, out.task.id, actor);
        assert.equal(result.task.state, 'EXPIRED');
        assert.match(result.reply, /金额/);
      }
      assert.equal(out.task.preview.account, null);
    }
  }
});

// T04：到账原文中的金额、客户与指定目标分别核对；不把指定核销降级为全客户分配。
for (const message of ['合成客户付了25元核销', '合成客户C000123付了25元核销']) {
  test(`口语付款保留原客户，不采用模型改写：${message}`, async () => {
    for (const parseIntent of [rules.parseIntent, async () => ({ graph: 'D-receipt', customerKeyword: '另一客户', amountCents: 2500 })]) {
      const { store, client, searches } = receiptContext();
      const out = await handleMessage(store, client, actor, message, { parseIntent });
      assert.equal(out.task.state, 'AWAITING_CONFIRM');
      assert.equal(out.preview.amountCents, 2500);
      assert.deepEqual(searches, [message.startsWith('合成客户C') ? '合成客户C000123' : '合成客户']);
    }
  });
}
for (const message of ['甲公司付了25元，把SL20261026009那笔核销掉', '甲公司到账25元，只核销那笔', '甲公司2026-10-26到账25元核销', '甲公司昨天到账25元核销']) {
  test(`指定目标或日期明确停步且模型不能抹掉：${message}`, async () => {
    for (const parseIntent of [rules.parseIntent, async () => ({ graph: 'D-receipt', customerKeyword: '另一客户', amountCents: 2500 }), async () => ({ graph: 'D-ledger', customerKeyword: '甲公司' }), async () => { throw new Error('synthetic model failure'); }]) {
      const calls = [];
      const noFlow = path => { calls.push(path); throw new Error('UNEXPECTED_FLOW'); };
      const out = await handleMessage(new TaskStore(null), { get: noFlow, post: noFlow }, actor, message, { parseIntent });
      assert.equal(out.preview, undefined);
      assert.match(out.reply, /指定|日期/);
      assert.match(out.reply, /收付款页/);
      assert.match(out.reply, /未登记|未生成/);
      if (message.includes('SL')) assert.match(out.reply, /SL20261026009/);
      assert.deepEqual(calls, []);
    }
  });
}
for (const original of ['合成客户付了5元，把SL20261026009那笔核销掉', '合成客户2026-10-26到账5元核销']) {
  test(`未执行旧收款快照不能忽略原文目标和日期：${original}`, async () => {
    for (const operation of ['select', 'confirm', 'settle']) {
      const { store, client } = receiptContext();
      const out = await handleMessage(store, client, actor, '合成客户到账5元核销', rules);
      out.task.userText = original;
      if (operation === 'settle') {
        out.task.graph = 'D-settle';
        Object.assign(out.task.preview, { receiptId: 90, receiptNo: 'RC-OLD', totalCents: 500 });
      }
      if (operation === 'select') await assert.rejects(tryAccountSelection(store, actor, '2', client, out.task), /指定|日期/);
      else {
        const result = await confirmTask(store, client, out.task.id, actor);
        assert.equal(result.task.state, 'EXPIRED');
        assert.match(result.reply, /指定|日期/);
        if (operation === 'settle') assert.match(result.reply, /不要重复登记|勿重复登记/);
      }
    }
  });
}
for (const name of ['和成公司', '钱氏公司']) {
  test(`客户名中的普通汉字不能被付款词清理误删：${name}`, async () => {
    const { store, client, searches } = receiptContext();
    const out = await handleMessage(store, client, actor, `${name}付了25元并核销`, rules);
    assert.equal(out.preview.amountCents, 2500);
    assert.deepEqual(searches, [name]);
  });
}
test('模型补出的单号、日期或客户不能替原文授权收款', async () => {
  for (const [message, extra] of [['合成客户到账25元核销', { orderNo: 'SL20261026009' }], ['合成客户到账25元核销', { paymentDate: '2026-10-26' }], ['到账25元核销', {}]]) {
    const { store, client, searches } = receiptContext();
    const out = await handleMessage(store, client, actor, message, { parseIntent: async () => ({ graph: 'D-receipt', customerKeyword: '合成客户', amountCents: 2500, ...extra }) });
    assert.equal(out.task?.preview ?? null, null);
    assert.match(out.reply, /原文|付款客户/);
    assert.deepEqual(searches, []);
  }
});
for (const [name, shortened] of [['张钱', '张'], ['给力五金', '力五金'], ['帮忙商贸', '商贸'], ['请益公司', '益公司'], ['甲收款五金', '甲'], ['甲核销服务', '甲']]) {
  test(`真实图不能把原名缩成另一客户：${name}`, async () => {
    for (const fullExists of [false, true]) {
      const searches = [];
      const client = { get: async path => {
        const url = new URL(path, 'http://synthetic');
        if (url.pathname === '/api/search/') {
          const keyword = url.searchParams.get('q'); searches.push(keyword);
          if (keyword === name && fullExists) return [{ id: 7, type: 'customer', title: name }];
          if (keyword === shortened) return [{ id: 8, type: 'customer', title: shortened }];
          return [];
        }
        if (url.pathname === '/api/customers/7') return { id: 7, name };
        if (url.pathname === '/api/customers/8') return { id: 8, name: shortened };
        if (url.pathname === '/api/payments/') return { list: [{ id: 11, orderNo: 'SL20261026007', totalAmount: 100, paidAmount: 0, balance: 100, status: 1 }], total: 1 };
        if (url.pathname === '/api/payments/party-ledger') return { summary: { closingBalance: 100 }, unassignedCount: 0 };
        if (url.pathname === '/api/finance/accounts/active') return [{ id: 5, name: '合成基本户' }];
        assert.fail(path);
      }, post: () => assert.fail('原名边界回归不能写入') };
      const out = await handleMessage(new TaskStore(null), client, actor, `${name}到账25元核销`, { parseIntent: async () => ({ graph: 'D-receipt', customerKeyword: shortened, amountCents: 2500 }) });
      assert.deepEqual(searches, [name]);
      if (fullExists) assert.equal(out.preview.customer.name, name);
      else {
        assert.equal(out.preview, undefined);
        assert.match(out.reply, /客户名.*到账.*金额.*核销/);
      }
    }
  });
}
test('无到账谓词的给力五金核销需核两种原文解读，不同客户停步消歧', async () => {
  const searches = [];
  const client = { get: async path => {
    const url = new URL(path, 'http://synthetic');
    if (url.pathname === '/api/search/') {
      const keyword = url.searchParams.get('q'); searches.push(keyword);
      if (keyword === '给力五金') return [{ id: 7, type: 'customer', title: '给力五金' }];
      if (keyword === '力五金') return [{ id: 8, type: 'customer', title: '力五金' }];
    }
    assert.fail(`双解读冲突不应读取账款: ${path}`);
  }, post: () => assert.fail('双解读冲突不能写入') };
  const out = await handleMessage(new TaskStore(null), client, actor, '给力五金核销', rules);
  assert.deepEqual(searches, ['给力五金', '力五金']);
  assert.equal(out.preview, undefined);
  assert.match(out.reply, /客户.*(?:歧义|不唯一|解读)/);
  assert.match(out.reply, /客户名.*到账.*金额.*核销/);
});
test('旧给客户核销仅命令解读有候选时仍可达原预览', async () => {
  const { store, client } = receiptContext();
  const originalGet = client.get;
  const searches = [];
  client.get = async path => {
    const url = new URL(path, 'http://synthetic');
    if (url.pathname === '/api/search/') {
      searches.push(url.searchParams.get('q'));
      if (url.searchParams.get('q') === '给合成客户') return [];
    }
    return originalGet(path);
  };
  const out = await handleMessage(store, client, actor, '给合成客户核销', rules);
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.customer.name, '合成客户');
  assert.deepEqual(searches, ['给合成客户', '合成客户', '合成客户']);
});
test('旧命令选择通过后候选变动仍重核，保存的选择不可沿用', async () => {
  const { store, client } = receiptContext();
  const originalGet = client.get;
  let selecting = false, selectionReads = 0;
  client.get = async path => {
    const url = new URL(path, 'http://synthetic');
    if (url.pathname === '/api/search/') {
      if (url.searchParams.get('q') === '给合成客户') return [];
      if (url.searchParams.get('q') === '合成客户') {
        if (selecting && ++selectionReads > 1) return [{ id: 8, type: 'customer', title: '另一合成客户' }];
        return [{ id: 7, type: 'customer', title: '合成客户' }, { id: 8, type: 'customer', title: '另一合成客户' }];
      }
    }
    return originalGet(path);
  };
  const pending = await handleMessage(store, client, actor, '给合成客户核销', rules);
  assert.equal(pending.task.state, 'DISAMBIGUATING');
  selecting = true;
  const out = await handleMessage(store, client, actor, '选这个', { ...rules, taskId: pending.task.id, choiceId: 7 });
  assert.equal(out.preview, undefined);
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /原先选择的对象已不可见/);
  assert.equal(out.task.selections.customer, 7);
});
for (const name of ['甲收款五金', '甲核销服务']) {
  test(`实际付款主体不能被名称里的业务名词截成另一客户：${name}`, async () => {
    const { store, client, searches } = receiptContext();
    const out = await handleMessage(store, client, actor, `${name}到账25元核销`, rules);
    assert.equal(out.task.state, 'AWAITING_CONFIRM');
    assert.deepEqual(searches, [name]);
  });
}
for (const operation of ['select', 'confirm', 'settle']) {
  test(`旧错客户预览必须重核原文身份并失效：${operation}`, async () => {
    const { store, client } = receiptContext();
    const out = await handleMessage(store, client, actor, '合成客户到账25元核销', rules);
    out.task.userText = '给力五金到账25元核销';
    const baseGet = client.get;
    client.get = async path => {
      const url = new URL(path, 'http://synthetic');
      if (url.pathname === '/api/search/') return [{ id: 8, type: 'customer', title: '给力五金' }];
      return baseGet(path);
    };
    if (operation === 'settle') {
      out.task.graph = 'D-settle';
      Object.assign(out.task.preview, { receiptId: 90, receiptNo: 'RC-LEGACY', totalCents: 2500 });
    }
    if (operation === 'select') await assert.rejects(tryAccountSelection(store, actor, '2', client, out.task), /客户/);
    else {
      const blocked = await confirmTask(store, client, out.task.id, actor);
      assert.match(blocked.reply, /客户/);
      if (operation === 'settle') assert.match(blocked.reply, /原收款已登记.*不要重复登记/);
    }
    assert.equal(out.task.state, 'EXPIRED');
    assert.equal(out.task.preview.account, null);
  });
}
for (const operation of ['select', 'confirm', 'settle']) {
  for (const proof of ['saved-selection', 'unavailable']) {
    test(`未执行收款客户证明失效即停止：${operation}/${proof}`, async () => {
      const { store, client } = receiptContext();
      const out = await handleMessage(store, client, actor, '合成客户到账25元核销', rules);
      const baseGet = client.get;
      if (proof === 'saved-selection') out.task.selections = { customer: 8 };
      client.get = async path => {
        const url = new URL(path, 'http://synthetic');
        if (url.pathname === '/api/search/') {
          if (proof === 'unavailable') throw new Error('synthetic customer 503');
          return [{ id: 7, type: 'customer', title: '合成客户' }, { id: 8, type: 'customer', title: '合成客户分店' }];
        }
        return baseGet(path);
      };
      if (operation === 'settle') {
        out.task.graph = 'D-settle';
        Object.assign(out.task.preview, { receiptId: 90, receiptNo: 'RC-LEGACY', totalCents: 2500 });
      }
      if (operation === 'select') await assert.rejects(tryAccountSelection(store, actor, '2', client, out.task), /客户/);
      else {
        const blocked = await confirmTask(store, client, out.task.id, actor);
        assert.match(blocked.reply, /客户/);
        if (operation === 'settle') assert.match(blocked.reply, /原收款已登记.*不要重复登记/);
      }
      assert.equal(out.task.state, 'EXPIRED');
      assert.equal(out.task.preview.account, null);
    });
  }
}
