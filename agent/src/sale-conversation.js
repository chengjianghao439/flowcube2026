import { asciiWidth } from './input-source.js';
import { customerFromText, customerRequestText } from './customer-source.js';

const quantityToken = '(?:[零〇一二两三四五六七八九十百千万亿]+|俩|仨)';
const unitToken = '[个件条只套箱把]';
const decimalToken = '[0-9０-９]+(?:[.．][0-9０-９]+)?';
const numberToken = `(?:${decimalToken}|${quantityToken})`;
const amountPattern = new RegExp(`^(${numberToken})\\s*(${unitToken})?$`);
const rangePattern = new RegExp(`${numberToken}\\s*(?:到|至|[-~～—])\\s*${numberToken}\\s*(?:${unitToken}|$)`);
const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const digit = '[一二三四五六七八九]';
const leading = '[一二两三四五六七八九]';
const tens = `${digit}十${digit}?`;
const hundreds = `${leading}百(?:${tens}|零${digit})?`;
const thousands = `${leading}千(?:${hundreds}|零(?:${tens}|${digit}))?`;
const spoken = new RegExp(`^(?:${leading}|${digit}?十${digit}?|${hundreds}|${thousands})$`);
const forward = new RegExp(`^(.+?)\\s*(${quantityToken})\\s*(${unitToken})$`);
const reverse = new RegExp(`^(${numberToken})\\s*(${unitToken})\\s*(.+)$`);
const leadingSales = /^(?:帮我)?(?:做|开|下|来|建|新建|创建|准备)(?:一?[个张份]|一)?(?:(?:销售)?(?:订单|草稿)|销售单|单)(?:[：:，,]\s*(.*))?[。！!？?]*$/;

export function quantityNumber(raw) {
  raw = asciiWidth(raw);
  if (raw === '俩') return 2;
  if (raw === '仨') return 3;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (!spoken.test(raw)) return NaN;
  let total = 0, current = 0;
  for (const char of raw) {
    if (Object.hasOwn(digits, char)) current = digits[char];
    else { total += (current || 1) * ({ 十: 10, 百: 100, 千: 1000 })[char]; current = 0; }
  }
  return total + current;
}

