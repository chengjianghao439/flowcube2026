import { cashUnits, exactReceipt } from './receipt-allocation.js';
import { exactStatement } from './monthly-reconciliation.js';
import { FlowError } from './flow.js';
import { RECOVERY_STATES } from './history-resume.js';
import { collectList } from './pagination.js';
import { hasPerm } from './perms.js';
import {
  RETURN_READ, REFUND_PERMISSIONS, returnFinanceRequest, linkedNo, saleByReturnNumber,
  refundByNumber, refundsForSale, readReturnFinanceLedger, buildRefundPreview,
} from './return-finance.js';

export const CROSS_PERIOD = 'Q-cross-period';
export const BACKFILL_ACTION = 'R-backfill-action';
export const APPLY_BACKFILL = 'finance.period.backfill';
export const APPROVE_BACKFILL = 'finance.period.backfill.approve';
const VOUCHER_VIEW = 'accounting.voucher.view';
export const CROSS_PERIOD_READ = [...RETURN_READ, APPLY_BACKFILL, APPROVE_BACKFILL];
const BACKFILLS = '/api/accounting/backfills';
const page = '[[跨期补录审批|/accounting/backfills]]';
const applicationPattern = /(?<![a-z\d_-])BF-\d{8}-\d{4,}(?![a-z\d_-])/gi;
const literalAnswer = /^(?:退款单号?|退货单号?|销售单号?|补录申请(?:单号?)?)?\s*(?:是|为|[:：])?\s*(?:[a-z][a-z\d_-]+)[。！？!?]*$/i;
const reasonPattern = /(?:^|[，,。；;\s])(?:(?:补录)?原因\s*(?:[：:]|是)|因为)\s*([^。；;\n]+)[。！!]?$/;
const phaseTopic = /跨月|跨年|跨期|已[封结]账|结账期间|补录|(?:记|入账|归属|凭证|冲减|退货|退款|到账|原账).{0,12}(?:哪一?期|哪个月|几月|期间)/;
const businessTopic = /销售|退货|退款|补录|收款|对账|\b(?:SL|SR|RF|RC|SC)[-_]?\d{6,}/i;
const fieldNames = { sale: '销售单号', return: '退货单号', refund: '退款单号', receipt: '收款单号', statement: '对账单号', application: '补录申请单号' };
const actions = { apply: '提交补录申请', approve: '批准并执行', execute: '重试执行' };
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function crossPeriodRequest(text, context) {
  if (/供应商退款|采购退货|报销补录|采购补录/.test(text)) return null;
  const t = text.trim().replace(/^(?:(?:小满|请|帮我|麻烦)[，,：:\s]*)+/, '');
  const reason = t.match(reasonPattern)?.[1]?.trim();
  const applications = [...new Set((t.match(applicationPattern) ?? []).map(no => no.toUpperCase()))];
  const continuation = Boolean(context && (literalAnswer.test(t) || reason && !phaseTopic.test(t) || /^(?:(?:再查|继续查|核对)(?:一下)?原(?:单|申请)|(?:刚才|之前|原来)(?:那张|那笔|那个)?(?:补录|申请)(?:呢|怎么样)?)[。！!？?]?$/.test(t)));
  if (!applications.length && (!phaseTopic.test(t) || !businessTopic.test(t)) && !continuation) return null;
  if (/^(?:继续|续办|恢复)(?:办(?:理)?)?(?:刚才|之前|上次|原来|原)(?:的|那张|那笔)?(?:退款)?补录(?:任务|申请|记录)?(?:\s|$)/.test(t)
    && !context) return null;
  const returning = returnFinanceRequest(t, true);
  const refs = { ...returning?.refs, ...(applications.length === 1 ? { application: applications[0] } : {}) };
  const multiple = returning?.multiple ?? (applications.length > 1 ? 'application' : null);
  const request = { refs, multiple, reason, continuation, action: 'read' };
  if (!/^(?:查|看|核对|解释|说明|别|暂停|先不|暂缓|不要)/.test(t)) {
    if (/^(?:重试执行|继续执行|执行)\s*(?:(?:这张|该|原)?(?:跨期)?补录申请|(?=BF-))/i.test(t)) request.action = 'execute';
    else if (/^(?:批准|通过|审批通过)\s*(?:(?:这张|该|原)?(?:跨期)?补录申请|(?=BF-))/i.test(t)) request.action = 'approve';
    else if (/^(?:(?:提交|发起|申请)(?:退款)?(?:跨期)?补录(?:申请)?|(?:为|对)退款单.{0,45}申请(?:跨期)?补录)/.test(t)) request.action = 'apply';
    else if (/^(?:确认|同意).*(?:跨期|补录)/.test(t)) request.action = 'confirm';
  }
  request.uncertain = request.action !== 'read' && /如果|只要|或者|改成|换成|先不|不要|暂缓|等.+再/.test(reason ? t.split(reason)[0] : t);
  return request;
}

