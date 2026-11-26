import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handoffRequest } from '../src/sale-handoff.js';

test('交接动作保留口语前缀和原单上下文，按消息上限整句识别', () => {
  for (const text of ['发货', '那就请帮我确认一下。', '给这张单 打包']) {
    assert.equal(handoffRequest(text, true)?.action, 'guide');
    assert.equal(handoffRequest(text, false), null);
  }
  assert.equal(handoffRequest('请帮我整理明细', true), null);
  assert.equal(handoffRequest('销售交接'.padEnd(4000, '。'))?.action, 'read');
  assert.equal(handoffRequest('销售交接'.padEnd(4001, '。')), null);
});

test('50 个普通前缀的合法动作在 10 毫秒内完成识别', t => {
  const text = '请 '.repeat(50) + '复核';
  assert.equal(handoffRequest(text, true)?.action, 'guide');
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = handoffRequest(text, true);
    samples.push(performance.now() - start);
    assert.equal(result?.action, 'guide');
  }
  const median = samples.sort((a, b) => a - b)[2];
  t.diagnostic(`合法输入耗时中位数 ${median.toFixed(3)} ms`);
  assert.ok(median < 10);
});

test('交接前缀逐词从上次结束位置向前扫描', () => {
  const code = readFileSync(new URL('../src/sale-handoff.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  function verify(text) {
    assert.match(text, /const prefix = \/[^\n]+\/y;/);
    assert.match(text, /while \(prefix\.exec\(text\)\) offset = prefix\.lastIndex;/);
    assert.match(text, /handoffAction\.test\(text\.slice\(offset\)\)/);
  }
  verify(code);
  assert.throws(() => verify(code.replace('/y;', '/;')), { code: 'ERR_ASSERTION' });
});