const trimEnd = input => input.trim().replace(/[。！!？?]+$/, '').trim();
const unquote = value => value.replace(/^[「『“"‘'](.+)[」』”"’']$/, '$1').trim();
const shortName = value => /^[\p{L}\p{N}][\p{L}\p{N} ()（）+&./_·#×*-]{0,79}$/u.test(value)
  && !/^(?:我|你|这|那|先|暂|算了|等等|稍后|还没|不知道|聊聊|讨论|查一下|看看|帮忙|帮我|[零〇一二两三四五六七八九十百千万亿]+(?:个|件|条|只|套|箱|把)?$)/.test(value)
  && !/(?:吗|呢|吧|什么意思|要不要|行不行|看一下)$/.test(value);

function explicitCustomer(text) {
  const named = /^(?:(?:不是[^，,；;]+[，,；;]\s*)?客户(?:是|叫|为|[：:]|(?:改|换)(?:成|为))|应该是客户)\s*([^，,；;]+)$/.exec(text)?.[1];
  const value = named && unquote(trimEnd(named));
  return value && shortName(value) ? value : null;
}

export function saleLineParts(input, { keepUnit = false } = {}) {
  const text = trimEnd(input).replace(/^(?:需要|要|商品(?:是|为|[：:]))\s*/, '');
  if (!text || amountPattern.test(text)) return null;
  const isCode = /^[A-Z][A-Z0-9._-]*[0-9][A-Z0-9._-]*$/i.test(text);
  const range = isCode ? null : rangePattern.exec(text);
  const left = !isCode && !range && (text.match(/^(.+?)\s*([0-9０-９]+(?:[.．][0-9０-９]+)?)\s*([个件条只套箱把])$/) || text.match(/^(.+?)\s+([0-9０-９]+(?:[.．][0-9０-９]+)?)$/) || text.match(forward));
  const right = !left && !range && text.match(reverse);
  const keyword = unquote((range ? (text.slice(0, range.index).trim() || text.slice(range.index + range[0].length).trim())
    : left?.[1] ?? right?.[3] ?? text).trim());
  if (!shortName(keyword)) return null;
  const value = quantityNumber(left?.[2] ?? right?.[1] ?? '');
  const unit = left?.[3] ?? right?.[2];
  return { productKeyword: keyword, qty: Number.isFinite(value) && value > 0 ? value : null, ...(keepUnit && unit ? { requestedUnit: unit } : {}) };
}

function listFromText(text, options) {
  const parts = text.split(/[，,、；;]/).map(trimEnd).filter(Boolean);
  if (!parts.length || parts.length > 20) return null;
  const parsed = parts.map(part => saleLineParts(part, options));
  return parsed.every(Boolean) ? parsed : null;
}

export function quantityReply(text) {
  const match = amountPattern.exec(trimEnd(text).replace(/^(?:就|要|一共|总共|数量(?:是|为|[：:])?)\s*/, ''));
  if (!match) return null;
  const qty = quantityNumber(match[1]);
  return Number.isFinite(qty) && qty > 0 ? { qty, requestedUnit: match[2] } : null;
}

export function saleCorrection(text) {
  const plain = trimEnd(customerRequestText(text)).replace(/^(?:我)?(?:刚才)?(?:说错了|改口)[，,：:\s]+/, '');
  const namedCustomer = /客户(?:改|换)(?:成|为)/.test(plain) ? explicitCustomer(plain) : null;
  if (namedCustomer) return { kind: 'customer', customerKeyword: namedCustomer };

  const replacement = /^(?:不是[^，,；;]+[，,；;]\s*)?(?:把)?商品\s*(?:改|换)(?:成|为)\s*(.*)$/.exec(plain)?.[1];
  if (replacement != null) return { kind: 'product', lines: listFromText(replacement, { keepUnit: true }) };

  const corrected = /^(?:(.*?)\s*)不是\s*([^，,；;]+)[，,；;]\s*(?:是|而是|改成|换(?:成|为)?)\s*(.+)$/.exec(plain);
  const edit = /^(.*?)\s*(?:改成|改为|改到)\s*(.+)$/.exec(plain);
  const target = (corrected?.[1] ?? edit?.[1])?.trim() ?? '';
  if (corrected && quantityReply(corrected[2])) return { kind: 'quantity', target, amount: quantityReply(corrected[3]) };
  if (corrected && !target) {
    const previous = unquote(corrected[2].trim());
    const next = unquote(corrected[3].trim());
    if (shortName(previous) && shortName(next)) {
      return { kind: 'reference', previous, next, lines: listFromText(corrected[3], { keepUnit: true }) };
    }
  }
  if (edit && (quantityReply(edit[2]) || /数量|第\s*\d+\s*行/.test(target))) return { kind: 'quantity', target, amount: quantityReply(edit[2]) };
  return null;
}

export function intakeSale(text, prior, options) {
  const plain = trimEnd(customerRequestText(text));
  const saved = prior?.lines ?? [];
  const formal = /^(?:给|为)\s*(.+?)\s*(?:开|新建|建|做|起|准备)\s*(?:一?[个张份])?\s*(?:销售)?(?:单|订单|草稿)(?:[：:，,](.*))?$/.exec(plain);
  if (formal) {
    const customerKeyword = customerFromText('B-sale-draft', text);
    const details = formal[2]?.trim();
    const lines = details ? listFromText(details, options) ?? [] : saved;
    return { explicit: true, customerKeyword, lines, unclearLines: Boolean(details && !lines.length) };
  }
  const initial = leadingSales.exec(plain);
  if (initial) {
    const details = initial[1]?.trim();
    const lines = details ? listFromText(details, options) ?? [] : saved;
    return { explicit: true, customerKeyword: prior?.customerKeyword, lines, unclearLines: Boolean(details && !lines.length) };
  }
  if (!prior) return { explicit: false, lines: [] };

  let customerKeyword = prior.customerKeyword;
  const named = explicitCustomer(plain);
  if (named) return { explicit: true, customerKeyword: named, lines: saved };
  const amount = quantityReply(plain);
  const missing = saved.flatMap((line, i) => line.qty == null ? [i] : []);
  if (amount) {
    if (missing.length !== 1) return { customerKeyword, lines: saved };
    return { customerKeyword, lines: saved.map((line, i) => i === missing[0] ? { ...line, ...amount } : line) };
  }
  const bareCustomer = !customerKeyword && /(?:公司|门店|[号分]店|门市|客户)$|^C\d+$/i.test(plain);
  if (bareCustomer && shortName(unquote(plain))) return { customerKeyword: unquote(plain), lines: saved };
  const extra = listFromText(plain, { keepUnit: true });
  if (extra && (customerKeyword || extra.some(line => line.qty != null) || /^商品(?:是|为|[：:])/.test(plain))) {
    const lines = [...saved];
    for (const line of extra) {
      const existing = lines.findIndex(row => row.productKeyword === line.productKeyword);
      if (existing === -1) lines.push(line);
      else if (line.qty != null || lines[existing].qty == null) lines[existing] = line;
    }
    return { customerKeyword, lines };
  }
  return { customerKeyword, lines: saved };
}

export function saleIntakeReply(customerKeyword, lines, unclearLines) {
  const missing = lines.map((line, i) => ({ ...line, index: i + 1 })).filter(line => line.qty == null);
  if (missing.length) {
    const names = missing.map(({ index, productKeyword }) => `第 ${index} 行「${productKeyword}」`).join('、');
    const prompt = missing.length === 1 ? '请给出明确数量。' : '请逐项给出商品和明确数量。';
    return `${names}还缺数量。${prompt}${customerKeyword ? '' : '还请提供客户全称。'}尚未建单。`;
  }
  if (unclearLines) return `${customerKeyword ? '客户先按「' + customerKeyword + '」。' : ''}请给出明确数量及对应商品，例如「缓冲铰链 10个」。尚未建单。`;
  if (customerKeyword && !lines.length) return `客户先按「${customerKeyword}」。还差商品和数量，例如「缓冲铰链 10个」。说全了我就试算，还没建单。`;
  if (!customerKeyword && lines.length) return '商品先记下了。客户是谁？直接说「客户是某某公司」就行。还没建单。';
  return '好，按销售草稿来办。请告诉我客户是谁、要哪些商品、各多少。例如「给华南客户开单：缓冲铰链 10个」。缺了这两样我先问你。还没建单。';
}

// 引用只提取窄格式的资料字段。引用中的句子不会走意图、改单或确认入口。
export function forwardedSaleFields(quoted) {
  const parts = String(quoted ?? '').split(/[；;\r\n]/).map(trimEnd).filter(Boolean);
  const clients = new Set(), lines = [], counts = [];
  let unclearGoods = false;
  const command = /确认|执行|提交|核销|付款|发货|取消|忽略|跳过|我的要求/;
  for (const part of parts) {
    const customer = /^客户(?:全称)?\s*(?:[：:]|是)\s*(.+)$/.exec(part)?.[1];
    const goods = /^(?:商品|货品)\s*(?:[：:]|是)\s*(.+)$/.exec(part)?.[1];
    const quantity = /^数量\s*(?:[：:]|是)\s*(.+)$/.exec(part)?.[1];
    const natural = !customer && !goods && !quantity
      ? /^(.{2,60}?(?:公司|客户|门店|[号分]店|门市))\s*(?:要|需要|订购)\s*(.+)$/.exec(part) : null;
    const buyer = unquote((customer ?? natural?.[1] ?? '').trim());
    const items = goods ?? natural?.[2];
    if (buyer && shortName(buyer) && !command.test(buyer)) clients.add(buyer);
    if (items != null || /^(?:商品|货品)\s*[：:]$/.test(part)) {
      const parsed = items && !command.test(items) && listFromText(items, { keepUnit: true });
      if (parsed && lines.length + parsed.length <= 20) lines.push(...parsed);
      else unclearGoods = true;
    }
    if (quantity) counts.push(quantityReply(quantity));
  }
  const grouped = new Map(), repeated = new Set();
  for (const line of lines) {
    if (grouped.has(line.productKeyword)) {
      repeated.add(line.productKeyword);
      grouped.set(line.productKeyword, { productKeyword: line.productKeyword, qty: null });
    } else grouped.set(line.productKeyword, line);
  }
  const goods = [...grouped.values()];
  if (goods.length > 1 && counts.length) {
    for (const line of goods) line.qty = null;
  } else if (goods.length === 1 && counts.length) {
    const line = goods[0];
    const total = counts[0];
    const disagreement = repeated.has(line.productKeyword) || counts.length !== 1 || !total || (line.qty != null && (
      line.qty !== total.qty || (line.requestedUnit && total.requestedUnit && line.requestedUnit !== total.requestedUnit)
    ));
    if (disagreement) goods[0] = { productKeyword: line.productKeyword, qty: null };
    else if (line.qty == null) Object.assign(line, total);
  }
  return { customerKeyword: clients.size === 1 ? [...clients][0] : undefined, lines: unclearGoods ? [] : goods };
}
