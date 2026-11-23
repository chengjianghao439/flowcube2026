import { hasPerm } from './perms.js';
import { receiptOverview } from './receipt-allocation.js';

const RETURN_TYPES = {
  PR: { path: '/api/returns/purchase', link: '[[采购退货|/returns/purchase]]' },
  SR: { path: '/api/returns/sale', link: '[[销售退货|/returns/sale]]' },
};
const RETURN_STATES = { 1: '草稿', 2: '已确认待执行', 3: '已执行', 4: '已取消' };
const RECEIPT_STATES = {
  1: ['待核销', '收款已登记，还没有分配到应收账款。'],
  2: ['部分核销', '这笔收款已经分配了一部分，剩余金额仍在收款单上。'],
  3: ['已核销', '这笔收款的金额已全部分配。'],
};
const RECEIVABLE_LINK = '[[客户往来|/payments/receivable]]';
// /api/warehouse-tasks 与 /stats 对应 warehouseTaskStatus 的活跃阶段。
const TASK_STAGES = {
  picking: { label: '拣货', status: 2 }, sorting: { label: '分拣', status: 3 },
  checking: { label: '复核', status: 4 }, packing: { label: '打包', status: 5 }, shipping: { label: '出库', status: 6 },
};

export const WORKBENCH_SOURCES = {
  sale: { permissions: ['dashboard.view', 'sale.order.view'], scoped: true, label: '待处理销售订单', link: '[[销售订单|/sale]]' },
  purchase: { permissions: ['dashboard.view', 'purchase.order.view'], scoped: true, label: '待处理采购订单', link: '[[采购订单|/purchase]]' },
  warehouse: { permissions: ['warehouse.task.view'], scoped: true, label: '仓库作业' },
  inbound: { permissions: ['inbound.order.view'], scoped: true, label: '待收货订单', link: '[[收货订单|/inbound-tasks]]' },
  receipts: { permissions: ['payment.view'], scoped: false, label: '收款核销', link: RECEIVABLE_LINK },
};

const readWords = /查|看|状态|进度|卡在|卡点|卡住|为什么|为啥|怎么还|到哪|没退完|核销了(?:吗|没|多少)|还没核销|尚未核销|未核销|还有.*没核销|有没有核销|是否核销|解释/;
const command = /(?:帮我|替我|请|我要|想要|马上|立即|直接|再|然后|顺便)\s*(?:把.{0,28}?)?(?:取消|删除|作废|审核|审批|确认|执行|登记|发货|出库|退款|付款|核销)(?!了|没|吗|多少|状态|进度)/;
const warehouseFilter = /(?:只(?:查|看)|仅(?:查|看)|限定|指定|在)\s*[^，,！!？?。]{1,28}?仓(?:库)?(?:的|里|中|范围|[，,\s]|$)|[^，,！!？?。\s]{1,22}仓(?:库)?的?(?:岗位待办|退货)|[一二三四五六七八九十\d]+号?仓/;

