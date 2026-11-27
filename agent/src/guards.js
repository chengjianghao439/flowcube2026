// 守卫层（总体设计 §5）：前置校验 + 数字纪律。
// 原则：Agent 先检给友好提示，服务端校验为最终裁决；禁止静默四舍五入/改数。

// 数量精度：最多两位有效小数（尾零可接受，如 1.230）；整数商品必须整数（逐行）。
// 返回 null 表示通过；否则返回结构化错误 {code, message}。
export function validateQty(qty, { allowDecimal = true, label = '数量' } = {}) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    return { code: 'QTY_INVALID', message: `${label} ${qty} 无效，必须为正数` };
  }
  // 两位有效小数判定：只接受十进制字面量并用字符串与百分位整数双检，避免科学计数法或极小尾差绕过
  const raw = String(qty).trim();
  const strMatch = /^\+?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!strMatch) {
    return { code: 'QTY_INVALID', message: `${label} ${qty} 格式无效，请输入正数` };
  }
  const frac = (strMatch[2] || '').replace(/0+$/, '');
  if (frac.length > 2) {
    return { code: 'QTY_DECIMALS_EXCEEDED', message: `${label} ${qty} 超过两位小数，系统不接受（不会自动四舍五入），请修正` };
  }
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
    const rawStr = String(value).trim().toLowerCase();
    if (rawStr.length > 64 || !Number.isFinite(Number(rawStr))) throw new Error('金额不是有效数字');
    const match = rawStr.match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
    if (!match) throw new Error('金额格式不正确');
    const exp = Number(match[4] || 0);
    if (!Number.isSafeInteger(exp) || Math.abs(exp) > 18) throw new Error('金额超过安全计算范围，请人工处理');
    const scale = (match[3] || '').length - exp;
    if (Math.abs(scale) > 30) throw new Error('金额超过安全计算范围，请人工处理');
    return { n: BigInt(`${match[1]}${match[2]}${match[3] || ''}`), scale };
  };
  const a = decimal(price), b = decimal(quantity);
  const scale = a.scale + b.scale - 2;
  if (Math.abs(scale) > 40) throw new Error('金额超过安全计算范围，请人工处理');
  const raw = a.n * b.n;
  const divisor = 10n ** BigInt(Math.max(0, scale));
  const absolute = raw < 0n ? -raw : raw;
  const cents = scale <= 0 ? raw * 10n ** BigInt(-scale) : (raw < 0n ? -1n : 1n) * ((absolute + divisor / 2n) / divisor);
  const result = Number(cents);
  if (!Number.isSafeInteger(result)) throw new Error('金额超过安全计算范围，请人工处理');
  return result;
}

// 数字纪律检查：汇报文本中出现的金额/数量必须能在工具返回中找到出处。
// allowed: 数字数组（元或个数的数值）。返回文本里无法溯源的数字列表（空 = 通过）。

// 预览新鲜度：比对关键字段（行增删/数量/单位/价格/可用量/总额），返回变化明细（空数组 = 无变化）
export function diffPreview(before, after) {
  const diffs = [];
  const key = l => `${l.productId}`;
  const bMap = new Map(before.lines.map(l => [key(l), l]));
  const aMap = new Map(after.lines.map(l => [key(l), l]));
  for (const b of before.lines) {
    if (!aMap.has(key(b))) {
      diffs.push({ productId: b.productId, field: 'line', before: '原有行', after: null });
    }
  }
  for (const a of after.lines) {
    const b = bMap.get(key(a));
    if (!b) { diffs.push({ productId: a.productId, field: 'line', before: null, after: '新增行' }); continue; }
    if (b.qty !== undefined && a.qty !== undefined && Number(b.qty) !== Number(a.qty)) {
      diffs.push({ productId: a.productId, field: 'qty', before: b.qty, after: a.qty });
    }
    if ((b.unit ?? null) !== (a.unit ?? null)) {
      diffs.push({ productId: a.productId, field: 'unit', before: b.unit ?? null, after: a.unit ?? null });
    }
    if (b.unitPriceCents !== a.unitPriceCents || b.unitPrice !== a.unitPrice) {
      diffs.push({ productId: a.productId, field: 'unitPriceCents', before: b.unitPriceCents, after: a.unitPriceCents });
    }
    if (Number(b.available) !== Number(a.available)) {
      diffs.push({ productId: a.productId, field: 'available', before: b.available, after: a.available });
    }
  }
  if (before.totalCents !== undefined && after.totalCents !== undefined && Number(before.totalCents) !== Number(after.totalCents)) {
    diffs.push({ productId: null, field: 'totalCents', before: before.totalCents, after: after.totalCents });
  }
  return diffs;
}
