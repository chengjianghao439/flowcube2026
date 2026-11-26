import { hasPerm } from './perms.js';
import { CHAT_GRAPH } from './persona.js';
import { TASK_PROGRESS_PERMISSIONS } from './tools.js';
import { SEQUENCE_GRAPH, READ_STEPS } from './composite-routing.js';
import { WORKBENCH_SOURCES } from './operations-read.js';
import { candidateKey } from './conversation-reference.js';
import { HANDOFF_PERMISSIONS, SALE_HANDOFF_GRAPH } from './sale-handoff.js';
import { RETURN_FINANCE, REFUND_EXECUTE, RETURN_READ, REFUND_PERMISSIONS } from './return-finance.js';

import { CROSS_PERIOD, BACKFILL_ACTION, CROSS_PERIOD_READ } from './cross-period.js';
import { taskConversationId } from './conversation-journal.js';

const READ_PERMISSIONS = {
  'A-inventory': ['inventory.view', 'dashboard.view', 'product.view', 'warehouse.view'],
  'B-sale-draft': ['sale.order.view', 'customer.view', 'price.list.view', 'product.view', 'inventory.view', 'warehouse.view', 'dashboard.view'],
  'B2-reserve': ['sale.order.view'],
  'C-replenishment': ['report.view', 'warehouse.view'],
  'C-purchase-draft': ['purchase.order.view', 'report.view', 'product.view', 'warehouse.view'],
  'D-ledger': ['payment.view', 'dashboard.view', 'customer.view'],
  'D-receipt': ['payment.view', 'finance.account.view', 'customer.view', 'dashboard.view'],
  'D-settle': ['payment.view', 'finance.account.view', 'customer.view', 'dashboard.view'],
  'F-briefing': ['dashboard.view'],
  'H-workbench': [],
  'I-returns': ['return.order.view'],
  'J-receipt-status': ['payment.view'],
  'M-monthly-reconciliation': ['payment.view'],
};
const WAREHOUSE_GRAPHS = new Set(['A-inventory', 'B-sale-draft', 'B2-reserve', 'C-replenishment', 'C-purchase-draft', 'E-stuck', 'F-briefing', 'I-returns']);
// 对应 /api/approvals/pending 的路由和各业务分支的当前可见权限。
const PENDING_APPROVAL_PERMISSIONS = [
  'approval.task.view', 'finance.expense.view.all', 'finance.expense.view', 'finance.expense.approve',
  'sale.credit.override.view', 'sale.credit.override.approve', 'product.view',
  'purchase.order.view', 'purchase.order.approve', 'inventory.disposal.view', 'inventory.disposal.approve',
  'supplier.refund.view', 'supplier.refund.confirm', 'return.order.view', 'payment.view',
];
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

