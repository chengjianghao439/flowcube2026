import { collectList } from './pagination.js';
import { hasPerm } from './perms.js';
import { buildSaleTrace, saleReturnSource, traceOrderLines } from './sale-trace.js';
import { releaseBatchText } from './reapply-progress.js';
import { quantityNumber } from './sale-conversation.js';

export const SALE_HANDOFF_GRAPH = 'L-sale-handoff';
export const HANDOFF_PERMISSIONS = { sale: 'sale.order.view', warehouse: 'warehouse.task.view', finance: 'payment.view', returns: 'return.order.view' };
export const HANDOFF_NUMBER_REQUIRED = '请给出原单的完整销售单号，例如 SL20261122011。';

const handoffWord = /交接|接手|转交|接班|交班|换班后|下一步(?:该)?谁(?:办|接|处理)|现在(?:该)?谁(?:办|接|处理)/;
const handoffSubject = /销售|单据|(?:这|该|本|前一|上一|哪|刚才那|之前那)(?:张|笔)?单|原单|客户|仓库|财务|客服|发货/;
const standaloneHandoff = /^(?:(?:请|帮我|给我|做个)\s*)*(?:交接|接手|接班|交班)(?:一下|吧|呢)?[。！？!?]*$/;
const followupRead = /^(?:(?:再|请|帮我|给我|那|那就)\s*)*(?:现在(?:该)?谁(?:办|接|处理)|(?:这张单|这单|该单|本单|原单)?(?:下一步(?:谁(?:接|办|处理)|怎么办)?|进度怎么样|(?:现在|目前)?到哪(?:一步|了))|(?:还)?卡在哪(?:里|一步)?|(?:重查|再查|(?:重新)?核对)(?:这张单|这单|原单)|(?:已经|都)办了什么|谁(?:来|负责)接手|(?:我|我们)现在能做什么|接着办|继续办理|能接着办吗)(?:呢|吗)?[。！？!?]*$/;
const reserveFollowup = /^(?:那|那就|好[，,])?\s*(?:我(?:来)?|帮我|请)?\s*(?:接着|继续|先|试着|试算|准备)?\s*(?:试占库|占库|补占(?:库)?|预占)(?:吧|看看|试算|预览)?[。！？!?]*$/;
const reserveDeferred = /(?:别|不要|不用|不必|无需|暂缓)[^，,。！？!?]{0,10}(?:占库|补占|预占)/;
const exceptionTopic = /异常|卡点|缺货|缺量|授信|改单|账款(?:差异|对不上)|账(?:没对上|对不上)/;
const financeRelease = /账(?:款)?(?:已经|已)?(?:对上|对齐)了/;
const releaseReport = /(?:卡点|异常|挂起)(?:都|已经|已|算是)?(?:解(?:除|决|了)|好了|清了)|已补(?:货|齐)|货(?:都|已经|已)?(?:到了|补好了|补齐了)|授信(?:已经|已)?(?:批了|过了|通过|批准)|改单(?:已经|已)?(?:好了|完了|处理完|解除)/;
const followupException = /先(?:处理|办)哪(?:个|项|一项|一步)|(?:重查|再查|重新核对).{0,8}(?:异常|卡点)|(?:异常|卡点)(?:还有|还剩|怎么样|先|怎么处理)|账(?:款)?(?:差异|对不上)|怎么排|谁先(?:办|处理)|哪个先(?:办|处理)|先找谁|按什么顺序/;
const continueAfterRelease = /(?:接着|继续|续办)(?:处理|办(?:理)?|占库|补占)?/;
const handoffAction = /^(?:确认|提交|发货|出库|拣货|分拣|复核|打包|收款|到账|登记|核销|付款|审批|取消|作废|转派|认领)(?:[^。！？!?]{0,35})[。！？!?]*$/;
const explicitOther = /(?:采购|退货|调拨|盘点|收货)(?:单号|单据|单|任务)|(?<![a-z\d_-])(?:PC|PR|SR|TR|SC|RC|WT)[-_]?\d{6,}(?![a-z\d_-])/i;
export const previousOrderMention = /上一(?:张|单|条)|上张单|前一张|刚才那(?:张|单)|之前那(?:张|单)/;
const orderPattern = /(?<![a-z\d_-])SL[-_]?\d{6,28}(?![a-z\d_-])/gi;
const namedNumber = /销售单号\s*(?:是|为|[：:])?\s*[「『“"]?([a-z][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi;

export function releaseSupplementAnswer(text, pending) {
  const cleaned = text.trim().replace(/[。！？!?]+$/, '').trim();
  if (pending.field === 'batch') {
    const match = /^第\s*([\d零一二两三四五六七八九十百]+)\s*(?:次(?:释放)?|批)$/.exec(cleaned);
    const ordinal = match && quantityNumber(match[1]);
    const selected = pending.choices.find(row => row.ordinal === ordinal);
    if (!match) return null;
    return { action: 'reserve', reapply: true, releaseOrdinal: ordinal, expectedReleaseId: selected?.id,
      invalidBatchSelection: !selected, requested: pending.requested, relativeBatch: pending.relativeBatch };
  }
  const request = { action: 'reserve', reapply: true, releaseOrdinal: pending.ordinal, expectedReleaseId: pending.id };
  if (pending.field === 'line') {
    const match = /^(?:本批)?第\s*([\d零一二两三四五六七八九十百]+)\s*行$/.exec(cleaned);
    return match ? { ...request, requested: { ...pending.requested, line: quantityNumber(match[1]) } } : null;
  }
  const amount = /^(\d+(?:\.\d{1,2})?)\s*([^\d\s元块]{0,12})$/.exec(cleaned);
  return amount ? { ...request, requested: { line: pending.requested?.line, hasAmount: true, qty: Number(amount[1]), unit: amount[2] } } : null;
}

function isHandoffAction(text) {
  const prefix = /(?:那|就|现在|我|来|帮我|替我|请|接着|继续|把|给这单|给这张单|这张单|这单|原单)\s*/y;
  let offset = 0;
  while (prefix.exec(text)) offset = prefix.lastIndex;
  return handoffAction.test(text.slice(offset));
}

export function handoffRequest(text, contextual = false) {
  if (typeof text !== 'string' || text.length > 4000) return null;
  const handoff = handoffWord.test(text);
  const numbers = [...new Set([...(text.match(orderPattern) ?? []),
    ...Array.from(text.matchAll(namedNumber), match => match[1])].map(no => no.toUpperCase()))];
  const otherDocument = explicitOther.test(text);
  const releaseNumbers = /释放/.test(text) ? [...new Set(Array.from(text.matchAll(/第\s*([\d零一二两三四五六七八九十百]+)\s*次/g),
    match => quantityNumber(match[1]) ?? 0))] : [];
  const reapply = /(?:重新|再次|再做|重做)(?:试算)?(?:占库|预占|补占)/.test(text);
  if (!otherDocument && reapply && (contextual || numbers.length || handoff || /释放|撤回|取消占库/.test(text)) && !reserveDeferred.test(text)
      && !/确认|提交/.test(text)) {
    const row = /(?:本批)?第\s*([\d零一二两三四五六七八九十百]+)\s*行/.exec(text);
    const command = row ? text.replace(row[0], '') : text;
    const end = /(?:重新|再次|再做|重做)(?:试算)?(?:占库|预占|补占)([^。！？!?]*)/.exec(command)?.[1].trim().replace(/^[，,：:]\s*/, '');
    const qty = /^([\d.]+)\s*([^\d\s。！？!?，,]*)$/.exec(end ?? '');
    const hasAmount = qty || /^[+－−\-约大概零一二两三四五六七八九十百\d.]/.test(end ?? '');
    const requested = hasAmount || row ? { qty: qty && /^\d+(?:\.\d{1,2})?$/.test(qty[1]) ? Number(qty[1]) : null,
      unit: qty?.[2], hasAmount: Boolean(hasAmount), line: row ? quantityNumber(row[1]) ?? 0 : undefined } : undefined;
    return numbers.length > 1 ? { multiple: true } : { action: 'reserve', no: numbers[0], reapply: true,
      requested, anotherSupplement: /再补一(?:笔|次)|另补一(?:笔|次)|再办一(?:笔|次)/.test(text),
      currentRemainder: /(?:当前|全部)(?:待占量|剩余未占|未占量)/.test(text),
      ...(releaseNumbers.length ? { releaseOrdinal: releaseNumbers[0], batchAmbiguous: releaseNumbers.length > 1 } : {}) };
  }
  const checkReceipt = /(?:没回音|没返回|没响应|结果不明|结果未知|查询?|核对|核实|看一下).{0,16}(?:原(?:占库|请求|提交|任务)(?:的)?(?:回执|结果)|占库结果)/.test(text)
    || /(?:占库|提交|确认).{0,12}(?:没回音|没返回|没响应|没结果|结果不明|结果未知|超时了)/.test(text);
  const repreview = /(?:预览|试算).{0,6}(?:过期|失效).{0,20}(?:重新|重做|再试|再算|续办|继续)/.test(text);
  if (!otherDocument && (contextual || handoff || numbers.length) && !/核销|退款|收款|采购|补录/.test(text)) {
    if (numbers.length > 1 && (checkReceipt || repreview)) return { multiple: true };
    if (checkReceipt) return { action: 'recover', no: numbers[0], checkOnly: true, otherOperator: /同事|他人|别人|上个班的人/.test(text) };
    if (repreview && /占库|预占/.test(text) && !reserveDeferred.test(text)) return { action: 'recover', no: numbers[0] };
  }
  const financialRelease = financeRelease.test(text);
  const reportedRelease = financialRelease || releaseReport.test(text);
  const exception = (contextual || numbers.length > 0 || handoffSubject.test(text) || /^(?:卡点|异常|挂起)/.test(text)) &&
    (reportedRelease || ((contextual || exceptionTopic.test(text)) && followupException.test(text)));
  if ((handoff || exception) && otherDocument && numbers.length) return { multiple: true };
  const batchRead = !/核销|收款|冲回/.test(text) && (numbers.length || contextual)
    && /释放|重占|补占/.test(text) && /核对|查看|查一下|进度|多少|谁(?:来)?补/.test(text);
  const explicit = !otherDocument && (batchRead || (handoff && (numbers.length > 0 || handoffSubject.test(text) || standaloneHandoff.test(text))) || exception);
  const bare = /^(?:销售单号\s*(?:是|为|[：:])?\s*)?[「『“"]?[a-z][a-z\d_-]{0,18}?\d{6,28}[」』”"]?[。！？!?]*$/i.test(text);
  const deferred = reserveDeferred.test(text);
  const action = isHandoffAction(text);
  if (!explicit && !(contextual && (bare || followupRead.test(text) || reserveFollowup.test(text) || action || deferred))) return null;
  if (numbers.length > 1) return { multiple: true };
  const no = numbers[0];
  const reportedFinance = /账(?:款)?(?:差异|对不上|没对上)/.test(text);
  if (reportedRelease && !deferred && continueAfterRelease.test(text) &&
      !/(?:别|不要|不用|先不|暂缓)[^，,。！？!?]{0,8}(?:继续|接着|续办)|确认|提交|发货|核销|收款/.test(text)) {
    return { action: 'recover', no, financeFocus: financialRelease && !/(?:占库|补占|预占)/.test(text) };
  }
  if (contextual && reserveFollowup.test(text)) return { action: 'reserve', no };
  const reserveRequest = explicit && /(?:接着|继续|试算|准备|试占)(?:一下)?(?:给(?:这张|这|本)单)?\s*(?:占库|补占|预占)/.test(text);
  if (reserveRequest && !deferred && !/确认|提交|发货/.test(text)) return { action: 'reserve', no };
  if (action || (explicit && /(?:我来|帮我|替我|直接|接着|继续)[^，,。]{0,6}(?:确认|发货|出库|核销|登记收款|作废|取消|转派|认领)/.test(text))) {
    return { action: 'guide', no };
  }
  return { action: 'read', no, reportedFinance, financeFocus: reportedFinance || financialRelease,
    ...(batchRead && releaseNumbers.length === 1 ? { releaseOrdinal: releaseNumbers[0] } : {}) };
}

const STRIP = /[\p{Cc}\p{Cf}\[\]*]/gu;
const plain = (value, size = 70) => typeof value === 'string' ? value.replace(STRIP, ' ').trim().slice(0, size) : '';
const positive = value => (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value))
  && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const sameNo = (value, no) => typeof value === 'string' && value.toUpperCase() === no;