const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });
function day(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}(?:$| )/.test(value)) return value.slice(0, 10);
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? dayFormat.format(stamp) : null;
}

function month(value) {
  const m = String(value ?? '').match(/^(\d{4})-?(0[1-9]|1[0-2])(?:$|-)/);
  return m ? m[1] + '年' + Number(m[2]) + '月' : null;
}

const backfillView = actor => hasPerm(actor, APPROVE_BACKFILL) ? APPROVE_BACKFILL : hasPerm(actor, APPLY_BACKFILL) ? APPLY_BACKFILL : null;
export const closedRefundReply = row => `原退款单 ${row.refundNo} 的业务日期 ${row.trace.effectiveDate} 属于${month(row.trace.businessPeriod)}，该期间已结账。请保留实际业务日期，由有权限的财务申请跨期补录，再由另一位有审批权限的财务审批。审批通过且当期开放时，调整凭证记在审批日期所属期间。`;

async function applicationByNumber(client, number) {
  return findApplication(client, { applicationNo: number }, row => linkedNo(row.applicationNo, number));
}

async function findApplication(client, filters, matches) {
  const { list } = await collectList(client, BACKFILLS, { bizType: 'refund', ...filters });
  const rows = list.filter(row => row.bizType === 'refund' && id(row.id) && matches(row));
  if (rows.length !== 1) return null;
  const row = rows[0];
  const detail = await client.get(BACKFILLS + '/' + row.id);
  return id(detail?.id) === id(row.id) && linkedNo(detail.applicationNo, row.applicationNo)
    && detail.bizType === 'refund' && id(detail.bizId) === id(row.bizId) && linkedNo(detail.bizNo, row.bizNo) ? detail : null;
}

const appSale = app => app?.requestSnapshot?.body?.saleOrderNo;
function applicationMatches(app, refs) {
  return Boolean(id(app?.bizId) && (!refs.sale || linkedNo(appSale(app), refs.sale)) && (!refs.refund || linkedNo(app.bizNo, refs.refund)));
}

function applicationLine(app) {
  const original = month(app.period);
  const basis = `补录申请 ${app.applicationNo}，原退款单 ${app.bizNo}，原业务日期 ${day(app.businessDate) ?? '待核实'}` + (original ? `，归属${original}` : '') + '。';
  if (Number(app.status) === 0) return basis + '待审批。下一步由申请人以外、具有跨期补录审批权限的财务核对并批准。调整凭证按审批当天所属开放期间归属。';
  if (Number(app.status) === 2 || Number(app.status) === 4) return basis + (Number(app.status) === 2 ? '已驳回。' : '已作废。') + '下一步由财务申请人核对原单和审批结论。';
  if (Number(app.status) !== 1) return basis + '历史申请，下一步由财务核对原申请、资金流水和凭证。';
  if (!app.executedAt) return basis + '已批准，待执行。' + (month(day(app.approvedAt)) ? `调整凭证应归属原审批日期所在的${month(day(app.approvedAt))}。` : '审批期间待财务核实。')
    + (app.approvalPeriodClosed ? '原审批期间已结账，下一步由财务负责人核对处理方式。'
      : '下一步由有审批权限的财务核对该期间和原退款单后，在原申请重试执行。');
  if (id(app.executedBizId) !== id(app.bizId) || !month(app.postingPeriod)) return basis + '已有执行记录，下一步由财务核对记账期间和原资金流水。';
  return basis + `已记账，调整凭证归属${month(app.postingPeriod)}。`
    + (app.voucherGeneratedAt && !app.voucherPending ? '调整凭证已生成。' : '凭证待生成。下一步由有审批权限的财务在原申请重试生成凭证。');
}

