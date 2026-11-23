import { reportedUnknownSubmission, resumesOriginal, SEQUENCE_GRAPH } from './composite-routing.js';
import { customerReference, taskDocumentNo } from './conversation-reference.js';
import { assertTaskAccess } from './task-access.js';
import { SALE_HANDOFF_GRAPH } from './sale-handoff.js';

export const RECOVERY_STATES = new Set(['CONFIRMED', 'EXECUTING', 'RESULT_UNKNOWN', 'VERIFYING', 'ESCALATED']);
const PENDING_STATES = new Set(['DISAMBIGUATING', 'PAUSED', 'AWAITING_CONFIRM', 'EXPIRED', ...RECOVERY_STATES]);
const SALES = ['B-sale-draft'];
const RECEIPTS = ['D-receipt', 'D-settle'];
const ORDERS = [
  [/退款补录|跨期补录|补录申请|补录/, ['R-backfill-action']],
  [/销售单交接|销售交接|单据交接|交接|接班/, [SALE_HANDOFF_GRAPH]],
  [/销售草稿|销售单|开单任务/, SALES],
  [/核销任务|核销分配|核销预览|那笔核销/, ['D-settle']],
  [/收款|到账/, RECEIPTS],
  [/占库|预占/, ['B2-reserve']],
  [/采购草稿|采购单/, ['C-purchase-draft']],
  [/库存|查库/, ['A-inventory']],
  [/多步查询|顺序查询|分步查询/, [SEQUENCE_GRAPH]],
];
const compact = text => text.trim().replace(/[。！!？?]+$/, '').trim();
const documentNumbers = text => [...new Set((text.match(/(?<![a-z\d_-])(?:BF-\d{8}-\d{4,}|[a-z][a-z\d_-]{0,17}?\d{6,28})(?![a-z\d_-])/gi) ?? []).map(no => no.toUpperCase()))];
const dayOf = value => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : null;
};
const tidy = value => compact(value).replace(/^[「『“"']|[」』”"']$/g, '').trim();

function clue(text) {
  const document = /^(?:完整)?(?:销售)?单号(?:是|为|[：:])?\s*(.+)$/.exec(text)?.[1];
  if (document || /^[a-z][a-z\d_-]{0,17}?\d{6,28}$/i.test(text)) {
    const numbers = documentNumbers(document || text);
    return numbers.length === 1 ? { no: numbers[0] } : { unresolved: true };
  }
  const field = /^(客户(?:全称)?|仓库|商品(?:名称|编号)?)(?:是|为|[：:])\s*(.+)$/.exec(text);
  if (field) return { [/^客户/.test(field[1]) ? 'customer' : /^商品/.test(field[1]) ? 'product' : 'warehouse']: tidy(field[2]) };
  const graphs = ORDERS.find(([pattern]) => new RegExp('^(?:' + pattern.source + ')$').test(text))?.[1];
  if (graphs) return { graphs };
  if (/^[\p{L}\p{N}][\p{L}\p{N} .()（）·&+_-]{1,59}$/u.test(text) && !/^(?:还是|原来|之前|刚才|上次|确认|提交|登记|退回|改成|改为|重新|继续|选)/.test(text)) {
    return { customer: tidy(text) };
  }
  return null;
}

export function historicalRequest(input, followup, baseText) {
  const text = compact(input).replace(/^(?:(?:小满|请|麻烦|帮我)[，,：:\s]*)+/, '');
  const start = /^(查询|查一下|查|核对|看看|重查)?\s*(?:上次|之前|刚才|昨天|前天|原任务|原请求).{0,42}(?:结果|回执)$/.exec(text);
  const askedResult = Boolean(start || reportedUnknownSubmission(text) || /^(?:查询|查一下|查|重查)原(?:任务(?:的?结果)?|结果|请求回执)$/.test(text));
  const action = /^(?:继续办(?:理)?|继续|接着办(?:理)?|接着处理|续办|恢复|找回)\s*/.exec(text);
  const generic = resumesOriginal(text);
  if (!action && !askedResult && !generic) {
    if (!followup) return null;
    const answer = clue(text);
    if (!answer) return null;
    const [base, ...earlier] = (baseText ?? '').split('\n', 5);
    const prior = base ? historicalRequest(base) : null;
    const filters = earlier.reduce((saved, line) => ({ ...saved, ...clue(line) }), {});
    const historyQuery = [base || '继续原任务', ...earlier, text].join('\n');
    return { ...prior, ...filters, unresolved: false, ...answer, qualified: true,
      historyQuery: historyQuery.length <= 4000 ? historyQuery : base };
  }
  if (generic) return { resultOnly: askedResult, qualified: false };
  const rest = text.slice((action?.[0] ?? start?.[1] ?? '').length).trim();
  const old = /^(?:(?:上次|之前|刚才|昨天|前天)(?:的)?(?:那个|那张|那笔|那条)?|原先的|原来的|原任务|原单)(?:\s*)/.exec(rest);
  const target = rest.slice(old?.[0]?.length ?? 0).trim();
  const qualifiedType = target.replace(/^(?:查询|查|做的|开的)\s*/, '').replace(/(?:的)?(?:结果|回执|任务|记录|查询|进度)$/, '');
  const graphs = ORDERS.find(([pattern]) => new RegExp('^(?:' + pattern.source + ')$').test(qualifiedType || target))?.[1];
  const customer = /^(?:给)?(.{2,60}?)的(?:销售草稿|销售单|开单任务|收款任务|那笔收款)$/.exec(target)?.[1];
  const field = /(?:^|[，,；;])\s*(客户(?:全称)?|仓库|商品(?:名称|编号)?)(?:是|为|[：:])\s*([^，,；;]+)$/.exec(target);
  const parsed = field ? clue(field[0].replace(/^[，,；;]\s*/, '')) : null;
  const numbers = documentNumbers(target);
  const typeWithClue = (Boolean(parsed) || Boolean(customer) || numbers.length > 0) && ORDERS.find(([pattern]) => pattern.test(target))?.[1];
  const described = !target || /^(?:任务|记录|单据|单|原任务|原单|原记录|结果|回执|这件事)$/.test(target);
  const named = old && !graphs && !described && !numbers.length && !parsed && clue(target);
  if (!old && !graphs && !numbers.length && !parsed && !customer && !askedResult) return null;
  const daysBack = /昨天/.test(old?.[0] ?? '') ? 1 : /前天/.test(old?.[0] ?? '') ? 2 : 0;
  return { graphs: graphs || typeWithClue || undefined, ...(numbers.length === 1 ? { no: numbers[0] } : {}),
    ...(customer ? { customer: tidy(customer) } : {}), ...named, ...parsed,
    ...(daysBack ? { day: dayOf(Date.now() - daysBack * 86400000) } : {}),
    unresolved: numbers.length > 1 || (!described && !graphs && !numbers.length && !parsed && !customer && !named),
    resultOnly: askedResult, qualified: Boolean(old || graphs || numbers.length || parsed || customer || askedResult) };
}

export function isHandoffHistory(query) {
  return query.graphs?.length === 1 && query.graphs[0] === SALE_HANDOFF_GRAPH;
}

function handoffIdentity(task) {
  const { orderNo, orderId, trace } = task.intent ?? {};
  if (task.graph !== SALE_HANDOFF_GRAPH || task.state !== 'DONE' || !orderNo || !Number.isSafeInteger(orderId) || orderId <= 0) return null;
  return JSON.stringify([orderNo, orderId, Boolean(trace), trace?.kind, trace?.targetNo]);
}

function matches(task, query) {
  if (task.sequenceOwner || (query.graphs && !query.graphs.includes(task.graph))) return false;
  if (query.resultOnly && !RECOVERY_STATES.has(task.state) && task.state !== 'DONE') return false;
  if (!(query.resultOnly || PENDING_STATES.has(task.state) || (query.no && task.state === 'DONE')
    || isHandoffHistory(query) && handoffIdentity(task))) return false;
  if (query.day && dayOf(task.createdAt) !== query.day) return false;
  if (query.no && ![taskDocumentNo(task), task.preview?.refundNo, task.intent?.refs?.application]
    .some(no => typeof no === 'string' && no.toUpperCase() === query.no)) return false;
  if (query.customer && (customerReference(task)?.name ?? task.intent?.customerKeyword) !== query.customer) return false;
  if (query.warehouse && ![task.intent?.warehouseKeyword, task.preview?.warehouseName, ...(task.result?.warehouses ?? []).map(w => w.warehouseName)].includes(query.warehouse)) return false;
  return !query.product || [task.intent?.productKeyword, task.result?.product, ...(task.preview?.lines ?? []).map(line => line.productName)].includes(query.product);
}

export function findHistoricalTask(store, actor, query) {
  const choices = [];
  const searchedHandoffs = new Set();
  let restricted = false;
  if (query.unresolved) return { choices, restricted };
  for (const page of store.pagesForActor(actor)) {
    for (const task of page) {
      if (!matches(task, query)) continue;
      const handoff = isHandoffHistory(query) ? handoffIdentity(task) : null;
      if (handoff && searchedHandoffs.has(handoff)) continue;
      if (task.graph === 'D-receipt' && task.state === 'DONE' && task.result?.stage2TaskId) {
        const next = store.get(task.result.stage2TaskId);
        if (next?.graph === 'D-settle' && next.preview?.receiptId === task.result.receiptId && matches(next, query)) continue;
      }
      try { assertTaskAccess(task, actor, store); }
      catch (error) { if (error.status === 403 || error.status === 404) { restricted = true; continue; } throw error; }
      if (handoff) searchedHandoffs.add(handoff);
      choices.push(task);
      if (choices.length === 2) return { choices, restricted };
    }
  }
  return { choices, restricted };
}

export function historicalQuestion({ choices, restricted }, query) {
  if (isHandoffHistory(query)) return query.no && choices.length
    ? '这张销售单有多条能匹配的交接记录。请从最近记录打开要续查的一条。'
    : '你要接着查哪张销售单？请给出完整销售单号。';
  if (!choices.length) return '暂时未能确定可续办的原任务。请从最近记录打开，或给出完整单号、客户全称。';
  if (query.customer || query.no) return '请确认是哪条原任务。相同客户或单号可能有多条记录，请从最近记录打开对应的一条。';
  const graphs = new Set(choices.map(task => task.graph));
  if (!restricted && [...graphs].every(graph => graph === 'A-inventory')) return '你要继续哪条库存查询？请告诉我原仓库或商品，例如「仓库是二仓」。';
  if ([...graphs].every(graph => SALES.includes(graph) || RECEIPTS.includes(graph))) return '你要继续哪条原任务？请给出客户全称或完整单号。';
  return '你要继续哪条原任务？请说任务类型、客户全称或完整单号，也可以从最近记录打开。';
}
