// 到账原文是金额来源；模型只定位业务意图，不能补出、舍入或改写到账额。
const invalid = message => Object.assign(new Error(message), { code: 'RECEIPT_AMOUNT_INVALID', status: 400 });
const formatError = () => invalid('到账金额没能准确识别，请用大于 0、最多两位小数的数字重述，例如「客户名 到账 0.50 核销」。未生成收款预览。');

export function assertReceiptAmountCents(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw invalid('到账金额必须大于 0，且精确到分；请核对金额后重新试算。');
}

export function assertReceiptOriginalAmount(amountCents, originalText) {
  assertReceiptAmountCents(amountCents);
  const original = parseReceiptAmount(originalText);
  assertReceiptRequestSupported(original);
  if (original.amountCents != null && original.amountCents !== amountCents) throw invalid('预览的到账金额与原文不一致，请重新试算。');
  return original;
}

export function assertReceiptPreviewAmount(preview, originalText) {
  assertReceiptOriginalAmount(preview?.amountCents, originalText);
  if (Number(preview.payload?.amount) !== preview.amountCents / 100) throw invalid('预览的到账金额与登记金额不一致，请重新试算。');
}

function amountRemainder(text) {
  return text.replace(/核销掉|核销|收款|到账|收到|支付|付款|付了|帮我|帮忙|请|把|给|了|入账|登记|块钱|人民币|元|块|金额|到账额|收款额|并|进行|全部|全额|按未结总额|那笔|这笔|那张|这张|只|指定|订单号|单号|账款编号|和|钱|RMB|CNY/gi, '')
    .replace(/[¥￥，,。:：、\s]+/g, '');
}

