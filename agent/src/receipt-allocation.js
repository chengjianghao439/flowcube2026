import { createHash } from 'node:crypto';
import { collectList } from './pagination.js';
import { reversalBatchText } from './reapply-progress.js';
import { quantityNumber } from './sale-conversation.js';

const receiptPattern = /(?<![a-z\d_-])RC[-_]?\d{6,28}(?![a-z\d_-])/gi;
const namedReceipt = /收款单号\s*(?:是|为|[：:])?\s*[「『“"]?((?!SL)[a-z][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi;
const salePattern = /(?<![a-z\d_-])SL[-_]?\d{6,28}(?![a-z\d_-])/gi;
const prepareWords = /(?:接着|继续|重新|再|准备|试算)(?:按原单)?核销|核销预览|再核一笔|另核一笔|下一次核销/;
const readWords = /查|看|核对|进度|状态|分次|每张|逐单|多少|还欠|余款|归属|挂账/;
const financeWords = /收款单|这(?:笔|张)收款|预收|余款|分次核销/;
const amountText = /^(?:给|核销|分配|冲抵)?\s*[:：=]?\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?$/;
const safe = s => typeof s === 'string' ? s.replace(/[\p{Cc}\p{Cf}\[\]*]/gu, ' ').trim().slice(0, 80) : '';
const sameNo = (value, no) => typeof value === 'string' && value.toUpperCase() === no;
const keyOf = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const receivable = '[[客户往来|/payments/receivable]]';
const states = { 1: '待核销', 2: '部分核销', 3: '已核销' };

export function cashUnits(value, precision = 2) {
  if (value == null) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > precision) return null;
  const units = Number(match[1] + fraction.padEnd(precision, '0'));
  return Number.isSafeInteger(units) ? units : null;
}
export function signedCashUnits(value, precision = 2) {
  if (!String(value).startsWith('-')) return cashUnits(value, precision);
  const units = cashUnits(String(value).slice(1), precision);
  return units == null ? null : -units;
}

export function receiptEntryIdentity(row) {
  const order = keyOf(row.orderId), record = keyOf(row.recordId), no = safe(row.orderNo).toUpperCase();
  const statement = row.statementId == null ? 0 : keyOf(row.statementId);
  return order && record && no && statement != null ? JSON.stringify([record, order, no, statement]) : null;
}