async function voucherMonths(client, type, number, ids) {
  if (!ids.length) return [];
  const { list } = await collectList(client, '/api/accounting/vouchers', { sourceType: type, keyword: number });
  const rows = list.filter(row => row.sourceType === type && linkedNo(row.sourceNo, number));
  const rootIds = rows.filter(row => ids.includes(id(row.sourceId))).map(row => id(row.id));
  return [...new Set(rows.filter(row => (ids.includes(id(row.sourceId)) || rootIds.includes(id(row.sourceRootId)))
    && !Number(row.isReversal) && [1, 2].includes(Number(row.status))).map(row => row.period))]
    .sort().map(month).filter(Boolean);
}

async function saleReturns(client, refs) {
  const { list } = await collectList(client, '/api/returns/sale', { saleOrderNo: refs.sale });
  const candidates = list.filter(row => linkedNo(row.saleOrderNo, refs.sale) && (!refs.return || linkedNo(row.returnNo, refs.return)));
  return Promise.all(candidates.map(async row => {
    if (!id(row.id) || !id(row.saleOrderId) || !id(row.warehouseId)) throw new Error('退货身份不完整');
    const detail = await client.get('/api/returns/sale/' + row.id + '?trace=1');
    if (id(detail?.id) !== id(row.id) || id(detail.saleOrderId) !== id(row.saleOrderId) || id(detail.warehouseId) !== id(row.warehouseId)
      || !linkedNo(detail.saleOrderNo, refs.sale) || !linkedNo(detail.returnNo, row.returnNo)) throw new Error('原退货单关联变动');
    return detail;
  }));
}

function saleIdOf(ledger, returns, refunds) {
  const ids = new Set([ledger?.record?.orderId, ...returns.map(row => row.saleOrderId), ...refunds.map(row => row.saleOrderId)].map(id).filter(Boolean));
  return { saleId: ids.size === 1 ? [...ids][0] : null, inconsistent: ids.size > 1 };
}

