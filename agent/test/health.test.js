// /health 扩字段测试：字段齐全、graphs 为 llm.js 实图清单、planner 与配置口径一致。
// planner 判定口径 = handleMessage 的实际判定：config.model.apiKey 有值 → llm，否则 rule。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth, plannerMode, realGraphs } from '../src/health.js';
import { GRAPHS } from '../src/llm.js';
import { CHAT_GRAPH } from '../src/persona.js';
import { config } from '../src/config.js';

test('health 字段齐全且 graphs 为实图清单（不含 none）', () => {
  const h = buildHealth();
  for (const k of ['ok', 'service', 'flow', 'modelConfigured', 'planner', 'model', 'graphs', 'keySource']) {
    assert.ok(k in h, `缺字段 ${k}`);
  }
  assert.equal(h.ok, true);
  assert.equal(h.service, 'jixu-agent');
  assert.deepEqual(h.graphs, [...GRAPHS.filter((g) => g !== 'none'), CHAT_GRAPH]);
  assert.equal(h.graphs.length, GRAPHS.length);
  assert.ok(!h.graphs.includes('none'));
  assert.deepEqual(realGraphs(), h.graphs);
});

test('planner 与配置一致：有 key → llm、无 key → rule', () => {
  assert.equal(plannerMode({ apiKey: 'some-key' }), 'llm');
  assert.equal(plannerMode({ apiKey: '' }), 'rule');
  const h = buildHealth();
  assert.equal(h.planner, config.model.apiKey ? 'llm' : 'rule');
  assert.equal(h.modelConfigured, Boolean(config.model.apiKey));
  assert.equal(h.model, config.model.name || null);
});

test('keySource 与 key 实际来源一致', () => {
  const h = buildHealth();
  assert.ok(['env', 'file', null].includes(h.keySource));
  if (!config.model.apiKey) {
    assert.equal(h.keySource, null);
    assert.equal(h.planner, 'rule');
  } else {
    assert.ok(h.keySource === 'env' || h.keySource === 'file');
    assert.equal(h.planner, 'llm');
  }
});
