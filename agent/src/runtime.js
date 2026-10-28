// 共享运行入口：不监听端口、不自行认证；HTTP 包装必须先提供当前身份和正式 API 客户端。
import { join } from 'node:path';
import { config } from './config.js';
import { buildHealth } from './health.js';
import { TaskStore } from './tasks.js';
import { handleMessage, confirmTask, cancelTask } from './agent.js';
import { TOOLS } from './tools.js';
import { assertTaskAccess, listTaskViews, safeTaskView, sanitizePreview } from './task-access.js';
import { BUSINESS_PAGE_IDS } from './routing.js';
export { FlowClient } from './flow.js';

const failure = (status, message) => Object.assign(new Error(message), { status });

function response(out) {
  const view = out.task ? safeTaskView(out.task) : null;
  return { reply: view?.reply ?? out.reply, task: view ? { id: view.id, graph: view.graph, state: view.state, queryOutcome: view.queryOutcome, revision: view.revision, confirmationBlocked: view.confirmationBlocked, userText: view.userText } : null,
    preview: view?.state === 'AWAITING_CONFIRM' ? view.preview : sanitizePreview(out.preview), result: view?.result ?? out.result,
    candidates: view?.candidates ?? out.candidates, diffs: out.diffs,
    businessPages: Array.isArray(out.businessPages) ? out.businessPages.filter(page => BUSINESS_PAGE_IDS.includes(page)) : undefined };
}

export function createAgentRuntime({ dataDir = config.dataDir, store = new TaskStore(join(dataDir, 'tasks.json')), messageOptions = {} } = {}) {
  const executing = new Set();
  return {
    async dispatch({ method, pathname, body = {}, actor, client }) {
      if (!actor?.username) throw failure(401, '请先登录极序 Flow');
      if (method === 'GET' && pathname === '/health') return { ...buildHealth(), flow: client.baseUrl };
      if (method === 'GET' && pathname === '/tools') return { tools: Object.entries(TOOLS).map(([name, tool]) => ({ name, level: tool.level, desc: tool.desc })) };
      if (method === 'GET' && pathname === '/me') return { realName: actor.realName, roleName: actor.roleName, warehouseScope: actor.unrestrictedWarehouseScope ? '全部仓库' : `${actor.warehouseIds.length} 个仓库` };
      if (method === 'GET' && pathname === '/tasks') return { tasks: listTaskViews(store, actor) };
      if (method === 'POST' && (!body || typeof body !== 'object' || Array.isArray(body))) throw failure(400, '请求内容格式不正确');
      if (method === 'POST' && pathname === '/chat') {
        const { message, taskId, choiceId } = body;
        if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw failure(400, '请输入 1 至 4000 字的任务说明');
        if (taskId != null && (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId))) throw failure(400, '任务编号无效');
        if (choiceId != null && (!taskId || !['number', 'string'].includes(typeof choiceId) || !/^[1-9]\d{0,15}$/.test(String(choiceId)))) throw failure(400, '候选编号无效，请从原任务候选中选择');
        const lock = `chat:${actor.id ?? actor.username}`;
        if (executing.has(lock)) throw failure(409, '上一条请求仍在处理中，请稍候');
        executing.add(lock);
        try { return response(await handleMessage(store, client, actor, message, { ...messageOptions, taskId, choiceId })); }
        finally { executing.delete(lock); }
      }
      const match = pathname.match(/^\/tasks\/([\w-]{1,100})(\/(?:confirm|cancel))?$/);
      if (match) {
        const task = assertTaskAccess(store.get(match[1]), actor);
        if (method === 'GET' && !match[2]) return { task: safeTaskView(task) };
        if (method === 'POST' && match[2]) {
          if (match[2] === '/cancel') return response(await cancelTask(store, task.id, actor));
          const { revision } = body;
          if (revision != null && (!Number.isSafeInteger(revision) || revision < 0)) throw failure(400, '预览版本无效');
          return response(await confirmTask(store, client, task.id, actor, { revision }));
        }
      }
      throw failure(404, '接口不存在');
    },
  };
}
