import { collectList } from './pagination.js';
import { hasPerm } from './perms.js';
import { cashUnits } from './receipt-allocation.js';
import { statementEvidence } from './monthly-reconciliation.js';
import { saleReturnSource, traceReturns } from './sale-trace.js';

export const RETURN_FINANCE = 'N-return-finance';
export const REFUND_EXECUTE = 'P-refund-execute';
export const RETURN_READ = ['return.order.view', 'payment.view', 'refund.order.view'];
export const REFUND_PERMISSIONS = ['refund.order.view', 'refund.order.execute', 'payment.view'];
const refPattern = /(?<![a-z\d_-])(?:SL|SR|RC|SC|RF)[-_]?\d{6,28}(?![a-z\d_-])/gi;
const namedPattern = /(销售单|退货单|收款单|(?:月结)?对账单|退款单)号?\s*(?:是|为|[：:])?\s*["「“]?([a-z][a-z\d_-]{0,18}?\d{6,28})(?![a-z\d_-])/gi;
const refKinds = { SL: 'sale', SR: 'return', RC: 'receipt', SC: 'statement', RF: 'refund', 销售单: 'sale', 退货单: 'return', 收款单: 'receipt', 退款单: 'refund', 对账单: 'statement', 月结对账单: 'statement' };
export const linkedNo = (value, expected) => typeof value === 'string' && value.toUpperCase() === expected?.toUpperCase();
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const units = (value, precision = 4) => String(value).startsWith('-')
  ? (cashUnits(String(value).slice(1), precision) == null ? null : -cashUnits(String(value).slice(1), precision)) : cashUnits(value, precision);
const yuan = (value, precision = 4) => value == null ? '待核实'
  : '¥' + (value / 10 ** precision).toLocaleString('zh-CN', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: precision });
const financeLink = '[[客户往来|/payments/receivable]]';
const refundLink = '[[退款单|/refunds]]';

export function returnFinanceRequest(text, context = false) {
  if (/供应商退款|采购退货/.test(text)) return null;
  const tags = [...text.matchAll(namedPattern)];
  const taggedNumbers = new Set(tags.map(match => match[2].toUpperCase()));
  const refs = {};
  const add = (kind, number) => (refs[kind] ??= new Set()).add(number.toUpperCase());
  for (const match of tags) add(refKinds[match[1]], match[2]);
  for (const no of text.match(refPattern) ?? []) {
    const kind = refKinds[no.slice(0, 2).toUpperCase()];
    if (!taggedNumbers.has(no.toUpperCase()) && (kind !== 'statement' || !/盘点/.test(text))) add(kind, no);
  }
  const held = /(?:别|暂停|先不|不必|暂缓|不要)[^，。]{0,10}退/.test(text);
  const confirms = /^(?:(?:请|帮我)\s*)?(?:确认|提交)退款/.test(text);
  const execute = /(?:继续|接着|执行|办理|准备|试算)(?:[^，。]{0,55}退款)|退款预览/.test(text)
    && !/查|看|核对/.test(text);
  const wants = /应收冲减|月结差异|待退|实退|退款(?:单|了|进度|情况|金额)|退货.{0,15}退款|部分退款|退款冲回/.test(text)
    && (refs.sale || refs.return || refs.refund || /销售|退货/.test(text));
  if (!wants && !execute && !confirms && !(context && (Object.keys(refs).length || /退了多少|还欠多少|再查原单|现在差异|退款/.test(text)))) return null;
  const multiple = Object.keys(refs).find(kind => refs[kind].size > 1);
  const captured = Object.fromEntries(Object.entries(refs).map(([kind, numbers]) => [kind, numbers.size === 1 ? [...numbers][0] : undefined]));
  const amounts = [...text.matchAll(/(?<![\d.])(?:[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块))/g)];
  return { refs: captured, multiple, action: held ? 'read' : confirms ? 'confirm' : execute ? 'prepare' : 'read',
    amountCents: amounts.length === 1 ? cashUnits(amounts[0][1] ?? amounts[0][2]) : null,
    uncertain: amounts.length > 1 || amounts.length === 1 && !cashUnits(amounts[0][1] ?? amounts[0][2])
      || /一半|百分之|[%％]|如果|只要|或者|退全部/.test(text),
    bareRefund: Object.keys(captured).length === 1 && Boolean(captured.refund)
      && /^\s*(?:退款单号?\s*(?:是|为|[：:])?\s*)?[a-z][a-z\d_-]+[。！？!?]*$/i.test(text) };
}

