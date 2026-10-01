'use strict'
const AppError = require('../../utils/AppError')
const invalid = reason => { throw new AppError(`套单拣货归还记录不一致：${reason}，请联系管理员核对原拣货记录`, 409, 'SALE_COMMERCIAL_PICK_SOURCE_INVALID') }
function units(value) {
  const n = Number(value), u = Math.round(n * 100)
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(u) || Math.abs(n * 100 - u) > 1e-6) invalid('数量无效')
  return u
}
async function load(conn, task, containers) {
  if (!containers.length) return new Map()
  const [items] = await conn.query('SELECT id,task_id,product_id,picked_qty FROM warehouse_task_items WHERE task_id=?', [task.id])
  const [scans] = await conn.query(`SELECT id,task_id,item_id,container_id,product_id,qty FROM scan_logs
    WHERE task_id=? AND container_id IN (?) AND COALESCE(scan_purpose,1)=1 ORDER BY id`, [task.id, containers.map(c => c.id)])
  const byItem = new Map(items.map(i => [Number(i.id), i])), byContainer = new Map(containers.map(c => [Number(c.id), c]))
  const picked = new Map(), itemQty = new Map()
  for (const s of scans) {
    const c = byContainer.get(Number(s.container_id)), i = byItem.get(Number(s.item_id)), qty = units(s.qty)
    if (!c || !i || !qty || Number(s.task_id) !== Number(task.id) || Number(c.locked_by_task_id) !== Number(task.id)
      || Number(i.task_id) !== Number(task.id) || Number(i.product_id) !== Number(c.product_id)
      || Number(s.product_id) !== Number(c.product_id) || Number(c.warehouse_id) !== Number(task.warehouse_id)) invalid('原拣货与任务、商品或仓库不符')
    picked.set(Number(c.id), (picked.get(Number(c.id)) || 0) + qty)
    itemQty.set(Number(i.id), (itemQty.get(Number(i.id)) || 0) + qty)
  }
  for (const c of containers) {
    const qty = picked.get(Number(c.id))
    if (Number(c.status) !== 1 || c.deleted_at != null) invalid('待归还条码不是有效在库实物')
    if (!qty) invalid('待归还条码缺少有效拣货记录')
    if (!Number.isSafeInteger(qty) || qty > units(c.remaining_qty)) invalid('原拣货数量超过条码实物量')
  }
  for (const i of items) if ((itemQty.get(Number(i.id)) || 0) > units(i.picked_qty)) invalid('原拣货数量超过任务已拣量')
  return new Map([...picked].map(([id, qty]) => [id, qty / 100]))
}
module.exports = { load }
