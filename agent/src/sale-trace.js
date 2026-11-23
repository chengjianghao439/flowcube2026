import { collectList } from './pagination.js';
import { hasPerm } from './perms.js';

const saleNumbers = /(?<![a-z\d_-])SL[-_]?\d{6,28}(?![a-z\d_-])/gi;
const namedSale = /销售单号\s*(?:是|为|[：:])?\s*[「『“"]?([a-z][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi;
const linkedNumbers = /(?<![a-z\d_-])(?:WT|SR|RT|RC)[-_]?\d{6,28}(?![a-z\d_-])/gi;
const traceVerb = /追查|追溯|串起来|沿.{0,12}(?:单|单据)|一路查|按原单/;
const related = /仓库任务|分批|多少批|哪几批|部分退货|退货|收款|核销|实发|未发/;
const subject = /销售单|销售订单|这张单|这单|原单/;
const targetKind = no => ({ WT: 'warehouse', SR: 'returns', RT: 'returns', RC: 'finance' })[no?.slice(0, 2)];
const targetNames = { warehouse: '仓库任务', returns: '退货单或退货任务', finance: '收款单' };
const DETAIL_LIMIT = 8;
const values = (text, pattern) => [...new Set((text.match(pattern) ?? []).map(no => no.toUpperCase()))];
const plain = value => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}\[\]*]/gu, ' ').trim().slice(0, 70) : '';
const exact = (value, no) => typeof value === 'string' && value.toUpperCase() === no;
const id = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const scoped = (actor, warehouseId) => id(warehouseId) != null && (!Array.isArray(actor.warehouseIds) || actor.warehouseIds.map(Number).includes(Number(warehouseId)));

export function saleTraceRequest(text, contextual = false) {
  const sales = [...new Set([...values(text, saleNumbers), ...Array.from(text.matchAll(namedSale), match => match[1].toUpperCase())])];
  const links = values(text, linkedNumbers);
  const asks = /(?:查|看|核对|跟进|继续|接着|办理|处理)|^(?:WT|SR|RT|RC)/i.test(text);
  const explicit = (sales.length > 0 || subject.test(text)) &&
    ((traceVerb.test(text) && related.test(text)) || (asks && (links.length || /分批发货|分笔收款|部分退货|收款核销明细|仓库批次|还剩多少没发/.test(text))));
  const ordinal = /第[一二两三四五六七八九十\d]+(?:个|批|笔|张)/.test(text);
  const follow = contextual && ((asks && (links.length || ordinal || (related.test(text) && !/开单|登记收款|重新开/.test(text))))
    || /^(?:这单|原单|这张单)?\s*(?:还剩多少没发|(?:之前)?发了(?:多少|几批)|实发多少|收了(?:多少|几笔)|核销了?多少|退了多少)[。！？!?]*$/.test(text));
  if (!explicit && !follow) return null;
  if (sales.length > 1) return { multiple: true, trace: {} };
  if (links.length > 1 || (ordinal && !links.length)) {
    const kind = /批|仓库/.test(text) ? 'warehouse' : /退货/.test(text) ? 'returns' : /收款|核销/.test(text) ? 'finance' : null;
    return { action: 'read', no: sales[0], trace: {}, question: kind
      ? '请给出要接着查的完整' + targetNames[kind] + '号。'
      : '请给出要接着查的完整关联单号（仓库任务、退货单或收款单）。', targetClarification: true };
  }
  const [targetNo] = links;
  const lane = /(?:只查|只看|单看|专查)(仓库|发货|退货|收款|核销)/.exec(text)?.[1];
  const kind = lane === '退货' ? 'returns' : /收款|核销/.test(lane ?? '') ? 'finance' : lane ? 'warehouse' : undefined;
  return { action: 'read', no: sales[0], trace: { targetNo, kind: targetKind(targetNo) ?? kind } };
}

function scaled(value, precision) {
  if (value == null || !/^\d+(?:\.\d+)?$/.test(String(value)) || String(value).split('.')[1]?.length > precision) return null;
  const units = Math.round(Number(value) * (10 ** precision));
  return Number.isSafeInteger(units) ? units : null;
}
const qty = value => scaled(value, 2);
const money = value => scaled(value, 4);
const cashText = (value) => '¥' + value / 10000;