export function operationsReadRoute(text) {
  const standard = text.match(/(?<![a-z0-9_-])(?:PR|SR|RC)\d{6,28}(?![a-z0-9_-])/gi) ?? [];
  const namesReturn = /退货/.test(text);
  const namesReceipt = /收款单|收款状态|收款.{0,12}(?:未核销|核销了吗|核销状态)/.test(text);
  // 单号支持自定义前缀。用业务名确定查询来源，并在正式列表内精确匹配完整单号。
  const custom = namesReturn || namesReceipt
    ? [...(text.match(/(?<![a-z0-9_-])[a-z][a-z0-9_-]{0,18}?\d{11,29}(?![a-z0-9_-])/gi) ?? []),
      ...Array.from(text.matchAll(/[「『“"]([\p{L}][\p{L}\d_-]{0,18}?\d{11,29})[」』”"]/gu), match => match[1])]
    : [];
  const docs = [...new Set([...standard, ...custom].filter(value => value.length <= 30).map(value => value.toUpperCase()))];
  const no = docs[0];
  const defaultType = /^(PR|SR|RC)\d+$/.exec(no ?? '')?.[1];
  const isReturn = namesReturn || defaultType === 'PR' || defaultType === 'SR';
  const isReceipt = namesReceipt || defaultType === 'RC';
  const namedReturns = ['采购退货', '销售退货'].filter(label => text.includes(label));
  const namedReturnType = namedReturns.length === 1 ? (namedReturns[0] === '采购退货' ? 'PR' : 'SR') : undefined;
  const returnType = namedReturnType ?? (isReturn ? defaultType : undefined);
  const taskStages = Object.entries(TASK_STAGES).filter(([, { label }]) => text.includes(label));
  const focusedWorkbench = taskStages.length === 1 && /(?:先|优先|待办|队列).{0,6}(?:看|做|处理|哪些|哪[几一]单)|(?:下一步|现在).{0,6}(?:看|做|处理)/.test(text);
  const workbench = focusedWorkbench || /岗位待办|(?:我的|本岗(?:位)?|今天的|今日)待办|(?:我|本岗(?:位)?)(?:今天|现在|目前)(?:该|要|应该)?先(?:做|处理|看)(?:什么|哪些|哪[几一]单)/.test(text);
  if (!no && !isReturn && !workbench && /(?:待核销|部分核销|已核销)/.test(text)
      && /区别|什么意思|是什么|含义|解释/.test(text) && !command.test(text)) {
    return { kind: 'clarify', reply: Object.values(RECEIPT_STATES).map(([name, note]) => name + ' · ' + note).join('\n')
      + '\n要查具体金额和状态，请给出完整收款单号。' };
  }
  if (!isReturn && !isReceipt && !workbench) return null;
  const writing = command.test(text)
    || /^(?:小满[，,\s]*)?(?:取消|删除|作废|审核|审批|确认|执行|登记|退款|付款|核销)(?!了|没|吗|多少|状态|进度)/.test(text);
  if (writing || (isReceipt && !readWords.test(text) && /核销|登记/.test(text))) {
    return { kind: 'blocked', reply: '小满在这里提供状态查询。办理已有单据请到原页面，按原流程确认。' };
  }
  if (!workbench && !readWords.test(text)) return null;
  if (docs.length > 1 || (isReceipt && isReturn)) return { kind: 'clarify', reply: '请一次给一个完整单号，我逐张核对。' };
  if (!isReceipt && warehouseFilter.test(text)) return { kind: 'clarify', reply: '这个查询按你的可见仓库范围汇总。请到业务列表选择指定仓库，或给出一张完整退货单号。' };
  const completeNo = /\d{11,}$/.test(no ?? '');
  if (isReceipt && !completeNo) return { kind: 'clarify', reply: '请给出完整收款单号，例如 RC20261122001，我可以查登记和核销状态。' };
  if (isReturn && (no || /这张|那张|单号|\b(?:PR|SR)\s*\d/i.test(text)) && !completeNo) {
    return { kind: 'clarify', reply: '请给出完整的采购退货单号 PR… 或销售退货单号 SR…。' };
  }
  if (isReturn && !no && !/卡点|卡住|环节|进度|待执行|待处理|草稿|积压/.test(text)) return null;
  if (isReturn && no && namedReturnType && defaultType && defaultType !== namedReturnType) {
    return { kind: 'clarify', reply: '退货类型与单号前缀不一致，请核对是采购退货 PR 还是销售退货 SR。' };
  }
  if (isReturn && no && !returnType) return { kind: 'clarify', reply: '请说明这个单号属于采购退货还是销售退货。' };
  return { kind: 'operational-read', graph: isReceipt ? 'J-receipt-status' : isReturn ? 'I-returns' : 'H-workbench',
    no, returnType, stage: focusedWorkbench ? taskStages[0][0] : undefined };
}