export function assertTaskAccess(task, actor, store) {
  if (!task) throw Object.assign(new Error('任务不存在'), { status: 404 });
  if (!ownsTask(task, actor)) throw fail('只能查看或处理本人发起的任务');
  if (task.graph === SEQUENCE_GRAPH) {
    const steps = task.sequence?.steps;
    if (!store || !Array.isArray(steps) || steps.length < 2 || steps.length > 3) throw fail('无法核对原查询步骤的权限');
    for (const step of steps) {
      if (!Object.hasOwn(READ_STEPS, step.graph)) throw fail('无法核对原查询步骤的权限');
      const id = step.completedId ?? step.activeId;
      if (!id) continue;
      const child = store.get(id);
      if (child?.graph !== step.graph || child.sequenceOwner !== task.id) throw fail('无法核对原查询步骤的权限');
      assertTaskAccess(child, actor);
    }
    return task;
  }
  if (task.graph === CHAT_GRAPH) throw fail('闲聊记录不再恢复。请直接说明要查的库存、单据或账款。');
  if (task.graph === CROSS_PERIOD || task.graph === BACKFILL_ACTION) {
    const required = task.crossPeriodPermissions ?? [];
    if (required.length ? required.some(code => !hasPerm(actor, code))
      : task.graph === BACKFILL_ACTION || !CROSS_PERIOD_READ.some(code => hasPerm(actor, code))) {
      throw fail('当前退货、账款、凭证或补录权限已变化，请核对原单');
    }
    if (Array.isArray(actor.warehouseIds) && (task.accessWarehouseIds ?? []).some(id => !actor.warehouseIds.map(Number).includes(Number(id)))) {
      throw fail('当前仓库范围已变化，请核对原单');
    }
    return task;
  }
  if (task.graph === RETURN_FINANCE || task.graph === REFUND_EXECUTE) {
    const required = task.graph === REFUND_EXECUTE ? REFUND_PERMISSIONS : task.returnFinancePermissions;
    if (required?.length ? required.some(code => !hasPerm(actor, code)) : !RETURN_READ.some(code => hasPerm(actor, code))) {
      throw fail('小满无法显示该记录，当前退货、退款或应收权限已变化');
    }
    const scope = task.accessWarehouseIds ?? [];
    if (Array.isArray(actor.warehouseIds) && (task.graph === REFUND_EXECUTE && !scope.length
      || scope.some(value => !actor.warehouseIds.map(Number).includes(Number(value))))) {
      throw fail('小满无法显示该记录，当前仓库范围已变化');
    }
    return task;
  }
  if (task.graph === SALE_HANDOFF_GRAPH) {
    const sources = task.handoffSources ?? task.result?.sources;
    const permissions = sources?.length ? sources.map(source => HANDOFF_PERMISSIONS[source]) : [];
    if (permissions.length ? permissions.some(permission => !permission || !hasPerm(actor, permission))
      : !Object.values(HANDOFF_PERMISSIONS).some(permission => hasPerm(actor, permission))) throw fail('小满无法显示该交接记录：当前查看权限已变化');
    if ((task.handoffActionPermissions ?? []).some(permission => !hasPerm(actor, permission))) throw fail('交接中的办理权限已变化，请重新核对原单');
    if ((task.accessWarehouseIds?.length || sources?.some(source => source !== 'finance')) && Array.isArray(actor.warehouseIds)
      && (!task.accessWarehouseIds?.length || task.accessWarehouseIds.some(id => !actor.warehouseIds.map(Number).includes(Number(id))))) {
      throw fail('小满无法显示该交接记录：当前仓库范围已变化');
    }
    return task;
  }
  const required = task.graph === 'D-settle' && task.preview?._explicit ? ['payment.view', 'payment.execute'] : READ_PERMISSIONS[task.graph];
  if (!required && task.graph !== 'E-stuck') throw fail('小满无法核对该任务的当前授权，请到原页面核查');
  const workbench = task.graph === 'H-workbench' ? task.result?.sources : null;
  const sourcePermissions = workbench?.flatMap(source => [
    ...(WORKBENCH_SOURCES[source.key]?.permissions ?? []),
    ...(source.key === 'warehouse' && source.link ? ['warehouse.task.ship'] : []),
  ]);
  if (task.graph === 'H-workbench' && !sourcePermissions?.length) throw fail('小满无法核对该岗位待办的当前授权');
  const missing = (sourcePermissions ?? required)?.find(code => !hasPerm(actor, code));
  if (missing) throw Object.assign(fail('小满无法显示该任务：当前查看权限已变化'), { permission: missing });
  if (task.graph === 'E-stuck' && !Object.values(TASK_PROGRESS_PERMISSIONS).some(code => hasPerm(actor, code))) throw fail('小满无法显示该任务：当前仓储查看权限已变化');
  // 聚合结果含多个独立权限段；曾有权取得的明细在该权限撤回后不可从旧快照重放。
  const extra = task.graph === 'F-briefing' ? [
    'sale.credit.view', ...(task.result?.sections?.pendingApprovals?.ok ? PENDING_APPROVAL_PERMISSIONS : ['approval.task.view']),
  ]
    : task.graph === 'E-stuck' ? Object.values(TASK_PROGRESS_PERMISSIONS) : [];
  if (extra.some(code => hasPerm(task.actor, code) && !hasPerm(actor, code))) throw fail('小满无法显示该任务：当前明细查看权限已变化');
  const scopedWorkbench = workbench?.some(source => WORKBENCH_SOURCES[source.key]?.scoped);
  if ((WAREHOUSE_GRAPHS.has(task.graph) || scopedWorkbench) && Array.isArray(actor?.warehouseIds)) {
    const aggregate = scopedWorkbench || (task.graph === 'I-returns' && Boolean(task.result?.sources))
      || ['E-stuck', 'F-briefing', 'C-replenishment'].includes(task.graph);
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

export function safeTaskView(task, store, restoring = false) {
  const expired = task.state === 'AWAITING_CONFIRM' && task.previewExpired();
  const handoffReview = restoring && task.state === 'DONE' && task.graph === SALE_HANDOFF_GRAPH;
  const resultReview = restoring && task.state === 'DONE' && ['B2-reserve', 'D-settle'].includes(task.graph);
  const verifyOnRestore = handoffReview || resultReview || (restoring && task.state === 'AWAITING_CONFIRM');
  return safeValue({
    id: task.id, graph: task.graph, state: expired ? 'EXPIRED' : task.state,
    conversationId: taskConversationId(task),
    userText: task.userText,
    reply: handoffReview || resultReview ? '打开原任务后重新核对原单当前进度。' : expired && !task.reviewRequired ? '预览已过期，请重新核对原任务。' : task.reply,
    preview: resultReview ? undefined : sanitizePreview(task.preview),
    result: handoffReview || (resultReview && task.graph === 'B2-reserve') ? { orderNo: task.result?.orderNo }
      : resultReview ? { receiptNo: task.result?.receiptNo } : task.result,
    error: task.error, candidates: task.candidates,
    candidateKey: candidateKey(task, store),
    ...((task.reviewRequired || verifyOnRestore) ? { reviewRequired: true } : {}),
    revision: task.revision, createdAt: task.createdAt, updatedAt: task.updatedAt || task.createdAt,
  }, task.requestKey);
}

export function listTaskViews(store, actor) {
  const tasks = [];
  for (const page of store.pagesForActor(actor)) {
    for (const task of page) {
      if (task.sequenceOwner) continue;
      try { assertTaskAccess(task, actor, store); } catch (error) { if ([403, 404].includes(error.status)) continue; throw error; }
      tasks.push(safeTaskView(task, store, true));
      if (tasks.length === 30) return tasks;
    }
  }
  return tasks;
}

export function rememberOutput(store, out) {
  if (out?.task && !out.preserveTask) {
    out.task.reply = safeValue(out.reply, out.task.requestKey);
    out.task.updatedAt = new Date().toISOString();
    if (out.candidates !== undefined) out.task.candidates = out.candidates;
    store.save(out.task);
  }
  return out;
}
