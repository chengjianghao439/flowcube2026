'use strict'

/**
 * 商品级数量精度校验（迁移 254 的 `product_items.allow_decimal_qty`）。
 *
 * 开关语义：
 *   - `allow_decimal_qty = 1`（默认）：数量可以带小数，最多**两位**（0.01）——
 *     「1.25 公斤」「2.5 米」这类可拆分的商品；
 *   - `allow_decimal_qty = 0`：数量必须是整数——「个 / 台 / 箱」这类不可拆分的商品。
 *
 * 为什么必须在服务端拦：前端只能管住自己页面上的输入框，PDA、桌面端、批量导入、
 * Excel 导入与直接调接口都绕得过去，而这些入口最后都会改库存与账款事实。
 *
 * 只校验**用户提交的数量**，不回改存量：数量列仍是 DECIMAL(14,4)，历史数据里
 * 若有三位以上小数，照旧读得出、算得对，只是不能再这么录。
 *
 * 容差 1e-9：`Number('1.10')` 与 DECIMAL(14,4) 往返会有 <1e-10 的浮点噪声，
 * 但不能因此放过真正的 0.5 个或 1.234。
 */

const AppError = require('./AppError')

const QTY_EPSILON = 1e-9

const CODE_INTEGER_REQUIRED = 'QTY_INTEGER_REQUIRED'
const CODE_SCALE_EXCEEDED = 'QTY_DECIMAL_SCALE_EXCEEDED'
const CODE_INVALID = 'QTY_INVALID'

/** 是否带小数部分（用于「只能整数」的商品） */
function hasFraction(value) {
  return Math.abs(value - Math.round(value)) > QTY_EPSILON
}

/** 是否超过两位小数（用于「允许小数」的商品） */
function hasTooManyDecimals(value) {
  const scaled = value * 100
  return Math.abs(scaled - Math.round(scaled)) > QTY_EPSILON
}

/**
 * 单个数量是否满足商品策略。
 * 商品查不到（policy 为空）时**放行**——「商品不存在」由各业务自己的校验报错，
 * 这里再报一次只会把真实原因盖掉。
 *
 * @param {object} [options]
 * @param {boolean} [options.checkScale=true] 是否同时校验「允许小数」商品的两位上限。
 *   出库、拣货、收货、盘点这些**执行类**入口传 false：那里的数量常常直接来自存量
 *   或占库记录，而存量里可能有历史遗留的三位小数，按两位拦会把正常业务卡死；
 *   「不允许小数」商品的整数约束在这类入口**仍然生效**（那才是用户要的整数出货）。
 * @returns {null|{ code: string, message: string }}
 */
function qtyPrecisionProblem(policy, qty, label = '数量', { checkScale = true } = {}) {
  if (!policy) return null
  const n = Number(qty)
  if (!Number.isFinite(n)) return { code: CODE_INVALID, message: `${label}不是有效数字` }
  const who = policy.name ? `商品「${policy.name}」` : '该商品'
  if (policy.allowDecimal === false) {
    if (hasFraction(n)) {
      return { code: CODE_INTEGER_REQUIRED, message: `${who}只能按整数出入库，${label}不能填 ${qty}` }
    }
    return null
  }
  if (checkScale && hasTooManyDecimals(n)) {
    return { code: CODE_SCALE_EXCEEDED, message: `${who}的数量最多两位小数，${label}不能填 ${qty}` }
  }
  return null
}

/** 同上，但直接抛业务异常。 */
function assertQtyPrecisionWith(policy, qty, label = '数量', options) {
  const problem = qtyPrecisionProblem(policy, qty, label, options)
  if (problem) throw new AppError(problem.message, 400, problem.code)
}

/**
 * 按商品 Id 批量读开关。
 *
 * **刻意不做跨调用缓存**：mysql2 连接池会把同一个 `PoolConnection` 实例派给先后不同的
 * 请求，任何挂在 conn 上的缓存都会在管理员改了商品开关之后继续返回旧值——「刚把它设成
 * 只能整数，结果还能按小数下单」这种问题最难排查。一次 `IN (?)` 主键查询的代价，
 * 比读到一个不该信的缓存小得多。
 *
 * @returns {Promise<Map<number, { id: number, name: string, code: string, allowDecimal: boolean }>>}
 */
async function loadQtyPolicies(conn, productIds) {
  const ids = [...new Set((productIds || []).map(Number).filter(Number.isInteger))]
  const out = new Map()
  for (const id of ids) out.set(id, null) // 商品不存在时保持 null，调用方按「放行」处理
  if (!ids.length) return out
  const [rows] = await conn.query(
    'SELECT id, code, name, allow_decimal_qty FROM product_items WHERE id IN (?)',
    [ids],
  )
  for (const row of rows) {
    out.set(Number(row.id), {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      // 与 products.service 的出参口径一致：NULL 视作允许
      allowDecimal: row.allow_decimal_qty == null ? true : Number(row.allow_decimal_qty) === 1,
    })
  }
  return out
}

/**
 * 校验一批明细的数量精度，遇到第一条违规就抛错。
 *
 * @param {object} conn 事务连接或连接池
 * @param {Array<{ productId: number, qty: number|string, label?: string }>} rows
 * @param {object} [options] 透传给 qtyPrecisionProblem；执行类入口传 { checkScale: false }
 */
async function assertQtyPrecision(conn, rows, options) {
  const list = (rows || []).filter((r) => r && r.productId != null && r.qty !== undefined && r.qty !== null)
  if (!list.length) return
  const policies = await loadQtyPolicies(conn, list.map((r) => r.productId))
  for (const row of list) {
    assertQtyPrecisionWith(policies.get(Number(row.productId)), row.qty, row.label || '数量', options)
  }
}

module.exports = {
  QTY_EPSILON,
  CODE_INTEGER_REQUIRED,
  CODE_SCALE_EXCEEDED,
  hasFraction,
  hasTooManyDecimals,
  qtyPrecisionProblem,
  assertQtyPrecisionWith,
  loadQtyPolicies,
  assertQtyPrecision,
}
