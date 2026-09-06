const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const statementsService = require('../payments/reconciliation-statements.service')
const { normalizePagination } = require('../../utils/pagination')
const { scopeFilter } = require('../../utils/warehouseScope')

/**
 * 客户/供应商门户（本期轻量版）——单租户系统内的只读查询入口。
 *
 * 门户页复用各业务模块的只读查询口径，不提供任何写操作：
 *  - 客户对账：复用 reconciliation-statements.service.findAll 的列表口径（实时金额投影），
 *    仅按 customerId 过滤；对账单为月结账款汇总单，客户侧看自己名下的单即可。
 *  - 供应商到货：purchase_orders 按 supplier_id 过滤，返回单号/状态/预计到货/已收量。
 */

/** 客户对账单列表：只读，复用汇总对账单的列表口径 */
async function listStatements({ customerId = null, page = 1, pageSize = 20 }) {
  if (!customerId) throw new AppError('请指定客户', 400)
  const customerIdNum = Number(customerId)
  const [[cust]] = await pool.query(
    'SELECT id, name FROM sale_customers WHERE id = ? AND deleted_at IS NULL',
    [customerIdNum],
  )
  if (!cust) throw new AppError('客户不存在', 404)

  // 通过账款来源销售单的客户 ID 关联，名称仅是展示快照；不能用模糊名称替代身份。
  const data = await statementsService.findAll({
    type: 2, // 客户对账单
    customerId: customerIdNum,
    page,
    pageSize,
  })
  return {
    customer: { id: customerIdNum, name: cust.name },
    ...data,
  }
}

/** 供应商到货查询：purchase_orders 只读列表，返回单号/状态/预计到货/已收量 */
async function listPurchaseStatus({ supplierId = null, page = 1, pageSize = 20, scopeWarehouseIds = null }) {
  if (!supplierId) throw new AppError('请指定供应商', 400)
  const supplierIdNum = Number(supplierId)
  const [[supplier]] = await pool.query(
    'SELECT id, name FROM supply_suppliers WHERE id = ? AND deleted_at IS NULL',
    [supplierIdNum],
  )
  if (!supplier) throw new AppError('供应商不存在', 404)

  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['po.deleted_at IS NULL', 'po.supplier_id = ?']
  const params = [supplierIdNum]
  const scope = scopeFilter(scopeWarehouseIds, 'po.warehouse_id')
  const where = `WHERE ${conds.join(' AND ')}${scope.sql}`
  params.push(...scope.params)

  const [rows] = await pool.query(
    `SELECT po.id, po.order_no, po.status, po.expected_date, po.total_amount,
            po.warehouse_name, po.remark, po.created_at,
            COALESCE(SUM(poi.quantity), 0) AS ordered_qty,
            COALESCE((
              SELECT SUM(it.received_qty)
                FROM inbound_task_items it
                JOIN inbound_tasks t ON t.id = it.task_id
               WHERE it.purchase_order_id = po.id AND t.deleted_at IS NULL
            ), 0) AS received_qty
       FROM purchase_orders po
       LEFT JOIN purchase_order_items poi ON poi.order_id = po.id
       ${where}
      GROUP BY po.id, po.order_no, po.status, po.expected_date, po.total_amount,
               po.warehouse_name, po.remark, po.created_at
      ORDER BY po.created_at DESC, po.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po ${where}`,
    params,
  )

  const STATUS_NAME = { 1: '草稿', 2: '已提交', 3: '已完成', 4: '已取消', 5: '待审批' }
  const list = rows.map(r => ({
    id: Number(r.id),
    orderNo: r.order_no,
    status: Number(r.status),
    statusName: STATUS_NAME[Number(r.status)] || '未知',
    expectedDate: r.expected_date,
    totalAmount: Number(r.total_amount),
    warehouseName: r.warehouse_name,
    orderedQty: Number(r.ordered_qty || 0),
    receivedQty: Number(r.received_qty || 0),
    remark: r.remark,
    createdAt: r.created_at,
  }))
  return {
    supplier: { id: supplierIdNum, name: supplier.name },
    list,
    pagination: { page: p, pageSize: ps, total },
  }
}

module.exports = { listStatements, listPurchaseStatus }
