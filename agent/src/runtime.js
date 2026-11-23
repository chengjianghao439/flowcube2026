// 共享运行入口：不监听端口、不自行认证；HTTP 包装必须先提供当前身份和正式 API 客户端。
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { buildHealth } from './health.js';
import { TaskStore } from './tasks.js';
import { handleMessage, confirmTask, changeSaleDraft, resumeTask } from './agent.js';
import { TOOLS } from './tools.js';
import { assertTaskAccess, listTaskViews, ownsTask, safeTaskView, sanitizePreview } from './task-access.js';
import { findHistoricalTask } from './history-resume.js';
import { conversationScope, createConversationJournal, isConversationId, taskConversationId } from './conversation-journal.js';
export { FlowClient } from './flow.js';

const failure = (status, message) => Object.assign(new Error(message), { status });

function response(out, store) {
  const view = out.task ? safeTaskView(out.task, store) : null;
  return { reply: out.preserveTask ? out.reply : view?.reply ?? out.reply,
    task: view ? { id: view.id, graph: view.graph, state: view.state, revision: view.revision, userText: view.userText, candidateKey: view.candidateKey,
      conversationId: view.conversationId,
      ...(view.reviewRequired ? { reviewRequired: true } : {}) } : null,
    preview: view?.state === 'AWAITING_CONFIRM' ? view.preview : sanitizePreview(out.preview), result: view?.result ?? out.result,
    candidates: view?.candidates ?? out.candidates, diffs: out.diffs, ...(out.detachTask ? { detachTask: true } : {}),
    ...(out.keepReferences ? { keepReferences: true } : {}),
    ...(out.historyLookup ? { historyLookup: true, historyQuery: out.historyQuery } : {}) };
}

export function openTaskStore(dataDir = config.dataDir) {
  return TaskStore.open(join(dataDir, 'tasks.json'));
}

export function createAgentRuntime({ dataDir, store = new TaskStore(join(dataDir ?? config.dataDir, 'tasks.json')), messageOptions = {} } = {}) {
  const executing = new Set();
  const observe = dataDir ? createConversationJournal(dataDir) : (_metadata, execute) => execute();

  function observeRequest(actor, operation, { message, taskId, conversationId: requestedId }, execute) {
    let owned;
    if (taskId) {
      try {
        const task = store.get(taskId);
        if (task && ownsTask(task, actor)) owned = task;
      } catch { /* The actual request still performs its task lookup and returns its own error. */ }
    }
    const conversationId = taskConversationId(owned) ?? requestedId ?? randomUUID();
    return observe({ actor, operation, conversationId, message, taskId: owned?.id }, () =>
      conversationScope.run(conversationId, async () => ({ ...await execute(), conversationId })));
  }

  return {
    async dispatch({ method, pathname, body = {}, actor, client }) {
      if (!actor?.username) throw failure(401, '请先登录极序 Flow');
      if (method === 'GET' && pathname === '/health') return { ...buildHealth(), flow: client.baseUrl };
      if (method === 'GET' && pathname === '/tools') return { tools: Object.entries(TOOLS).map(([name, tool]) => ({ name, level: tool.level, desc: tool.desc })) };
      if (method === 'GET' && pathname === '/me') return { realName: actor.realName, roleName: actor.roleName, warehouseScope: actor.unrestrictedWarehouseScope ? '全部仓库' : `${actor.warehouseIds.length} 个仓库` };
      if (method === 'GET' && pathname === '/tasks') {
        const { choices, restricted } = findHistoricalTask(store, actor, {});
        return { tasks: listTaskViews(store, actor), resumeAmbiguous: choices.length > 1 || (restricted && choices.length === 1) };
      }
      if (method === 'POST' && (!body || typeof body !== 'object' || Array.isArray(body))) throw failure(400, '请求内容格式不正确');
      if (method === 'POST' && pathname === '/chat') {
        const { message, taskId, choiceId, previousTaskId, referenceTaskId, candidateKey, historyLookup, historyQuery, conversationId } = body;
        if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw failure(400, '请输入 1 至 4000 字的任务说明');
        if (taskId != null && (typeof taskId !== 'string' || !/^[\w-]{1,100}$/.test(taskId))) throw failure(400, '任务编号无效');
        if (previousTaskId != null && (typeof previousTaskId !== 'string' || !/^[\w-]{1,100}$/.test(previousTaskId))) throw failure(400, '上一条任务编号无效');
        if (referenceTaskId != null && (taskId || typeof referenceTaskId !== 'string' || !/^[\w-]{1,100}$/.test(referenceTaskId))) throw failure(400, '引用任务编号无效');
        if (candidateKey != null && (typeof candidateKey !== 'string' || !/^[a-f\d]{64}$/.test(candidateKey))) throw failure(400, '候选列表版本无效');
        if ((historyLookup != null && typeof historyLookup !== 'boolean') ||
            (historyQuery != null && (!historyLookup || typeof historyQuery !== 'string' || historyQuery.length > 4000))) throw failure(400, '续办查询格式无效');
        if (choiceId != null && (!taskId || !['number', 'string'].includes(typeof choiceId) || !/^[1-9]\d{0,15}$/.test(String(choiceId)))) throw failure(400, '候选编号无效，请从原任务候选中选择');
        if (conversationId != null && !isConversationId(conversationId)) throw failure(400, '会话编号无效');
        const metadata = { message, taskId: taskId ?? referenceTaskId, conversationId };
        const lock = `chat:${actor.id ?? actor.username}`;
        if (executing.has(lock)) return observeRequest(actor, 'chat', metadata, () => {
          throw failure(409, '上一条请求仍在处理中，请稍候');
        });
        executing.add(lock);
        try {
          return await observeRequest(actor, 'chat', metadata, async () =>
            response(await handleMessage(store, client, actor, message, { ...messageOptions, taskId, previousTaskId, referenceTaskId,
              choiceId, candidateKey, historyLookup, historyQuery }), store));
        } finally { executing.delete(lock); }
      }
      const match = pathname.match(/^\/tasks\/([\w-]{1,100})(?:\/(confirm|sale-draft|resume))?$/);
      if (match) {
        const [, taskId, operation] = match;
        if (method === 'GET' && !operation) return { task: safeTaskView(assertTaskAccess(store.get(taskId), actor, store), store, true) };
        if (method === 'POST' && operation) return observeRequest(actor, operation, { taskId }, async () => {
          const task = assertTaskAccess(store.get(taskId), actor, store);
          if (operation === 'resume') return response(await resumeTask(store, client, task.id, actor), store);
          const { action, revision } = body;
          if (operation === 'confirm') {
            if (revision != null && (!Number.isSafeInteger(revision) || revision < 0)) throw failure(400, '预览版本无效');
            return response(await confirmTask(store, client, task.id, actor, { revision }), store);
          }
          if (!['reselect', 'cancel'].includes(action) || !Number.isSafeInteger(revision) || revision < 0) throw failure(400, '销售草稿操作或预览版本无效');
          return response(await changeSaleDraft(store, task.id, actor, { action, revision }), store);
        });
      }
      throw failure(404, '接口不存在');
    },
  };
}