async function readTimeline(client, actor, refs, namedRefund, namedApp) {
  const lines = [`原销售单 ${refs.sale}`], issues = [], permissions = new Set(), scope = new Set();
  const canVoucher = hasPerm(actor, VOUCHER_VIEW);
  const [ledgerRead, returnRead] = await Promise.allSettled([
    hasPerm(actor, 'payment.view') ? readReturnFinanceLedger(client, refs.sale, refs) : null,
    hasPerm(actor, 'return.order.view') ? saleReturns(client, refs) : [],
  ]);
  const ledger = ledgerRead.value, returns = returnRead.value ?? [];
  let refunds = [];
  if (hasPerm(actor, 'refund.order.view')) {
    try {
      refunds = namedRefund ? [namedRefund] : await refundsForSale(client, refs.sale, id(ledger?.record?.orderId), id(ledger?.record?.id));
    } catch { issues.push('退款台账暂未核实，请财务查原退款单和出账。'); }
  }
  const { saleId, inconsistent } = saleIdOf(ledger, returns, refunds);
  if (inconsistent || namedRefund && ledger?.record && id(namedRefund.paymentRecordId) !== id(ledger.record.id)) {
    return { reply: '原销售单与各单据的来源编号存在差异。下一步由财务核对原销售应收及关联单据。', permissions: [], scope: [] };
  }
  const periodsFor = async (type, no, ids) => {
    if (!canVoucher) return [];
    try {
      const result = await voucherMonths(client, type, no, ids);
      if (result.length) permissions.add(VOUCHER_VIEW);
      return result;
    } catch { return []; }
  };
  const original = await periodsFor('sale_revenue', refs.sale, saleId ? [saleId] : []);
  lines.push(original.length ? '原销售收入凭证期间 ' + original.join('、') + '。' : '原销售实际凭证期间待核实，请财务查看原销售收入凭证。');
  if (ledgerRead.status === 'rejected') {
    issues.push('原应收暂未核实，请财务核对原销售账款。');
  } else if (ledger) {
    permissions.add('payment.view');
    lines.push(ledger.lines[0]);
    for (const receipt of ledger.receipts ?? []) {
      lines.push(`原收款单 ${receipt.number}，到账业务日期 ${day(receipt.date) ?? '待核实'}`
        + (month(day(receipt.date)) ? `（${month(day(receipt.date))}）` : '') + '。' + receipt.line);
      const periods = await periodsFor('receipt_in', receipt.number, receipt.fundId ? [receipt.fundId] : []);
      if (periods.length) lines.push(`收款单 ${receipt.number} 的凭证期间 ${periods.join('、')}。`);
      else lines.push(`收款单 ${receipt.number} 的实际凭证期间由财务核对。`);
    }
    if (ledger.statement) {
      const { statement, issues: statementIssues } = ledger.statement;
      lines.push(`原对账单 ${statement.statementNo}，对账区间 ${day(statement.periodStart) ?? '待核实'} 至 ${day(statement.periodEnd) ?? '待核实'}`
        + (statementIssues.length ? '，账面有差异。' : (Number(statement.status) === 1 ? '，待确认。' : '，已确认。')));
    }
    issues.push(...ledger.issues);
  } else lines.push('该账号的原收款、对账和应收由财务核对。');
  if (returnRead.status === 'rejected' || refs.return && !returns.length) issues.push('指定退货单或退货记录未核实，请仓库和财务核对原退货。');
  for (const row of returns) {
    permissions.add('return.order.view');
    scope.add(id(row.warehouseId));
    const executed = month(day(row.executedAt)), basis = month(day(row.postingBasisDate));
    const periods = await periodsFor('sale_return', row.returnNo, [id(row.id)]);
    if (Number(row.status) === 3 && executed && row.executedAmount != null) {
      lines.push(`退货单 ${row.returnNo}，${executed}执行，应收冲减 ¥${Number(row.executedAmount).toFixed(2)}。 `
        + (periods.length ? '退货凭证期间 ' + periods.join('、') + '。' : basis ? `退货凭证按${basis}归属，实际凭证请财务核对。` : '请财务核对退货凭证期间。'));
      if (basis && executed !== basis) issues.push(`退货单 ${row.returnNo} 的执行月与凭证依据月不同，下一步由财务核对原事件及凭证。`);
    } else if (Number(row.status) === 3) {
      issues.push(`退货单 ${row.returnNo} 已完成，冲减日期及金额由仓库和财务核对原执行记录。`);
    } else {
      lines.push(`退货单 ${row.returnNo}，${Number(row.status) === 4 ? '已取消，请销售或财务核对原单。' : '尚未核实退货完成。销售确认原退货，仓库核收后再由财务核对冲减。'}`);
    }
  }
  const applications = namedApp ? [namedApp] : [];
  const backfillPermission = backfillView(actor);
  for (const row of refunds) {
    permissions.add('refund.order.view');
    row.trace.warehouseIds.forEach(value => scope.add(id(value)));
    const when = month(row.trace.businessPeriod) ?? month(day(row.trace.effectiveDate));
    const funds = row.trace.fundTransactions ?? [];
    const proven = Number(row.status) === 3 && !row.trace.fundConflict && funds.length === 1
      && row.trace.outgoing.length === 1 && Number(row.trace.outgoing[0]) === Number(row.amount);
    if (proven) {
      const [fund] = funds;
      const periods = await periodsFor('refund_pay', row.refundNo, [id(fund.id)].filter(Boolean));
      lines.push(`退款单 ${row.refundNo} 已出账 ¥${Number(row.amount).toFixed(2)}，流水业务日期 ${day(fund.businessDate) ?? '待核实'}。`
        + (periods.length ? `退款凭证期间 ${periods.join('、')}。`
          : `凭证按${month(day(fund.postingDate)) ?? '待核实期间'}归属，实际凭证由财务核对。`));
    } else if (Number(row.status) === 3) {
      issues.push(`退款单 ${row.refundNo} 已完成登记，实际出账和凭证期间由财务核对资金流水。`);
    } else if (Number(row.status) === 2 && row.trace.periodClosed) {
      lines.push(closedRefundReply(row));
    } else if (Number(row.status) === 2) {
      lines.push(`退款单 ${row.refundNo} 待出账，业务日期 ${day(row.trace.effectiveDate) ?? '待核实'}`
        + (when ? `（${when}）` : '') + '。下一步由财务按原业务日期核对账户、期间和应收。');
    } else {
      lines.push(`退款单 ${row.refundNo} ${Number(row.status) === 1 ? '为草稿待确认' : '已取消'}，下一步由财务核对原退款单。`);
    }
    if (!backfillPermission || namedApp || !row.trace.periodClosed && !funds.some(fund => fund.backfillId)) continue;
    try {
      const { list } = await collectList(client, BACKFILLS, { bizType: 'refund', bizId: String(row.id) });
      for (const app of list.filter(app => app.bizType === 'refund' && id(app.bizId) === id(row.id) && linkedNo(app.bizNo, row.refundNo))) {
        applications.push(app);
      }
    } catch { issues.push('补录阶段暂未核实，下一步由财务查看原申请。'); }
  }
  if (applications.length) {
    permissions.add(backfillPermission);
    lines.push(...applications.map(applicationLine), page);
  }
  lines.push(...new Set(issues));
  return { reply: lines.join('\n'), permissions: [...permissions], scope: [...scope] };
}