/** 汇总只在同一商品的同一基本单位内进行。 */
function aggregate(items, fields) {
  if (!Array.isArray(items) || !items.length) throw new Error('数量明细未核实');
  const groups = new Map();
  for (const item of items) {
    const productId = id(item.productId), name = plain(item.productName), unit = plain(item.unit);
    const amounts = Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, qty(item[column])]));
    if (!productId || !name || !unit || Object.values(amounts).some(amount => amount == null)) throw new Error('数量或单位未核实');
    const key = productId + '|' + unit;
    const row = groups.get(key) ?? { productId, name, unit };
    for (const [field, value] of Object.entries(amounts)) row[field] = (row[field] ?? 0) + value;
    groups.set(key, row);
  }
  return [...groups.values()];
}

export function traceOrderLines(items) {
  try {
    const rows = aggregate(items, { ordered: 'quantity', dispatched: 'dispatchedQty', shipped: 'shippedQty' });
    if (rows.some(row => row.shipped > row.ordered || row.shipped > row.dispatched)) return null;
    return rows;
  } catch { return null; }
}

export async function traceWarehouses(client, actor, warehouse, originalId, no, targetNo) {
  const matches = warehouse.stages.filter(row => !targetNo || exact(row.no, targetNo));
  const items = await Promise.allSettled(matches.slice(0, DETAIL_LIMIT).map(async row => {
    const detail = await client.get('/api/warehouse-tasks/' + row.id);
    if (id(detail?.id) !== row.id || !exact(detail.taskNo, row.no.toUpperCase()) || detail.taskType !== 'sale_out'
      || id(detail.saleOrderId) !== originalId || !exact(detail.saleOrderNo, no) || !scoped(actor, detail.warehouseId)
      || Number(detail.warehouseId) !== row.warehouseId || Number(detail.status) !== row.status) throw new Error('批次关联或状态变化');
    if (row.status === 7 && !detail.shippedAt) throw new Error('实出未核实');
    const lines = aggregate(detail.items, { planned: 'requiredQty', picked: 'pickedQty' });
    if (lines.some(item => item.picked > item.planned)) throw new Error('批次数量未对平');
    return { ...row, lines };
  }));
  return { total: matches.length, rows: items.map((entry, i) => entry.status === 'fulfilled' ? entry.value : { ...matches[i], incomplete: true }),
    incomplete: matches.length > DETAIL_LIMIT || items.some(entry => entry.status === 'rejected') };
}

const returnState = { 1: '草稿', 2: '已确认', 3: '已执行', 4: '已取消' };
const returnStage = {
  1: ['待收货', '仓库退货收货岗按原退货任务收货。'],
  2: ['收货中', '仓库退货收货岗核对本批收货。'],
  3: ['待质检', '仓库质检岗核对合格与拒收数量。'],
  4: ['待上架', '仓库上架岗按原任务处理已质检合格件。'],
  5: ['已完成', '已完成本批入仓。'],
  6: ['已取消', '核对原退货单状态。'],
  7: ['反向处理中', '仓库按原返货出库任务办理。'],
};

export async function saleReturnSource(client, actor, no) {
  const { list } = await collectList(client, '/api/returns/sale', { saleOrderNo: no });
  const rows = list.filter(row => exact(row.saleOrderNo, no) && id(row.saleOrderId) && id(row.id)
    && scoped(actor, row.warehouseId) && plain(row.returnNo));
  return { rows, ids: [...new Set(rows.map(row => Number(row.saleOrderId)))], warehouseIds: rows.map(row => Number(row.warehouseId)) };
}

