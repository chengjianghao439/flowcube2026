/**
 * 数量输入框的 step（迁移 254 的商品「数量小数」开关）。
 *
 * 只允许整数的商品给 step=1：上下箭头按整数走，桌面端也会把它当整数框，
 * 用户不会误以为小数是合法的；其余商品给 0.01——这就是系统的最小库存精度
 * （数量列统一 DECIMAL(*,2)，见 backend/src/utils/unitConversion.js 的 roundQty）。
 *
 * step 本身不拦键入；数量框必须显式加 Input 的 quantity 属性，输入和粘贴
 * 均由 quantityInputError 校验。服务端仍须独立校验，不能信任界面。
 */
export function qtyStep(allowDecimal?: boolean | null): string {
  return allowDecimal === false ? '1' : '0.01'
}

/** 仅用于派生数量的计算/展示，不得用于悄悄修改用户录入。 */
export function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100
}

/** 数字型业务草稿允许计算噪声；原始用户输入仍走下方严格字符串校验。 */
export function hasQuantityPrecision(value: number): boolean {
  if (!Number.isFinite(value)) return false
  const rounded = roundQuantity(value)
  if (rounded === 0) return value === 0
  return Math.abs(value - rounded) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4
}

/** 校验原始输入的有效小数位，不先转 Number 丢失精度；尾零及科学计数法按数值解释。 */
export function quantityInputError(value: string, integerOnly = false): string | null {
  const text = value.trim()
  if (!text) return null
  const parts = text.match(/^[+-]?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/)
  if (!parts || !(parts[1] || parts[2]) || !Number.isFinite(Number(text))) return '请输入有效数量'
  const digits = parts[1] + (parts[2] || '')
  if (!/[1-9]/.test(digits)) return null
  const trailingZeros = digits.length - digits.replace(/0+$/, '').length
  const places = Math.max(0, (parts[2]?.length || 0) - Number(parts[3] || 0) - trailingZeros)
  if (integerOnly && places > 0) return '该商品数量只能是整数'
  return places > 2 ? '数量最多保留两位小数' : null
}
