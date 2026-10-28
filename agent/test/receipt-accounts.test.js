// 图 D 多账户可选测试：多账户时预览先挂「待选账户」，对话选定（序号/名称）后才放行确认；
// 不选不能确认；选第二个账户时收款落到第二个；单账户行为与 receipt.test.js 一致（不回归）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FlowClient } from '../src/flow.js';
import { TaskStore } from '../src/tasks.js';
import { handleMessage, confirmTask } from '../src/agent.js';

const FULL = { username: 't', realName: '测试员', roleId: 2, roleName: '全权', permissions: ['dashboard.view', 'inventory.view', 'report.view', 'product.view', 'customer.view', 'price.list.view', 'sale.order.view', 'sale.order.create', 'sale.order.reserve', 'purchase.order.create', 'purchase.order.view', 'payment.view', 'payment.execute', 'finance.account.view', 'warehouse.view', 'warehouse.task.view'], warehouseIds: null, unrestrictedWarehouseScope: true, isSuper: false };
const TWO_ACCOUNTS = [{ id: 5, name: '基本户' }, { id: 6, name: '现金户' }];

function makeMock({ accounts = TWO_ACCOUNTS } = {}) {
  const state = {
    records: [
      { id: 11, orderNo: 'SL20261025001', totalAmount: 1000, paidAmount: 0, balance: 1000, status: 1, dueDate: null, createdAt: '2026-10-25 10:00:00' },
      { id: 12, orderNo: 'SL20261025002', totalAmount: 1152, paidAmount: 0, balance: 1152, status: 1, dueDate: null, createdAt: '2026-10-25 11:00:00' },
    ],
    receipts: [], settleCalls: 0,
    byKey: new Map(),
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
        paymentDate: body.paymentDate, accountId: body.accountId,
        accountName: accounts.find(a => a.id === body.accountId)?.name || '基本户',
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

test('多账户：预览挂待选账户并列出账户，不默认第一个', async () => {
  const { server, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
  assert.equal(out.task.state, 'AWAITING_CONFIRM');
  assert.equal(out.preview.needsAccountChoice, true);
  assert.equal(out.preview.account, null);
  assert.match(out.reply, /1）基本户/);
  assert.match(out.reply, /2）现金户/);
  server.close();
});

test('多账户：不选直接确认 → 硬拦截，零登记，任务仍待确认', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
  const blocked = await confirmTask(store, client, out.task.id, FULL);
  assert.match(blocked.reply, /还没选入账账户/);
  assert.equal(blocked.task.state, 'AWAITING_CONFIRM');
  assert.equal(state.receipts.length, 0);
  server.close();
});

test('多账户：回复序号 2 选户 → 收款落到第二个账户，后续核销照常', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
  const sel = await handleMessage(store, client, FULL, '2');
  assert.equal(sel.task.id, out.task.id);
  assert.equal(sel.preview.needsAccountChoice, false);
  assert.equal(sel.preview.account.id, 6);
  assert.match(sel.reply, /现金户/);
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(state.receipts.length, 1);
  assert.equal(state.receipts[0].accountId, 6);
  assert.equal(stage2.task.graph, 'D-settle');
  const done = await confirmTask(store, client, stage2.task.id, FULL);
  assert.equal(done.task.state, 'DONE');
  assert.equal(state.records[0].status, 3);
  server.close();
});

test('多账户：按账户名选户同样有效；乱回复不落规划器、不误选', async () => {
  const { server, state, client, store } = await ctx();
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
  const stray = await handleMessage(store, client, FULL, '3');
  assert.equal(stray.task.id, out.task.id);
  assert.equal(stray.preview.needsAccountChoice, true);
  assert.match(stray.reply, /还没选入账账户/);
  const sel = await handleMessage(store, client, FULL, '入现金户吧');
  assert.equal(sel.preview.account.id, 6);
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(state.receipts[0].accountId, 6);
  assert.equal(stage2.task.graph, 'D-settle');
  server.close();
});
test('待选账户时无关闲聊仍只说明极序范围，不修改预览', async () => {
  const { server, state, client, store } = await ctx();
  try {
    const pending = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
    const stray = await handleMessage(store, client, FULL, '聊聊阅读习惯');
    assert.equal(stray.task, null);
    assert.match(stray.reply, /只聊极序相关/);
    assert.equal(pending.task.preview.needsAccountChoice, true);
    assert.equal(state.receipts.length, 0);
  } finally { server.close(); }
});

test('单账户：行为不变，无待选状态、直接可确认', async () => {
  const { server, state, client, store } = await ctx({ accounts: [{ id: 5, name: '基本户' }] });
  const out = await handleMessage(store, client, FULL, '演示客户甲公司到账 1000 核销');
  assert.equal(out.preview.needsAccountChoice, false);
  assert.equal(out.preview.account.id, 5);
  const stage2 = await confirmTask(store, client, out.task.id, FULL);
  assert.equal(state.receipts.length, 1);
  assert.equal(state.receipts[0].accountId, 5);
  assert.equal(stage2.task.graph, 'D-settle');
  server.close();
});