async function recordForSale(client, saleNo) {
  const { list } = await collectList(client, '/api/payments/', { type: '2', orderNo: saleNo });
  const matches = list.filter(row => Number(row.type) === 2 && linkedNo(row.orderNo, saleNo) && id(row.id) && id(row.orderId));
  if (matches.length > 1) throw new Error('原销售单关联多个应收，财务须核对原账款。');
  return matches[0] ?? null;
}

export async function refundDetail(client, row) {
  const raw = await client.get('/api/refunds/' + row.id + '?trace=1');
  if (id(raw?.id) !== id(row.id) || !linkedNo(raw.refundNo, row.refundNo) || id(raw.saleOrderId) !== id(row.saleOrderId)
    || !linkedNo(raw.saleOrderNo, row.saleOrderNo) || !id(raw.saleOrderId) || !Array.isArray(raw.trace?.warehouseIds)
    || !raw.trace.warehouseIds.length || raw.trace.warehouseIds.some(value => !id(value))
    || !Array.isArray(raw.trace.outgoing) || ![1, 2, 3, 4].includes(Number(raw.status))) {
    throw new Error('原退款单与销售单关联未能核实。');
  }
  return raw;
}

export async function refundByNumber(client, no) {
  const { list } = await collectList(client, '/api/refunds', { keyword: no });
  const rows = list.filter(row => id(row.id) && linkedNo(row.refundNo, no));
  return rows.length === 1 ? refundDetail(client, rows[0]) : null;
}

export async function saleByReturnNumber(client, no) {
  const { list } = await collectList(client, '/api/returns/sale', { keyword: no });
  const rows = list.filter(row => linkedNo(row.returnNo, no) && id(row.id) && id(row.saleOrderId) && row.saleOrderNo);
  return rows.length === 1 ? rows[0].saleOrderNo.toUpperCase() : null;
}

async function statementForRecord(client, record, number) {
  const { list } = await collectList(client, '/api/payments/statements', { type: '2', recordId: String(record.id), ...(number ? { statementNo: number } : {}) });
  const rows = list.filter(row => Number(row.type) === 2 && id(row.id) && (!number || linkedNo(row.statementNo, number)));
  if (rows.length > 1) throw new Error('原应收属于多张对账单，请财务核对关联。');
  if (!rows.length) return null;
  const row = rows[0];
  const detail = await client.get('/api/payments/statements/' + row.id + '?trace=1');
  if (id(detail?.id) !== id(row.id) || !linkedNo(detail.statementNo, row.statementNo) || Number(detail.type) !== 2
    || !detail.items?.some(item => id(item.recordId) === id(record.id) && id(item.orderId) === id(record.orderId) && linkedNo(item.orderNo, record.orderNo))) {
    throw new Error('原应收与指定月结对账单未能核实关联。');
  }
  return statementEvidence(detail);
}