function actionPermissions(action) {
  return action === 'apply' ? [...REFUND_PERMISSIONS, APPLY_BACKFILL] : [APPROVE_BACKFILL];
}

function stableApp(app) {
  return { bizId: id(app.bizId), bizNo: app.bizNo, applicantId: id(app.applicantId), period: app.period,
    businessDate: day(app.businessDate), saleOrderNo: appSale(app), amount: Number(app.amount), approvedDate: day(app.approvedAt) };
}

function sameApp(app, preview) {
  const current = app && stableApp(app), expected = preview._expectedApp;
  return id(app?.id) === preview.applicationId && linkedNo(app.applicationNo, preview.applicationNo)
    && current.bizId === expected.bizId && linkedNo(current.bizNo, expected.bizNo)
    && linkedNo(current.saleOrderNo, expected.saleOrderNo) && current.applicantId === expected.applicantId
    && current.period === expected.period && current.businessDate === expected.businessDate && current.amount === expected.amount;
}

async function checkLinkedLedger(client, actor, refs, sale) {
  if (!refs.receipt && !refs.statement) return true;
  if (!sale || !hasPerm(actor, 'payment.view')) return false;
  try {
    const ledger = await readReturnFinanceLedger(client, sale, refs);
    return Boolean(ledger.record && !ledger.issues.length && (!refs.receipt || ledger.receipts?.length === 1)
      && (!refs.statement || ledger.statement));
  } catch { return false; }
}