function endpoint(path, query) {
  return path + '?' + new URLSearchParams({ page: 1, pageSize: 1, ...query });
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('接口未返回有效计数');
  return value;
}
async function readCount(client, path, query) {
  return count((await client.get(endpoint(path, query)))?.pagination?.total);
}
export function workbenchKeys(actor) {
  return Object.entries(WORKBENCH_SOURCES)
    .filter(([, source]) => source.permissions.every(code => hasPerm(actor, code))
      && !(source.scoped && actor.warehouseIds?.length === 0))
    .map(([key]) => key);
}
export async function readWorkbench(client, actor, keys, stage) {
  const summary = keys.some(key => key === 'sale' || key === 'purchase') ? client.get('/api/dashboard/summary') : null;
  const sources = await Promise.all(keys.map(async key => {
    const { label, link } = WORKBENCH_SOURCES[key];
    try {
      if (key === 'sale' || key === 'purchase') {
        const field = key === 'sale' ? 'pendingSaleOrders' : 'pendingPurchaseOrders';
        return { key, rows: [{ label, count: count((await summary)?.[field]) }], link };
      }
      if (key === 'warehouse') {
        const link = (!stage || stage === 'shipping') && hasPerm(actor, 'warehouse.task.ship') ? '[[仓库发货|/warehouse-shipping]]' : undefined;
        if (stage) {
          const { label: stageLabel, status } = TASK_STAGES[stage];
          const data = await client.get(endpoint('/api/warehouse-tasks/', { status, pageSize: 3 }));
          if (!Array.isArray(data?.list)) throw new Error('接口未返回有效列表');
          const examples = data.list.slice(0, 3)
            .filter(row => row.status === status && inScope(actor, row.warehouseId) && /^[\p{L}\p{N}_-]{1,30}$/u.test(row.taskNo ?? ''))
            .map(row => ({ no: row.taskNo, urgent: row.priority === 1 }));
          return { key, rows: [{ label: stageLabel, count: count(data.pagination?.total) }], examples, link };
        }
        const stats = await client.get('/api/warehouse-tasks/stats');
        return { key, rows: Object.entries(TASK_STAGES).map(([field, { label }]) => ({ label, count: count(stats?.[field]) })), link };
      }
      if (key === 'inbound') return { key, rows: [{ label, count: await readCount(client, '/api/inbound-tasks/', { status: 1 }) }], link };
      const [pending, partial] = await Promise.all([1, 2].map(status => readCount(client, '/api/payments/receipts', { type: 2, status })));
      return { key, rows: [{ label: '待核销收款单', count: pending }, { label: '部分核销收款单', count: partial }], link };
    } catch {
      return { key, unavailable: label };
    }
  }));
  const rows = sources.flatMap(source => source.unavailable
    ? [source.unavailable + '暂未查到，稍后重试。']
    : [source.rows.map(row => row.label + ' ' + row.count + ' 单').join('，') + (source.link ? ' · ' + source.link : ''),
      ...(source.examples ?? []).map(row => row.no + (row.urgent ? ' · 紧急' : ''))]);
  const hasFacts = sources.some(source => source.rows);
  const note = !hasFacts ? '暂未取到岗位待办。'
    : stage ? '以下是可见仓库的作业队列，按正式作业列表顺序最多取前三张。个人分派请在对应页面核对。'
      : '这是当前账号可见的积压概况。仓库作业按可见仓库统计，个人分派与紧急程度请在对应页面核对。';
  return { hasFacts, result: { sources }, reply: [note, ...rows.map(row => '- ' + row)].join('\n\n') };
}

function inScope(actor, warehouseId) {
  return Number.isSafeInteger(warehouseId) && warehouseId > 0
    && (!Array.isArray(actor.warehouseIds) || actor.warehouseIds.map(Number).includes(warehouseId));
}
async function findDocument(client, path, query, matches) {
  const data = await client.get(endpoint(path, { ...query, pageSize: 30 }));
  if (!Array.isArray(data?.list)) throw new Error('接口未返回有效列表');
  const match = data.list.find(row => matches(row) && Number.isSafeInteger(row.id) && row.id > 0);
  if (!match && count(data.pagination?.total) > data.list.length) throw new Error('未能在有限搜索结果内核对该单号，请到原页面按完整单号查询。');
  return match;
}
async function returnDetail(client, actor, path, row) {
  const detail = await client.get(path + '/' + row.id);
  if (detail?.id !== row.id || detail.returnNo !== row.returnNo || !inScope(actor, detail.warehouseId) || !RETURN_STATES[detail.status]) {
    throw new Error('未能核对退货单、状态及仓库范围');
  }
  const stage = task => task?.taskNo && task.statusName && { no: task.taskNo, status: task.statusName };
  return { no: detail.returnNo, warehouseId: detail.warehouseId, status: detail.status,
    task: stage(detail.task) || null, reverseTask: stage(detail.reverseTask) || null };
}

