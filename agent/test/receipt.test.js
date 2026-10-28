// 图 D 收款核销（两段确认）测试：登记收款 → 回查 → 核销分配预览 → 确认核销 → 回查逐笔对平。
// 对应评估集 G4（部分核销→全额核销）与契约 14 的典型错误/恢复口径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { listTaskViews } from '../src/task-access.js';
import { handleMessage, confirmTask } from '../src/agent.js';

const FULL = { username: 't', realName: '测试员', roleId: 2, roleName: '全权', permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };

function makeMock({ accounts = [{ id: 5, name: '基本户' }], settled = false } = {}) {
  const state = {
    records: [
      { id: 11, orderNo: 'SL20261025001', totalAmount: 1000, paidAmount: settled ? 1000 : 0, balance: settled ? 0 : 1000, status: settled ? 3 : 1, dueDate: null, createdAt: '2026-10-25 10:00:00' },
      { id: 12, orderNo: 'SL20261025002', totalAmount: 1152, paidAmount: settled ? 1152 : 0, balance: settled ? 0 : 1152, status: settled ? 3 : 1, dueDate: null, createdAt: '2026-10-25 11:00:00' },
    ],
    receipts: [], settleCalls: 0,
    byKey: new Map(), // requestKey -> { resourceId, result }
    dropNextReceiptPost: false, dropNextSettlePost: false,
  };
  const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const readBody = async req => { const chunks = []; for await (const ch of req) chunks.push(ch); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    if (p === '/api/search/') {
      const kw = url.searchParams.get('q') || '';
      return ok(res, kw.includes('演示客户') ? [{ id: 1, type: 'customer', title: '演示客户甲公司' }] : []);
    }
    if (p === '/api/customers/1') return ok(res, { id: 1, name: '演示客户甲公司', priceLevel: 'A', creditLimit: null });
    if (p === '/api/payments/party-ledger') {
      return ok(res, { summary: { closingBalance: state.records.reduce((s, r) => s + r.balance, 0) }, list: [] });
    }
    if (p === '/api/payments/') {
      const unsettledOnly = url.searchParams.get('status') === 'unsettled';
      const list = state.records.filter(r => !unsettledOnly || (r.balance > 0 && r.status !== 3));
      return ok(res, { list, pagination: { total: list.length } });
    }
    if (p === '/api/finance/accounts/active') return ok(res, accounts);
    if (p === '/api/payments/receipts' && req.method === 'POST') {
      const key = req.headers['x-request-key'];
      if (key && state.byKey.has(key)) return ok(res, state.byKey.get(key).result);
      const body = await readBody(req);
      const receipt = {
        id: 90 + state.receipts.length, receiptNo: `RC-MOCK-${state.receipts.length + 1}`,
        type: 2, partyName: body.partyName, partyId: body.partyId,
        amount: body.amount, settledAmount: 0, balance: body.amount, status: 1,
        paymentDate: body.paymentDate, accountId: body.accountId, accountName: '基本户',
      };
      state.receipts.push(receipt);
      if (key) state.byKey.set(key, { resourceId: receipt.id, result: { id: receipt.id, receiptNo: receipt.receiptNo, amount: receipt.amount, settledAmount: 0, balance: receipt.balance, applied: [] } });
      if (state.dropNextReceiptPost) { state.dropNextReceiptPost = false; res.socket.destroy(); return; }
      return ok(res, state.byKey.get(key).result);
    }
    const settleMatch = p.match(/^\/api\/payments\/receipts\/(\d+)\/settle$/);
    if (settleMatch && req.method === 'POST') {
      const key = req.headers['x-request-key'];
      if (key && state.byKey.has(key)) return ok(res, state.byKey.get(key).result);
      const body = await readBody(req);
      state.settleCalls++;
      const receipt = state.receipts.find(r => r.id === Number(settleMatch[1]));
      const applied = [];
      let total = 0;
      for (const a of body.allocations || []) {
        const rec = state.records.find(r => r.id === a.recordId);
        rec.paidAmount += a.amount; rec.balance -= a.amount; rec.status = rec.balance <= 0 ? 3 : 2;
        applied.push({ recordId: rec.id, orderNo: rec.orderNo, amount: a.amount, settled: rec.status === 3 });
        total += a.amount;
      }
      receipt.settledAmount += total; receipt.balance -= total; receipt.status = receipt.balance <= 0 ? 3 : 2;
      const result = { id: receipt.id, receiptNo: receipt.receiptNo, allocatedTotal: total, settledAmount: receipt.settledAmount, balance: receipt.balance, applied };
      if (key) state.byKey.set(key, { resourceId: receipt.id, result });
      if (state.dropNextSettlePost) { state.dropNextSettlePost = false; res.socket.destroy(); return; }
      return ok(res, result);
    }
    const detailMatch = p.match(/^\/api\/payments\/receipts\/(\d+)$/);
    if (detailMatch && req.method === 'GET') {
      const receipt = state.receipts.find(r => r.id === Number(detailMatch[1]));
      if (receipt) return ok(res, receipt);
    }
    if (p.startsWith('/api/system/request-status/')) {
      const key = decodeURIComponent(p.split('/').pop());
      const hit = state.byKey.get(key);
      if (hit) return ok(res, { resourceId: hit.resourceId, status: 'success' });
      res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: '无回执' }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'nf ' + p }));
  });
  return { server, state };
}

