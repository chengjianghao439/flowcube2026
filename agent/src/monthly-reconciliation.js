import { collectList } from './pagination.js';
import { cashUnits, receiptEntriesMatch, receiptMovements, receiptMovementText, signedCashUnits } from './receipt-allocation.js';

export const MONTHLY_GRAPH = 'M-monthly-reconciliation';
const scPattern = /(?<![a-z\d_-])SC[-_]?\d{6,28}(?![a-z\d_-])/gi;
const rcPattern = /(?<![a-z\d_-])RC[-_]?\d{6,28}(?![a-z\d_-])/gi;
const salePattern = /(?<![a-z\d_-])SL[-_]?\d{6,28}(?![a-z\d_-])/i;
const namedStatement = /(?:月结)?对账单号?\s*(?:是|为|[：:])?\s*[「『“"]?([a-z\d][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi;
const namedReceipt = /收款单号?\s*(?:是|为|[：:])?\s*[「『“"]?([a-z\d][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi;
const links = '[[月结对账|/reports/reconciliation/receivable]]';
const onlyMoney = /^\s*(?:(?:金额(?:是|为)?|补(?:核销)?)\s*[：:]?\s*)?[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?[。！？!?]*$/;
const keyOf = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const noOf = value => typeof value === 'string' && /^[a-z\d][a-z\d_-]{2,49}$/i.test(value) ? value.toUpperCase() : null;
const yuan = (units, precision = 4) => '¥' + (units / (10 ** precision)).toLocaleString('zh-CN', {
  useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: precision,
});
const positive = value => cashUnits(value) || null;
const dateKey = value => value == null ? null : new Date(value).toISOString();

export function monthlyRequest(text, context = false) {
  const taggedStatement = Array.from(text.matchAll(namedStatement), match => noOf(match[1]));
  const taggedReceipt = Array.from(text.matchAll(namedReceipt), match => noOf(match[1]));
  const statements = [...new Set([...taggedStatement, ...(text.match(scPattern) ?? []).map(noOf).filter(no => !taggedReceipt.includes(no))])];
  const receipts = [...new Set([...taggedReceipt, ...(text.match(rcPattern) ?? []).map(noOf).filter(no => !taggedStatement.includes(no))])];
  const amountOnly = onlyMoney.exec(text)?.[1];
  const bareReceipt = receipts.length && /^\s*(?:收款单号?\s*(?:是|为|[：:])?\s*)?[a-z\d][a-z\d_-]+[。！？!?]*$/i.test(text);
  const bareStatement = statements.length && /^\s*(?:(?:月结)?对账单号?\s*(?:是|为|[：:])?\s*)?[a-z\d][a-z\d_-]+[。！？!?]*$/i.test(text);
  const term = /月结对账|对账单/.test(text);
  if (/盘点/.test(text) && !term || /供应商|应付|付款对账单|(?<![a-z\d_-])SP[-_]?\d{6,28}/i.test(text) && !/客户|应收/.test(text)) return null;
  if (statements.length && !term && !context && !/对账|核销|收款|应收/.test(text)) return null;
  const held = /(?:别|暂缓|不用|不要|先不)[^，。]{0,8}(?:核销|确认)/.test(text);
  const command = /(?:接着|继续|重新|准备|试算)(?:按(?:原|月结)?对账单)?核销|核销预览|再核一笔|另核一笔|用(?:这笔|原)?收款单[^。]{0,65}(?:核销|冲抵)/.test(text)
    || /^(?:(?:小满|帮我|请|麻烦)[，,:：\s]*)*(?:核销|冲抵)\s*(?=(?:这张|原|月结)?对账单|SC[-_]?\d)/i.test(text);
  const confirmOnly = /^(?:(?:请|帮我)\s*)?(确认|提交)(?:核销|(?:月结)?对账单)/.test(text);
  const detailQuery = /重查原单|重新核对|还欠多少|已确认吗|进度|差异/.test(text);
  if (!statements.length && !term && !(context && (command || confirmOnly || detailQuery || amountOnly || bareReceipt))) return null;
  // 月结泛概念解释仍走原解释路径，明确单号或实际办理才进入对账。
  if (!statements.length && !context && !command && !confirmOnly && !/查|看|核对|进度|状态|哪|多少|差异/.test(text)) return null;
  const withoutIds = text.replace(namedStatement, ' ').replace(namedReceipt, ' ').replace(scPattern, ' ').replace(rcPattern, ' ');
  const amountContext = statements.length || receipts.length || /(?:核销|冲抵|收款单|对账单)/.test(text);
  const amounts = [...withoutIds.matchAll(/(?<![\d.])(?:[¥￥]\s*(\d+(?:\.\d+)?)(?:\s*(?:元|块))?|(\d+(?:\.\d+)?)\s*(?:元|块))/g)]
    .map(match => match[1] ?? match[2]);
  const tailAmount = !amounts.length && amountContext ? /\s+(\d+(?:\.\d+)?)\s*[。！？!?]*$/.exec(withoutIds)?.[1] : undefined;
  const amount = amountOnly ?? amounts[0] ?? tailAmount;
  const direct = Boolean(statements.length && receipts.length && amounts.length && /核销|冲抵/.test(text) && !/查|看|核对|多少/.test(text));
  const action = held ? 'read' : confirmOnly ? (/确认(?:月结)?对账单/.test(text) ? 'confirm-statement' : 'confirm')
    : command || direct || context && amountOnly ? 'prepare' : 'read';
  return {
    action, statementNo: statements.length === 1 ? statements[0] : undefined,
    receiptNo: receipts.length === 1 ? receipts[0] : undefined, multiStatement: statements.length > 1, multiReceipt: receipts.length > 1,
    amountCents: positive(amount), invalidAmount: amounts.length > 1 || Boolean(amount && !positive(amount))
      || action === 'prepare' && /(?:或者|还是|百分之|[%％])/.test(text),
    conditional: action === 'prepare' && /如果|假如|要是|只要/.test(text),
    specifiedSales: action === 'prepare' && salePattern.test(text), followup: Boolean(bareReceipt || bareStatement || amountOnly),
    newRound: /再核一笔|另核一笔/.test(text), held,
  };
}

export async function exactStatement(client, number) {
  const base = '/api/payments/statements';
  const { list } = await collectList(client, base, { type: '2', statementNo: number });
  const exact = list.filter(row => Number(row.type) === 2 && noOf(row.statementNo) === number);
  if (exact.length !== 1 || !keyOf(exact[0].id)) return null;
  const detail = await client.get(base + '/' + exact[0].id + '?trace=1');
  return Number(detail?.type) === 2 && Number(detail.id) === Number(exact[0].id)
    && noOf(detail.statementNo) === number && [1, 2, 3].includes(Number(detail.status)) ? detail : null;
}

export function statementEvidence(statement) {
  const issues = [];
  const items = new Map();
  const receiptGroups = new Map();
  const paidByRecord = new Map();
  const seen = new Set();
  const amounts = row => [row?.totalAmount, row?.paidAmount, row?.balance].map(value => cashUnits(value, 4));
  const validTrace = Array.isArray(statement.items) && Array.isArray(statement.trace?.entries) && statement.trace.projection;
  if (!validTrace) issues.push('原对账单明细或核销分录暂未核实。');
  for (const row of statement.items ?? []) {
    const recordId = keyOf(row.recordId);
    const orderId = keyOf(row.orderId);
    const no = noOf(row.orderNo);
    const [total, paid, due] = amounts(row);
    if (!recordId || !orderId || !no || no !== noOf(row.sourceOrderNo) || Number(row.type) !== 2
      || Number(row.settlementType) !== 2 || items.has(recordId) || !keyOf(row.customerId)
      || [total, paid, due].some(value => value == null)) {
      issues.push((no ?? '一条对账明细') + ' 的原销售单、客户归属或账款数据未能复核。');
      continue;
    }
    const difference = total - paid - due;
    if (difference) issues.push(no + ' 账款差异 ' + yuan(Math.abs(difference)) + '，应收减已核销为 '
      + (total >= paid ? yuan(total - paid) : '-' + yuan(paid - total)) + '，账款余额为 ' + yuan(due) + '。');
    const status = due === 0 ? 3 : paid ? 2 : 1;
    if (Number(row.status) !== status) issues.push(no + ' 的账款状态与金额不一致。');
    items.set(recordId, { recordId, orderId, no: row.orderNo, total, paid, due, customerId: keyOf(row.customerId), createdAt: row.createdAt });
  }
  const members = [...items.values()];
  if (new Set(members.map(row => row.orderId)).size !== members.length) issues.push('原销售单对应多条应收，须先厘清账款关联。');
  const owners = new Set(members.map(row => row.customerId));
  const partyId = owners.size === 1 ? members[0].customerId : null;
  if (!partyId) issues.push('对账明细没有唯一可证的客户归属。');

  let historical = 0, refunds = 0;
  for (const entry of statement.trace?.entries ?? []) {
    const receiptId = keyOf(entry.receiptId), number = noOf(entry.receiptNo);
    const refund = entry.method === 'refund' && entry.receiptId == null && entry.statementId == null && Number(entry.amount) < 0;
    const id = keyOf(entry.entryId), recordId = keyOf(entry.recordId);
    const linkedReversal = receiptId && Number(entry.statementId) === Number(statement.id);
    const value = refund || linkedReversal ? signedCashUnits(entry.amount, 4) : cashUnits(entry.amount, 4);
    if (!id || !value || seen.has(id) || !items.has(recordId)) {
      issues.push('有无法核对的原账款分录。');
      continue;
    }
    seen.add(id);
    paidByRecord.set(recordId, (paidByRecord.get(recordId) ?? 0) + value);
    if (refund) { refunds -= value; continue; }
    if (Number(entry.statementId) !== Number(statement.id)) {
      historical += value;
      continue;
    }
    if (!receiptId || !number || Number(entry.receiptType) !== 2 || !partyId || Number(entry.receiptPartyId) !== partyId) {
      issues.push(items.get(recordId).no + ' 有对账核销分录无法核实原收款单或客户归属。');
      continue;
    }
    const head = [entry.receiptAmount, entry.receiptSettledAmount, entry.receiptBalance].map(value => cashUnits(value, 4));
    const group = receiptGroups.get(receiptId) ?? { no: entry.receiptNo, amount: 0, reversed: 0, head, entries: new Map(), recordNets: new Map() };
    if (group.no !== entry.receiptNo || group.head.some((value, index) => value !== head[index])) {
      issues.push('同一收款编号的分录来源不一致。');
      continue;
    }
    group.amount += value;
    group.reversed += Math.max(0, -value);
    group.entries.set(id, { recordId, amount: value });
    const net = (group.recordNets.get(recordId) ?? 0) + value;
    group.recordNets.set(recordId, net);
    if (net < 0) issues.push(items.get(recordId).no + ' 的核销冲回超过原收款单在本单的核销金额。');
    receiptGroups.set(receiptId, group);
  }
  for (const row of receiptGroups.values()) {
    const [received, settled, balance] = row.head;
    if (row.head.some(value => value == null) || received !== settled + balance || row.amount > settled) {
      row.inconsistent = true;
      issues.push(row.no + ' 的到账、已核销和余款存在差异，请核对原收款单。');
    }
  }
  const total = members.reduce((sum, row) => sum + row.total, 0);
  const paid = members.reduce((sum, row) => sum + row.paid, 0);
  const due = members.reduce((sum, row) => sum + row.due, 0);
  for (const row of members) {
    const posted = paidByRecord.get(row.recordId) ?? 0;
    if (row.paid !== posted) issues.push(row.no + ' 已核销与对应分录差异 ' + yuan(Math.abs(row.paid - posted))
      + '，应收记录为 ' + yuan(row.paid) + '，分录合计 ' + yuan(posted) + '。');
  }
  const fields = [['对账额', 'totalAmount', total], ['已核销', 'settledAmount', paid], ['待收', 'balance', due]];
  for (const [label, field, sum] of fields) {
    const snapshot = cashUnits(statement.trace?.projection?.[field], 4);
    for (const [name, value] of [['当前抬头', cashUnits(statement[field], 4)], ['存储抬头', snapshot]]) {
      if (value == null || value !== sum) issues.push(name + label + '与逐单合计有差异'
        + (value == null ? '，原金额待核' : ' ' + yuan(Math.abs(value - sum)) + '（' + yuan(value) + ' 对 ' + yuan(sum) + '）') + '。');
    }
  }
  if (Number(statement.status) !== Number(statement.trace?.projection?.status)) {
    issues.push('对账单存储状态与实时核销状态不一致。');
  }
  return { statement, members, partyId, receipts: receiptGroups, issues: [...new Set(issues)], historical, refunds, total, paid, due };
}

function checkReceiptIdentity(evidence, receipt) {
  if (!evidence.partyId || keyOf(receipt.partyId) !== evidence.partyId) throw new Error('收款单和对账单的客户归属未核实或不一致，请财务核对原单。');
  const group = evidence.receipts.get(Number(receipt.id));
  const rows = (receipt.settlements ?? []).filter(row => Number(row.statementId) === Number(evidence.statement.id));
  if ((group?.entries.size ?? 0) !== rows.length || new Set(rows.map(row => keyOf(row.entryId))).size !== rows.length
    || group && group.no !== receipt.receiptNo || rows.some(row => {
    const entry = group?.entries.get(keyOf(row.entryId));
    return !entry || entry.recordId !== keyOf(row.recordId) || entry.amount !== signedCashUnits(row.amount, 4);
  })) throw new Error('原收款单与原对账单的核销分录有差异，请财务重查两张原单。');
  return group?.amount ?? 0;
}

export function monthlyOverview(evidence, receipt) {
  const { statement, members, receipts, issues, historical, refunds, total, paid, due } = evidence;
  const status = Number(statement.status) === 1 ? '草稿，待确认'
    : Number(statement.status) === 3 ? '已确认、已核销' : '已确认';
  const rows = [
    '月结对账单 ' + statement.statementNo + ' · ' + status,
    '对账额 ' + yuan(total) + '，已核销 ' + yuan(paid) + (issues.length ? '，账款余额合计 ' : '，还欠 ')
      + yuan(due) + (issues.length ? '（待核对）。' : '。'),
    ...members.map(row => row.no + ' 已核销 ' + yuan(row.paid) + '，当前欠款 ' + yuan(row.due) + '。'),
    ...[...receipts.values()].map(row => row.no + (row.reversed ? ' 对本对账单净核销 ' + yuan(row.amount) + '，后续冲回 ' + yuan(row.reversed)
      : ' 已对本对账单核销 ' + yuan(row.amount)) + '（' + row.entries.size + ' 条分录）'
      + (row.inconsistent ? '，原收款单余额待核。' : '，到账 ' + yuan(row.head[0]) + '，收款单累计核销 ' + yuan(row.head[1]) + '，余款 ' + yuan(row.head[2]) + '。')),
    ...(issues.length ? [] : [...receipts.values()].filter(row => row.reversed).flatMap(receipt => {
      const byRecord = Map.groupBy([...receipt.entries], ([, row]) => row.recordId);
      return members.filter(row => byRecord.get(row.recordId)?.some(([, entry]) => entry.amount < 0)).map(row => {
        const movements = byRecord.get(row.recordId).map(([entryId, entry]) => ({ entryId, amount: entry.amount / 10000 }));
        return receipt.no + ' 对 ' + row.no + ' 的分录 ' + receiptMovementText(receiptMovements(movements, 4), 4) + '。';
      });
    })),
  ];
  if (historical) rows.push('另有原账款其他来源的分录 ' + yuan(historical) + '，请沿原账款核对其归属。');
  if (refunds) rows.push('退款已冲回 ' + yuan(refunds) + '，已计入销售单当前实收和欠款。');
  let receiptIssue = false;
  if (receipt) {
    try {
      const matched = checkReceiptIdentity(evidence, receipt);
      const amounts = [receipt.amount, receipt.settledAmount, receipt.balance].map(value => cashUnits(value, 4));
      if (amounts.some(value => value == null) || amounts[0] !== amounts[1] + amounts[2]) throw new Error('原收款单本身存在金额差异，请财务核对到账及核销。');
      rows.push('收款单 ' + receipt.receiptNo + ' 到账 ' + yuan(amounts[0]) + '，累计已核销 ' + yuan(amounts[1])
        + '，其中本对账单 ' + yuan(matched) + '，收款单余款 ' + yuan(amounts[2]) + '。');
    } catch (error) { receiptIssue = true; rows.push(error.message); }
  }
  if (issues.length) rows.push(...issues, '下一步由财务在 ' + links + ' 核对销售应收、原收款单和到账凭证，核清后再办。');
  else if (Number(statement.status) === 1) rows.push('下一步由有对账确认权限的财务人员在 ' + links + ' 核对明细并确认。');
  else if (due > 0) rows.push('下一步由财务核实到账。继续核销时请给原收款单号和本次准确金额。');
  const result = { statementNo: statement.statementNo, status: statement.status, total: total / 10000, paid: paid / 10000, balance: due / 10000,
    orders: members.map(row => ({ no: row.no, paid: row.paid / 10000, balance: row.due / 10000 })),
    receipts: [...receipts.values()].map(row => ({ no: row.no, amount: row.amount / 10000 })), hasDifferences: issues.length > 0 || receiptIssue };
  return { reply: rows.join('\n'), result };
}

export function monthlyPreview(evidence, receipt, amountCents) {
  const { statement, members, partyId, issues, total, paid, due } = evidence;
  if (Number(statement.status) === 1) throw new Error('原月结对账单仍是草稿，请由有对账确认权限的财务人员先在 ' + links + ' 核对并确认。');
  if (issues.length) throw new Error('原月结对账单有差异，请财务先核对明细和已核销分录。\n' + issues.join('\n'));
  if (Number(statement.status) === 3 || due <= 0) throw new Error('原月结对账单已结清。');
  checkReceiptIdentity(evidence, receipt);
  const receiptFields = [receipt.amount, receipt.settledAmount, receipt.balance].map(value => cashUnits(value));
  const [receiptTotal, receiptPaid, receiptBalance] = receiptFields;
  const receiptEntries = receipt.settlements;
  if (receiptFields.some(value => value == null) || receiptTotal !== receiptPaid + receiptBalance
    || !receiptEntriesMatch(receiptEntries, receiptPaid)
    || members.some(row => [row.total, row.paid, row.due].some(value => value % 100))) {
    throw new Error('原收款单或对账账款未对平，或含历史非分金额，请财务核对原单。');
  }
  if (amountCents > receiptBalance) throw new Error('本次金额超过原收款单余款 ' + yuan(receiptBalance, 2) + '。');
  if (amountCents > due / 100) throw new Error('本次金额超过原对账单欠款 ' + yuan(due) + '。');
  let left = amountCents;
  const allocations = [];
  const ordered = members.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.recordId - b.recordId);
  for (const row of ordered) {
    const balanceBeforeCents = row.due / 100;
    const chosen = Math.min(left, balanceBeforeCents);
    if (!chosen) continue;
    allocations.push({ recordId: row.recordId, orderId: row.orderId, orderNo: row.no, amountCents: chosen,
      balanceBeforeCents, settledAfter: chosen === balanceBeforeCents });
    left -= chosen;
  }
  const statementId = Number(statement.id), statementNo = statement.statementNo;
  return {
    _explicit: true, _monthly: true, _settlementEntryIds: receiptEntries.map(row => Number(row.entryId)),
    statementId, statementNo, statementBalanceBeforeCents: due / 100,
    receiptId: Number(receipt.id), receiptNo: receipt.receiptNo, receiptBalanceBeforeCents: receiptBalance,
    customer: { id: partyId, name: statement.partyName }, totalCents: amountCents,
    title: '月结核销 · ' + statementNo, confirmLabel: '确认核销', allocations,
    _expectedAllocation: {
      partyId, receiptNo: receipt.receiptNo, receiptBalanceCents: receiptBalance, settledCents: receiptPaid,
      statement: { id: statementId, no: statementNo, totalCents: total / 100, paidCents: paid / 100, balanceCents: due / 100, confirmedAt: dateKey(statement.confirmedAt) },
      targets: ordered.map(row => ({ recordId: row.recordId, orderId: row.orderId, orderNo: row.no,
        totalCents: row.total / 100, paidCents: row.paid / 100, balanceCents: row.due / 100 })),
    },
    payload: { allocations: [{ statementId, amount: amountCents / 100 }] },
  };
}

export function monthlyPreviewReply(preview) {
  const { statement, receiptBalanceCents } = preview._expectedAllocation;
  return '按原对账单的老账顺序试算 ' + yuan(preview.totalCents, 2) + '。\n'
    + preview.allocations.map(row => row.orderNo + ' 本次核销 ' + yuan(row.amountCents, 2) + '，核销后欠款 '
      + yuan(row.balanceBeforeCents - row.amountCents, 2) + '。').join('\n')
    + '\n对账单 ' + preview.statementNo + ' 还欠 ' + yuan(statement.balanceCents - preview.totalCents, 2)
    + '，收款单 ' + preview.receiptNo + ' 余款 ' + yuan(receiptBalanceCents - preview.totalCents, 2) + '。请核对后点击确认核销。';
}
