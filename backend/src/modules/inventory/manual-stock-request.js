const AppError = require('../../utils/AppError')
const { beginCreationOperationRequest } = require('../../utils/operationRequest')

async function beginManualStockRequest(conn, { requestKey, userId, ...payload }) {
  const key = requestKey == null ? null : String(requestKey).trim()
  if (key) {
    // 旧回执未记录仓库/载荷，既不能冒充本次成功，也不能升级后重扣。
    const [legacy] = await conn.query(
      'SELECT id FROM operation_requests WHERE request_key=? AND action IN (?) AND user_id <=> ? LIMIT 1',
      [key, ['inventory.manual-out', `inventory.manual-out.${Number(payload.productId)}`], userId],
    )
    if (legacy.length) throw new AppError('该请求存在未记录仓库的历史出库记录，请先核对库存流水后重新操作', 409, 'LEGACY_STOCK_REQUEST_REVIEW_REQUIRED')
  }
  return beginCreationOperationRequest(conn, { requestKey: key, userId, action: 'inventory.manual-out.v2', payload })
}
module.exports = { beginManualStockRequest }