export async function readReturnFinanceLedger(client, saleNo, refs = {}) {
  const record = await recordForSale(client, saleNo);
  const issues = [], lines = [], receipts = [];
  if (!record) return { lines: ['未能在完整销售单号下核实原应收。'], issues, record };
  const [total, paid, balance] = [record.totalAmount, record.paidAmount, record.balance].map(value => cashUnits(value, 4));
  const status = balance === 0 ? 3 : paid > 0 ? 2 : 1;
  const disputed = [total, paid, balance].some(value => value == null) || total !== paid + balance || Number(record.status) !== status;
  if (disputed) {
    issues.push('原应收余额或状态有差异，请财务核对原账款。');
  }
  lines.push('原应收 ' + yuan(total) + '，当前净实收 ' + yuan(paid) + '，欠款 ' + yuan(balance) + (disputed ? '（账面待核）。' : '。'));
  let entryRefund = null;
  try {
    const entries = await client.get('/api/payments/' + record.id + '/entries?trace=1');
    if (!Array.isArray(entries) || new Set(entries.map(row => id(row.id))).size !== entries.length
      || entries.some(row => !id(row.id) || id(row.recordId) !== id(record.id) || units(row.amount) == null
        || units(row.amount) < 0 && (row.method !== 'refund' || row.receiptId != null))) throw new Error('分录身份未核实');
    const net = entries.reduce((sum, row) => sum + units(row.amount), 0);
    if (paid !== net) {
      issues.push(paid != null && Number.isSafeInteger(paid - net)
        ? `原应收与净收款分录差异 ${yuan(Math.abs(paid - net))}，账面净实收 ${yuan(paid)}，分录净额 ${yuan(net)}。请财务核对。`
        : '原应收的账面净实收与分录净额待财务核对。');
    }
    entryRefund = -entries.filter(row => row.method === 'refund' && units(row.amount) < 0).reduce((sum, row) => sum + units(row.amount), 0);
    lines.push('账款退款冲回 ' + yuan(entryRefund) + '。');
    const selected = entries.filter(row => row.receiptId && (!refs.receipt || linkedNo(row.receiptNo, refs.receipt)));
    const byReceipt = Map.groupBy(selected, row => id(row.receiptId));
    if (refs.receipt && !byReceipt.size) issues.push('未能核实指定收款单与原销售单的关联。');
    const details = await Promise.allSettled([...byReceipt].map(async ([receiptId, rows]) => {
      if (!receiptId) throw new Error('原收款单编号无效');
      const receipt = await client.get('/api/payments/receipts/' + receiptId + '?trace=1');
      const matches = receipt?.settlements?.filter(item => id(item.recordId) === id(record.id) && id(item.orderId) === id(record.orderId)
        && linkedNo(item.orderNo, saleNo) && Number(item.type) === 2);
      if (id(receipt?.id) !== receiptId || Number(receipt.type) !== 2 || !matches || matches.length !== rows.length
        || new Set(matches.map(item => id(item.entryId))).size !== matches.length
        || rows.some(row => !linkedNo(receipt.receiptNo, row.receiptNo)
          || !matches.some(item => id(item.entryId) === id(row.id) && units(item.amount) === units(row.amount)
            && id(item.statementId) === id(row.statementId)))) throw new Error('原收款关联未核实');
      const received = cashUnits(receipt.amount, 4), settled = cashUnits(receipt.settledAmount, 4), balance = cashUnits(receipt.balance, 4);
      const applied = rows.reduce((sum, row) => sum + units(row.amount), 0);
      if ([received, settled, balance].some(value => value == null) || received !== settled + balance || settled < applied) {
        throw new Error('原收款总额未对平');
      }
      return { number: receipt.receiptNo, date: receipt.paymentDate, fundId: id(receipt.fundSourceId),
        line: receipt.receiptNo + ' 本销售单原核销 ' + yuan(applied) + '，收款单余款 ' + yuan(balance) + '。' };
    }));
    for (const item of details) {
      if (item.status === 'fulfilled') { receipts.push(item.value); lines.push(item.value.line); }
      else issues.push('原收款金额或与原销售单的核销关联有差异，请财务核对。');
    }
  } catch { issues.push('原应收分录暂未核实，请财务核对。'); }

  let statement;
  try {
    statement = await statementForRecord(client, record, refs.statement);
    if (statement) {
      const { statement: source, paid: net, due: owing, members } = statement;
      const member = members.find(row => row.recordId === id(record.id) && row.orderId === id(record.orderId));
      const phase = Number(source.status) === 1 ? '草稿待确认' : Number(source.status) === 3 ? '已确认、已结清' : '已确认';
      lines.push(source.statementNo + ' ' + phase + '，对账单净核销 ' + yuan(net) + '，对账单欠款 ' + yuan(owing) + '。');
      issues.push(...statement.issues);
      if (!member) issues.push('对账单本销售行与原应收的身份待财务核对。');
      else {
        const fields = [['应收', member.total, total], ['净实收', member.paid, paid], ['欠款', member.due, balance]];
        for (const [label, statementValue, ledgerValue] of fields) {
          if (statementValue === ledgerValue) continue;
          issues.push(ledgerValue != null && Number.isSafeInteger(statementValue - ledgerValue)
            ? `对账单 ${source.statementNo} 本销售行${label} ${yuan(statementValue)}，原应收${label} ${yuan(ledgerValue)}，差额 ${yuan(Math.abs(statementValue - ledgerValue))}。`
            : `对账单 ${source.statementNo} 本销售行${label}与原应收待核对。`);
        }
      }
    } else if (refs.statement) issues.push('未能核实指定对账单与原销售单的关联。');
    else if (Number(record.settlementType) === 2) lines.push('原应收当前未查到汇总对账单。');
  } catch (error) { issues.push(error.message); }
  return { record, lines, issues, statement, entryRefund, receipts };
}

