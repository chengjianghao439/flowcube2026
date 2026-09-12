const { createRefreshQueue, createCommitNotifier } = require('./fulfillment.refresh-queue')
const AppError = require('../../utils/AppError')
const DEPENDENCY_BATCH = 25
// 候选供应也会改变可发日期；按商品+仓库关联，不能只依赖可能已释放的绑定。
const sources = {
  sale: { table: 'sale_orders', items: 'sale_order_items', parent: 'order_id', warehouse: 'COALESCE(x.warehouse_id,d.warehouse_id)' },
  purchase: { table: 'purchase_orders', items: 'purchase_order_items', parent: 'order_id', warehouse: 'd.warehouse_id' },
  inbound: { table: 'inbound_tasks', items: 'inbound_task_items', parent: 'task_id', warehouse: 'd.warehouse_id' },
  transfer: { table: 'transfer_orders', items: 'transfer_order_items', parent: 'order_id', warehouse: null },
  warehouse: { table: 'warehouse_tasks', items: 'warehouse_task_items', parent: 'task_id', warehouse: 'd.warehouse_id' },
}
// 修改前在同一事务捕获旧维度；不持有业务行对象、不提前发布提示。
async function captureDimensions(conn, type, id) {
  const source = sources[type]
  if (!source) return { pairs: [], truncated: false }
  const select = warehouse => `SELECT DISTINCT x.product_id AS productId,${warehouse} AS warehouseId
    FROM ${source.items} x JOIN ${source.table} d ON d.id=x.${source.parent} WHERE d.id=?`
  const sql = source.warehouse ? select(source.warehouse) : `${select('d.from_warehouse_id')} UNION ${select('d.to_warehouse_id')}`
  const [rows] = await conn.query(`${sql} ORDER BY productId,warehouseId LIMIT ?`, [...(source.warehouse ? [id] : [id, id]), 501])
  return { pairs: rows.slice(0, 500).map(row => `${row.productId}:${row.warehouseId}`), truncated: rows.length > 500 }
}
function createRefreshProcessor({ pool, syncDocument, notify }) {
  return async job => {
    if (job.type === 'stock') {
      const [productId, warehouseId] = job.id.split(':').map(Number)
      const [sales] = await pool.query(`SELECT s.id FROM sale_orders s WHERE s.id>? AND s.deleted_at IS NULL AND s.status IN (1,2,3,6)
        AND EXISTS(SELECT 1 FROM sale_order_items si WHERE si.order_id=s.id AND si.product_id=?
          AND COALESCE(si.warehouse_id,s.warehouse_id)=?) ORDER BY s.id LIMIT ?`,
      [job.cursor?.after || 0, productId, warehouseId, DEPENDENCY_BATCH])
      for (const row of sales) notify('sale', row.id, false)
      return sales.length === DEPENDENCY_BATCH ? { after: sales.at(-1).id } : null
    }
    const source = sources[job.type]
    if (!source) return null
    if (!job.cursor && job.type !== 'warehouse') await syncDocument(job.type, job.id)
    if (!job.cursor && job.type === 'warehouse') {
      const [[task]] = await pool.query('SELECT sale_order_id FROM warehouse_tasks WHERE id=?', [job.id])
      if (task?.sale_order_id) await syncDocument('sale', Number(task.sale_order_id))
    }
    if (!job.expand) return null
    // 混合收货可影响多张采购；独立游标，不一次展开无界ID集合。
    const stage = job.cursor?.stage || (job.type === 'inbound' ? 'purchase' : 'sale')
    const after = job.cursor?.after || 0
    if (stage === 'purchase') {
      const [purchases] = await pool.query(`SELECT p.id FROM purchase_orders p WHERE p.id>? AND
        (EXISTS(SELECT 1 FROM inbound_task_items x WHERE x.task_id=? AND x.purchase_order_id=p.id)
        OR EXISTS(SELECT 1 FROM inbound_tasks d WHERE d.id=? AND d.purchase_order_id=p.id)) ORDER BY p.id LIMIT ?`, [after, job.id, job.id, DEPENDENCY_BATCH])
      for (const row of purchases) notify('purchase', row.id, true)
      return purchases.length === DEPENDENCY_BATCH ? { stage, after: purchases.at(-1).id } : { stage: 'sale', after: 0 }
    }
    const warehouseMatch = source.warehouse ? `COALESCE(si.warehouse_id,s.warehouse_id)=${source.warehouse}` : 'COALESCE(si.warehouse_id,s.warehouse_id) IN (d.from_warehouse_id,d.to_warehouse_id)'
    const [sales] = await pool.query(`SELECT s.id FROM sale_orders s WHERE s.id>? AND s.deleted_at IS NULL AND s.status IN (1,2,3,6)
      ${job.type === 'sale' ? 'AND s.id<>?' : ''}
      AND EXISTS(SELECT 1 FROM sale_order_items si JOIN ${source.items} x ON x.product_id=si.product_id
        JOIN ${source.table} d ON d.id=x.${source.parent}
        WHERE si.order_id=s.id AND d.id=? AND ${warehouseMatch}) ORDER BY s.id LIMIT ?`,
    [after, ...(job.type === 'sale' ? [job.id] : []), job.id, DEPENDENCY_BATCH])
    for (const row of sales) notify('sale', row.id, false)
    return sales.length === DEPENDENCY_BATCH ? { stage: 'sale', after: sales.at(-1).id } : null
  }
}
// 惰性依赖避免业务模块加载时建立新连接/循环依赖；notify 只操作内存。
const queue = createRefreshQueue({ process: job => createRefreshProcessor({
  pool: require('../../config/db').pool,
  syncDocument: require('./fulfillment.worker').syncDocument,
  notify: queue.notify,
})(job) })
let snapshotOverflow = 0
const commitFulfillment = createCommitNotifier(queue.notify, () => { snapshotOverflow++ })
const getRefreshStats = () => ({ ...queue.stats(), snapshotOverflow })
function getRefreshStatus(user) {
  if (Number(user?.roleId) !== 1) throw new AppError('仅管理员可查看履约同步诊断', 403)
  return getRefreshStats()
}
module.exports = { getRefreshStatus, captureDimensions, createRefreshProcessor, commitFulfillment, notifyFulfillment: queue.notify, runFulfillmentRefresh: queue.run, getRefreshStats }