export async function runCrossPeriod(store, client, actor, text, request, context, resume) {
  if (resume && context?.graph === BACKFILL_ACTION && RECOVERY_STATES.has(context.state)
    && request.continuation && !Object.keys(request.refs).length) return resume(context.id);
  const pending = context?.graph === CROSS_PERIOD && context.state === 'DISAMBIGUATING' && request.continuation ? context : null;
  const action = pending?.intent?.action ?? request.action;
  const original = context?.intent?.refs;
  const sameReference = request.continuation && !Object.keys(request.refs).length;
  const refs = { ...(pending || sameReference ? original : {}), ...request.refs };
  if (sameReference && context?.result?.applicationNo) refs.application ??= context.result.applicationNo;
  if (action !== 'read') {
    refs.sale ??= original?.sale;
    if (pending || /这笔|原退款|刚才/.test(text)) refs.refund ??= original?.refund;
  }
  const reason = request.reason ?? pending?.intent?.reason;
  const needed = action === 'read' ? (refs.application ? [backfillView(actor)] : []) : actionPermissions(action);
  const deny = reply => ({ task: null, detachTask: true, reply });
  if (action === 'confirm') return deny('请核对当前补录预览后，在卡片上点击确认。');
  if (needed.some(code => !code || !hasPerm(actor, code)) || action === 'read' && !CROSS_PERIOD_READ.some(code => hasPerm(actor, code))) {
    return deny(refs.application || action !== 'read' ? '当前账号缺少办理或查看此跨期补录所需权限，请由有权限的财务核对原申请。'
      : '当前账号缺少查看原退货、退款或应收的权限，请仓库和财务按原单核对。');
  }
  const clarify = reply => {
    const task = pending ?? store.create({ graph: CROSS_PERIOD, userText: text, actor });
    if (task.state === 'CREATED') task.transition('DISAMBIGUATING');
    task.intent = { refs, action, reason };
    task.crossPeriodPermissions = needed;
    return { task, reply };
  };
  if (request.multiple) return clarify('请只给要办理的一张完整' + fieldNames[request.multiple] + '。');
  if (request.uncertain) return deny('请明确要办理的原退款单或补录申请，以及这次要执行的步骤。');
  if (action === 'apply' && refs.application) return deny('请先核对已给出的原补录申请，确认当前阶段后继续原申请。');
  const oldTask = action === 'read' ? null : [...store.pagesForActor(actor)].flat().find(row => row.graph === BACKFILL_ACTION
    && row.intent?.action === action && (action === 'apply' ? linkedNo(row.preview?.refundNo, refs.refund) : linkedNo(row.preview?.applicationNo, refs.application))
    && (!refs.sale || linkedNo(row.preview?.saleOrderNo, refs.sale))
    && (RECOVERY_STATES.has(row.state) || row.state === 'AWAITING_CONFIRM' && !row.previewExpired()
      && (action !== 'apply' || reason === row.preview._reason)
      && Object.entries(request.refs).every(([kind, no]) => linkedNo(row.intent.refs[kind], no))));
  if (oldTask) return resume(oldTask.id);
  if (action === 'apply' && !refs.refund) return clarify('请给出要补录的完整退款单号。');
  if (action === 'apply' && (!reason || reason.length < 4 || reason.length > 300)) return clarify('请补充原退款为何需要跨期补录，回复「原因：…」（4 到 300 个字）。');
  if (action !== 'read' && action !== 'apply' && !refs.application) return clarify('请给出完整补录申请单号，例如 BF-20261122-0001。');

  let refund, app;
  if (refs.application) {
    app = await applicationByNumber(client, refs.application).catch(() => null);
    if (!app) return clarify('未能核实这张退款补录申请，请核对完整申请单号和当前权限。');
    if (!applicationMatches(app, refs)) return clarify('这张补录申请与原销售单或退款单未能核实关联，请核对原申请单号。');
    if (refs.return) {
      const source = hasPerm(actor, 'return.order.view') ? await saleByReturnNumber(client, refs.return).catch(() => null) : null;
      if (!source || !linkedNo(source, appSale(app))) return clarify('指定退货单与补录的原销售单关联待核实，请核对退货单号。');
    }
    if (!await checkLinkedLedger(client, actor, refs, appSale(app))) return clarify('指定收款或对账单与原销售的关联待核实，请核对原单号。');
    if (action === 'approve' && Number(app.applicantId) === Number(actor.id)) return deny('这张补录申请由你本人提交，需要另一位有审批权限的财务批准。');
  }
  if (refs.refund && action !== 'approve' && action !== 'execute') {
    if (hasPerm(actor, 'refund.order.view')) {
      refund = await refundByNumber(client, refs.refund).catch(() => null);
      if (!refund || refs.sale && !linkedNo(refund.saleOrderNo, refs.sale)) return clarify('未能核实原退款单与销售单的关联，请核对完整退款单号。');
      refs.sale ??= refund.saleOrderNo;
    } else if (!refs.sale && !app) return clarify('当前账号的退款单由财务核查。你可以提供原销售单的完整销售单号。');
  }
  if (refs.return && !app && (!refs.sale || action === 'apply')) {
    const no = hasPerm(actor, 'return.order.view') ? await saleByReturnNumber(client, refs.return).catch(() => null) : null;
    if (!no || refs.sale && !linkedNo(no, refs.sale)) return clarify('未能核实退货单与原销售单的关联，请核对完整退货单号。');
    refs.sale ??= no;
  }
  if (!refs.sale && !app && (refs.receipt || refs.statement) && hasPerm(actor, 'payment.view')) {
    try {
      const receipt = refs.receipt && await exactReceipt(client, refs.receipt);
      const statement = refs.statement && await exactStatement(client, refs.statement);
      const sources = [receipt?.settlements, statement?.items].filter(Array.isArray);
      const common = sources.map(rows => new Set(rows.filter(row => id(row.orderId) && row.orderNo).map(row => row.orderNo.toUpperCase())));
      const matches = [...(common[0] ?? [])].filter(no => common.every(values => values.has(no)));
      if (matches.length === 1 && (!refs.receipt || receipt) && (!refs.statement || statement)) refs.sale = matches[0];
    } catch { /* 只追问原销售单号 */ }
  }
  if (!refs.sale && !app) return clarify('请给出原销售单的完整销售单号。');

  let preview;
  const describe = value => `${applicationLine(value)}\n${page}`;
  if (action === 'apply') {
    const active = await collectList(client, BACKFILLS, { bizType: 'refund', bizId: String(refund.id) }).catch(() => null);
    if (!active) return deny('暂时无法核对原退款的补录申请，请财务稍后查询原单。');
    const matched = active.list.filter(row => row.bizType === 'refund' && id(row.bizId) === id(refund.id) && linkedNo(row.bizNo, refund.refundNo)
      && [0, 1].includes(Number(row.status)));
    if (matched.length) return deny(matched.length === 1 ? describe(matched[0]) : '原退款单关联多张在办补录申请，请财务在审批页核对原申请。');
    if (Number(refund.status) === 3) return deny('原退款单已有完成登记，请财务核对资金和凭证。');
    if (refund.trace.periodClosed !== true) return deny('原退款业务期间未核实为已结账，请财务按原日期在退款单核对目前期间。');
    try { preview = await buildRefundPreview(client, refund, refs); }
    catch (error) { return clarify(error instanceof FlowError ? '原账款暂时无法核对，请财务稍后重查。' : error.message); }
    preview = { ...preview, businessPeriod: refund.trace.businessPeriod, confirmLabel: actions.apply, _reason: reason };
  } else if (action === 'approve' || action === 'execute') {
    const expected = stableApp(app);
    if (Number(app.status) !== (action === 'approve' ? 0 : 1) || app.executedAt || action === 'execute' && app.approvalPeriodClosed) return deny(describe(app));
    if (!expected.bizId || !expected.applicantId || !expected.businessDate || !expected.saleOrderNo || !month(expected.period)
      || !cashUnits(expected.amount) || (action === 'execute' && !expected.approvedDate)) return deny('原补录申请的销售来源或审批日期待核实，请财务在审批页核对。');
    refs.sale ??= expected.saleOrderNo;
    preview = { applicationId: Number(app.id), applicationNo: app.applicationNo, refundNo: app.bizNo, saleOrderNo: expected.saleOrderNo,
      totalCents: cashUnits(expected.amount), paymentDate: expected.businessDate, businessPeriod: expected.period,
      postingMonth: month(expected.approvedDate), confirmLabel: actions[action], _expectedApp: expected };
  } else {
    const report = refs.sale ? await readTimeline(client, actor, refs, refund, app)
      : { reply: describe(app), permissions: [backfillView(actor)], scope: [] };
    const task = pending ?? store.create({ graph: CROSS_PERIOD, userText: text, actor });
    task.intent = { refs };
    task.crossPeriodPermissions = [...new Set([...needed, ...report.permissions])];
    task.accessWarehouseIds = report.scope;
    task.transition('DRY_RUNNING');
    task.transition('DONE');
    return { task, reply: report.reply };
  }
  const task = store.create({ graph: BACKFILL_ACTION, userText: text, actor });
  task.intent = { refs, action };
  task.crossPeriodPermissions = needed;
  task.accessWarehouseIds = preview._scope ?? [];
  task.transition('DRY_RUNNING');
  task.setPreview(preview);
  task.requirePreviewRevision = true;
  task.transition('AWAITING_CONFIRM');
  if (pending) { pending.transition('CANCELLED'); store.save(pending); }
  const detail = action === 'apply' ? closedRefundReply(refund) + ' 原因：' + reason
    : applicationLine(app) + (action === 'approve' ? ' 批准后系统会尝试原退款出账。' : '');
  return { task, preview, reply: detail + ' 请核对当前预览后确认。' };
}