const scope = (actor, warehouseId) => positive(warehouseId) && (!Array.isArray(actor.warehouseIds) || actor.warehouseIds.map(Number).includes(Number(warehouseId)));
export const SALE_STATES = { 1: '草稿', 2: '已占库', 3: '履约中', 4: '已出库', 5: '已取消', 6: '部分占库' };
const SALE_PROGRESS = {
  1: '销售草稿已建', 2: '销售单已占库', 3: '销售单已进入仓库履约', 4: '销售单已出库',
  5: '销售单已取消', 6: '销售单已办部分占库',
};
const WH_STATES = {
  1: ['待拣货', '仓库拣货岗按任务号开始拣货。', 'warehouse.task.pick'],
  2: ['拣货中', '仓库拣货岗在 PDA 完成拣货。', 'warehouse.task.pick'],
  3: ['待分拣', '仓库分拣岗在 PDA 完成分拣。', 'warehouse.task.sort'],
  4: ['待复核', '仓库复核岗在 PDA 核对实物。', 'warehouse.task.check_done'],
  5: ['待打包', '仓库打包岗在 PDA 完成装箱。', 'warehouse.task.pack_done'],
  6: ['待出库', '仓库出库岗在原作业入口核对包裹并出库。', 'warehouse.task.ship'],
  7: ['已出库', '本仓任务已完成。'],
  8: ['已取消', '本仓任务已终止。'],
};
const ISSUE_RULES = {
  adjust: ['改单等待仓库确认', '仓库改单处理岗核对拆箱或实物归还，业务人员跟进原销售单。'],
  return: ['取消等待实物归还', '仓库归还岗按原任务完成实物归还。'],
  credit: ['授信申请待审批', '授信审批岗按原流程核对申请。'],
  shortage: ['缺货 · 销售供应未覆盖', '销售或客服核对缺量和供货方案，采购可并行核对补货及到货时间。'],
  delay: ['承诺发货日期有风险', '销售或客服核对原单承诺和交期。'],
  'purchase-delay': ['关联采购已延期', '采购核对新到货日期，销售或客服据此跟进交期。'],
};