function amountBeforeMarker(prefix) {
  // 只认货币标记/单位，或与客户名分开的末尾数字；C000123 等编码不是到账额。
  const number = '[+-]?\\s*(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const unit = '(?:[万千百亿]?\\s*(?:元|块钱|块)|角|分)(?:整)?';
  const money = new RegExp(`(?:[¥￥]|人民币|\\b(?:RMB|CNY)\\b)\\s*${number}(?:\\s*${unit})?|${number}\\s*${unit}`, 'gi');
  const matches = [...prefix.matchAll(money)];
  if (/[负正零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]+\s*(?:元|块|角|分)|(?:^|\s)[负正零〇一二两三四五六七八九十百千万亿]+\s*$/.test(prefix)) throw formatError();
  if (matches.length > 1) throw formatError();
  const match = matches[0] || /(?:^|\s)([+-]?\s*(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(prefix);
  if (!match) {
    if (/[¥￥]|人民币|\b(?:RMB|CNY)\b/i.test(prefix)) throw formatError();
    return null;
  }
  // 防止只匹配到 5e2元、1,000元、--5元 等表达的尾部。
  if (/[+\-.,eE\d负正]\s*$/.test(prefix.slice(0, match.index))) throw formatError();
  return match;
}

function parseAmountText(text) {
  const marker = /到账|收到|打款|打来|打了|打过来|支付了?|付款了?|付了/.exec(text) || /收款/.exec(text);
  let offset = marker ? marker.index + marker[0].length : 0;
  let region = text.slice(offset);
  if (marker) {
    const before = amountBeforeMarker(text.slice(0, marker.index));
    if (before) {
      if (amountRemainder(region)) throw formatError();
      offset = before.index;
      region = before[0];
    }
  }
  const numbers = [...region.matchAll(/[+-]?\s*(?:\d+(?:\.\d*)?|\.\d+)/g)];
  if (!numbers.length) {
    // 有到账语句但余下内容未识别，或明确写中文金额，不能偷换成“未写金额”。
    if ((marker && amountRemainder(region)) || /[负正零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]+\s*(?:元|块|角|分)|核销\s*[负正零〇一二两三四五六七八九十百千万亿]/.test(region)) throw formatError();
    return { amountCents: null, customerText: text, customerMarker: marker?.[0] ?? null };
  }
  if (numbers.length !== 1) throw invalid('这句话里有多个数字，无法确定到账金额。请按「客户名 到账 金额 核销」重述；不写金额才按未结总额办理。');
  const match = numbers[0];
  const raw = match[0].trim().replace(/^([+-])\s+/, '$1');
  const before = region.slice(0, match.index);
  const after = region.slice(match.index + match[0].length);
  // 不截掉负号、指数、倍率或小数点；非标准表达统一要求重述。
  if (/[+\-.\d负正]\s*$/.test(before) || /^\s*[.eE\d万千百亿角分]/.test(after)
    || !/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) throw formatError();
  if (marker && amountRemainder(before + after)) throw formatError();
  // 没有付款语境时须有紧邻货币标记/单位；不能把“123五金”的名称数字删作金额。
  if (!marker && ((!/(?:[¥￥]|人民币|\b(?:RMB|CNY))\s*$/i.test(before) && !/^\s*(?:元|块钱|块)/.test(after))
    || amountRemainder(after) || /负\s*$/.test(before))) throw formatError();
  const [whole, fraction = ''] = raw.replace(/^[+-]/, '').split('.');
  const unsigned = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  const amountCents = Number(raw.startsWith('-') ? -unsigned : unsigned);
  assertReceiptAmountCents(amountCents);
  const start = offset + match.index;
  const customerText = (text.slice(0, start) + text.slice(start + match[0].length).replace(/^\s*(?:元|块钱|块)(?:整)?/, ''))
    .replace(/[¥￥]|人民币|\b(?:RMB|CNY)\b/gi, '');
  return { amountCents, customerText, customerMarker: marker?.[0] ?? null };
}

// 元信息只作原文证据，绝不通过去掉数字把指定核销变成全客户分配。
export function parseReceiptAmount(input) {
  const originalText = String(input).normalize('NFKC').replace(/[−﹣－–—]/g, '-');
  const dates = [], targetRefs = [], customerCodes = [], codes = [];
  let text = originalText.replace(/(?:于|在|收款日期[为是]?|日期[为是]?)?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日|今天|昨天|昨日|前天|明天)/g, (_, date) => { dates.push(date); return ' '; });
  text = text.replace(/(?<![A-Z0-9])(?:[A-Z]+[A-Z0-9-]*\d[A-Z0-9-]*)(?![A-Z0-9])/gi, (code, index, source) => {
    // 保留指数与货币表达给金额校验，不能把非法金额遮成“未写金额”。
    if (/^(?:e\d+|(?:RMB|CNY)\d)/i.test(code)) return code;
    const explicit = /(?:订单号|单号|账款编号|指定)\s*[:：]?\s*$/.test(source.slice(0, index))
      || /^(?:那笔|这笔|那张|这张)/.test(source.slice(index + code.length));
    if (explicit || /^(?:SL|SO|XS|RC|SK|AR|SC|PC|PO|PR)\d{6,}$/i.test(code)) {
      targetRefs.push(code);
      return ' ';
    }
    if (/^(?:C|KH)\d{3,}$/i.test(code)) customerCodes.push(code);
    // AB123五金等混合名称按原字保留；不能仅凭字母+数字猜为单据。
    const placeholder = String.fromCodePoint(0xE000 + codes.length);
    if (originalText.includes(placeholder)) throw formatError();
    codes.push([placeholder, code]);
    return placeholder;
  });
  text = text.replace(/(?:订单号|单号|账款编号)\s*[:：]?\s*(\d+)/g, (full, no) => { targetRefs.push(no); return ' '; });
  const scopedTarget = /(?:这|那)(?:一)?(?:笔|张)|指定|仅核销|只核销|对账单|单号|订单号|账款编号/.test(text);
  const parsed = parseAmountText(text);
  let customerText = parsed.customerText;
  for (const [placeholder, code] of codes) customerText = customerText.replace(placeholder, code);
  // 使用金额解析实际采用的付款谓词；名称中的“收款/核销”不能抢在到账谓词前截断。
  // 没有付款谓词时只认句尾核销请求，保留名称内部的相同汉字。
  const boundaryIndex = parsed.customerMarker ? customerText.indexOf(parsed.customerMarker)
    : /(?:核销|收款)(?:掉)?[，,。:：、\s]*$/.exec(customerText)?.index;
  const customerKeyword = customerText.slice(0, boundaryIndex ?? customerText.length)
    .replace(/^[，,。:：、\s]+|[，,。:：、\s]+$/g, '').trim();
  // 只有无付款谓词的旧命令允许第二种解读；保留原名，交当前权限下的双候选核对。
  const paymentSubject = /到账|收到|打过来|打款|打来|打了|支付了?|付款了?|付了/.test(customerText);
  const commandCustomerKeyword = paymentSubject ? customerKeyword : customerKeyword.replace(/^(?:(?:请|帮我|帮忙|把|给)[，,\s]*)+/, '');
  return { ...parsed, customerText, customerKeyword, commandCustomerKeyword, originalText, customerCodes, dates, targetRefs, scopedTarget };
}

export function assertReceiptRequestSupported(parsed) {
  if (parsed.targetRefs.length || parsed.scopedTarget || parsed.dates.length) {
    const details = [parsed.targetRefs.length ? `指定单据 ${parsed.targetRefs.join('、')}` : parsed.scopedTarget ? '指定的核销目标' : '', parsed.dates.length ? `日期 ${parsed.dates.join('、')}` : ''].filter(Boolean).join('，');
    throw Object.assign(new Error(`已识别${details}${parsed.amountCents != null ? `，到账金额 ¥${(parsed.amountCents / 100).toFixed(2)}` : ''}。小满暂不能安全办理指定目标或日期的收款核销，请到原收付款页核对客户、单据、余额和业务日期后办理。未生成新的收款预览，未新增收款或执行核销。`), { code: 'RECEIPT_SCOPE_UNSUPPORTED', status: 400 });
  }
}