export async function traceReturns(client, actor, source, originalId, no, targetNo) {
  const byTask = targetNo?.startsWith('RT');
  const matches = source.rows.filter(row => !targetNo || byTask || exact(row.returnNo, targetNo));
  const checked = await Promise.allSettled(matches.slice(0, DETAIL_LIMIT).map(async row => {
    const detail = await client.get('/api/returns/sale/' + row.id + '?trace=1');
    if (id(detail?.id) !== id(row.id) || !exact(detail.returnNo, row.returnNo.toUpperCase())
      || !exact(detail.saleOrderNo, no) || id(detail.saleOrderId) !== originalId
      || !scoped(actor, detail.warehouseId) || id(detail.warehouseId) !== id(row.warehouseId)
      || !Object.hasOwn(returnState, detail.status)) throw new Error('退货关联未核实');
    const taskNo = plain(detail.task?.taskNo);
    if (byTask && !exact(taskNo, targetNo)) return null;
    const status = Number(detail.status);
    const result = { id: id(detail.id), no: plain(detail.returnNo), status, label: returnState[status],
      planned: aggregate(detail.items, { requested: 'quantity' }), taskNo,
      plannedAmount: money(detail.totalAmount), executedAmount: status === 3 ? money(detail.executedAmount) : null,
      isReverse: Boolean(detail.reverseTask && [1, 2, 3, 4, 5, 6].includes(Number(detail.reverseTask.status))) };
    if (!id(detail.task?.id)) return result;
    try {
      const task = await client.get('/api/return-tasks/' + detail.task.id);
      if (id(task?.id) !== id(detail.task.id) || task.returnType !== 'sale' || id(task.returnId) !== result.id
        || !exact(task.returnNo, detail.returnNo.toUpperCase()) || !exact(task.taskNo, taskNo.toUpperCase())
        || id(task.warehouseId) !== id(detail.warehouseId) || Number(task.status) !== Number(detail.task.status)
        || !Object.hasOwn(returnStage, task.status)) throw new Error('退货任务关联未核实');
      result.stage = Number(task.status);
      result.execution = aggregate(task.items, { received: 'receivedQty', passed: 'putawayQty', rejected: 'rejectedQty' });
      if (result.execution.some(item => item.passed + item.rejected > item.received)) throw new Error('退货数量未对平');
    } catch { return { ...result, execution: undefined, incomplete: true }; }
    return result;
  }));
  const rows = checked.flatMap((entry, i) => entry.status === 'fulfilled' ? entry.value ? [entry.value] : []
    : byTask ? [] : [{ no: plain(matches[i].returnNo), incomplete: true }]);
  return { total: byTask ? rows.length : matches.length, rows,
    incomplete: matches.length > DETAIL_LIMIT || checked.some(entry => entry.status === 'rejected') || rows.some(row => row.incomplete) };
}

export async function traceFinance(client, finance, originalId, no, targetNo) {
  const results = await Promise.allSettled(finance.records.slice(0, DETAIL_LIMIT).map(async record => {
    if (!record.id) throw new Error('原应收身份未核实');
    const rows = await client.get('/api/payments/' + record.id + '/entries?trace=1');
    if (!Array.isArray(rows) || new Set(rows.map(entry => id(entry.id))).size !== rows.length
      || rows.some(entry => !id(entry.id) || id(entry.recordId) !== record.id || money(entry.amount) == null
        || (entry.receiptId != null && !id(entry.receiptId)))) {
      throw new Error('原应收分录未核实');
    }
    const settled = rows.map(entry => ({
      id: id(entry.id), recordId: record.id, receiptId: id(entry.receiptId), receiptNo: plain(entry.receiptNo), amount: money(entry.amount),
    }));
    return { ...record, entries: settled };
  }));
  const records = finance.records.slice(0, DETAIL_LIMIT).map((record, i) => results[i].status === 'fulfilled'
    ? results[i].value : { ...record, incomplete: true });
  const entries = records.flatMap(record => record.entries ?? []);
  const linked = new Map();
  for (const entry of entries) if (entry.receiptId && (!targetNo || !entry.receiptNo || exact(entry.receiptNo, targetNo))) {
    if (!linked.has(entry.receiptId)) linked.set(entry.receiptId, []);
    linked.get(entry.receiptId).push(entry);
  }
  const details = await Promise.allSettled([...linked].slice(0, DETAIL_LIMIT).map(async ([receiptId, originalEntries]) => {
    const detail = await client.get('/api/payments/receipts/' + receiptId);
    const receiptNo = plain(detail?.receiptNo);
    if (id(detail?.id) !== receiptId || Number(detail.type) !== 2 || !receiptNo || !Array.isArray(detail.settlements)
      || originalEntries.some(entry => entry.receiptNo && !exact(entry.receiptNo, receiptNo.toUpperCase()))) throw new Error('原收款单未核实');
    if (targetNo && !exact(receiptNo, targetNo)) return null;
    const allocations = new Map(detail.settlements.map(row => [id(row.entryId), row]));
    if (allocations.size !== detail.settlements.length || originalEntries.some(entry => {
      const row = allocations.get(entry.id);
      return id(row?.recordId) !== entry.recordId || id(row.orderId) !== originalId || !exact(row.orderNo, no)
        || Number(row.type) !== 2 || money(row.amount) !== entry.amount;
    })) throw new Error('本单核销分录关联未核实');
    const balance = money(detail.balance);
    return { no: receiptNo, id: receiptId, applied: originalEntries.reduce((n, entry) => n + entry.amount, 0), balance };
  }));
  const receipts = details.flatMap(entry => entry.status === 'fulfilled' && entry.value ? [entry.value] : []);
  return { records, receipts, directTotal: entries.filter(entry => !entry.receiptId).reduce((n, entry) => n + entry.amount, 0),
    incomplete: finance.records.length > DETAIL_LIMIT || results.some(row => row.status === 'rejected')
      || linked.size > DETAIL_LIMIT || details.some(row => row.status === 'rejected') };
}