function returnStage(row) {
  if (row.reverseTask) return '返货任务 ' + row.reverseTask.no + ' · ' + row.reverseTask.status;
  if (row.task) return '仓库任务 ' + row.task.no + ' · ' + row.task.status;
  return row.status === 2 ? '暂未查到关联仓库任务，请在退货单详情核对。' : '';
}

export async function readReturns(client, actor, no, returnType) {
  if (no) {
    const { path, link } = RETURN_TYPES[returnType];
    const row = await findDocument(client, path, { keyword: no }, item => item.returnNo?.toUpperCase() === no && inScope(actor, item.warehouseId));
    if (!row) return { hasFacts: true, result: { found: false }, reply: '在当前可见范围内未找到退货单 ' + no + '。' };
    const detail = await returnDetail(client, actor, path, row);
    const note = detail.status === 1 ? '草稿待确认。' : returnStage(detail);
    return { hasFacts: true, result: detail, reply: [detail.no + ' · ' + RETURN_STATES[detail.status], note, '查看 ' + link].filter(Boolean).join('\n') };
  }
  const sections = Object.entries(RETURN_TYPES).filter(([type]) => !returnType || type === returnType);
  const sources = await Promise.all(sections.map(async ([type, { path, link }]) => {
    try {
      const [drafts, pending] = await Promise.all([
        readCount(client, path, { status: 1 }),
        client.get(endpoint(path, { status: 2, pageSize: 2 })),
      ]);
      const confirmed = count(pending?.pagination?.total);
      if (!Array.isArray(pending?.list)) throw new Error('接口未返回有效列表');
      const samples = await Promise.allSettled(pending.list.slice(0, 2)
        .filter(row => row.status === 2 && inScope(actor, row.warehouseId) && Number.isSafeInteger(row.id) && row.id > 0)
        .map(row => returnDetail(client, actor, path, row)));
      return { type, link, drafts, confirmed,
        samples: samples.filter(item => item.status === 'fulfilled' && item.value.status === 2).map(item => item.value),
        samplesUnavailable: samples.some(item => item.status === 'rejected') };
    } catch {
      return { type, link, unavailable: true };
    }
  }));
  const reply = ['当前可见仓库的退货草稿与已确认待执行单据。每类最多列两张待执行单的仓库环节。'];
  for (const source of sources) {
    if (source.unavailable) reply.push(source.link + ' 暂未取到数据。');
    else reply.push(source.link + ' · 草稿 ' + source.drafts + ' 单，已确认待执行 ' + source.confirmed + ' 单',
      ...source.samples.map(row => row.no + ' · ' + returnStage(row)),
      ...(source.samplesUnavailable ? ['部分关联任务暂未查到，请到退货列表核对。'] : []));
  }
  return { hasFacts: sources.some(source => !source.unavailable), result: { sources }, reply: reply.join('\n') };
}

export async function readReceiptStatus(client, no) {
  const path = '/api/payments/receipts';
  const matches = row => row?.receiptNo?.toUpperCase() === no && row.type === 2;
  const row = await findDocument(client, path, { type: 2, receiptNo: no }, matches);
  if (!row) return { hasFacts: true, result: { found: false }, reply: '未找到收款单 ' + no + '。' };
  const detail = await client.get(path + '/' + row.id);
  const state = RECEIPT_STATES[detail?.status];
  if (!matches(detail) || detail.id !== row.id || !state) throw new Error('未能核对收款单号、类型及状态');
  if (Array.isArray(detail.settlements)) return receiptOverview(detail);
  const { receiptNo, amount, settledAmount, balance, status } = detail;
  if (![amount, settledAmount, balance].every(value => Number.isFinite(value) && value >= 0)) throw new Error('收款金额字段不完整，请到客户往来核对。');
  const show = value => value.toLocaleString('zh-CN', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return { hasFacts: true, result: { no: receiptNo, status, amount, settledAmount, balance },
    reply: receiptNo + ' · ' + state[0] + '\n' + state[1]
      + '\n收款金额 ¥' + show(amount) + '，已核销 ¥' + show(settledAmount) + '，收款单未核销余额 ¥' + show(balance)
      + '。客户整体应收余额请在 ' + RECEIVABLE_LINK + ' 分开核对。' };
}