async function ctx(opts) {
  const { server, state } = makeMock(opts);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, state, client: new FlowClient(`http://127.0.0.1:${server.address().port}`, 't'), store: new TaskStore(null) };
}

test('初始收款文字把卡片字段留卡，保留未结口径、选户和两段确认边界', async t => {
  for (const accounts of [[{ id: 5, name: '基本户' }], [{ id: 5, name: '基本户' }, { id: 6, name: '合成备用户' }]]) {
    const { server, state, client, store } = await ctx({ accounts });
    t.after(() => server.close());
    const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
    assert.equal(out.preview.amountCents, 100000);
    assert.equal(out.preview.customer.name, '演示客户甲公司');
    assert.equal(state.receipts.length, 0);
    assert.match(out.reply, /第 1 段/);
    assert.match(out.reply, /未结 2 笔共 ¥2152\.00/);
    assert.match(out.reply, /本次只看已关联应收/);
    assert.doesNotMatch(out.reply, /客户 演示客户|本次到账|入账账户「|日期 \d/);
    if (accounts.length > 1) assert.match(out.reply, /1）基本户；2）合成备用户.*选定.*确认登记/);
    else assert.match(out.reply, /确认登记后.*下一张卡.*确认核销分配/);
  }
});

test('图 D 全链（不写金额=全额）：登记预览 → 确认① 落收款单 → 核销预览 → 确认② 逐笔结清对平', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  assert.equal(out.task.graph, 'D-receipt');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.amountCents, 215200);
  assert.equal(out.preview.allocations.length, 2);
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(stage2.task.graph, 'D-settle');
  assert.equal(stage2.task.state, 'AWAITING_CONFIRM');
  assert.match(stage2.reply, /RC-MOCK-1/);
  assert.equal(state.receipts.length, 1);
  assert.equal(state.receipts[0].settledAmount, 0); // 第一段只登记未核销
  assert.equal(stage2.preview.totalCents, 215200);
  const done = await confirmTask(store, client, stage2.task.id, FULL);
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.settleCalls, 1);
  assert.ok(state.records.every(r => r.status === 3 && r.balance === 0));
  assert.equal(state.receipts[0].settledAmount, 2152);
  assert.match(done.reply, /本次来源关联范围内的未结应收已结清/);
  server.close();
});

test('图 D 部分核销（到账 1000）：账龄最老优先只核第一笔，剩余如实报', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
  assert.equal(out.preview.amountCents, 100000);
  assert.equal(out.preview.allocations.length, 1);
  assert.equal(out.preview.allocations[0].orderNo, 'SL20261025001');
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  const done = await confirmTask(store, client, stage2.task.id, FULL);
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.records[0].status, 3);
  assert.equal(state.records[1].balance, 1152);
  assert.match(done.reply, /还剩未结 ¥1152\.00/);
  server.close();
});

test('图 D 超额：到账 > 未结总额 → 停步，零登记', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 3000 核销');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /超过该客户未结总额/);
  assert.equal(state.receipts.length, 0);
  server.close();
});

test('图 D 未结列表为空：限定关联口径，不建收款单', async () => {
  const { server, state, client, store } = await ctx({ settled: true });
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  assert.equal(out.task.state, 'DONE');
  assert.match(out.reply, /当前关联应收里没查到未结账款/);
  assert.equal(state.receipts.length, 0);
  server.close();
});