export async function refreshBackfill(client, task) {
  const p = task.preview, action = task.intent.action;
  if (action === 'apply') {
    const refund = await refundByNumber(client, p.refundNo);
    if (id(refund?.id) !== p.refundId || refund.trace.periodClosed !== true || refund.trace.businessPeriod !== p.businessPeriod) return false;
    const fresh = await buildRefundPreview(client, refund, task.intent.refs);
    return JSON.stringify(fresh._expectedRefund) === JSON.stringify(p._expectedRefund)
      && [...fresh._scope].sort().join(',') === [...p._scope].sort().join(',');
  }
  const app = await client.get(BACKFILLS + '/' + p.applicationId);
  return sameApp(app, p) && !app.executedAt && (action !== 'execute' || !app.approvalPeriodClosed) && day(app.approvedAt) === p._expectedApp.approvedDate
    && Number(app.status) === (action === 'approve' ? 0 : 1)
    && (action !== 'approve' || Number(app.applicantId) !== Number(task.actor.id));
}

export async function recoverBackfill(client, task, rejection = null) {
  const p = task.preview, action = task.intent.action;
  let app;
  if (action === 'apply') {
    app = await findApplication(client, { requestKey: task.requestKey }, row => id(row.bizId) === p.refundId && linkedNo(row.bizNo, p.refundNo)
      && Number(row.applicantId) === Number(task.actor.id)).catch(() => null);
    if (!applicationMatches(app, task.intent.refs) || app.period !== p.businessPeriod || day(app.businessDate) !== p.paymentDate
      || cashUnits(app.amount) !== p.totalCents) app = null;
  } else {
    app = await client.get(BACKFILLS + '/' + p.applicationId).catch(() => null);
    if (!sameApp(app, p)) app = null;
    if (app && (action === 'approve' ? Number(app.status) !== 1 : !app.executedAt)) {
      if (rejection) {
        task.transition('VERIFYING');
        task.transition('FAILED_FINAL');
        return { task, reply: applicationLine(app) + '\n' + rejection.message };
      }
      app = null;
    }
  }
  if (!app) return { task, reply: '原补录请求结果待核实。请稍后续办原任务或在跨期补录审批页查看原单。' };
  task.result = { applicationNo: app.applicationNo, refundNo: app.bizNo };
  task.transition('VERIFYING');
  task.transition('DONE');
  const detail = rejection && !app.approvalPeriodClosed ? '\n' + rejection.message : '';
  return { task, reply: applicationLine(app) + detail + '\n' + page };
}

export async function confirmBackfill(store, client, task) {
  const p = task.preview, action = task.intent.action;
  if (!await refreshBackfill(client, task).catch(() => false)) {
    task.transition('EXPIRED');
    return { task, reply: '原退款、业务期间、账款或审批阶段已变化，请重新核对原单。' };
  }
  task.transition('CONFIRMED');
  task.transition('EXECUTING');
  store.save(task);
  let rejection;
  try {
    if (action === 'apply') {
      await client.post('/api/refunds/' + p.refundId + '/execute',
        { backfillRequest: true, backfillReason: p._reason, expectedPreview: p._expectedRefund }, { requestKey: task.requestKey });
    } else {
      await client.post(BACKFILLS + '/' + p.applicationId + '/' + action, { expected: p._expectedApp });
    }
  } catch (error) {
    if (error instanceof FlowError && ['auth', 'business'].includes(error.kind)) rejection = error;
  }
  if (rejection && action === 'apply') {
    task.transition('FAILED_FINAL');
    return { task, reply: '补录申请被系统拦截。' + rejection.message };
  }
  task.transition('RESULT_UNKNOWN');
  return recoverBackfill(client, task, rejection);
}