function refundFacts(rows) {
  const lines = [], issues = [];
  let outgoing = 0, pending = 0, drafts = 0;
  for (const row of rows) {
    const amount = cashUnits(row.amount, 4);
    const sent = row.trace.outgoing.map(value => cashUnits(value, 4));
    const no = row.refundNo;
    if (amount == null || row.trace.fundConflict || Number(row.status) !== 3 && sent.length) {
      issues.push(no + ' 的退款金额或资金流水有差异，请财务核对。');
    } else if (Number(row.status) === 3) {
      if (sent.length === 1 && sent[0] === amount) {
        outgoing += amount;
        lines.push(no + ' 已出账 ' + yuan(amount) + '。');
      } else {
        issues.push(no + ' 已完成退款登记，实际出账未核实，请财务核对付款凭证。');
      }
    } else if (Number(row.status) === 2) {
      pending += amount;
      lines.push(no + ' 已确认待退 ' + yuan(amount) + '，由有退款执行权限的财务办理。');
    } else if (Number(row.status) === 1) {
      drafts += amount;
      lines.push(no + ' 草稿 ' + yuan(amount) + '，由有退款单权限的财务核对并确认。');
    }
  }
  return { lines, issues, outgoing, pending, drafts };
}

export async function refundsForSale(client, saleNo, saleId, recordId) {
  const { list } = await collectList(client, '/api/refunds', { saleOrderNo: saleNo });
  const candidates = list.filter(row => id(row.id) && linkedNo(row.saleOrderNo, saleNo));
  const originId = saleId ?? id(candidates[0]?.saleOrderId);
  if (candidates.some(row => id(row.saleOrderId) !== originId)) throw new Error('原退款销售身份冲突');
  const rows = await Promise.all(candidates.map(row => refundDetail(client, row)));
  if (recordId && rows.some(row => id(row.paymentRecordId) !== recordId)) throw new Error('原退款关联未核实');
  return rows;
}

