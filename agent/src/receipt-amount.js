// 到账原文是金额来源；模型只定位业务意图，不能补出、舍入或改写到账额。
const invalid = message => Object.assign(new Error(message), { code: 'RECEIPT_AMOUNT_INVALID', status: 400 });
const formatError = () => invalid('到账金额没能准确识别，请用大于 0、最多两位小数的数字重述，例如「客户名 到账 0.50 核销」。未生成收款预览。');

export function assertReceiptAmountCents(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw invalid('到账金额必须大于 0，且精确到分；请核对金额后重新试算。');
}

export function assertReceiptPreviewAmount(preview, originalText) {
  assertReceiptAmountCents(preview?.amountCents);
  const original = parseReceiptAmount(originalText);
  if ((original.amountCents != null && original.amountCents !== preview.amountCents)
    || Number(preview.payload?.amount) !== preview.amountCents / 100) throw invalid('预览的到账金额与原文或登记金额不一致，请重新试算。');
}

function amountRemainder(text) {
  return text.replace(/核销|收款|到账|收到|帮我|帮忙|请|把|给|了|入账|登记|块钱|人民币|元|块|金额|到账额|收款额|并|进行|全部|全额|按未结总额|RMB|CNY/gi, '')
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

export function parseReceiptAmount(input) {
  const text = String(input).normalize('NFKC').replace(/[−﹣－–—]/g, '-');
  const marker = /到账|收到|打款|打来|打了|打过来/.exec(text) || /收款/.exec(text);
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
    return { amountCents: null, customerText: text };
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
  if (!marker && /负\s*$/.test(before)) throw formatError();
  const [whole, fraction = ''] = raw.replace(/^[+-]/, '').split('.');
  const unsigned = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  const amountCents = Number(raw.startsWith('-') ? -unsigned : unsigned);
  assertReceiptAmountCents(amountCents);
  const start = offset + match.index;
  const customerText = (text.slice(0, start) + text.slice(start + match[0].length).replace(/^\s*(?:元|块钱|块)(?:整)?/, ''))
    .replace(/[¥￥]|人民币|\b(?:RMB|CNY)\b/gi, '');
  return { amountCents, customerText };
}
