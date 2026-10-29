import { hasPerm } from './perms.js';
import { CHAT_GRAPH } from './persona.js';

const READ_PERMISSIONS = {
  'A-inventory': ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view'],
  'B-sale-draft': ['sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view'],
  'B2-reserve': ['sale.order.view'],
  'C-replenishment': ['report.view', 'warehouse.view'],
  'C-purchase-draft': ['purchase.order.view', 'report.view', 'product.view', 'warehouse.view'],
  'D-ledger': ['payment.view', 'dashboard.view'],
  'D-receipt': ['payment.view', 'finance.account.view', 'customer.view', 'dashboard.view'],
  'D-settle': ['payment.view', 'finance.account.view', 'customer.view', 'dashboard.view'],
  'F-briefing': ['dashboard.view'],
};
const WAREHOUSE_GRAPHS = new Set(['A-inventory', 'B-sale-draft', 'B2-reserve', 'C-replenishment', 'C-purchase-draft', 'E-stuck', 'F-briefing']);
const fail = (message, code = 'TASK_ACCESS_DENIED') => Object.assign(new Error(message), { status: 403, code });

export function ownsTask(task, actor) {
  const owner = task?.actor;
  if (owner?.id != null && actor?.id != null) return Number(owner.id) === Number(actor.id);
  const name = typeof owner === 'string' ? owner : owner?.username;
  return Boolean(name && actor?.username && name === actor.username);
}

function warehouseIdsIn(value, into = new Set()) {
  if (Array.isArray(value)) for (const row of value) warehouseIdsIn(row, into);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'warehouseId' && child != null && Number.isSafeInteger(Number(child)) && Number(child) > 0) into.add(Number(child));
      else if (key !== 'payload' && !key.startsWith('_')) warehouseIdsIn(child, into);
    }
  }
  return into;
}

export function assertTaskAccess(task, actor) {
  if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
  if (!ownsTask(task, actor)) throw fail('只能查看或处理本人发起的任务');
  if (task.graph === CHAT_GRAPH) throw fail('闲聊记录不再恢复。请直接说明要查的库存、单据或账款。');
  const required = READ_PERMISSIONS[task.graph];
  if (!required && task.graph !== 'E-stuck') throw fail('小满无法核对该任务的当前授权，请到原页面核查');
  const missing = required?.find(code => !hasPerm(actor, code));
  if (missing) throw Object.assign(fail('小满无法显示该任务：当前查看权限已变化'), { permission: missing });
  if (task.graph === 'E-stuck' && !['warehouse.task.view', 'inventory.view'].some(code => hasPerm(actor, code))) throw fail('小满无法显示该任务：当前仓储查看权限已变化');
  // 聚合结果含多个独立权限段；曾有权取得的明细在该权限撤回后不可从旧快照重放。
  const extra = task.graph === 'F-briefing' ? ['sale.credit.view', 'approval.task.view']
    : task.graph === 'E-stuck' ? ['warehouse.task.view', 'inventory.view', 'warehouse.task.assign', 'inbound.order.view'] : [];
  if (extra.some(code => hasPerm(task.actor, code) && !hasPerm(actor, code))) throw fail('小满无法显示该任务：当前明细查看权限已变化');
  if (WAREHOUSE_GRAPHS.has(task.graph) && Array.isArray(actor?.warehouseIds)) {
    const aggregate = ['E-stuck', 'F-briefing', 'C-replenishment'].includes(task.graph);
    const snapshotIds = aggregate ? task.accessWarehouseIds ?? [] : task.accessWarehouseIds ?? [...warehouseIdsIn([task.preview, task.result])];
    const ids = snapshotIds.length ? snapshotIds : task.actor?.warehouseIds;
    if (!Array.isArray(ids) || ids.some(id => !actor.warehouseIds.map(Number).includes(Number(id)))) throw fail('小满无法显示该任务：当前仓库范围已变化');
    if (!actor.warehouseIds.length) throw fail('小满无法显示该任务：当前仓库范围为空');
  }
  return task;
}

const PRIVATE_KEYS = new Set(['payload', 'sigRecs', 'signature', 'requestKey', 'request_key', 'actor', 'permissions', 'steps', 'raw', 'password', 'token', 'apiKey', 'authorization', 'headers']);
function safeValue(value, requestKey) {
  if (typeof value === 'string') return requestKey ? value.split(requestKey).join('已保留的原请求') : value;
  if (Array.isArray(value)) return value.map(v => safeValue(v, requestKey));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith('_') && !PRIVATE_KEYS.has(key))
    .map(([key, child]) => [key, safeValue(child, requestKey)]));
  return value;
}
export function sanitizePreview(preview) { return preview ? safeValue(preview) : undefined; }

export function safeTaskView(task) {
  const expired = task.state === 'AWAITING_CONFIRM' && task.previewExpired();
  return safeValue({
    id: task.id, graph: task.graph, state: expired ? 'EXPIRED' : task.state,
    userText: task.userText, reply: expired ? '预览已过期，请重新发起试算。' : task.reply,
    preview: sanitizePreview(task.preview), result: task.result, error: task.error, candidates: task.candidates,
    revision: task.revision, createdAt: task.createdAt, updatedAt: task.updatedAt || task.createdAt,
  }, task.requestKey);
}

export function listTaskViews(store, actor) {
  const tasks = [];
  for (const task of [...store.tasks.values()].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))) {
    try { assertTaskAccess(task, actor); } catch (error) { if ([403, 404].includes(error.status)) continue; throw error; }
    tasks.push(safeTaskView(task));
    if (tasks.length === 30) break;
  }
  return tasks;
}

export function rememberOutput(store, out) {
  if (out?.task) {
    out.task.reply = safeValue(out.reply, out.task.requestKey);
    out.task.updatedAt = new Date().toISOString();
    if (out.candidates !== undefined) out.task.candidates = out.candidates;
    store.save();
  }
  return out;
}
