// 先划分消息来源，再处理格式。只有员工自己的要求会进入普通意图规划。
const QUOTES = { '「': '」', '『': '』', '“': '”', '‘': '’', '«': '»', '"': '"' };
const transfer = /(?:^|[\n，,；;。])\s*(?:【(?:转发|聊天记录)】|(?:转发(?:了)?\s*(?:的)?\s*)?(?:客户(?:发(?:来|了)?(?:的)?\s*(?:微信|消息|语音|聊天记录)|发来(?:的)?|回复|反馈|转述|说|原话|消息|微信|留言|聊天记录)|聊天记录|转发内容|微信转发)|转发)\s*(?:[：:]\s*|(?=[「『“‘«"\n])|$)/;
const unboundedSpeech = /(?:^|[\n，,；;。])\s*(?:转发\s*)?(?:客户|对方)\s*(?:刚才\s*)?(?:说|回复|发来|发(?:了)?微信(?:说|回复)|留言|原话|转述|反馈)/;
const ownInstruction = /^[ \t，,；;。]*\r?\n\s*我(?:的要求|这边的要求|本人要求|的指令)\s*[：:]\s*([^\r\n]+)\s*$/;
const closers = new Set(Object.values(QUOTES));

function closeQuote(text, start) {
  const stack = [QUOTES[text[start]]];
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return i;
    } else if (Object.hasOwn(QUOTES, char)) stack.push(QUOTES[char]);
    else if (closers.has(char)) return -1;
  }
  return -1;
}

function separateQuote(text) {
  if (!Object.hasOwn(QUOTES, text[0])) return null;
  const end = closeQuote(text, 0);
  if (end < 0) return null;
  const after = text.slice(end + 1);
  const outer = text[0];
  if (after.includes(outer) || after.includes(QUOTES[outer])) return null;
  // 带有未闭合或多余引号的后缀不可用于确定发话者。
  for (let i = 0; i < after.length; i++) {
    if (Object.hasOwn(QUOTES, after[i])) {
      i = closeQuote(after, i);
      if (i < 0) return null;
    } else if (closers.has(after[i])) return null;
  }
  return { quoted: text.slice(1, end), after };
}

export function forwardedMessage(input) {
  const text = String(input ?? '').trim();
  const marker = transfer.exec(text);
  if (/^>/.test(text)) return { quoted: null, instruction: null };
  if (!marker) {
    const found = separateQuote(text);
    if (!found) return Object.hasOwn(QUOTES, text[0]) || unboundedSpeech.test(text) ? { quoted: null, instruction: null } : null;
    const own = ownInstruction.exec(found.after)?.[1]?.trim();
    if (own) return { quoted: found.quoted, instruction: own };
    return { quoted: null, instruction: null };
  }
  const source = text.slice(marker.index + marker[0].length).trimStart();
  const quote = separateQuote(source);
  // 无闭合边界时，整段都按转发处理，里面的“我的要求”也只是来源文本。
  if (!quote || text.slice(0, marker.index).trim()) return { quoted: null, instruction: null };
  const own = ownInstruction.exec(quote.after)?.[1]?.trim() ?? null;
  return { quoted: quote.quoted, instruction: own };
}

export function prepareForwardedSale(text) {
  return /^(?:请\s*|帮我\s*)?按(?:这(?:条|段)|上(?:面|述)(?:的)?)?(?:客户)?(?:留言|原话|消息|内容)\s*(?:准备|起草|创建|新建|建|做)(?:一?[张份])?销售草稿[。！!]*$/.test(text);
}

export function asciiWidth(text) {
  return text.replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF0E\uFF0D\uFF0B\u3000]/g,
    char => char === '\u3000' ? ' ' : String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

// 默认单据号由日期和流水组成。空白只在完整的号码内合并，保留编号本身的横杠或下划线。
const businessNumber = /(?<![a-z0-9_-])(?:(BF)[ \t]*-[ \t]*(\d{8})[ \t]*-[ \t]*(\d{4,})|(SL|SR|PR|RC|RF|SC|WT|RT|PC|IT|TR|PY)([ \t]*(?:[-_][ \t]*)?)(\d{8})([ \t]*)(\d{3,}))(?![a-z0-9_-]|\.\d)/gi;
const numericUnit = /^[ \t]*(?:元|块|万|角|毛|件|个|套|箱|条|包|盒|台|米|公斤|千克|[%％‰])/;

function isDocumentDate(value) {
  const iso = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6);
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso;
}

function normalizeDocumentNumbers(text) {
  const ascii = asciiWidth(text);
  let output = '', end = 0;
  for (const match of ascii.matchAll(businessNumber)) {
    const [found, application, applicationDate, applicationId, prefix, separator, businessDate, serialGap, serial] = match;
    const next = match.index + found.length;
    if (!isDocumentDate(applicationDate ?? businessDate) || serialGap && numericUnit.test(ascii.slice(next))) continue;
    const number = application ? `BF-${applicationDate}-${applicationId}` : prefix + separator.trim() + businessDate + serial;
    output += text.slice(end, match.index) + number;
    end = next;
  }
  return output + text.slice(end);
}

export function operatorInput(input) {
  const raw = String(input ?? '').trim();
  const spoken = raw
    .replace(/^(?:【)?(?:语音转写|语音转文字|语音识别)(?:】)?\s*[：:]\s*/, '')
    .replace(/^(小满[，,:：\s]*)?(?:(?:嗯+|呃+|额+|那个)[，,、\s]+)+/, '$1')
    .replace(/^(?:(?:小满|请|帮我|帮忙|麻烦)[，,:：\s]*)*(?:瞅一眼|瞅一下|瞅瞅|看下|查下|看一眼)(?=\s*[\p{L}\d])/u,
      match => match.replace(/(?:瞅一眼|瞅一下|瞅瞅|看下|查下|看一眼)$/, '查一下'))
    .replace(/(?:库纯|库村|庫存)(?=\s*(?:[。！？!?；;]|$))/g, '库存')
    .replace(/(?:还剩几个|还有几个|有多少货|还剩多少货)(?=\s*(?:[。！？!?]|$))/g, '还剩多少')
    .trim();
  const text = normalizeDocumentNumbers(spoken);
  return { text, normalized: text !== raw };
}