const yuan = cents => '¥' + (cents / 100).toFixed(2);
const precise = n => '¥' + n.toLocaleString('zh-CN', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function receiptMovements(rows, precision = 2) {
  let credits = 0, reversals = 0;
  return rows.slice().sort((a, b) => Number(a.entryId) - Number(b.entryId)).map(row => {
    const units = signedCashUnits(row.amount, precision);
    return { id: Number(row.entryId), units, ordinal: units < 0 ? ++reversals : ++credits };
  });
}

export function receiptMovementText(movements, precision = 2) {
  return movements.map(({ units, ordinal }) =>
    `第 ${ordinal} 笔${units < 0 ? '冲回' : '核销'} ${precise(Math.abs(units) / 10 ** precision)}`).join('，');
}

export function receiptLedgerFingerprint(receipt) {
  const rows = receipt.settlements.slice().sort((a, b) => Number(a.entryId) - Number(b.entryId));
  return createHash('sha256').update(JSON.stringify(rows.map(row => [Number(row.entryId), Number(row.recordId),
    Number(row.statementId ?? 0), String(signedCashUnits(row.amount))]))).digest('hex');
}

export function receiptAllocationRequest(text, contextual = false, choosingReversal = false) {
  const numbers = [...new Set([...(text.match(receiptPattern) ?? []), ...Array.from(text.matchAll(namedReceipt), m => m[1])]
    .map(no => no.toUpperCase()))];
  const matches = [...text.matchAll(salePattern)];
  const linked = numbers.length > 0;
  const shortChoice = choosingReversal && /^第\s*[\d零一二两三四五六七八九十百]+\s*(?:笔|次|批)[。！!？?]*$/.test(text);
  const entryChoice = choosingReversal && /^分录\s*[#＃]?\s*([1-9]\d*)[。！!？?]*$/.exec(text);
  const reversal = shortChoice || Boolean(entryChoice) || /冲回|冲正|撤销核销|反核销/.test(text);
  const reapply = reversal && /重新(?:按原单)?核销/.test(text);
  const reversalNumbers = reversal ? [...new Set(Array.from(text.matchAll(/第\s*([\d零一二两三四五六七八九十百]+)\s*(?:笔|次|批)/g),
    match => quantityNumber(match[1]) ?? 0))] : [];
  const held = /(?:别|暂缓|不用|不要|先不)[^，。]{0,8}(?:核销|分配)/.test(text);
  const isRead = readWords.test(text);
  const directAllocation = matches.length > 0 && /核销|冲抵/.test(text) && !isRead
    && (linked || /^(?:(?:帮我|请|麻烦)\s*)?(?:核销|用这笔收款)/.test(text));
  const wantsPrepare = !held && (prepareWords.test(text) || directAllocation);
  const confirms = /^(?:(?:帮我|请)\s*)?(?:确认|提交)核销/.test(text);
  const amountOnly = /^\s*[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?[。！？!?]*$/.exec(reapply ? text.replace(/^(?:.*重新(?:按原单)?核销)\s*/, '').replace(/^[，,]?\s*(?:再补|另补)一笔\s*/, '') : text)?.[1];
  const bareReceipt = linked && /^\s*(?:(?:收款单号|单号)(?:是|为|[：:])?\s*)?[「『“"]?[a-z][a-z\d_-]+[」』”"]?[。！？!?]*$/i.test(text);
  const detailed = reversal || /分次|分笔|预收|余款|逐单|每张|多张|还欠|归属/.test(text);
  if (!(reapply || (linked || directAllocation || financeWords.test(text)) && (wantsPrepare || confirms || (isRead && detailed))
    || contextual && (wantsPrepare || isRead && (financeWords.test(text) || /核销进度|还剩多少|每张还欠多少|核对原收款/.test(text))
      || matches.length && !isRead || bareReceipt || amountOnly || confirms || reversal && (/核销/.test(text) || reversalNumbers.length || entryChoice)))) return null;
  const no = numbers[0];
  if (confirms) return { action: 'confirm', no };
  const action = !held && (wantsPrepare || contextual && (matches.length || amountOnly) && !isRead) ? 'prepare' : 'read';
  const rows = action === 'prepare' ? matches.map((match, index) => {
    const raw = text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
      .replace(/[，,、。；;！!？?\s]*(?:(?:和|及|给|再给|然后给)\s*)?(?:销售单号?|单号)\s*$/, '')
      .replace(/[，,、。；;！!？?\s]+$/, '').replace(/(?:和|及|给|再给|然后给)$/, '').trim();
    const amount = raw && amountText.exec(raw)?.[1];
    return { no: match[0].toUpperCase(), cents: amount ? cashUnits(amount) : null, invalid: Boolean(raw && (!amount || !cashUnits(amount))) };
  }) : [];
  const extraAmount = action === 'prepare' && matches.length && /\d+(?:\.\d+)?\s*(?:元|块|%)|[¥￥]\s*\d/.test(text.slice(0, matches[0].index));
  return { action, no: numbers.length > 1 ? undefined : no, multiple: numbers.length > 1, rows, held, reversal, reapply,
    ...(entryChoice ? { reversalId: keyOf(entryChoice[1]) } : {}),
    ...(reversal ? { batchOrderNos: matches.map(match => match[0].toUpperCase()) } : {}),
    ...(reversalNumbers.length ? { reversalOrdinal: reversalNumbers[0], batchAmbiguous: reversalNumbers.length > 1 } : {}),
    invalid: Boolean(extraAmount || rows.some(row => row.invalid)),
    ...(amountOnly ? { amountOnly: cashUnits(amountOnly), amountOnlyGiven: true } : {}),
    replacesPlan: wantsPrepare || /只核销|只给|改成|改为/.test(text),
    newRound: /再核一笔|另核一笔|下一次核销|再补一笔|另补一笔/.test(text) };
}

export async function exactReceipt(client, no) {
  const path = '/api/payments/receipts';
  const { list } = await collectList(client, path, { type: '2', receiptNo: no });
  const rows = list.filter(row => Number(row.type) === 2 && sameNo(row.receiptNo, no));
  if (!rows.length) return null;
  const id = rows.length === 1 && keyOf(rows[0].id);
  if (!id) throw new Error('原收款单身份不唯一');
  const detail = await client.get(path + '/' + id);
  if (keyOf(detail?.id) !== id || Number(detail.type) !== 2 || !sameNo(detail.receiptNo, no) || !Object.hasOwn(states, detail.status)) {
    throw new Error('未能核对收款单号、类型及状态');
  }
  return detail;
}

export function receiptOverview(detail) {
  const { receiptNo, amount, settledAmount, balance, status } = detail;
  if (![amount, settledAmount, balance].every(value => cashUnits(value, 4) != null)) throw new Error('原收款单金额字段不完整，请到客户往来核对');
  const groups = new Map(), ids = new Set(), conflictedOrders = new Set();
  let incomplete = !Array.isArray(detail.settlements) && settledAmount > 0;
  let entryTotal = 0;
  for (const row of Array.isArray(detail.settlements) ? detail.settlements : []) {
    const entryId = keyOf(row.entryId), value = signedCashUnits(row.amount, 4);
    const recordId = keyOf(row.recordId), orderId = keyOf(row.orderId), no = safe(row.orderNo);
    const owing = cashUnits(row.orderBalance, 4);
    if (!entryId || ids.has(entryId) || value == null || Number(row.type) !== 2) { incomplete = true; continue; }
    ids.add(entryId); entryTotal += value;
    if (!orderId || !recordId || !no || owing == null) { incomplete = true; continue; }
    if (conflictedOrders.has(orderId)) continue;
    const old = groups.get(orderId);
    if (old && (old.recordId !== recordId || old.no !== no || old.owing !== owing)) {
      groups.delete(orderId);
      conflictedOrders.add(orderId);
      incomplete = true;
      continue;
    }
    if (!old) groups.set(orderId, { recordId, no, owing, units: value, reversed: Math.max(0, -value), entries: 1, movements: [row] });
    else { old.units += value; old.reversed += Math.max(0, -value); old.entries++; old.movements.push(row); }
  }
  const validTotal = cashUnits(amount, 4) === cashUnits(settledAmount, 4) + cashUnits(balance, 4);
  if (entryTotal !== cashUnits(settledAmount, 4) || !validTotal
      || !receiptEntriesMatch(detail.settlements, cashUnits(settledAmount, 4), 4)) incomplete = true;
  const rows = [...groups.values()];
  const owner = keyOf(detail.partyId) ? safe(detail.partyName) : '';
  const notes = [];
  if (balance > 0) notes.push(owner
    ? '预收款客户归属为「' + owner + '」，余款的具体销售单待分配。'
    : '预收余款的客户归属尚待核对，请财务先核实原收款单。');
  if (incomplete) notes.push('部分核销金额或销售单关联尚待核对，请到原收款单复核。');
  return {
    hasFacts: true,
    result: { no: receiptNo, status, amount, settledAmount, balance, ...(Array.isArray(detail.settlements)
      ? { orders: rows.filter(row => row.units >= 0 && (!row.reversed || !incomplete))
        .map(({ no, units, owing, entries }) => ({ no, applied: units / 10000, owing: owing / 10000, entries })) } : {}) },
    reply: [
      receiptNo + ' · ' + states[status],
      '收款金额 ' + precise(amount) + '，已核销 ' + precise(settledAmount) + '，收款单未核销余额 ' + precise(balance)
        + (balance > 0 ? '，预收余款 ' + precise(balance) : '') + '。',
      ...rows.filter(row => row.units >= 0 && (!row.reversed || !incomplete)).map(row =>
        row.no + (row.reversed ? ' 本收款单净核销 ' + precise(row.units / 10000) + '，后续冲回 ' + precise(row.reversed / 10000)
          : ' 本收款单已核销 ' + precise(row.units / 10000))
        + '（' + row.entries + ' 条分录），当前欠款 ' + precise(row.owing / 10000) + '。'
        + (row.reversed ? receiptMovementText(receiptMovements(row.movements, 4), 4) + '。' : '')),
      ...(Array.isArray(detail.reversalBatches) ? detail.reversalBatches.map(reversalBatchText) : []),
      ...notes,
      '客户整体应收余额可在 ' + receivable + ' 核对。' + (balance > 0 && owner ? '如需继续核销，请给出各张完整销售单号及金额。' : ''),
    ].join('\n'),
  };
}

export const explicitPlanSignature = rows => JSON.stringify(rows.map(row => [row.no, row.cents]).sort(([a], [b]) => a.localeCompare(b)));

export function receiptEntriesMatch(settlements, settledCents, precision = 2) {
  if (!Array.isArray(settlements)) return false;
  const seen = new Set();
  const groups = new Map();
  let sum = 0;
  for (const row of settlements.slice().sort((a, b) => Number(a.entryId) - Number(b.entryId))) {
    const id = keyOf(row.entryId), cents = signedCashUnits(row.amount, precision);
    if (!id || seen.has(id) || !cents || Number(row.type) !== 2) return false;
    const identity = receiptEntryIdentity(row);
    if (identity) groups.set(identity, (groups.get(identity) ?? 0) + cents);
    if (cents < 0 && (!identity || groups.get(identity) < 0)) return false;
    seen.add(id);
    sum += cents;
  }
  return sum === settledCents;
}

export async function explicitSettlementPreview(client, receipt, requested) {
  const partyId = keyOf(receipt.partyId), receiptId = keyOf(receipt.id);
  const receiptBalanceCents = cashUnits(receipt.balance), settledBefore = cashUnits(receipt.settledAmount), amountCents = cashUnits(receipt.amount);
  if (!partyId || !safe(receipt.partyName)) throw new Error('原收款单客户归属尚未核实，请在客户往来核对');
  if (!receiptId || [receiptBalanceCents, settledBefore, amountCents].some(v => v == null) || amountCents !== receiptBalanceCents + settledBefore) {
    throw new Error('原收款单金额含历史非分金额或未对平，请到原单核对');
  }
  if (!receiptEntriesMatch(receipt.settlements, settledBefore)) {
    throw new Error('原收款单的核销分录与已核销总额未能对平，请到原单核对');
  }
  const totalCents = requested.reduce((sum, row) => sum + row.cents, 0);
  if (!receiptBalanceCents || Number(receipt.status) === 3) throw new Error('原收款单余款为零');
  if (totalCents > receiptBalanceCents) throw new Error('本次合计超过原收款单的预收余款 ' + yuan(receiptBalanceCents));
  const allocations = await Promise.all(requested.map(async ({ no, cents }) => {
    const { list } = await collectList(client, '/api/payments/', { type: '2', partyId: String(partyId), orderNo: no, settlementTypes: '1' });
    const found = list.filter(row => Number(row.type) === 2 && sameNo(row.orderNo, no) && keyOf(row.id) && keyOf(row.orderId));
    if (found.length !== 1) throw new Error(no + ' 在本收款客户的现结应收中未能核实唯一账款。请核对客户、完整销售单号和结算方式');
    const record = found[0];
    const balanceBeforeCents = cashUnits(record.balance), paidBeforeCents = cashUnits(record.paidAmount), total = cashUnits(record.totalAmount);
    if ([balanceBeforeCents, paidBeforeCents, total].some(v => v == null) || balanceBeforeCents !== Math.max(0, total - paidBeforeCents)) {
      throw new Error(no + ' 的原应收存在历史非分金额或余额待核对，请在正式入口办理');
    }
    if (cents > balanceBeforeCents || ![1, 2].includes(Number(record.status))) {
      throw new Error(no + ' 的本次金额超出当前可核销余额 ' + yuan(balanceBeforeCents));
    }
    return { recordId: keyOf(record.id), orderId: keyOf(record.orderId), orderNo: record.orderNo, amountCents: cents,
      balanceBeforeCents, paidBeforeCents, totalCents: total, settledAfter: balanceBeforeCents === cents };
  }));
  const expectedAllocation = {
    partyId, receiptNo: receipt.receiptNo, receiptBalanceCents, settledCents: settledBefore,
    targets: allocations.map(row => ({ recordId: row.recordId, orderId: row.orderId, orderNo: row.orderNo,
      balanceCents: row.balanceBeforeCents, paidCents: row.paidBeforeCents, totalCents: row.totalCents })),
  };
  return {
    _explicit: true, _expectedAllocation: expectedAllocation, _settlementEntryIds: (receipt.settlements ?? []).map(row => Number(row.entryId)),
    receiptId, receiptNo: receipt.receiptNo, receiptBalanceBeforeCents: receiptBalanceCents,
    customer: { id: partyId, name: safe(receipt.partyName) }, amountCents, totalCents,
    allocations, title: '原收款单核销 · ' + receipt.receiptNo, confirmLabel: '确认核销',
    lines: allocations.map(row => ({
      productName: row.orderNo + '（欠款 ' + yuan(row.balanceBeforeCents) + ' → ' + yuan(row.balanceBeforeCents - row.amountCents) + '）',
      qty: 1, unitPriceCents: row.amountCents, priceSource: { level: row.settledAfter ? '结清' : '部分核销' },
    })),
    payload: { allocations: allocations.map(row => ({ recordId: row.recordId, amount: row.amountCents / 100 })) },
  };
}

export function explicitPreviewReply(preview) {
  return '原收款单 ' + preview.receiptNo + ' 本次核销试算 ' + yuan(preview.totalCents) + '。\n'
    + preview.allocations.map(row => row.orderNo + ' 本次核销 ' + yuan(row.amountCents) + '，核销后欠款 '
      + yuan(row.balanceBeforeCents - row.amountCents) + '。').join('\n')
    + '\n本次确认后预收余款 ' + yuan(preview._expectedAllocation.receiptBalanceCents - preview.totalCents)
    + '。请核对后点击确认核销。';
}

export function settlementReceiptMatches(data, preview) {
  const expected = preview._expectedAllocation ?? { receiptBalanceCents: preview.amountCents, settledCents: 0 };
  if (keyOf(data?.id) !== preview.receiptId || data.receiptNo !== preview.receiptNo
    || cashUnits(data.balance) !== expected.receiptBalanceCents - preview.totalCents
    || cashUnits(data.settledAmount) !== expected.settledCents + preview.totalCents
    || !Array.isArray(data.applied) || data.applied.length !== preview.allocations.length
    || (expected.reversalEntryId != null && keyOf(data.reversalEntryId) !== expected.reversalEntryId)) return false;
  const applied = new Map(data.applied.map(row => [keyOf(row.recordId), row]));
  return preview.allocations.every(row => {
    const item = applied.get(row.recordId);
    return item?.orderNo === row.orderNo && cashUnits(item.amount) === row.amountCents && item.settled === row.settledAfter
      && (!preview._monthly || keyOf(item.statementId) === preview.statementId);
  });
}