function quantities(lines) {
  const groups = new Map();
  for (const { qty, unit } of lines) {
    groups.set(unit, (groups.get(unit) ?? 0) + qty);
  }
  return [...groups].map(([unit, qty]) => `${qty / 100}${unit ? ' ' + unit : ''}`).join('、');
}

export function reservationRelease(order, eventId, preview) {
  if (!Array.isArray(order.timeline) || !Array.isArray(order.items)) return null;
  const counts = { reserved: 0, released: 0 };
  const events = order.timeline.filter(event => positive(event.id) && Object.hasOwn(counts, event.eventType))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(event => ({ ...event, ordinal: ++counts[event.eventType] }));
  const start = eventId ? events.find(event => event.eventType === 'reserved' && Number(event.id) === eventId)
    : events.find(event => event.eventType === 'reserved');
  const later = eventId ? (start ? events.filter(event => Number(event.id) > Number(start.id)) : []) : events;
  const releases = later.filter(event => event.eventType === 'released');
  if (!releases.length) return null;
  const reordered = later.some(event => event.eventType === 'reserved' && Number(event.id) > Number(releases[0].id));
  const items = new Map(order.items.map(item => [Number(item.id), item]));
  const amounts = releases.flatMap(event => event.payload?.released ?? []);
  const current = order.items.map(item => ({ qty: Math.round(Number(item.reservedQty) * 100), unit: plain(item.unit, 12) }));
  const valid = current.length > 0 && current.every(item => Number.isSafeInteger(item.qty) && item.qty >= 0);
  let released = releases.every(event => Array.isArray(event.payload?.released) && event.payload.released.length)
    && amounts.every(row => items.has(Number(row.itemId)) && Number.isFinite(Number(row.qty)) && Number(row.qty) > 0)
    ? quantities(amounts.map(row => ({ qty: Math.round(Number(row.qty) * 100), unit: plain(items.get(Number(row.itemId)).unit, 12) }))) : null;
  if (!released && preview && eventId && valid && !reordered && [1, 6].includes(Number(order.status)) && preview.lines?.length === items.size
      && preview.lines.every(line => {
        const item = items.get(Number(line.itemId));
        return item && Number(item.productId) === Number(line.productId) && Number(item.warehouseId ?? order.warehouseId) === Number(line.warehouseId)
          && Math.round(Number(item.quantity) * 100) === Math.round((line.reservedQty + line.remainToReserve) * 100)
          && Number(item.dispatchedQty) === 0 && Number(item.quantity) >= Number(item.reservedQty);
      })) {
    released = quantities(order.items.map(item => ({ qty: Math.round((Number(item.quantity) - Number(item.reservedQty)) * 100), unit: plain(item.unit, 12) })));
  }
  const ops = eventId ? [start, ...later] : later;
  const showQty = row => positive(row?.itemId) && Number.isFinite(Number(row?.qty)) && Number(row.qty) > 0
    && (items.has(Number(row.itemId)) || typeof row.unit === 'string');
  const sequence = ops.length > 2 ? ops.map(event => {
    const kind = event.eventType === 'reserved' ? '占库' : '释放';
    const rows = event.payload?.[event.eventType];
    const amount = Array.isArray(rows) && rows.length && rows.every(showQty)
      ? quantities(rows.map(row => ({ qty: Math.round(Number(row.qty) * 100), unit: plain(row.unit ?? items.get(Number(row.itemId))?.unit, 12) })))
      : '数量待核';
    return `第 ${event.ordinal} 次${kind} ${amount}${eventId === Number(event.id) ? '（原请求）' : ''}`;
  }).join('，') : '';
  const gap = order.items.map((item, index) => ({ unit: current[index].unit, qty: Math.round(Number(item.quantity) * 100) - current[index].qty }));
  const pending = valid && [1, 6].includes(Number(order.status)) && gap.every(row => Number.isSafeInteger(row.qty) && row.qty >= 0)
    ? `，当前待占 ${quantities(gap)}` : '';
  const lastReserve = Number(events.findLast(event => event.eventType === 'reserved')?.id);
  const open = events.filter(event => event.eventType === 'released' && Number(event.id) > lastReserve);
  const batches = order.releaseBatches;
  const progress = Array.isArray(batches) ? batches.map(releaseBatchText) : [];
  return { reordered, batches, releaseCount: releases.length, open: open.map(event => ({ id: Number(event.id), ordinal: event.ordinal })),
    reply: (released ? `原单后续已释放 ${released}` : '原单后续已释放库存，释放量请在原单核对')
    + (reordered ? '，之后有重新占库记录' : '') + (sequence ? '。' + sequence : '')
    + (valid ? `，当前仍占 ${quantities(current)}${pending}。` : '，当前占用数量请在原单核对。')
    + (progress.length ? '\n' + progress.join('\n') : '') };
}

