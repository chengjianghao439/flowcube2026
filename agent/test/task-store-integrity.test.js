import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../src/tasks.js';

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