const amount = (value, description) => value == null ? description + '未核实' : description + ' ' + cashText(value);
const perLine = (rows, format) => rows.map(item => item.name + ' ' + format(item, n => (n / 100) + ' ' + item.unit)).join('、');

function shipmentTotalsAgree(sale, rows) {
  const actual = new Map();
  const key = item => item.productId + '|' + item.unit;
  for (const batch of rows) if (batch.status === 7) {
    for (const item of batch.lines) actual.set(key(item), (actual.get(key(item)) ?? 0) + item.picked);
  }
  for (const item of sale.traceLines) {
    if ((actual.get(key(item)) ?? 0) !== item.shipped) return false;
    actual.delete(key(item));
  }
  return ![...actual.values()].some(value => value !== 0);
}

export async function buildSaleTrace(client, actor, loaded, originalId, no, request) {
  const { sale, warehouse, returns, finance } = loaded;
  const { targetNo, kind } = request;
  const [ship, back, cash] = await Promise.all([
    warehouse ? traceWarehouses(client, actor, warehouse, originalId, no, targetNo) : null,
    returns ? traceReturns(client, actor, returns, originalId, no, targetNo) : null,
    finance ? traceFinance(client, finance, originalId, no, targetNo) : null,
  ]);
  const facts = [], blockers = [], next = [];
  const actionPermissions = new Set();
  const result = {};
  if (targetNo && ((kind === 'warehouse' && !ship?.rows.some(row => !row.incomplete))
    || (kind === 'returns' && !back?.rows.some(row => row.id))
    || (kind === 'finance' && !cash?.receipts.length))) {
    return { missing: '当前原单范围内未能核实该' + targetNames[kind] + '的关联。请核对完整关联单号，或从有权限的原页面查证。' };
  }
  if (sale) {
    if (sale.traceLines) {
      result.sale = sale.traceLines;
      facts.push('销售明细：' + perLine(sale.traceLines, (r, q) => '订购 ' + q(r.ordered) + '，已派发 ' + q(r.dispatched)
        + '，实发 ' + q(r.shipped) + '，未发 ' + q(r.ordered - r.shipped)
        + '，其中未派发 ' + q(Math.max(0, r.ordered - r.dispatched))) + '。');
    } else blockers.push('销售明细数量未能完整核对。');
  }
  if (ship) {
    result.warehouse = { total: ship.total, rows: ship.rows, incomplete: ship.incomplete };
    for (const row of ship.rows) {
      facts.push(row.no + ' ' + row.warehouseName + ' · ' + row.label + (row.incomplete ? '，批次数量待核对' : '，'
        + perLine(row.lines, (r, q) => '批次计划 ' + q(r.planned) + '，' + (row.status === 7 ? '实出 ' : '已拣 ') + q(r.picked))) + '。');
      if (row.status < 7) {
        blockers.push(row.no + ' ' + (row.hold || row.label) + '。');
        if (targetNo) {
          const canShip = row.actionPermission === 'warehouse.task.ship';
          next.push(row.next + (canShip ? '[[发货出库|/warehouse-shipping]]' : ''));
          if (canShip) actionPermissions.add(row.actionPermission);
        }
      }
    }
    if (ship.incomplete) blockers.push('部分可见批次还需在原仓库任务核对。');
    if (sale?.traceLines && sale.taskIds && !ship.incomplete && sale.taskIds.length === ship.rows.length
      && ship.rows.every(row => sale.taskIds.includes(row.id)) && !shipmentTotalsAgree(sale, ship.rows)) {
      blockers.push('销售明细的实发量与已出库批次暂未对平，销售与仓库应复核原单和各批次。');
    }
  }
  if (back) {
    result.returns = back;
    if (!back.total) facts.push('当前可见退货范围未查到关联退货。');
    for (const row of back.rows) {
      if (!row.id) {
        blockers.push(row.no + ' 退货详情未核实。');
        continue;
      }
      let line = row.no + ' · ' + row.label + '，' + perLine(row.planned, (r, q) => '申请 ' + q(r.requested));
      if (row.execution) line += '，' + perLine(row.execution, (r, q) => '实收 ' + q(r.received) + '，'
        + (row.status === 4 ? '历史入仓 ' : '已入仓 ') + q(r.passed) + '，拒收 ' + q(r.rejected));
      if (row.status === 3) line += '，' + amount(row.executedAmount, '实际冲减');
      if ([1, 2].includes(row.status)) line += '，' + amount(row.plannedAmount, '预计退货金额');
      facts.push(line + '。');
      if (row.status === 1) {
        blockers.push(row.no + ' 草稿待确认。');
        if (hasPerm(actor, 'return.order.confirm')) {
          next.push(row.no + ' 当前账号可在原退货单核对后继续确认。');
          actionPermissions.add('return.order.confirm');
        } else next.push(row.no + ' 由有退货确认权限的销售岗核对原退货单。');
      } else if (row.status === 2) {
        const stage = row.isReverse ? returnStage[7] : returnStage[row.stage];
        blockers.push(row.no + ' ' + (stage?.[0] ?? '仓库阶段未核实') + '。');
        next.push(row.no + ' ' + (stage?.[1] ?? '销售或客服在原退货单核对仓库任务。'));
      } else if (row.status === 3 && (row.executedAmount == null || !row.execution)) {
        blockers.push(row.no + ' 实际入仓或冲减证据尚待核对。');
      }
    }
    if (back.incomplete) blockers.push('部分可见退货事实需打开原退货单核实。');
  }
  if (cash) {
    result.finance = { receipts: cash.receipts, incomplete: cash.incomplete };
    if (!targetNo) {
      for (const record of cash.records) {
        facts.push('原单关联应收：' + [amount(money(record.totalAmount), '应收'), amount(money(record.paidAmount), '已收'),
          amount(money(record.balance), '未结')].join('，') + '。');
        if (record.entries && record.entries.reduce((n, e) => n + e.amount, 0) !== money(record.paidAmount)) blockers.push('原应收已收与核销分录未对平。');
      }
      if (cash.directTotal) facts.push('原账款直接登记 ' + cashText(cash.directTotal) + '。');
    }
    for (const row of cash.receipts) facts.push(row.no + ' 本单核销 ' + cashText(row.applied)
      + (row.balance > 0 ? '，该收款单尚有 ' + cashText(row.balance) + ' 未分配，归属待财务核对' : '') + '。');
    if (cash.incomplete) blockers.push('部分收款分录或与原单的关联未核实。');
    if (cash.incomplete || cash.receipts.some(row => row.balance > 0) || cash.records.some(row => row.balance > 0 || row.discrepancy)) {
      const mayContinue = cash.receipts.length > 0 && hasPerm(actor, 'payment.execute');
      if (mayContinue) actionPermissions.add('payment.execute');
      const guide = !cash.receipts.length ? '请财务先在原应收核对到账和收款凭证。'
        : mayContinue ? '当前账号可在原收款单核对后按正式流程办理。' : '请由财务在原收款单核对。';
      next.push(guide + '先对照本单未结应收、到账和已做的核销，再决定是否继续。[[客户往来|/payments/receivable]]');
    }
  }
  return { result, facts, blockers, next, actionPermissions };
}
