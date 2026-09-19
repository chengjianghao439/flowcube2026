const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const statementsService = require('../payments/reconciliation-statements.service')

/**
 * 客户对账门户（本期轻量版）——单租户系统内的只读查询入口。
 *
 * 复用账款模块的只读查询口径，不提供任何写操作：按 customerId 过滤，
 * 对账单为月结账款汇总单，客户侧看自己名下的单即可。
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

module.exports = { listStatements }
