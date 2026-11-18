// 合成历史及同进程 HTTP 探针。仅使用随机回环端口和本脚本临时数据。
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskStore } from '../src/tasks.js';

const createdAt = '2026-11-18T00:00:00.000Z';
const updatedAt = '2026-11-18T01:00:00.000Z';
const sizes = [100, 1000, 10000];
const samples = 16;

function fixture(index) {
  return {
    id: `fixture-${index}`, graph: 'A-inventory', state: 'DONE',
    actor: { id: (index % 20) + 1, username: `synthetic-owner-${index % 20}`, warehouseIds: [1] },
    requestKey: `synthetic-original-${index}`, userText: '合成库存查询', createdAt, updatedAt,
    result: { rows: Array.from({ length: 12 }, (_, row) => ({
      sku: `SKU-${row}`, productName: '模拟'.repeat(20), warehouseId: 1,
      remainingQty: row, note: 'sample-'.repeat(22),
    })) },
    history: [{ state: 'DONE', at: updatedAt }],
  };
}

const rounded = value => Number(value.toFixed(2));
function p95(values) {
  return rounded([...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]);
}

async function measure(history) {
  const temporary = mkdtempSync(join(tmpdir(), 'xiaoman-task-store-bench-'));
  const file = join(temporary, 'tasks.json');
  let store, current, writeTimes = [];
  const server = createServer((request, response) => {
    if (request.url === '/assistant-save') {
      const started = performance.now();
      current.reply = `合成回复 ${started}`;
      current.updatedAt = new Date().toISOString();
      store.save(current);
      writeTimes.push(performance.now() - started);
    }
    response.end('OK');
  });
  try {
    writeFileSync(file, JSON.stringify(Array.from({ length: history }, (_, index) => fixture(index)), null, 2), { mode: 0o600 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const ping = async endpoint => {
      const started = performance.now();
      await (await fetch(base + endpoint)).text();
      return performance.now() - started;
    };
    // 同一脚本可放到旧代码检出，用旧 TaskStore 对照相同合成输入。
    const openStore = () => typeof TaskStore.open === 'function' ? TaskStore.open(file) : Promise.resolve(new TaskStore(file));
    const importStarted = performance.now();
    let loading = true;
    const opening = Promise.resolve().then(openStore).finally(() => { loading = false; });
    const coldProbe = [];
    while (loading) {
      coldProbe.push(await ping('/erp-probe'));
      if (loading) await delay(50);
    }
    store = await opening;
    const importMs = rounded(performance.now() - importStarted);
    const reopenStarted = performance.now();
    store = await openStore();
    const reopenMs = rounded(performance.now() - reopenStarted);
    current = store.get('fixture-0');
    await Promise.all([ping('/assistant-save'), ping('/erp-probe')]);
    writeTimes = [];
    const idle = [], concurrent = [];
    for (let index = 0; index < samples; index++) {
      idle.push(await ping('/erp-probe'));
      const [, elapsed] = await Promise.all([ping('/assistant-save'), ping('/erp-probe')]);
      concurrent.push(elapsed);
    }
    const directory = join(temporary, 'tasks-v2');
    const files = typeof TaskStore.open === 'function' ? readdirSync(directory) : [];
    const taskBytes = files.reduce((sum, name) => sum + statSync(join(directory, name)).size, 0);
    console.log(JSON.stringify({
      history, legacyBytes: statSync(file).size, taskBytes, files: files.length, importMs, reopenMs,
      coldProbeP95Ms: p95(coldProbe), writeP95Ms: p95(writeTimes),
      idleProbeP95Ms: p95(idle), concurrentProbeP95Ms: p95(concurrent),
    }));
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(temporary, { recursive: true, force: true });
  }
}

for (const history of sizes) await measure(history);
