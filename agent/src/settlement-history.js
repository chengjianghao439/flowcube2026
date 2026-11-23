import { cashUnits, receiptEntriesMatch, receiptEntryIdentity, receiptMovements, receiptMovementText, signedCashUnits } from './receipt-allocation.js';
import { reversalBatchText } from './reapply-progress.js';
import { exactStatement, statementEvidence } from './monthly-reconciliation.js';

const yuan = cents => '¥' + (cents / 100).toFixed(2);
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function captureSettlementEntries(task, data) {
  if (!Array.isArray(data?.applied) || data.applied.length !== task.preview?.allocations?.length) return;
  const byRecord = new Map(data.applied.map(row => [Number(row.recordId), Number(row.entryId)]));
  const ids = task.preview.allocations.map(row => byRecord.get(Number(row.recordId)));
  if (ids.every(positive) && new Set(ids).size === ids.length) task.settlementEntryIds = ids;
}

export function settlementReapplyLinks(store, actor, receiptId) {
  const links = new Map(), collisions = new Set();
  for (const page of store.pagesForActor(actor)) for (const task of page) {
    const source = task.preview?._reversalSource;
    const posted = task.settlementEntryIds?.[0];
    if (task.graph !== 'D-settle' || task.state !== 'DONE' || !positive(posted) || !positive(source?.id)
        || Number(task.result?.receiptId) !== receiptId || Number(task.preview?.receiptId) !== receiptId
        || task.preview.allocations?.length !== 1 || collisions.has(posted)) continue;
    if (links.has(posted) && links.get(posted) !== source.id) {
      links.delete(posted);
      collisions.add(posted);
    } else links.set(posted, source.id);
  }
  return links;
}

function traceAllocation(movements, originalId, links) {
  let available = 0, min = 0, max = 0, postedSince = 0, firstReversal = false, unassigned = 0;
  const batches = new Map(), ambiguous = [], reversalTotals = new Map();
  for (const movement of movements) {
    const { units, id, ordinal } = movement;
    if (units > 0) {
      if (id === originalId) min = max = units;
      if (firstReversal) postedSince += units;
      const linked = links.get(id);
      const budget = reversalTotals.get(linked);
      if (linked && budget >= units) {
        reversalTotals.set(linked, budget - units);
        const batch = batches.get(linked);
        if (batch) batch.linkedCents += units;
      } else unassigned += units;
    } else {
      const amount = -units;
      reversalTotals.set(id, amount);
      // 冲回可来自同组仍有效的任一笔核销。只有上下界相同，才确认本次原核销被冲回的金额。
      const low = Math.max(0, amount - (available - min)), high = Math.min(max, amount);
      if (id > originalId) {
        firstReversal = true;
        if (low !== high) ambiguous.push(ordinal);
        else if (low > 0) batches.set(id, { id, ordinal, amount, originalCents: low, linkedCents: 0, unassignedBefore: unassigned });
      }
      min = Math.max(0, min - amount);
      max = Math.min(max, available - amount);
    }
    available += units;
  }
  return { min, max, postedSince, ambiguous, batches: [...batches.values()].map(batch => ({ ...batch,
    open: Math.max(0, batch.originalCents - batch.linkedCents - (unassigned - batch.unassignedBefore)),
  })) };
}

function linkedRows(entries, receipt, row, original) {
  return Array.isArray(entries) && entries.every(entry => positive(entry.id) && Number(entry.recordId) === Number(row.recordId))
    && row.negatives.every(negative => entries.some(entry => Number(entry.id) === Number(negative.entryId)
      && Number(entry.receiptId) === Number(receipt.id) && entry.receiptNo === receipt.receiptNo
      && Number(entry.statementId ?? 0) === Number(original.statementId ?? 0)
      && signedCashUnits(entry.amount) === signedCashUnits(negative.amount)));
}

