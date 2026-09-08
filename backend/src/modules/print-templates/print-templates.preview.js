const { pool } = require('../../config/db')
const { readLabelVariables } = require('../print-jobs/labelVariables')
const { scopeFilter } = require('../../utils/warehouseScope')
const sale = require('../sale/sale.service')
const purchase = require('../purchase/purchase.service')
const saleReturns = require('../returns/returns-sale.service')
const purchaseReturns = require('../returns/returns-purchase.service')
const warehouseTasks = require('../warehouse-tasks/warehouse-tasks.query')

// Table/column names are private constants; request input never becomes SQL.
async function latestDocument(type, scopeWarehouseIds) {
  if (type === 3) {
    const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
    const [[row]] = await pool.query(
      `SELECT * FROM (
         (SELECT id, created_at, 'sale' AS return_type FROM sale_returns
          WHERE deleted_at IS NULL${scope.sql} ORDER BY created_at DESC, id DESC LIMIT 1)
         UNION ALL
         (SELECT id, created_at, 'purchase' AS return_type FROM purchase_returns
          WHERE deleted_at IS NULL${scope.sql} ORDER BY created_at DESC, id DESC LIMIT 1)
       ) candidates ORDER BY created_at DESC, id DESC, return_type ASC LIMIT 1`,
      [...scope.params, ...scope.params],
    )
    if (!row) return null
    const detail = row.return_type === 'sale' ? saleReturns.findByIdSR : purchaseReturns.findByIdPR
    const record = { ...(await detail(row.id, scopeWarehouseIds)), type: row.return_type }
    return { type, sourceLabel: record.returnNo, kind: 'return', record }
  }
  const sources = {
    1: { table: 'sale_orders', kind: 'sale', detail: sale.findById },
    2: { table: 'purchase_orders', kind: 'purchase', detail: purchase.findById },
    4: { table: 'warehouse_tasks', kind: 'warehouse-task', detail: warehouseTasks.findById },
  }
  const source = sources[type]
  const scope = scopeFilter(scopeWarehouseIds, 'd.warehouse_id')
  let sql = scope.sql
  const params = [...scope.params]
  // Match sale.findAll: an accessible header must not expose out-of-scope lines.
  // Purchase lines have no warehouse column; their order header owns the scope.
  if (type === 1 && Array.isArray(scopeWarehouseIds) && scopeWarehouseIds.length) {
    sql += ' AND NOT EXISTS (SELECT 1 FROM sale_order_items i WHERE i.order_id=d.id AND i.warehouse_id NOT IN (?))'
    params.push(scopeWarehouseIds)
  }
  const [[row]] = await pool.query(
    `SELECT d.id FROM ${source.table} d WHERE d.deleted_at IS NULL${sql} ORDER BY d.id DESC LIMIT 1`, params,
  )
  if (!row) return null
  // Existing detail services assert warehouse access again and format approved fields.
  const record = await source.detail(row.id, scopeWarehouseIds)
  return { type, sourceLabel: record.orderNo || record.taskNo, kind: source.kind, record }
}

async function latestLabel(type, scopeWarehouseIds) {
  const result = await readLabelVariables(type, { scopeWarehouseIds })
  if (!result) return null
  return { type, sourceLabel: result.row.barcode || result.row.code, kind: 'label', data: result.vars }
}

async function findPreviewData(type, scopeWarehouseIds = null) {
  return type <= 4 ? latestDocument(type, scopeWarehouseIds) : latestLabel(type, scopeWarehouseIds)
}

module.exports = { findPreviewData }
