'use strict'

/** 数量落库前统一校验：最多两位有效小数；整数商品另外拒绝非整数。
 * 只接受 IEEE-754 运算产生的舍入噪声，不允许先 roundQty 再校验原始输入。
 * 金额、单价与单位换算率不使用此校验。商品不存在由业务报错，但精度限制始终生效。
 */

const AppError = require('./AppError')

const QTY_EPSILON = 1e-9

const CODE_INTEGER_REQUIRED = 'QTY_INTEGER_REQUIRED'
const CODE_INVALID = 'QTY_INVALID'
const CODE_DECIMALS_EXCEEDED = 'QTY_DECIMALS_EXCEEDED'

function hasTooManyDecimals(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return true
  const scaled = n * 100
  const nearest = Math.round(scaled)
  if (nearest === 0 && n !== 0) return true
  return Math.abs(scaled - nearest) > Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2
}

function qtyScaleProblem(qty, label = '数量') {
  if (qty == null || String(qty).trim() === '' || !Number.isFinite(Number(qty))) {
    return { code: CODE_INVALID, message: `${label}不是有效数字` }
  }
  if (hasTooManyDecimals(qty)) return { code: CODE_DECIMALS_EXCEEDED, message: `${label}最多保留 2 位小数，请修改后重试` }
  return null
}

function assertQtyScale(qty, label = '数量') {
  const problem = qtyScaleProblem(qty, label)
  if (problem) throw new AppError(problem.message, 400, problem.code)
}

/** 是否带小数部分（用于「只能整数」的商品） */
function hasFraction(value) {
  return Math.abs(value - Math.round(value)) > QTY_EPSILON
}

/**
 * 单个数量是否满足商品策略。
 * 商品查不到时仍检查两位尺度；商品是否存在与其余业务条件由调用方报错。
 *
 * @returns {null|{ code: string, message: string }}
 */
function qtyPrecisionProblem(policy, qty, label = '数量') {
  const scaleProblem = qtyScaleProblem(qty, label)
  if (scaleProblem) return scaleProblem
  if (!policy) return null
  const n = Number(qty)
  if (policy.allowDecimal === false && hasFraction(n)) {
    const who = policy.name ? `商品「${policy.name}」` : '该商品'
    return { code: CODE_INTEGER_REQUIRED, message: `${who}只能按整数出入库，${label}不能填 ${qty}` }
  }
  return null
}

/** 同上，但直接抛业务异常。 */
function assertQtyPrecisionWith(policy, qty, label = '数量') {
  const problem = qtyPrecisionProblem(policy, qty, label)
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
 */
async function assertQtyPrecision(conn, rows) {
  const list = (rows || []).filter((r) => r && r.productId != null && r.qty !== undefined && r.qty !== null)
  if (!list.length) return
  for (const row of list) assertQtyScale(row.qty, row.label || '数量')
  const policies = await loadQtyPolicies(conn, list.map((r) => r.productId))
  for (const row of list) {
    assertQtyPrecisionWith(policies.get(Number(row.productId)), row.qty, row.label || '数量')
  }
}

module.exports = {
  QTY_EPSILON,
  CODE_DECIMALS_EXCEEDED,
  hasTooManyDecimals,
  qtyScaleProblem,
  assertQtyScale,
  CODE_INTEGER_REQUIRED,
  hasFraction,
  qtyPrecisionProblem,
  assertQtyPrecisionWith,
  loadQtyPolicies,
  assertQtyPrecision,
}
