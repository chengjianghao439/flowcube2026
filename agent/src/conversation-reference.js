import { createHash } from 'node:crypto';
import { SEQUENCE_GRAPH } from './composite-routing.js';
import { asciiWidth } from './input-source.js';
import { quantityNumber } from './sale-conversation.js';

const orderGraphs = new Set(['B-sale-draft', 'B2-reserve', 'C-purchase-draft', 'D-receipt', 'D-settle', 'I-returns', 'J-receipt-status']);
const customerGraphs = new Set(['B-sale-draft', 'D-ledger', 'D-receipt', 'D-settle']);
const lead = /^(?:(?:小满|帮我|麻烦|请)[，,:：\s]*)+/;
const past = /^(?:上一|上(?:个|条|张|位|单)|前一)/;
const here = /^(?:这|当前|现在)/;
const anchor = word => past.test(word) ? 'previous' : here.test(word) ? 'current' : 'either';

export function referenceRequest(input) {
  const text = input.replace(lead, '').replace(/[。！？!?]+$/, '').trim();
  const ordinal = /^(?:(?:选(?:择)?|确认)\s*)?第\s*([\d０-９一二两三四五六七八九十百]+)\s*([个项位张])\s*(客户|商品|仓库|仓|单据|单)?\s*(?:呢|吧|那个|[，,]\s*确认(?:吧)?)?$/.exec(text);
  if (ordinal) {
    const [, number, unit, named] = ordinal;
    return { kind: 'ordinal', index: quantityNumber(asciiWidth(number)) - 1,
      subject: named || (unit === '张' ? '单' : unit === '位' ? '客户' : undefined) };
  }
  const warehouse = /^(?:还是\s*)?(?:按|只查|重查|再查|查|用|看|换回|切回)?\s*(上一条的|上一个|上一次的|刚才那个|刚才的|当前的|这个|这次的|原来的|原)\s*仓(?:库)?(?:\s*(?:再查(?:一次)?|查一下|查库存|呢))?$/.exec(text);
  if (warehouse) return { kind: 'stock', anchor: anchor(warehouse[1]) };
  const customer = /^(?:(?:再查|查一下|查|看看|核对)\s*)?(上一位|上一家|上一个|刚才那位|刚才那家|刚才那个|这位|这家|这个|当前的|原来的|原)\s*客户(?:的)?(?:\s*(应收(?:账款|余额)?|欠款|台账|还欠多少|还剩多少没收)(?:还有多少|还剩多少|是多少|多少|呢)?)?$/.exec(text);
  if (customer) return { kind: 'customer', anchor: anchor(customer[1]), ledger: Boolean(customer[2]) };
  const order = /^(?:(?:还是|先)\s*)?(?:(看看|看一下|看|查看|查一下|查|打开|回到|回看|继续处理|继续办|继续|确认|提交|把)\s*)?((?:刚才那(?:一)?|上一|上|前一|这(?:一)?|那(?:一)?|当前(?:这)?|原来那(?:一)?)(?:张(?:销售退货|采购退货|销售|采购|退货|收款)?(?:订单|单据|单)?|笔(?:收款|核销|单据|单)?)|刚才那单|刚才的单|上一单|上单|这单|当前单|原来那单)(.*)$/.exec(text);
  if (order) {
    const [, verb, word, tail] = order;
    const numbers = [...new Set((tail.match(/(?<![a-z\d_-])(?:SL|PC|PR|SR|RC)[-_]?\d{6,28}(?![a-z\d_-])/gi) ?? []).map(no => no.toUpperCase()))];
    const action = /^(?:的)?(?:数量|第[\d一二两三四五六七八九十]+行)(?:[\s\S]*)(?:改成|改为|改到).+$/.test(tail) ? tail.replace(/^的/, '') : null;
    if (numbers.length || action || anchor(word) !== 'current' || /^(?:呢|吧|的?(?:状态|进度|单号)(?:呢|是多少)?|怎么样|，?确认吧)?$/.test(tail)) {
      return { kind: 'order', anchor: anchor(word), numbers, action, tail: tail.trim(), resume: verb?.startsWith('继续'),
        orderType: word.match(/销售退货|采购退货|销售|采购|退货|收款|核销/)?.[0] };
    }
  }
  if (/^(?:还是\s*)?(?:就|先)?(?:按|用|回到)\s*(?:原来的|原先的|之前的|刚才的)(?:[，,\s]*(?:确认(?:吧|一下)?|继续(?:办)?))?$/.test(text)
      || /^(?:确认|提交)\s*(?:原来的|原先的|刚才的)(?:吧|一下)?$/.test(text)) {
    return { kind: 'original', anchor: 'either' };
  }
  return null;
}