export async function readReturnFinance(client, actor, saleNo, refs, namedRefund) {
  const lines = ['原销售单 ' + saleNo], issues = [], permissions = [], scope = new Set();
  let saleId = id(namedRefund?.saleOrderId);
  let ledger;
  if (hasPerm(actor, 'payment.view')) {
    permissions.push('payment.view');
    try {
      ledger = await readReturnFinanceLedger(client, saleNo, refs);
      const linkedId = id(ledger.record?.orderId);
      if (saleId && linkedId && saleId !== linkedId) throw new Error('退款单与原销售单应收关联有差异。');
      saleId ??= linkedId;
      lines.push(...ledger.lines);
      issues.push(...ledger.issues);
    } catch { issues.push('当前未能核实唯一原销售应收，请财务核对。'); }
  }
  if (hasPerm(actor, 'return.order.view')) {
    permissions.push('return.order.view');
    try {
      const source = await saleReturnSource(client, actor, saleNo);
      if (source.ids.length > 1 || saleId && source.ids.some(value => value !== saleId)) throw new Error('来源冲突');
      saleId ??= source.ids[0];
      const back = await traceReturns(client, actor, source, saleId, saleNo, refs.return);
      if (!back.total) lines.push(refs.return ? '未能核实指定退货单与原销售单的关联。' : '当前可见范围未查到原销售单退货。');
      for (const row of back.rows) {
        if (!row.id) continue;
        const detail = row.execution?.map(item => item.name + ' 实收 ' + item.received / 100 + ' ' + item.unit + '，'
          + (row.status === 4 ? '历史入仓 ' : '已入仓 ') + item.passed / 100 + ' ' + item.unit + '，拒收 ' + item.rejected / 100 + ' ' + item.unit).join('、');
        lines.push(row.no + ' ' + row.label + (detail ? '，' + detail : '')
          + (row.status === 3 ? '，应收冲减 ' + yuan(row.executedAmount) : '') + '。');
        if (row.status === 1) lines.push('下一步由有退货确认权限的销售核对原退货单。');
        if (row.status === 2) lines.push('下一步由仓库按原退货任务处理收货、质检或上架，销售或客服跟进原单。');
      }
      if (back.incomplete) issues.push('部分退货事实或应收冲减待核对。');
      source.warehouseIds.forEach(value => scope.add(value));
    } catch { issues.push('原销售单的退货关系未核实，请销售和仓库核对。'); }
  } else lines.push('实收退货数量及单笔冲减需有退货单查看权限。');

  if (hasPerm(actor, 'refund.order.view')) {
    permissions.push('refund.order.view');
    try {
      const refunds = await refundsForSale(client, saleNo, saleId, id(ledger?.record?.id));
      refunds.forEach(row => row.trace.warehouseIds.forEach(value => scope.add(value)));
      const facts = refundFacts(refunds);
      if (refunds.length) lines.push('原销售单退款合计，已出账 ' + yuan(facts.outgoing) + '，已确认待退 ' + yuan(facts.pending)
        + (facts.drafts ? '，另有草稿 ' + yuan(facts.drafts) : '') + '。');
      else lines.push('当前可见范围未找到原退款单，实际出账和待退金额待核实。');
      lines.push(...(refs.refund ? facts.lines.filter(line => linkedNo(line.split(' ')[0], refs.refund)) : facts.lines));
      issues.push(...facts.issues);
      if (ledger?.entryRefund != null && ledger.entryRefund !== facts.outgoing) {
        const difference = facts.outgoing - ledger.entryRefund;
        issues.push(refunds.length && !facts.issues.length && Number.isSafeInteger(difference)
          ? `退款出账与应收退款冲回有差异。已核实出账 ${yuan(facts.outgoing)}，原应收退款分录 ${yuan(ledger.entryRefund)}，差额 ${yuan(Math.abs(difference))}。请财务核对原退款单与资金流水。`
          : '原应收的退款分录、原退款单及资金流水仍需财务核对。');
      }
    } catch { issues.push('原退款单或资金流水暂未核实，请财务核对。'); }
  } else lines.push('已出账和已确认待退金额需有退款单查看权限，由财务凭原退款单核对。');
  lines.push('退款单关联到销售应收，单笔退货和收款的金额以各自原单分录为准。');
  if (issues.length) lines.push(...new Set(issues), '下一步由财务核对原应收、到账凭证及月结对账差异。' + financeLink);
  else lines.push('下一步由财务在原单核对待退款及未结应收。' + (hasPerm(actor, 'refund.order.view') ? refundLink : ''));
  return { reply: lines.join('\n'), permissions, scope: [...scope], result: { saleOrderNo: saleNo, hasDifferences: issues.length > 0 } };
}

