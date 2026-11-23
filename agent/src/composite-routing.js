import { customerFromText } from './customer-source.js';
import { intakeSale, quantityNumber } from './sale-conversation.js';

export const SEQUENCE_GRAPH = 'K-sequence';
export const READ_STEPS = {
  'A-inventory': '查库存', 'C-replenishment': '看补货建议', 'D-ledger': '查应收台账',
  'E-stuck': '查仓库卡点', 'F-briefing': '看经营简报', 'H-workbench': '看岗位待办',
  'I-returns': '查退货', 'J-receipt-status': '查收款状态', 'M-monthly-reconciliation': '查月结对账单',
  'N-return-finance': '查退货后应收及退款', 'Q-cross-period': '查跨月退货、退款及补录',
};

const separator = /[，,；;。]\s*(?:然后|接着|接下来|最后|并且|同时|顺便|并(?=查|看|核对)|再)|(?:然后|接着|顺便|同时)(?=查|看|核对|给|建|开)|[；;]\s*(?=查|看|核对)|(?<=库存|卡点|待办|简报)(?:再|并)(?=查|看|核对|给|建|开)/;
const conditionStart = /^(?:如果|若|只要|假如)|^(?:(?:库存|可用量)\s*)?(?:有货|够|足够|不少于|达到|至少)/;
const splitCondition = /^(.+?(?:库存|可用量))[，,；;\s]*(?=(?:如果|若|只要|假如|库存够|有货|足够|够|(?:可用量\s*)?(?:不少于|至少|达到)))(.+)$/;
const saleMention = /开(?:销售)?(?:订单|单|草稿)|建销售(?:订单|单|草稿)/;
const writeMention = /开(?:销售|采购)?(?:单|草稿)|建(?:销售|采购)|预占|占库|(?:登记|收)款(?:项)?(?:再核销)?|付款|审批|发货|退款|删(?:除)?|作废/;
const plain = text => text.trim().replace(/[。！？!?]+$/, '').trim();
const withoutFirst = text => text.replace(/^(?:(?:小满|帮我|请|麻烦)[，,:：\s]*)*先\s*/, '');

export function compositeRoute(text, classify) {
  const conditional = splitCondition.exec(text);
  if (conditional && saleMention.test(conditional[2]) && classify(withoutFirst(conditional[1])).graph === 'A-inventory') {
    return { kind: 'stock-before-sale', query: plain(withoutFirst(conditional[1])), condition: plain(conditional[2]) };
  }
  const parts = text.split(separator).map(plain);
  if (parts.length < 2) return null;
  // 同一张单的下一责任人是交接答复的一部分。
  if (parts.length === 2 && /^(?:该)?谁(?:来(?:接手|办|处理)?|接手|办|处理|负责)(?:呢|吗)?$/.test(parts[1])) {
    const first = classify(withoutFirst(parts[0]));
    if (first.handoff?.action === 'read') return first;
  }

  if (parts.length > 3) return { kind: 'clarify', reply: '一次可以按顺序处理最多三项查询。请把其余要求分开说。' };
  const steps = [];
  for (const [i, part] of parts.entries()) {
    const query = i === 0 ? withoutFirst(part) : part;
    const route = classify(query);
    if (conditionStart.test(query)) {
      return { kind: 'clarify', reply: '请把条件、要查询的商品和仓库、满足时要办的事说具体。当前支持按指定仓库可用量试算销售草稿。' };
    }
    if (!Object.hasOwn(READ_STEPS, route.graph ?? '') || (route.graph === 'D-ledger' && !customerFromText(route.graph, query))) {
      if (route.kind === 'blocked' || route.receipt?.action === 'prepare' || route.monthly || route.returning || route.crossPeriod || writeMention.test(query)) return { kind: 'clarify', reply: '请把查询和办理单据分开说。涉及写入的步骤需要单独核对和确认。' };
      return { kind: 'clarify', reply: `请说清第 ${i + 1} 步要查的对象和内容，例如商品与仓库、客户全称或完整单号。` };
    }
    steps.push({ query, graph: route.graph });
  }
  return { kind: 'ordered-read', steps };
}

export function parseStockSaleCondition(text) {
  const matched = /^(?:(?:如果|若|只要|假如)\s*)?(?:(?:商品)?(?:库存|可用库存|可用量|可用数量|数量)\s*)?(?:(有货)|(够|足够|不少于|至少|达到)\s*([\d.零一二两三四五六七八九十百千]+)\s*(个|件|条|只|套|箱|把))[，,；;\s]*(?:就|再|则|才)\s*(.+)$/.exec(text);
  if (!matched) return null;
  const [, hasStock, operator, amount, statedUnit, instruction] = matched;
  const sale = intakeSale(instruction, undefined, { keepUnit: true });
  if (!sale.explicit || !sale.customerKeyword || sale.unclearLines || sale.lines.length > 1 || sale.lines.some(row => !row.qty)) return null;
  const explicit = sale.lines[0];
  if (!explicit && !['足够', '够'].includes(operator)) return null;
  const minimum = hasStock ? explicit.qty : quantityNumber(amount);
  if (!Number.isFinite(minimum) || minimum <= 0) return null;
  return { customerKeyword: sale.customerKeyword, unit: statedUnit ?? explicit?.requestedUnit, minimum,
    requestedUnit: explicit?.requestedUnit, productKeyword: explicit?.productKeyword, qty: explicit?.qty ?? minimum };
}

export function reportedUnknownSubmission(text) {
  return /^(?:(?:刚才|刚刚|之前)\s*)?(?:我\s*)?(?:(?:点了|按了)\s*)?(?:提交|确认)(?:后|了)?[，,\s]*(?:一直)?(?:没(?:回音|响应|返回|结果)|没有结果|结果(?:未知|不明|不清楚)|超时了)[。！!？?]*$/.test(text);
}

export function resumesOriginal(text) {
  return reportedUnknownSubmission(text)
    || /^(?:(?:请|帮我)\s*)?(?:继续(?:办理|办|原任务|上一步|刚才的任务)?|接着办|恢复原任务|(?:重查|查询|查一下|查)原(?:任务(?:的?结果)?|结果|请求回执)|重试(?:一下|当前步骤|原任务)?|再试一次)[。！!？?]*$/.test(text);
}
