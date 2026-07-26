/**
 * 用户-仓库数据权限（user_warehouse_scope，迁移 122）
 *
 * 语义：表中无该用户任何行 = 不限仓（返回 null）；有行 = 只能访问 scope 内仓库。
 * 超管（roleId 1）恒不限仓。带 60s 内存缓存，用户 scope 变更后调 clearScopeCache。
 */
const { pool } = require('../config/db')
const AppError = require('./AppError')

const CACHE = new Map()
const TTL_MS = 60 * 1000

/** @returns {Promise<number[]|null>} null=不限仓 */
async function loadUserWarehouseScope(userId, roleId) {
  if (roleId === 1) return null
  const key = Number(userId)
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.scope
  const [rows] = await pool.query(
    'SELECT warehouse_id FROM user_warehouse_scope WHERE user_id = ?',
    [key],
  )
  const scope = rows.length ? rows.map(r => Number(r.warehouse_id)) : null
  CACHE.set(key, { scope, ts: Date.now() })
  return scope
}

function clearScopeCache(userId) {
  if (userId != null) CACHE.delete(Number(userId))
  else CACHE.clear()
}

/**
 * 生成列表查询的 scope 过滤片段。
 * @param {number[]|null|undefined} warehouseIds - req.user.warehouseIds
 * @param {string} column - 仓库列（含表别名），如 'so.warehouse_id'
 * @returns {{ sql: string, params: number[] }} sql 为空串表示不限
 */
function scopeFilter(warehouseIds, column) {
  if (!Array.isArray(warehouseIds)) return { sql: '', params: [] }
  if (!warehouseIds.length) return { sql: ' AND 1=0', params: [] } // 空 scope 极端情况：什么都看不到
  return { sql: ` AND ${column} IN (?)`, params: [warehouseIds] }
}

/**
 * 单据级 scope 断言：列表靠 scopeFilter 过滤，但「知道 id 就直接查详情/改状态」
 * 是绕开列表的另一条路，必须在拿到单据后再验一次它属于哪个仓。
 *
 * 两种情况刻意放行：
 * - warehouseIds 不是数组 → 该用户不限仓（超管，或没配 user_warehouse_scope）
 * - 单据自身没有仓库归属（null）→ 例如混单收货单的头字段为空，此时按明细行判定，
 *   由调用方自行决定是否逐行校验，这里不武断拦截
 *
 * @param {number[]|null|undefined} warehouseIds - req.user.warehouseIds
 * @param {number|null} targetWarehouseId - 单据所属仓库
 * @param {string} entityName - 报错文案里的单据名
 */
function assertInScope(warehouseIds, targetWarehouseId, entityName = '该单据') {
  if (!Array.isArray(warehouseIds)) return
  if (targetWarehouseId == null) return
  if (!warehouseIds.map(Number).includes(Number(targetWarehouseId))) {
    throw new AppError(`无权访问其他仓库的${entityName}`, 403, 'WAREHOUSE_SCOPE_DENIED')
  }
}

/**
 * 调拨的 scope 判定：源仓或目标仓任一在范围内即可见。
 * 调拨天然跨仓，若要求两端都在 scope 内，发货方就看不见自己发出的单子。
 */
function transferScopeFilter(warehouseIds, fromColumn, toColumn) {
  if (!Array.isArray(warehouseIds)) return { sql: '', params: [] }
  if (!warehouseIds.length) return { sql: ' AND 1=0', params: [] }
  return {
    sql: ` AND (${fromColumn} IN (?) OR ${toColumn} IN (?))`,
    params: [warehouseIds, warehouseIds],
  }
}

function assertTransferInScope(warehouseIds, fromWarehouseId, toWarehouseId) {
  if (!Array.isArray(warehouseIds)) return
  const ids = warehouseIds.map(Number)
  const from = fromWarehouseId != null ? Number(fromWarehouseId) : null
  const to = toWarehouseId != null ? Number(toWarehouseId) : null
  if ((from != null && ids.includes(from)) || (to != null && ids.includes(to))) return
  throw new AppError('无权访问其他仓库的调拨单', 403, 'WAREHOUSE_SCOPE_DENIED')
}

module.exports = {
  loadUserWarehouseScope,
  clearScopeCache,
  scopeFilter,
  assertInScope,
  transferScopeFilter,
  assertTransferInScope,
}
