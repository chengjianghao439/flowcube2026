import { parseReceiptAmount } from './receipt-amount.js';

// 客户关键词从原话的句法位置取得。模型识别任务和参数，不能替换客户身份。
const opener = /^(?:(?:小满|请|帮我|帮忙|麻烦|替我)[，,:：\s]*)+/;
const lookup = /^(?:查(?:一下|询|看)?|看一下|看看|核对一下|核对|想看)\s*/;

export function customerRequestText(text) {
  return String(text).trim().replace(opener, '');
}

export function customerFromText(graph, text) {
  const plain = customerRequestText(text);
  let name;
  if (graph === 'B-sale-draft') {
    name = /^(?:给|为)\s*([^，,。！？?]{1,60}?)\s*(?:开|新建|建|做|起|准备)\s*(?:一?[个张份])?\s*(?:销售(?:单|订单|草稿)|单|订单|草稿)(?=[，,。！？?：:\s]|$)/.exec(plain)?.[1]
      ?? /^(?:给|为|帮)?([^，,。！？?]{1,60}?)\s*(?:要订|想订|要买|订购?|买)\s*(?=[\d零一二两三四五六七八九十]).+/.exec(plain)?.[1]
      ?? /(?:^|[，,。；;])\s*客户(?:是|叫|为|[：:])\s*([^，,。！？?；;]{1,60})/.exec(plain)?.[1];
  } else if (graph === 'D-ledger') {
    name = /^([^，,。！？?]{1,60}?)\s*(?:的)?(?:应收(?:账款|余额)?|欠款|台账|(?:那边)?的账)(?:\s*(?:现在|还|还有|还剩|有|是)?多少|\s*结清了吗|\s*还有没有|\s*有多少没收|\s*(?:怎么样|如何))?[？?。！!]*$/
      .exec(plain.replace(lookup, ''))?.[1]
      ?? /^([^，,。！？?]{1,60}?)\s*(?:还有|还剩)多少(?:没收|未收)[？?。！!]*$/.exec(plain.replace(lookup, ''))?.[1];
  } else if (graph === 'D-receipt') {
    name = /^(?:已)?收到\s*([^，,。！？?]{1,60}?)\s*(?:打过来|打来|支付|转来|转入|汇来)的?/.exec(plain)?.[1]
      ?? /^(?:给|为)?\s*([^，,。！？?]{1,60}?)\s*(?:到账|打款|打过来|打来|打了|来了|核销)/.exec(plain)?.[1];
    name = name?.trim().replace(/(公司|号店|门店)(?:的)?(?:钱|款)$/, '$1');
  }
  name = name?.trim().replace(/^[「『“"‘'](.+)[」』”"’']$/, '$1').trim();
  if (!name || /^(?:这|那)(?:个|家|位|笔)|^(?:它|他|她|客户|对方|收到|收款单|账款)$|刚才|上次|(?:[¥￥]|\d\s*(?:元|块))/.test(name)) return null;
  return name;
}

export function receiptCustomerFromText(text, parsed) {
  const name = customerFromText('D-receipt', parsed.customerText);
  const original = customerFromText('D-receipt', text);
  return original?.normalize('NFKC') === name ? original : name;
}

export function groundCustomerIntent(intent, text) {
  if (!intent?.customerKeyword) return intent;
  let name;
  if (intent.graph === 'D-receipt') {
    try { name = receiptCustomerFromText(text, parseReceiptAmount(text)); }
    catch { return null; }
  } else {
    name = customerFromText(intent.graph, text);
  }
  return name ? { ...intent, customerKeyword: name } : null;
}