async function saleSource(client, actor, no, trace) {
  const { list } = await collectList(client, '/api/sale/', { keyword: no });
  const found = list.filter(row => sameNo(row.orderNo, no));
  if (!found.length) return null;
  if (found.length !== 1 || !positive(found[0].id)) throw new Error('销售单身份不唯一');
  const id = Number(found[0].id);
  const detail = await client.get(`/api/sale/${id}`);
  if (Number(detail?.id) !== id || !sameNo(detail.orderNo, no) || !Array.isArray(detail.items)) throw new Error('销售单身份无法核对');
  const activeTasks = Array.isArray(detail.tasks) ? detail.tasks.filter(task => Number(task.status) < 7) : [];
  const warehouseIds = [...new Set([detail.warehouseId, ...detail.items.map(item => item.warehouseId ?? detail.warehouseId),
    ...activeTasks.map(task => task.warehouseId)])];
  if (!warehouseIds.every(id => scope(actor, id))) throw new Error('销售单范围无法核对');
  const status = Number(detail.status);
  if (!Object.hasOwn(SALE_STATES, status)) throw new Error('销售状态无法核对');
  const taskIds = Array.isArray(detail.tasks) && detail.tasks.every(task => positive(task.taskId))
    ? [...new Set(detail.tasks.map(task => Number(task.taskId)))] : null;
  let fulfillment;
  try {
    const live = await client.get(`/api/fulfillment/sale/${id}`);
    if (live?.type === 'sale' && Number(live.id) === id && Array.isArray(live.issues)) {
      const open = live.issues.filter(row => ['open', 'processing'].includes(row.status)
        && (row.source === 'manual' || (row.source === 'auto' && row.conditionActive === true)));
      const issues = open.slice(0, 8).map(row => {
        const type = String(row.source_key ?? '').split(':')[0];
        const known = row.source === 'auto' && Object.hasOwn(ISSUE_RULES, type) ? ISSUE_RULES[type] : null;
        const owner = plain(row.ownerName);
        return { type: known ? type : 'other', title: known?.[0] ?? (plain(row.title) || '履约事项'), owner,
          next: known?.[1] ?? (owner ? `登记负责人 ${owner} 到原单履约面板核对。` : '销售或客服到原单履约面板核对。') };
      });
      const confirmedAutomatic = open.filter(row => row.source === 'auto').length;
      const activeKinds = Array.isArray(live.activeIssueKinds) && live.activeIssueKinds.length === live.detectedCount
        ? [...new Set(live.activeIssueKinds)] : null;
      const hasPendingDetection = activeKinds ? activeKinds.some(kind => !Object.hasOwn(ISSUE_RULES, kind))
        : !Number.isSafeInteger(live.detectedCount) || live.detectedCount > confirmedAutomatic;
      fulfillment = { issues, liveKinds: activeKinds?.filter(kind => Object.hasOwn(ISSUE_RULES, kind)) ?? [],
        more: open.length - issues.length, hasPendingDetection };
    }
  } catch { /* 销售详情仍有效，履约事项单独标为待核对。 */ }
  return { id, warehouseIds: warehouseIds.map(Number), status, label: SALE_STATES[status], warehouseName: plain(detail.warehouseName),
    release: reservationRelease(detail),
    pendingDispatch: detail.hasUndispatchedItems === true, pendingReserve: detail.hasUnreservedItems === true,
    holds: [...new Set(activeTasks.flatMap(task => [task.cancelRequestedAt && 'return', task.adjustmentRequestedAt && 'adjust'].filter(Boolean)))],
    held: activeTasks.some(task => task.cancelRequestedAt || task.adjustmentRequestedAt),
    fulfillment, ...(trace ? { traceLines: traceOrderLines(detail.items), taskIds } : {}) };
}

