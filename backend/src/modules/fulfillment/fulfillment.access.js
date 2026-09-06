const AppError = require('../../utils/AppError')
const { PERMISSIONS: P } = require('../../constants/permissions')
const { assertInScope, assertTransferInScope } = require('../../utils/warehouseScope')
const definitions = {
  sale: { table: 'sale_orders', path: '/sale', view: P.SALE_ORDER_VIEW, write: P.SALE_ORDER_UPDATE },
  purchase: { table: 'purchase_orders', path: '/purchase', view: P.PURCHASE_ORDER_VIEW, write: P.PURCHASE_ORDER_CREATE },
  inbound: { table: 'inbound_tasks', path: '/inbound-tasks', view: P.INBOUND_ORDER_VIEW, write: P.INBOUND_ORDER_SUBMIT },
  transfer: { table: 'transfer_orders', path: '/transfer', view: P.TRANSFER_ORDER_VIEW, write: P.TRANSFER_ORDER_CREATE },
}
function definition(type) {
  if (!Object.hasOwn(definitions, type)) throw new AppError('不支持的履约单据类型', 400)
  return definitions[type]
}
function can(user, permission) { return Number(user.roleId) === 1 || (user.permissions || []).includes(permission) }
function scopeDocument(type, row, user) {
  if (type === 'transfer') assertTransferInScope(user.warehouseIds, row.from_warehouse_id, row.to_warehouse_id)
  else assertInScope(user.warehouseIds, row.warehouse_id)
}
async function authorize(conn, type, id, user, write = false) {
  const def = definition(type)
  if (!can(user, def.view) || (write && !can(user, def.write))) throw new AppError('无权查看或处理该单据履约事项', 403)
  const [[row]] = await conn.query(`SELECT * FROM ${def.table} WHERE id=? AND deleted_at IS NULL${write ? ' FOR UPDATE' : ''}`, [id])
  if (!row) throw new AppError('单据不存在', 404)
  scopeDocument(type, row, user)
  if (type === 'sale' && Array.isArray(user.warehouseIds)) {
    const [items] = await conn.query('SELECT DISTINCT COALESCE(warehouse_id,?) AS warehouse_id FROM sale_order_items WHERE order_id=?', [row.warehouse_id, id])
    for (const item of items) assertInScope(user.warehouseIds, item.warehouse_id)
  }
  return row
}
async function eligibleOwners(conn, type, row) {
  const def = definition(type)
  const [users] = await conn.query(`SELECT u.id,u.real_name AS name,u.role_id FROM sys_users u
    WHERE u.is_active=1 AND u.deleted_at IS NULL AND (u.role_id=1 OR
    (EXISTS(SELECT 1 FROM sys_role_permissions p WHERE p.role_id=u.role_id AND p.permission=?)
     AND EXISTS(SELECT 1 FROM sys_role_permissions p WHERE p.role_id=u.role_id AND p.permission=?))) ORDER BY u.id`, [def.view, def.write])
  const [scopes] = await conn.query('SELECT user_id,warehouse_id FROM user_warehouse_scope')
  const byUser = new Map()
  for (const s of scopes) { if (!byUser.has(Number(s.user_id))) byUser.set(Number(s.user_id), []); byUser.get(Number(s.user_id)).push(Number(s.warehouse_id)) }
  const warehouses = [row.warehouse_id]
  if (type === 'sale') {
    const [items] = await conn.query('SELECT DISTINCT COALESCE(warehouse_id,?) AS warehouse_id FROM sale_order_items WHERE order_id=?', [row.warehouse_id, row.id])
    warehouses.push(...items.map(i => i.warehouse_id))
  }
  return users.filter(u => {
    const scope = Number(u.role_id) === 1 ? null : byUser.get(Number(u.id))
    if (!scope) return true
    return type === 'transfer' ? scope.includes(Number(row.from_warehouse_id)) || scope.includes(Number(row.to_warehouse_id)) : warehouses.every(w => w != null && scope.includes(Number(w)))
  }).map(u => ({ id: Number(u.id), name: u.name }))
}
module.exports = { definitions, definition, can, authorize, eligibleOwners, scopeDocument }