export function customerReference(task) {
  const customer = task?.result?.customer ?? task?.preview?.customer;
  return customer && Number.isSafeInteger(Number(customer.id)) && Number(customer.id) > 0 && customer.name ? customer : null;
}

export function taskDocumentNo(task) {
  return task.result?.orderNo ?? task.preview?.orderNo ?? task.result?.receiptNo ?? task.preview?.receiptNo
    ?? task.result?.applicationNo ?? task.preview?.applicationNo ?? task.result?.refundNo ?? task.preview?.refundNo
    ?? (['I-returns', 'J-receipt-status'].includes(task.graph) ? task.result?.no : undefined);
}

export function referenceMatches(task, { kind, orderType, numbers }) {
  if (!task || task.state === 'FAILED_FINAL' || task.state === 'CANCELLED') return false;
  if (kind === 'order') {
    if (numbers?.length && (numbers.length !== 1 || String(taskDocumentNo(task)).toUpperCase() !== numbers[0])) return false;
    if (task.graph === 'I-returns') return Boolean(task.result?.no) &&
      (!orderType || orderType === '退货' || (orderType === '销售退货' && task.intent?.returnType === 'SR') ||
        (orderType === '采购退货' && task.intent?.returnType === 'PR'));
    if (task.graph === 'J-receipt-status' && !task.result?.no) return false;
    if (!orderType) return orderGraphs.has(task.graph);
    return Boolean({
      销售: ['B-sale-draft', 'B2-reserve'], 采购: ['C-purchase-draft'],
      收款: ['D-receipt', 'D-settle', 'J-receipt-status'], 核销: ['D-settle', 'J-receipt-status'],
    }[orderType]?.includes(task.graph));
  }
  if (kind === 'customer') return customerGraphs.has(task.graph) && Boolean(customerReference(task));
  if (kind === 'stock') return task.graph === 'A-inventory' && task.state === 'DONE' && Boolean(task.result?.productId);
  return true;
}

export function candidateKey(task, store) {
  if (!task?.candidates?.length || !['DISAMBIGUATING', 'PAUSED'].includes(task.state)) return undefined;
  const activeId = task.graph === SEQUENCE_GRAPH ? task.sequence?.steps?.find(step => !step.completedId)?.activeId : task.id;
  const active = activeId === task.id ? task : store?.get(activeId);
  if (!active?.selection) return undefined;
  const { keyword, slot, type } = active.selection;
  return createHash('sha256').update(JSON.stringify([task.id, active.id, keyword, slot, type, task.candidates.map(row => row.id)])).digest('hex');
}

export function referenceQuestion(kind) {
  if (kind === 'order') return '你指的是哪张单？请说明要查询的对象，从最近记录打开对应任务，或给出完整单号。';
  if (kind === 'customer') return '你指的是哪位客户？请打开对应记录，或给出客户全称。';
  if (kind === 'stock') return '你指的是哪个仓库？请给出完整仓名，或打开对应的库存记录。';
  return '「原来的」指哪条记录？请先从最近记录打开对应任务。';
}
