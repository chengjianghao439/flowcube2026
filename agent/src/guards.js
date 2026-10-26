// 守卫层（总体设计 §5）：前置校验 + 数字纪律。
// 原则：Agent 先检给友好提示，服务端校验为最终裁决；禁止静默四舍五入/改数。

// 数量精度：最多两位有效小数（尾零可接受，如 1.230）；整数商品必须整数（逐行）。
// 返回 null 表示通过；否则返回结构化错误 {code, message}。
export function validateQty(qty, { allowDecimal = true, label = '数量' } = {}) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    return { code: 'QTY_INVALID', message: `${label} ${qty} 无效，必须为正数` };
  }
  // 两位有效小数判定：用字符串与百分位整数双检，避免浮点噪声误判
  const scaled = Math.round(n * 100);
  if (Math.abs(n * 100 - scaled) > 1e-6) {
    return { code: 'QTY_DECIMALS_EXCEEDED', message: `${label} ${qty} 超过两位小数，系统不接受（不会自动四舍五入），请修正` };
  }
  if (!allowDecimal && scaled % 100 !== 0) {
    return { code: 'QTY_INTEGER_REQUIRED', message: `${label} ${qty} 不是整数，该商品不允许小数数量，请修正` };
  }
  return null;
}

// 金额：展示元 → 整数分（总额口径按分；单价保留原精度由服务端处理）
export function toCents(yuan) {
  return amountCents(yuan, 1);
}
// 十进制相乘后再按分取整，不能先把单价舍入到分。
export function amountCents(price, quantity) {
  const decimal = value => {
    if (!Number.isFinite(Number(value))) throw new Error('金额不是有效数字');
    const match = String(value).toLowerCase().match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
    if (!match) throw new Error('金额格式不正确');
    return { n: BigInt(`${match[1]}${match[2]}${match[3] || ''}`), scale: (match[3] || '').length - Number(match[4] || 0) };
  };
  const a = decimal(price), b = decimal(quantity);
  const scale = a.scale + b.scale - 2;
  const raw = a.n * b.n;
  const divisor = 10n ** BigInt(Math.max(0, scale));
  const absolute = raw < 0n ? -raw : raw;
  const cents = scale <= 0 ? raw * 10n ** BigInt(-scale) : (raw < 0n ? -1n : 1n) * ((absolute + divisor / 2n) / divisor);
  const result = Number(cents);
  if (!Number.isSafeInteger(result)) throw new Error('金额超过安全计算范围，请人工处理');
  return result;
}
export function centsToYuan(cents) {
  return (Number(cents) / 100).toFixed(2);
}

// 数字纪律检查：汇报文本中出现的金额/数量必须能在工具返回中找到出处。
// allowed: 数字数组（元或个数的数值）。返回文本里无法溯源的数字列表（空 = 通过）。
export function checkReportNumbers(text, allowed) {
  const allowedSet = new Set(allowed.map(v => String(Number(v))));
  const found = String(text).match(/\d+(?:\.\d+)?/g) || [];
  const bad = [];
  for (const raw of found) {
    const norm = String(Number(raw));
    if (!allowedSet.has(norm)) bad.push(raw);
  }
  return bad;
}

// 预览新鲜度：比对关键字段（价格/可用量），返回变化明细（空数组 = 无变化）
export function diffPreview(before, after) {
  const diffs = [];
  const key = l => `${l.productId}`;
  const bMap = new Map(before.lines.map(l => [key(l), l]));
  for (const a of after.lines) {
    const b = bMap.get(key(a));
    if (!b) { diffs.push({ productId: a.productId, field: 'line', before: null, after: '新增行' }); continue; }
    if (b.unitPriceCents !== a.unitPriceCents || b.unitPrice !== a.unitPrice) {
      diffs.push({ productId: a.productId, field: 'unitPriceCents', before: b.unitPriceCents, after: a.unitPriceCents });
    }
    if (Number(b.available) !== Number(a.available)) {
      diffs.push({ productId: a.productId, field: 'available', before: b.available, after: a.available });
    }
  }
  return diffs;
}
