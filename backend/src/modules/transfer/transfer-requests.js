const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { beginOperationRequest, getOperationRequestStatus, STATUS } = require('../../utils/operationRequest')

const TRANSFER_ACTION = /^(transfer\.scan(?:Out|In))(?:\.([1-9]\d*))?$/

function receiptMatches(row, transferId) {
  let data
  try { data = JSON.parse(row.response_json) } catch { return false }
  return row.resource_type === 'transfer_order'
    && Number(row.resource_id) === Number(transferId)
    && Number(data?.transferId) === Number(transferId)
}

// 旧固定 action 的成功记录仍可重试，但只能回放原单；新请求按资源区分。
// 调用方先锁定单据并完成范围/设备仓校验，再进入此处；状态校验在重试之后。
async function beginTransferRequest(conn, { requestKey, action, transferId, userId }) {
  if (requestKey) {
    const [[legacy]] = await conn.query(
      'SELECT * FROM operation_requests WHERE request_key=? AND action=? AND user_id <=> ?',
      [String(requestKey).trim(), action, userId],
    )
    if (legacy) {
      if (Number(legacy.status) !== STATUS.SUCCESS || !receiptMatches(legacy, transferId)) {
        throw new AppError('旧请求键结果不属于本调拨单或仍待确认，请核对原操作回执', 409)
      }
      return { replay: true, responseData: JSON.parse(legacy.response_json) }
    }
  }
  return beginOperationRequest(conn, { requestKey, action: `${action}.${Number(transferId)}`, userId })
}

async function getTransferRequestStatus({ requestKey, action, userId }) {
  const match = TRANSFER_ACTION.exec(String(action))
  if (!match) return getOperationRequestStatus({ requestKey, action, userId })
  const [, baseAction, transferId] = match
  const exact = await getOperationRequestStatus({ requestKey, action, userId })
  if (exact.status !== 'not_found') return exact

  const [candidates] = await pool.query(
    `SELECT * FROM operation_requests WHERE request_key=? AND user_id <=> ?
     AND ${transferId ? 'action=?' : 'action LIKE ?'} ORDER BY id LIMIT 2`,
    [String(requestKey).trim(), userId, transferId ? baseAction : `${baseAction}.%`],
  )
  // 旧客户端只传固定 action：同键对应多单时明确保持待核实，不能任选一单成功。
  const row = candidates.length === 1 ? candidates[0] : null
  const candidateId = transferId || TRANSFER_ACTION.exec(String(row?.action))?.[2]
  if (!row || !candidateId || !receiptMatches(row, candidateId)) return exact
  return getOperationRequestStatus({ requestKey, action: row.action, userId })
}

module.exports = { beginTransferRequest, getTransferRequestStatus }