async function warehouseSource(client, actor, no) {
  const { list } = await collectList(client, '/api/warehouse-tasks/', { keyword: no });
  const rows = list.filter(row => row.taskType === 'sale_out' && sameNo(row.saleOrderNo, no) && scope(actor, row.warehouseId));
  if (!rows.length) return null;
  if (rows.some(row => !positive(row.saleOrderId) || !positive(row.id) || !plain(row.taskNo) || !Object.hasOwn(WH_STATES, Number(row.status)))) {
    throw new Error('仓库任务关联无法核对');
  }
  const stages = rows.map(row => {
    const status = Number(row.status);
    const cancellation = status < 7 && Boolean(row.cancelRequestedAt);
    const adjustment = status < 7 && Boolean(row.adjustmentPending || row.adjustmentRequestedAt);
    const assignment = status === 3 && !row.sortingBinId && !cancellation && !adjustment;
    const [label, defaultNext, permission] = WH_STATES[status];
    const required = assignment ? 'warehouse.task.assign' : permission;
    return { id: Number(row.id), no: plain(row.taskNo), warehouseId: Number(row.warehouseId), warehouseName: plain(row.warehouseName),
      status, label, physicalException: cancellation ? 'return' : adjustment ? 'adjust' : undefined,
      hold: cancellation ? '取消待实物归还' : adjustment ? '改单待实物核对' : assignment ? '待分配分拣格' : undefined,
      next: cancellation ? '仓库归还岗按原任务处理，暂缓发货。' : adjustment ? '仓库改单处理岗先核对实物，暂缓原作业。'
        : assignment ? '仓库任务分配岗补分拣格。' : defaultNext,
      actionPermission: !cancellation && !adjustment && required && hasPerm(actor, required) ? required : undefined,
    };
  });
  return { ids: [...new Set(rows.map(row => Number(row.saleOrderId)))],
    warehouseIds: [...new Set(stages.map(row => row.warehouseId))], stages };
}