export async function reviewSettlement(client, task, receipt, links = new Map()) {
  const p = task.preview;
  const first = `原收款单 ${p.receiptNo} 当时已核销 ${yuan(p.totalCents)}（原请求${task.result?.recoveredViaReceipt ? '回执已核对' : '已有办理记录'}）。`;
  const pending = '请财务核对原收款单和原应收分录，再确认发生冲回的是哪次核销。';
  const owner = p._expectedAllocation?.partyId ?? p.customer?.id;
  if (Number(receipt?.id) !== Number(p.receiptId) || receipt.receiptNo !== p.receiptNo
      || Number(receipt.type) !== 2 || Number(receipt.partyId) !== Number(owner)) {
    return { reply: first + '\n当前收款单身份或权限未能核实。' + pending };
  }
  const [amount, settled, balance] = [receipt.amount, receipt.settledAmount, receipt.balance].map(value => cashUnits(value));
  if ([amount, settled, balance].some(value => value == null) || amount !== settled + balance
      || !receiptEntriesMatch(receipt.settlements, settled)) {
    return { reply: first + '\n当前收款余额或分录尚未对平。' + pending };
  }
  const durable = Array.isArray(receipt.reversalBatches) ? receipt.reversalBatches : null;
  if (durable) links = new Map(durable.flatMap(batch => batch.posted.map(posted => [posted.id, batch.id])));
  const rows = await Promise.all(p.allocations.map(async (allocation, index) => {
    const relevant = receipt.settlements.filter(row => Number(row.recordId) === Number(allocation.recordId)
      && row.orderNo === allocation.orderNo && (allocation.orderId == null || Number(row.orderId) === Number(allocation.orderId))
      && Number(row.statementId ?? 0) === Number(p.statementId ?? 0));
    const ids = new Set(p._settlementEntryIds ?? []);
    const matching = relevant.filter(row => signedCashUnits(row.amount) === allocation.amountCents && !ids.has(Number(row.entryId)));
    const original = task.settlementEntryIds?.[index]
      ? matching.find(row => Number(row.entryId) === task.settlementEntryIds[index])
      : p._settlementEntryIds && matching.length === 1 ? matching[0] : null;
    const identity = original && receiptEntryIdentity(original);
    if (!identity) return { message: `${allocation.orderNo} 的原核销分录当前未能唯一核对。` };
    const group = relevant.filter(row => receiptEntryIdentity(row) === identity);
    const due = cashUnits(original.orderBalance), paid = cashUnits(original.orderPaid), total = cashUnits(original.orderTotal);
    if ([due, paid, total].some(value => value == null) || total !== due + paid
        || group.some(row => cashUnits(row.orderBalance) !== due || cashUnits(row.orderPaid) !== paid)) {
      return { message: `${allocation.orderNo} 当前应收金额未能对平。` };
    }
    const negatives = group.filter(row => Number(row.entryId) > Number(original.entryId) && signedCashUnits(row.amount) < 0);
    const entries = await client.get(`/api/payments/${allocation.recordId}/entries?trace=1`).catch(() => null);
    const refundRows = Array.isArray(entries) ? entries.filter(row => positive(row.id) && Number(row.id) > Number(original.entryId)
      && Number(row.recordId) === Number(allocation.recordId) && row.method === 'refund' && row.receiptId == null
      && row.statementId == null && signedCashUnits(row.amount) < 0) : [];
    const refunds = new Set(refundRows.map(row => Number(row.id))).size === refundRows.length
      ? -refundRows.reduce((sum, row) => sum + signedCashUnits(row.amount), 0) : 0;
    const owes = `，当前欠款 ${yuan(due)}。`;
    if (negatives.length && !linkedRows(entries, receipt, { ...allocation, negatives }, original)) {
      const net = group.reduce((sum, row) => sum + signedCashUnits(row.amount), 0);
      return { message: `${allocation.orderNo} 在本收款单的净核销 ${yuan(net)}${owes}后续负向分录属于哪次核销，仍待财务核对。` };
    }
    const movements = receiptMovements(group);
    const trace = traceAllocation(movements, Number(original.entryId), links);
    const certain = trace.min === trace.max;
    const effective = certain ? trace.min : null;
    const reversed = certain ? allocation.amountCents - effective : null;
    const sequence = movements.some(row => row.units < 0) ? '\n' + receiptMovementText(movements) + '。' : '';
    const portions = trace.batches.length > 1 || trace.batches.some(row => row.amount !== row.originalCents)
      ? '\n' + trace.batches.map(row => `第 ${row.ordinal} 笔冲回中有 ${yuan(row.originalCents)} 对应本次原核销`).join('，') + '。' : '';
    const uncertainty = trace.ambiguous.length
      ? '\n' + trace.ambiguous.map(ordinal => `第 ${ordinal} 笔冲回`).join('、') + '属于哪次核销，请财务核对。' : '';
    return { reversed, effective, batches: certain ? trace.batches.filter(row => row.open > 0) : [],
      message: `${allocation.orderNo} ${certain ? (reversed ? '后续冲回 ' + yuan(reversed) + '，' : '') + '本次仍有效 ' + yuan(effective)
        : '本次原核销剩余金额待核对'}`
        + (trace.postedSince ? `，此后另有核销 ${yuan(trace.postedSince)}` : '')
        + (refunds ? `，另有应收退款分录 ${yuan(refunds)}` : '') + owes + sequence + portions + uncertainty };
  }));
  let statementReview = '';
  if (p._monthly) {
    const statement = await exactStatement(client, p.statementNo.toUpperCase()).catch(() => null);
    const evidence = statement && Number(statement.id) === Number(p.statementId) ? statementEvidence(statement) : null;
    statementReview = evidence && evidence.partyId === owner && !evidence.issues.length
      ? `对账单 ${p.statementNo} 当前欠款 ${yuan(evidence.due / 100)}。\n`
      : `对账单 ${p.statementNo} 的当前余额待财务核对。\n`;
  }
  const known = rows.every(row => row.effective != null);
  const current = known ? {
    effectiveAllocationCents: rows.reduce((sum, row) => sum + row.effective, 0),
    reversedAllocationCents: rows.reduce((sum, row) => sum + row.reversed, 0),
  } : {};
  return {
    current: { ...current, currentReceiptBalanceCents: balance },
    reopen: new Map(rows.map((row, index) => [p.allocations[index].orderNo.toUpperCase(), row.batches ?? []])),
    reply: [first, ...rows.map(row => row.message),
      `原收款单当前未核销余额 ${yuan(balance)}。`,
      ...(durable ?? []).filter(batch => p.allocations.some(row => row.recordId === batch.recordId) && (batch.posted.length || batch.issue))
        .map(reversalBatchText),
      statementReview + (known ? (rows.some(row => row.batches.length)
        ? (p._monthly ? '下一步由财务核对各笔冲回。继续办理月结核销时，请给出原收款单号和本次金额。'
          : '下一步由财务核对冲回原因。如需重办，请说「冲回后重新核销」并给出本次金额。')
        : '下一步由财务按原收款单和当前应收核对余款。') : pending)].join('\n'),
  };
}
