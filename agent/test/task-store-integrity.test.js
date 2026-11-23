import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../src/tasks.js';
import { confirmTask } from '../src/agent.js';
import { listTaskViews } from '../src/task-access.js';

const valid = { id: 'original', graph: 'B-sale-draft', state: 'EXECUTING', actor: { id: 11, username: 'owner' }, requestKey: 'synthetic-original-key', createdAt: '2026-10-26T00:00:00.000Z' };
for (const [label, content] of [['损坏JSON', '{bad-json'], ['非数组', '{}'], ['重复ID', JSON.stringify([valid, { ...valid, requestKey: 'different-key' }])], ['空行', '[null]'], ['缺原任务编号', JSON.stringify([{ ...valid, id: undefined }])]]) {
  test(`历史${label}必须停止加载，保留原文件与原请求证明`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'xiaoman-store-integrity-'));
    try {
      const file = join(directory, 'tasks.json');
      writeFileSync(file, content, { mode: 0o600 });
      assert.throws(() => new TaskStore(file), error => error.code === 'ASSISTANT_HISTORY_UNAVAILABLE' && error.status === 503);
      assert.equal(readFileSync(file, 'utf8'), content);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
test('旧版缺updatedAt仍保留原任务和请求键，新库不存在时允许首次创建', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoman-store-compatible-'));
  try {
    const file = join(directory, 'tasks.json');
    const fresh = new TaskStore(file);
    assert.equal(fresh.tasks.size, 0);
    writeFileSync(file, JSON.stringify([valid]));
    const restored = new TaskStore(file);
    assert.equal(restored.get('original').requestKey, 'synthetic-original-key');
    assert.equal(restored.get('original').updatedAt, valid.createdAt);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const NOW = '2026-11-18T00:00:00.000Z';
const owner = { id: 11, username: 'owner', isSuper: true, warehouseIds: null };
const sameNameOtherAccount = { ...owner, id: 12 };

function diskStore(t, rows = []) {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoman-task-file-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'tasks.json');
  const disk = join(directory, 'tasks-v2');
  const legacy = JSON.stringify(rows, null, 2);
  writeFileSync(file, legacy, { mode: 0o600 });
  return { file, disk, legacy, store: new TaskStore(file) };
}

test('导入旧任务后单次写入只替换目标文件，保留其他任务与原始历史', t => {
  const rows = [
    { ...valid, id: 'a', actor: owner, state: 'RESULT_UNKNOWN', steps: [{ receipt: { resourceId: 8 } }] },
    { ...valid, id: 'b', actor: sameNameOtherAccount },
  ];
  const { file, disk, legacy, store } = diskStore(t, rows);
  const untouched = join(disk, 'b.json');
  const prior = { ino: statSync(untouched).ino, bytes: readFileSync(untouched, 'utf8') };
  const changed = store.get('a');
  changed.reply = '仍在等原回执';
  changed.updatedAt = NOW;
  store.save(changed);
  assert.equal(readFileSync(file, 'utf8'), legacy);
  const manifest = JSON.parse(readFileSync(join(disk, '.manifest.json'), 'utf8'));
  assert.equal(manifest.legacySha256, createHash('sha256').update(legacy).digest('hex'));
  assert.deepEqual(manifest.importedIds, ['a', 'b']);
  assert.equal(statSync(untouched).ino, prior.ino);
  assert.equal(readFileSync(untouched, 'utf8'), prior.bytes);
  assert.equal(statSync(join(disk, 'a.json')).mode & 0o777, 0o600);
  const restarted = new TaskStore(file);
  assert.equal(restarted.get('a').reply, '仍在等原回执');
  assert.equal(restarted.get('a').requestKey, rows[0].requestKey);
  assert.deepEqual(restarted.get('a').steps, rows[0].steps);
  assert.deepEqual(restarted.get('b').actor, sameNameOtherAccount);
});

test('按本人分页，账号编号压过同名；旧无编号记录继续按姓名兼容', t => {
  const rows = [
    { ...valid, id: 'a3', actor: owner, updatedAt: '2026-11-18T04:00:00.000Z' },
    { ...valid, id: 'b', actor: sameNameOtherAccount, updatedAt: '2026-11-18T05:00:00.000Z' },
    { ...valid, id: 'old', actor: 'owner', updatedAt: '2026-11-18T03:00:00.000Z' },
    { ...valid, id: 'a2', actor: owner, updatedAt: '2026-11-18T02:00:00.000Z' },
    { ...valid, id: 'a1', actor: owner, updatedAt: '2026-11-18T01:00:00.000Z' },
  ];
  const { file } = diskStore(t, rows);
  const restarted = new TaskStore(file);
  assert.deepEqual([...restarted.pagesForActor(owner, { pageSize: 2 })].map(page => page.map(task => task.id)),
    [['a3', 'old'], ['a2', 'a1']]);
  assert.deepEqual(listTaskViews(restarted, sameNameOtherAccount).map(task => task.id), ['b', 'old']);
});

test('导入后的未知销售结果沿原请求键只查回执，重启可读原最终结果', async t => {
  const row = { ...valid, actor: owner, state: 'RESULT_UNKNOWN', requestKey: 'persisted-synthetic-sale-key',
    preview: { totalCents: 830, customer: { id: 6 }, warehouseId: 1, lines: [{ productId: 3, qty: 2 }] } };
  const { file } = diskStore(t, [row]);
  const restarted = new TaskStore(file);
  const client = {
    requestStatus: async (key, action) => {
      assert.deepEqual([key, action], [row.requestKey, 'sale.create']);
      return { resourceId: 8 };
    },
    get: async path => {
      assert.equal(path, '/api/sale/8');
      return { id: 8, totalAmount: 8.30, orderNo: 'SL-SYNTHETIC-8', customerId: 6, warehouseId: 1, items: [{ productId: 3, quantity: 2 }] };
    },
    post: () => assert.fail('未知结果只能查原回执'),
  };
  await assert.rejects(confirmTask(restarted, client, row.id, sameNameOtherAccount), error => error.status === 403);
  const confirmed = await confirmTask(restarted, client, row.id, owner);
  assert.equal(confirmed.task.state, 'DONE');
  const durable = new TaskStore(file).get(row.id);
  assert.equal(durable.requestKey, row.requestKey);
  assert.equal(durable.result.orderId, 8);
});

test('收款结果和核销预览一次落盘，之后保存任一记录仍保留另一记录的已提交状态', t => {
  const { file, disk, store } = diskStore(t, [{ ...valid, actor: owner, graph: 'D-receipt', state: 'VERIFYING' }]);
  const parent = store.get(valid.id);
  const child = store.createRelated(parent, { graph: 'D-settle', actor: owner }, (next, receiptTask) => {
    next.transition('DISAMBIGUATING');
    next.transition('DRY_RUNNING');
    next.setPreview({ receiptId: 9 });
    next.transition('AWAITING_CONFIRM');
    receiptTask.result = { receiptId: 9, stage2TaskId: next.id };
    receiptTask.transition('DONE');
  });
  const restarted = new TaskStore(file);
  assert.equal(restarted.get(parent.id).result.stage2TaskId, child.id);
  assert.equal(restarted.get(child.id).preview.receiptId, 9);
  assert.deepEqual(readdirSync(disk).filter(name => /^[a-z0-9-]+\.json$/.test(name)), ['original.json']);
  parent.reply = '未提交的父任务文本';
  child.reply = '已提交的核销文本';
  store.save(child);
  const savedAgain = new TaskStore(file);
  assert.notEqual(savedAgain.get(parent.id).reply, parent.reply);
  assert.equal(savedAgain.get(child.id).reply, child.reply);
});

test('发布后损坏的目录不得回退旧版历史，未提交的写入也不得伪装成新任务状态', t => {
  const { file, disk, legacy, store } = diskStore(t, [valid]);
  const target = join(disk, 'original.json');
  renameSync(target, join(disk, '.fixture-earlier'));
  mkdirSync(target);
  const task = store.get(valid.id);
  task.state = 'DONE';
  assert.throws(() => store.save(task), error => error.code === 'ASSISTANT_HISTORY_UNAVAILABLE');
  assert.throws(() => store.get(valid.id), error => error.code === 'ASSISTANT_HISTORY_UNAVAILABLE');
  assert.throws(() => new TaskStore(file), error => error.code === 'ASSISTANT_HISTORY_UNAVAILABLE');
  assert.equal(readFileSync(file, 'utf8'), legacy);
});

test('同一任务互斥，不同任务仍能独立保存', async t => {
  const { file, store } = diskStore(t, [{ ...valid, id: 'a' }, { ...valid, id: 'b' }]);
  let release;
  const pending = store.exclusive('a', async () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(store.exclusive('a', async () => assert.fail('不能并发变更原任务')), error => error.code === 'TASK_BUSY');
  await store.exclusive('b', async () => {
    const task = store.get('b');
    task.reply = '另一任务已独立提交';
    store.save(task);
  });
  release();
  await pending;
  assert.equal(new TaskStore(file).get('b').reply, '另一任务已独立提交');
});

test('独立加载线程在导入期间让出事件循环', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaoman-startup-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'tasks.json');
  const rows = Array.from({ length: 40 }, (_, index) => ({ ...valid, id: `load-${index}`, actor: owner }));
  writeFileSync(file, JSON.stringify(rows), { mode: 0o600 });
  let opened = false;
  const loading = TaskStore.open(file).then(store => { opened = true; return store; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, false);
  const store = await loading;
  assert.equal(store.tasks.size, 40);
  assert.equal(store.get('load-39').requestKey, valid.requestKey);
});

test('收款与核销关联校验失败时保留原提交状态和原任务键', t => {
  const { file, disk, store } = diskStore(t, [{ ...valid, actor: owner, graph: 'D-receipt', state: 'VERIFYING' }]);
  const parent = store.get(valid.id);
  const target = join(disk, 'original.json');
  const before = readFileSync(target, 'utf8');
  assert.throws(() => store.createRelated(parent, { graph: 'D-settle', actor: owner }, (_child, receipt) => {
    receipt.result = { receiptId: 9, stage2TaskId: 'unrelated' };
    receipt.transition('DONE');
  }), error => error.code === 'ASSISTANT_HISTORY_UNAVAILABLE');
  assert.equal(readFileSync(target, 'utf8'), before);
  assert.equal(parent.state, 'VERIFYING');
  const restored = new TaskStore(file);
  assert.equal(restored.get(valid.id).requestKey, valid.requestKey);
  assert.equal(restored.tasks.size, 1);
});
