/**
 * 用户-仓库数据权限（user_warehouse_scope，迁移 122）
 *
 * 语义：表中无该用户任何行 = 不限仓（返回 null）；有行 = 只能访问 scope 内仓库。
 * 超管（roleId 1）恒不限仓。带 60s 内存缓存，用户 scope 变更后调 clearScopeCache。
 */
const { pool } = require('../config/db')

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

module.exports = { loadUserWarehouseScope, clearScopeCache, scopeFilter }