test('图 D 第一段新鲜度：预览后余额被他人动过 → 确认① 拦截，零登记', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  state.records[1].balance = 500; state.records[1].paidAmount = 652; state.records[1].status = 2;
  const blocked = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.equal(state.receipts.length, 0);
  server.close();
});

test('图 D 第二段新鲜度：核销预览后某笔被他人核销 → 确认② 拦截，零核销', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  state.records[0].balance = 400; state.records[0].paidAmount = 600; state.records[0].status = 2;
  const blocked = await confirmTask(store, client, stage2.task.id, FULL);
  assert.equal(blocked.task.state, 'EXPIRED');
  assert.equal(state.settleCalls, 0);
  server.close();
});

test('图 D 结果未知：核销响应丢失 → 查回执恢复，不重复核销', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  state.dropNextSettlePost = true;
  const done = await confirmTask(store, client, stage2.task.id, FULL);
  assert.equal(done.task.state, 'DONE');
  assert.equal(done.task.result.recoveredViaReceipt, true);
  assert.equal(state.settleCalls, 1);
  assert.ok(state.records.every(r => r.status === 3 && r.balance === 0));
  server.close();
});

test('图 D 登记结果未知：收款登记响应丢失 → 查回执恢复并续出核销卡，只落一张收款单', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  state.dropNextReceiptPost = true;
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(stage2.task.graph, 'D-settle');
  assert.equal(state.receipts.length, 1);
  assert.match(stage2.reply, /回执确认收款已登记/);
  server.close();
});

test('图 D 权限：无 payment.execute → 拒绝且零登记', async () => {
  const { server, state, client, store } = await ctx();
  const actor = { ...FULL, permissions: FULL.permissions.filter(p => p !== 'payment.execute') };
  const out = await handleMessage(store, client, actor, '给演示客户甲公司核销');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /收付款执行/);
  assert.equal(state.receipts.length, 0);
  server.close();
});

test('图 D 无资金账户：停步引导建账，零登记', async () => {
  const { server, state, client, store } = await ctx({ accounts: [] });
  const out = await handleMessage(store, client, FULL, '给演示客户甲公司核销');
  assert.equal(out.task.state, 'FAILED_FINAL');
  assert.match(out.reply, /资金账户/);
  assert.equal(state.receipts.length, 0);
  server.close();
});

test('旧指定目标任务登记结果未知仍查原键恢复，第二段停止且不重复收款', async () => {
  const { server, state, client, store } = await ctx();
  try {
    const out = await handleMessage(store, client, FULL, '演示客户甲公司到账25元核销');
    await confirmTask(store, client, out.task.id, FULL);
    const originalKey = out.task.requestKey;
    out.task.userText = '演示客户甲公司付了25元，把SL20261026009那笔核销掉';
    out.task.state = 'RESULT_UNKNOWN';
    const recovered = await confirmTask(store, client, out.task.id, FULL);
    assert.equal(recovered.task.graph, 'D-settle');
    assert.equal(out.task.requestKey, originalKey);
    assert.equal(state.receipts.length, 1);
    const stopped = await confirmTask(store, client, recovered.task.id, FULL);
    assert.equal(stopped.task.state, 'EXPIRED');
    assert.match(stopped.reply, /原收款已登记/);
    assert.equal(state.receipts.length, 1);
    assert.equal(state.settleCalls, 0);
  } finally { server.close(); }
});

test('旧指定目标核销结果未知只恢复原回执，不再次核销', async () => {
  const { server, state, client, store } = await ctx();
  try {
    const out = await handleMessage(store, client, FULL, '演示客户甲公司到账25元核销');
    const stage2 = await confirmTask(store, client, out.task.id, FULL);
    await confirmTask(store, client, stage2.task.id, FULL);
    const originalKey = stage2.task.requestKey;
    stage2.task.userText = '演示客户甲公司付了25元，把SL20261026009那笔核销掉';
    stage2.task.state = 'RESULT_UNKNOWN';
    const recovered = await confirmTask(store, client, stage2.task.id, FULL);
    assert.equal(recovered.task.state, 'DONE');
    assert.equal(stage2.task.requestKey, originalKey);
    assert.equal(state.settleCalls, 1);
    assert.equal(state.receipts.length, 1);
  } finally { server.close(); }
});