function balanceUnits(value) {
  if (!/^-?\d+(?:\.\d{1,4})?$/.test(String(value))) return null;
  const scaled = Math.round(Number(value) * 10000);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

async function financeSource(client, no, trace) {
  const { list } = await collectList(client, '/api/payments/', { type: '2', orderNo: no });
  const rows = list.filter(row => Number(row.type) === 2 && sameNo(row.orderNo, no) && positive(row.orderId));
  if (!rows.length) return null;
  const records = rows.map(row => {
    const status = Number(row.status);
    const balance = row.balance == null ? NaN : Number(row.balance);
    const confirmed = row.confirmStatus != null && Number(row.confirmStatus) === 1;
    const [total, paid, due] = [row.totalAmount, row.paidAmount, row.balance].map(balanceUnits);
    const validAmounts = [total, paid, due].every(value => value !== null);
    const expectedBalance = validAmounts && total >= 0 && paid >= 0 ? Math.max(total - paid, 0) : null;
    const statusMismatch = status === 3 && due > 0 || [1, 2].includes(status) && due === 0;
    const discrepancy = confirmed && validAmounts
      && (expectedBalance == null || due !== expectedBalance || statusMismatch);
    const difference = expectedBalance == null ? null : due - expectedBalance;
    const label = !confirmed ? '待财务确认' : discrepancy ? '账款差异待核对' : status === 3 && balance === 0 ? '已收清'
      : status === 1 && balance > 0 ? '未收' : status === 2 && balance > 0 ? '部分收款' : '账款状态待核对';
    return { label, ...(Number.isFinite(balance) ? { balance } : {}),
      ...(trace ? { id: positive(row.id) ? Number(row.id) : null, totalAmount: row.totalAmount, paidAmount: row.paidAmount } : {}),
      ...(discrepancy ? { discrepancy, totalAmount: Number(row.totalAmount), paidAmount: Number(row.paidAmount),
        ...(Number.isSafeInteger(difference) ? { expectedBalance: expectedBalance / 10000, balanceDifference: difference / 10000 } : {}),
        ...(statusMismatch ? { statusMismatch } : {}) } : {}) };
  });
  return { ids: [...new Set(rows.map(row => Number(row.orderId)))], records };
}

function saleNext(sale) {
  if (sale.status === 4) return '已出库，可由财务按原单核对关联应收。';
  if (sale.status === 5) return '销售单已取消，原销售单无需继续派发或占库。';
  if (sale.held || sale.fulfillment?.issues.some(issue => ['adjust', 'return'].includes(issue.type))) return '仓库先处理原任务的实物归还或改单，销售或客服跟进原单。';
  const blocking = sale.fulfillment?.issues.filter(issue => issue.type === 'other');
  if (blocking?.length) return [...new Set(blocking.map(issue => issue.next))].join('');
  if (!sale.fulfillment || sale.fulfillment.hasPendingDetection) return '销售或客服先核对原单履约面板。';
  if (sale.status === 1 || sale.status === 6) return '销售岗核对原单并按权限试占或补占。';
  if (sale.status === 2 || sale.pendingDispatch) return '有派发权限的销售岗在原单派发仓库任务。';
  if (sale.pendingReserve) return '销售岗核对剩余未占部分，仓库继续各自已派发批次。';
  return '仓库按已派发任务核对当前执行环节。';
}

const exceptionOrder = ['return', 'adjust', 'credit', 'shortage'];
const exceptionNames = { return: '实物归还', adjust: '改单实物核对', credit: '授信待审批', shortage: '缺货' };

export async function readSaleHandoff(client, actor, no, financeFocus = false, trace) {
  const readers = { sale: () => saleSource(client, actor, no, trace), warehouse: () => warehouseSource(client, actor, no),
    finance: () => financeSource(client, no, trace), ...(trace ? { returns: () => saleReturnSource(client, actor, no) } : {}) };
  const keys = Object.keys(readers).filter(key => (!trace?.kind || key === trace.kind) && hasPerm(actor, HANDOFF_PERMISSIONS[key]));
  if (trace?.targetNo && !keys.length) return { reply: '当前账号没有该类关联单据的查看权限。请交给对应岗位核对同一张销售单。' };
  const outcomes = await Promise.allSettled(keys.map(key => readers[key]()));
  const loaded = Object.fromEntries(keys.map((key, i) => [key, outcomes[i].status === 'fulfilled' ? outcomes[i].value : null]));
  const { sale, warehouse, finance, returns } = loaded;
  const linked = {
    sale: sale ? [sale.id] : [], warehouse: warehouse?.ids ?? [], finance: finance?.ids ?? [], returns: returns?.ids ?? [],
  };
  const ids = new Set(Object.values(linked).flat());
  if (!ids.size) return { reply: '当前权限和仓库范围内未能核实这张销售单的交接事实。请在有权访问的原页面核对完整销售单号。' };
  if (ids.size > 1) {
    const names = { sale: '销售单', warehouse: '仓库任务', finance: '客户应收', returns: '销售退货' };
    const next = {
      sale: '销售或客服核对原销售单。',
      warehouse: '仓库核对原任务的销售来源。',
      finance: '财务在[[客户往来|/payments/receivable]]核对原应收的销售来源。',
      returns: '销售或仓库在[[销售退货|/returns/sale]]核对该退货单的销售来源。',
    };
    const involved = sale ? ['sale', ...keys.filter(key => key !== 'sale' && linked[key].some(id => id !== sale.id))]
      : keys.filter(key => linked[key].length);
    return { reply: `原销售单 ${no} 的${involved.map(key => names[key]).join('、')}关联不一致。`
      + involved.map(key => next[key]).join('') };
  }

  const sources = keys.filter(key => Boolean(loaded[key]));
  const warehouseIds = [...new Set([...(sale?.warehouseIds ?? []), ...(warehouse?.warehouseIds ?? []), ...(returns?.warehouseIds ?? [])])];
  const result = { orderNo: no, sources };
  const documentId = [...ids][0];
  const traced = trace ? await buildSaleTrace(client, actor, loaded, documentId, no, trace) : null;
  if (traced?.missing) return { documentId, reply: traced.missing };
  if (traced) result.trace = traced.result;
  if (trace?.kind === 'returns' && traced?.result.returns?.rows.length === 1 && traced.result.returns.rows[0].id) {
    result.returnId = traced.result.returns.rows[0].id;
  }
  if (trace?.targetNo) {
    return { result, documentId, warehouseIds, actionPermissions: [...traced.actionPermissions], reply: [
      `销售单 ${no} · 关联追查`, '已办：' + traced.facts.join(' '),
      '卡点：' + (traced.blockers.join(' ') || '当前关联记录未发现待处理卡点。'),
      '下一步：' + (traced.next.join(' ') || '有需要可再核对原单当前进度。'),
    ].join('\n') };
  }
  const done = [], blockers = [], next = [], scopeNotes = [], actionPermissions = new Set(traced?.actionPermissions);
  const observed = new Set([
    ...(sale?.holds ?? []), ...(sale?.fulfillment?.liveKinds ?? []), ...(sale?.fulfillment?.issues.map(issue => issue.type) ?? []),
    ...(warehouse?.stages.map(row => row.physicalException).filter(Boolean) ?? []),
  ]);
  const ordered = exceptionOrder.filter(type => observed.has(type));
  const financeMismatch = finance?.records.some(row => row.discrepancy);
  const priority = ordered.map(type => exceptionNames[type]);
  if (ordered.length) {
    blockers.push(...ordered.map(type => ISSUE_RULES[type][0] + '。'));
    next.push(...ordered.map(type => ISSUE_RULES[type][1]));
  }
  if (sale) {
    result.orderId = sale.id;
    result.sale = { status: sale.status, label: sale.label, warehouseName: sale.warehouseName };
    done.push(SALE_PROGRESS[sale.status] + (sale.warehouseName ? '，单头仓 ' + sale.warehouseName : '') + '。');
    if (sale.release) {
      result.sale.reservationReleased = true;
      done.push(sale.release.reply);
      next.push('销售岗先核对原释放原因，需要恢复时重新试算。');
    }
    if (sale.fulfillment?.issues.length) {
      blockers.push(sale.fulfillment.issues.map(issue => issue.title + (issue.owner ? `（登记负责人 ${issue.owner}）` : '')).join('；') +
        (sale.fulfillment.more ? '；另有未展示事项，请在原单核对。' : '。'));
      next.push(...sale.fulfillment.issues.map(issue => issue.next));
    }
    if (sale.held) blockers.push('销售详情有仓库挂起记录，需先核对原任务。');
    if (!sale.fulfillment || sale.fulfillment.hasPendingDetection) blockers.push('履约事项未能完整复核，请到原单核对当前原因。');
    if (!ordered.length && !financeFocus) {
      if (sale.status !== 3 || !warehouse) next.push(saleNext(sale));
      else if (sale.pendingDispatch) next.push('销售岗核对本单尚未派发的部分。');
      else if (sale.pendingReserve) next.push('销售岗核对剩余未占部分。');
    }
  } else scopeNotes.push('销售单整单状态未核实');
  if (warehouse) {
    const stages = warehouse.stages;
    result.warehouse = { tasks: stages.slice(0, 6).map(({ no, warehouseName, status, label, hold }) => ({ no, warehouseName, status, label, hold })),
      totalVisible: stages.length };
    done.push('已派发到当前可见仓库的任务 ' + stages.length + ' 条。');
    if (!trace) done.push(stages.slice(0, 6).map(row => `${row.no} ${row.warehouseName} ${row.label}`).join('；') + '。');
    for (const row of stages.slice(0, 6)) {
      if (row.hold || row.status < 7) blockers.push(`${row.no} ${row.hold || row.label}。`);
      if (row.status < 7) {
        const orderHold = !row.physicalException && (observed.has('return') || observed.has('adjust'));
        const creditHold = !row.physicalException && row.status === 6 && observed.has('credit');
        if (orderHold || creditHold) {
          next.push(`${row.no} 先由对应岗位解除本单挂起或审批，再核对原仓库任务。`);
        } else {
          next.push(`${row.no} ${row.next}${row.actionPermission ? '当前账号可按原作业入口继续。' : ''}`);
          if (row.actionPermission) actionPermissions.add(row.actionPermission);
        }
      }
    }
    if (stages.length > 6) scopeNotes.push('其余可见任务请在原仓库入口核对');
  } else scopeNotes.push('仓库任务未核实');
  if (finance) {
    result.finance = { records: finance.records.slice(0, 6) };
    done.push('财务已核对本单关联应收 ' + finance.records.length + ' 笔。');
    for (const row of finance.records.slice(0, 6)) {
      const line = `关联应收${row.label}${row.balance == null ? '' : `，余额 ¥${row.balance}`}。`;
      if (row.label === '已收清') done.push(line);
      else if (row.discrepancy) {
        const amount = value => '¥' + value.toLocaleString('zh-CN', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 4 });
        const difference = row.balanceDifference;
        const proof = Number.isFinite(difference) && difference !== 0
          ? `按应收减已收应余 ${amount(row.expectedBalance)}，账面${difference > 0 ? '多' : '少'} ${amount(Math.abs(difference))}。` : '';
        blockers.push(`账款差异：应收 ${amount(row.totalAmount)}，已收 ${amount(row.paidAmount)}，账面余额 ${amount(row.balance)}。`
          + proof + (row.statusMismatch ? '账款状态与账面余额不一致。' : ''));
      } else blockers.push(line);
    }
    if (financeMismatch) next.push('财务先核对原应收、到账与核销明细，确认差异后再办理该笔款。[[客户往来|/payments/receivable]]');
    else if (finance.records.some(row => row.label !== '已收清')) next.push('财务核对本单应收和实际到账，按原账款继续。[[客户往来|/payments/receivable]]');
    else next.push('本单可见的关联应收已收清，财务侧无需继续收款。');
  } else scopeNotes.push('关联应收未核实');
  if (trace && !returns) scopeNotes.push('关联退货未核实');
  if (outcomes.some(row => row.status === 'rejected')) scopeNotes.push('部分来源暂未返回可核对结果');

  const canReserveAtStage = sale && ([1, 6].includes(sale.status) || (sale.status === 3 && sale.pendingReserve));
  const reserveReady = Boolean(canReserveAtStage && !sale.held && sale.fulfillment
    && !sale.fulfillment.hasPendingDetection && sale.fulfillment.more === 0
    && !ordered.length && !observed.has('other'));
  if (reserveReady && !financeFocus && hasPerm(actor, 'sale.order.reserve')) {
    next.push(sale.release?.open.length ? '确认要恢复占用时，可说「按当前待占量重新占库」。' : '当前账号可说「接着占库」，先试算这张原单。');
    actionPermissions.add('sale.order.reserve');
  }
  return { result, documentId, warehouseIds, reserveReady, releaseHistory: sale?.release, financeMismatchOnly: financeMismatch && !ordered.length,
    actionPermissions: [...actionPermissions], reply: [
    `销售单 ${no} · ${trace ? '关联追查' : '交接'}`,
    '已办：' + done.join(' '),
    ...(traced?.facts ?? []),
    '卡点：' + ([...new Set([...blockers, ...(traced?.blockers ?? [])])].join(' ') || '目前未查到已证实的阻塞。'),
    ...(priority.length || financeMismatch ? [
      '处理顺序：' + (priority.length ? '先处理' + priority.join('，随后核对') + '。' : '')
        + (financeMismatch ? (priority.length ? '财务可并行核对账款差异。' : '财务先核对账款差异。') : ''),
    ] : []),
    '下一步：' + ([...new Set([...next, ...(traced?.next ?? [])])].join(' ') || '可见记录未显示待执行步骤，需核对其余环节时请找对应岗位。'),
    '核对范围：' + (scopeNotes.length ? scopeNotes.join('；') + '。'
      : trace ? '销售、可见仓库任务、关联退货与应收核销。' : '销售、可见仓库任务及关联应收。'),
  ].join('\n') };
}
