// 冷启动读盘与旧历史导入在独立线程运行，避免阻塞 ERP HTTP 事件循环。
import { parentPort, workerData } from 'node:worker_threads';
import { loadTaskGroups } from './tasks.js';

const groups = loadTaskGroups(workerData);
const batchSize = 32;
for (let start = 0; start < groups.length; start += batchSize) {
  parentPort.postMessage({ groups: groups.slice(start, start + batchSize) });
}
parentPort.postMessage({ done: true });
parentPort.close();
