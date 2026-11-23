import { quantityNumber } from './sale-conversation.js';
import { asciiWidth } from './input-source.js';

const ordinal = /^(?:第)?(\d{1,2}|[一二三四五六七八九十两]{1,3})(?:号|號)?[仓倉](?:库|庫)?$/;
const suffix = /(?<![\d一二三四五六七八九十两])(?:第)?(?:\d{1,2}|[一二三四五六七八九十两]{1,3})(?:号|號)?[仓倉](?:库|庫)?$/;
const queryHead = /^(?:(?:小满|请|帮我|帮忙|麻烦)[，,:：\s]*)*(?:先\s*)?(?:只查|只看|查询一下|查一下|查询|查看|看一下|看看|查|看)\s*/;
const leadingOrdinal = /^(?:在\s*)?(第?(?:[\d０-９]{1,2}|[一二三四五六七八九十两]{1,3})(?:号|號)?[仓倉](?:库|庫)?)(?!型|版|款)/;
const writtenWarehouse = /(?:只查|只看|查询一下|查一下|查询|查看|看一下|看看|查|看|在)\s*([^，,。！？?\s]{1,30}?[仓倉](?:库|庫)?)(?:的|里|中|\s|$)/;

export function warehouseOrdinal(name, fromDirectory = false) {
  const value = String(name ?? '');
  const folded = asciiWidth(value);
  const part = fromDirectory ? folded.match(suffix)?.[0] : folded;
  const digits = ordinal.exec(part ?? '')?.[1];
  return digits ? quantityNumber(digits) : NaN;
}

export function inventoryWords(text) {
  const warehouse = writtenWarehouse.exec(text)?.[1];
  const source = /^[仓倉](?:库|庫)?$/.test(warehouse ?? '') ? null : warehouse;
  return { written: source || leadingOrdinal.exec(text.replace(queryHead, ''))?.[1], withoutHead: text.replace(queryHead, '') };
}

export function inventoryProductCode(text) {
  const literal = String(text).trim();
  const code = asciiWidth(literal);
  const match = /^(?:字母\s*)?([a-z]{1,4})((?:[ \t]*[0-9零〇一二三四五六七八九幺]){2,24})$/i.exec(code);
  if (!match) return /^[a-z][a-z0-9._-]*\d[a-z0-9._-]*$/i.test(code) ? code : literal;
  const digits = match[2].replace(/[ \t]+/g, '').replace(/[零〇一二三四五六七八九幺]/g,
    char => String({ 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 幺: 1 }[char]));
  return match[1].toUpperCase() + digits;
}

export function productSearchAlternative(keyword) {
  const matches = [...keyword.matchAll(/铰连|绞链|绞连/g)];
  return matches.length === 1 ? keyword.replace(matches[0][0], '铰链') : null;
}

export function branchSearchAlternative(keyword) {
  const match = /^([\p{L}][\p{L}0-9·-]{1,23}?)(?<!\d)(\d{1,3}号(?:店|门店|分店))$/u.exec(keyword);
  if (!match) return null;
  return { prefix: match[1], branch: match[2] };
}