export async function buildRefundPreview(client, row, refs = {}) {
  const ledger = await readReturnFinanceLedger(client, row.saleOrderNo, refs);
  const record = ledger.record;
  if (ledger.issues.length) throw new Error('原应收或月结有差异，请财务先核对。\n' + ledger.issues.join('\n'));
  if (!record || id(record.id) !== id(row.paymentRecordId) || id(record.orderId) !== id(row.saleOrderId) || !linkedNo(record.orderNo, row.saleOrderNo)) {
    throw new Error('原退款单与原销售单应收关联未核实。');
  }
  const [amount, total, paid, balance] = [row.amount, record.totalAmount, record.paidAmount, record.balance].map(value => cashUnits(value));
  if ([amount, total, paid, balance].some(value => value == null) || !amount || total !== paid + balance || amount > paid) {
    throw new Error('原账款金额不可继续退款，请财务核对实收、余额及历史金额。');
  }
  if (Number(row.status) !== 2) throw new Error('原退款单当前未处于已确认待退款，请在原退款单核对状态。');
  if (!id(row.accountId) || !/^\d{4}-\d{2}-\d{2}$/.test(row.trace.effectiveDate) || row.trace.fundConflict || row.trace.outgoing.length) {
    throw new Error('请财务先核对退款账户、日期和已有出账凭据。');
  }
  const existingRefunds = await refundsForSale(client, row.saleOrderNo, id(row.saleOrderId), id(row.paymentRecordId));
  const current = existingRefunds.find(item => id(item.id) === id(row.id));
  const prior = refundFacts(existingRefunds);
  if (!current || Number(current.status) !== 2 || prior.issues.length || ledger.entryRefund !== prior.outgoing) {
    throw new Error('原销售单的退款出账与账款有差异，请财务核对原退款和资金流水。');
  }
  let statement = null;
  if (ledger.statement) {
    const { statement: source, total, paid, due } = ledger.statement;
    if ([total, paid, due].some(value => value % 100)) throw new Error('原月结对账金额含历史非分值，请财务核对。');
    statement = { id: id(source.id), no: source.statementNo, status: Number(source.status), totalCents: total / 100, paidCents: paid / 100, balanceCents: due / 100 };
  }
  const expected = { refundNo: row.refundNo, saleOrderId: id(row.saleOrderId), saleOrderNo: row.saleOrderNo, paymentRecordId: id(record.id),
    accountId: id(row.accountId), effectiveDate: row.trace.effectiveDate, amountCents: amount, totalCents: total, paidCents: paid, balanceCents: balance, statement };
  return {
    refundId: id(row.id), refundNo: row.refundNo, saleOrderNo: row.saleOrderNo, statementNo: statement?.no,
    account: { id: expected.accountId, name: '账户 #' + expected.accountId }, paymentDate: expected.effectiveDate,
    totalCents: amount, title: '退款确认', confirmLabel: '确认退款出账', _expectedRefund: expected, _scope: row.trace.warehouseIds,
  };
}

export function refundPreviewReply(preview) {
  const p = preview._expectedRefund;
  return '原退款单 ' + p.refundNo + '，关联销售单 ' + p.saleOrderNo
    + (p.statement ? '、对账单 ' + p.statement.no : '') + '。本次退款 ' + yuan(p.amountCents, 2)
    + '，退款后原销售单净实收 ' + yuan(p.paidCents - p.amountCents, 2) + '，欠款 '
    + yuan(p.balanceCents + p.amountCents, 2) + '。请核对实际退款账户和业务日期后点击确认。';
}

export function refundReceiptMatches(data, preview) {
  return id(data?.id) === preview.refundId && data.refundNo === preview.refundNo && cashUnits(data.amount) === preview.totalCents;
}