test('旧核销快照金额与原文不符时保留收款，零新增核销', async () => {
  const { server, state, client, store } = await ctx();
  try {
    const out = await handleMessage(store, client, FULL, '演示客户甲公司到账25元核销');
    const stage2 = await confirmTask(store, client, out.task.id, FULL);
    stage2.task.userText = '演示客户甲公司到账5元核销';
    const blocked = await confirmTask(store, client, stage2.task.id, FULL);
    assert.equal(blocked.task.state, 'EXPIRED');
    assert.match(blocked.reply, /金额/);
    assert.match(blocked.reply, /原收款已登记.*不要重复登记/);
    assert.equal(state.receipts.length, 1);
    assert.equal(state.receipts[0].amount, 25);
    assert.equal(state.settleCalls, 0);
  } finally { server.close(); }
});

for (const revokeChoice of [false, true]) {
  test(`两客户候选选择后完整两段保留客户身份：${revokeChoice ? '撤销原候选拒绝核销' : '正常完成'}`, async () => {
    const { server, state, client, store } = await ctx();
    const baseGet = client.get.bind(client);
    let revoked = false;
    client.get = async (...args) => {
      if (args[0].startsWith('/api/search/')) return [
        ...(!revoked ? [{ id: 1, type: 'customer', title: '演示客户甲公司' }] : []),
        { id: 2, type: 'customer', title: '演示客户甲公司分店' },
      ];
      return baseGet(...args);
    };
    try {
      const pending = await handleMessage(store, client, FULL, '演示客户甲公司到账25元核销');
      assert.equal(pending.task.state, 'DISAMBIGUATING');
      const chosen = await handleMessage(store, client, FULL, '选这个', { taskId: pending.task.id, choiceId: 1 });
      assert.equal(chosen.task.selections.customer, 1);
      const stage2 = await confirmTask(store, client, chosen.task.id, FULL);
      assert.equal(stage2.task.graph, 'D-settle');
      assert.equal(state.receipts.length, 1);
      if (revokeChoice) revoked = true;
      const result = await confirmTask(store, client, stage2.task.id, FULL);
      if (revokeChoice) {
        assert.equal(result.task.state, 'EXPIRED');
        assert.match(result.reply, /客户/);
        assert.match(result.reply, /原收款已登记.*不要重复登记/);
        assert.equal(state.settleCalls, 0);
      } else {
        assert.equal(result.task.state, 'DONE');
        assert.equal(stage2.task.selections.customer, 1);
        assert.equal(state.settleCalls, 1);
        assert.equal(state.receipts[0].settledAmount, 25);
      }
      assert.equal(state.receipts.length, 1);
    } finally { server.close(); }
  });
}


test('T13两段显式关联仍是独立ID和原键，恢复与过期均不另建或重复登记', async () => {
  const { server, state, client, store } = await ctx();
  try {
    const first = await handleMessage(store, client, FULL, '演示客户甲公司到账25元核销');
    const firstId = first.task.id, firstKey = first.task.requestKey;
    const second = await confirmTask(store, client, firstId, FULL);
    const secondId = second.task.id, secondKey = second.task.requestKey;
    assert.notEqual(firstId, secondId);
    assert.notEqual(firstKey, secondKey);
    assert.equal(first.task.result.stage2TaskId, secondId);
    assert.equal(first.task.result.receiptId, second.preview.receiptId);
    const views = listTaskViews(store, FULL);
    assert.equal(views.length, 2);
    assert.equal(views.find(row => row.id === firstId).result.stage2TaskId, secondId);
    assert.doesNotMatch(JSON.stringify(views), /"actor"|"payload"|"requestKey"/);
    assert.equal(listTaskViews(store, { ...FULL, username: 'different-owner' }).length, 0);
    assert.equal(listTaskViews(store, { ...FULL, permissions: [] }).length, 0);
    const restored = await confirmTask(store, client, firstId, FULL);
    assert.equal(restored.task.id, secondId);
    assert.equal(restored.task.requestKey, secondKey);
    assert.equal(store.tasks.size, 2);
    assert.equal(state.receipts.length, 1);
    assert.equal(state.settleCalls, 0, '恢复第二段不代替第二次确认');
    second.task.preview.expiresAt = '2000-01-01T00:00:00Z';
    const expired = await confirmTask(store, client, secondId, FULL);
    assert.equal(expired.task.state, 'EXPIRED');
    assert.equal(first.task.requestKey, firstKey);
    assert.equal(second.task.requestKey, secondKey);
    assert.equal(store.tasks.size, 2);
    assert.equal(state.receipts.length, 1);
    assert.equal(state.settleCalls, 0);
  } finally { server.close(); }
});
