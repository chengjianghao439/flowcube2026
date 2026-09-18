const crypto = require('node:crypto')
const { pool } = require('../config/db')
const AppError = require('./AppError')

const STATUS = {
  PENDING: 0,
  SUCCESS: 1,
  FAILED: 2,
}

function normalizeRequestKey(value) {
  const key = value != null ? String(value).trim() : ''
  return key || null
}

function parseResponseJson(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function getOperationRequest({ requestKey, action, userId, conn = pool, forShare = false }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return null
  const uid = userId != null ? Number(userId) : null
  const lockSql = forShare ? ' FOR SHARE' : ''
  const [[row]] = await conn.query(
    `SELECT *
     FROM operation_requests
     WHERE request_key = ? AND action = ? AND user_id <=> ?${lockSql}`,
    [key, String(action), uid],
  )
  if (!row) return null
  return {
    ...row,
    responseData: parseResponseJson(row.response_json),
  }
}

async function beginOperationRequest(conn, { requestKey, action, userId }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return { enabled: false }
  const uid = userId != null ? Number(userId) : null
  const normalizedAction = String(action)

  try {
    const [r] = await conn.query(
      `INSERT INTO operation_requests (request_key, action, user_id, status)
       VALUES (?, ?, ?, ?)`,
      [key, normalizedAction, uid, STATUS.PENDING],
    )
    return {
      enabled: true,
      id: Number(r.insertId),
      requestKey: key,
      action: normalizedAction,
      userId: uid,
      replay: false,
      pending: false,
    }
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error
    // 重复INSERT已持有唯一键S锁；这里只读既有状态，不应升级X锁。
    // 多个重放者同时FOR UPDATE会互相等待对方的S锁而死锁。
    // FOR SHARE仍是当前读，能看到事务旧快照之后提交的回执，不能换成普通SELECT。
    const existing = await getOperationRequest({
      requestKey: key,
      action: normalizedAction,
      userId: uid,
      conn,
      forShare: true,
    })
    if (!existing) {
      throw new AppError('请求结果暂不可确认，请稍后重试', 409)
    }
    if (Number(existing.status) === STATUS.SUCCESS) {
      return {
        enabled: true,
        id: Number(existing.id),
        requestKey: key,
        action: normalizedAction,
        userId: uid,
        replay: true,
        pending: false,
        responseData: existing.responseData,
        responseMessage: existing.response_message || null,
      }
    }
    if (Number(existing.status) === STATUS.PENDING) {
      throw new AppError('上次提交结果仍待确认，请刷新或稍后查询结果', 409)
    }
    throw new AppError(existing.error_message || '上次提交失败，请重新操作', 409)
  }
}

async function completeOperationRequest(conn, requestState, {
  data = null,
  message = null,
  resourceType = null,
  resourceId = null,
} = {}) {
  if (!requestState?.enabled || !requestState.id) return
  await conn.query(
    `UPDATE operation_requests
     SET status = ?, response_json = ?, response_message = ?, error_message = NULL,
         resource_type = ?, resource_id = ?
     WHERE id = ?`,
    [
      STATUS.SUCCESS,
      JSON.stringify(data ?? null),
      message || null,
      resourceType || null,
      resourceId != null ? Number(resourceId) : null,
      Number(requestState.id),
    ],
  )
}

async function failOperationRequest({ requestKey, action, userId, errorMessage, conn = pool }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return
  const uid = userId != null ? Number(userId) : null
  await conn.query(
    `UPDATE operation_requests
     SET status = ?, error_message = ?
     WHERE request_key = ? AND action = ? AND user_id <=> ? AND status <> ?`,
    [STATUS.FAILED, String(errorMessage || '请求失败').slice(0, 500), key, String(action), uid, STATUS.SUCCESS],
  )
}

/**
 * 资源级幂等：把单据 ID 绑进 action（`<base>.<resourceId>`）。
 *
 * 背景（2026-09-18 审计 P2[6]）：唯一键是 (request_key, action, user_id)，若 action 是常量，
 * 客户端把同一个 X-Request-Key 用在**另一张单据**上时会命中已有回执、直接回放上一单的
 * responseData，第二张单据的操作根本没执行——两端都显示成功，库存/账款静默不符。
 * 因此资源级写操作必须让不同单据天然落在不同幂等记录上（同单据同键仍可重放）。
 *
 * 兼容迁移前留下的旧固定 action 行：先按旧 action 精确查一次，
 * 成功且回执行的 resource_type/resource_id 都属于本单据才原样回放；否则明确 409。
 * resourceId 必须是正整数；调用方传入非正整数属编程错误，直接 500，不静默降级。
 */
async function beginResourceOperationRequest(conn, { requestKey, action, userId, resourceType, resourceId }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return { enabled: false }

  const uid = userId != null ? Number(userId) : null
  const baseAction = String(action)
  const numericResourceId = Number(resourceId)
  if (!Number.isInteger(numericResourceId) || numericResourceId <= 0) {
    throw new AppError(`资源级幂等要求正整数 resourceId（action=${baseAction}）`, 500)
  }
  const scopedAction = `${baseAction}.${numericResourceId}`

  const legacy = await getOperationRequest({ requestKey: key, action: baseAction, userId: uid, conn })
  if (legacy) {
    const sameResource = legacy.resource_type === String(resourceType)
      && Number(legacy.resource_id) === numericResourceId
    if (Number(legacy.status) === STATUS.SUCCESS && sameResource) {
      return {
        enabled: true,
        id: Number(legacy.id),
        requestKey: key,
        action: baseAction,
        userId: uid,
        replay: true,
        pending: false,
        responseData: legacy.responseData,
        responseMessage: legacy.response_message || null,
      }
    }
    if (Number(legacy.status) === STATUS.SUCCESS) {
      throw new AppError('该请求键已有其它操作的回执，请核对原操作后重试', 409)
    }
    // 旧行仍待确认或已失败：沿用 beginOperationRequest 的既有 409 文案，不另造一套。
    throw new AppError(
      Number(legacy.status) === STATUS.PENDING
        ? '上次提交结果仍待确认，请刷新或稍后查询结果'
        : (legacy.error_message || '上次提交失败，请重新操作'),
      409,
    )
  }

  return beginOperationRequest(conn, { requestKey: key, action: scopedAction, userId: uid })
}

async function getOperationRequestStatus({ requestKey, action, userId }) {
  const row = await getOperationRequest({ requestKey, action, userId })
  if (!row) {
    return { status: 'not_found', data: null, message: '未找到该请求记录' }
  }
  if (Number(row.status) === STATUS.SUCCESS) {
    return {
      status: 'success',
      data: row.responseData,
      message: row.response_message || '操作已确认成功',
      resourceType: row.resource_type || null,
      resourceId: row.resource_id != null ? Number(row.resource_id) : null,
    }
  }
  if (Number(row.status) === STATUS.FAILED) {
    return {
      status: 'failed',
      data: null,
      message: row.error_message || '操作失败',
    }
  }
  return {
    status: 'pending',
    data: null,
    message: '结果待确认，请稍后重试查询',
  }
}


/** 创建类动作的载荷指纹：稳定序列化（键排序）后取 sha256 前 16 位 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}
function creationFingerprint(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 16)
}

/**
 * **创建类**动作的幂等（2026-09-18 审计 [6] 的收尾）。
 *
 * 收货/出库/付款这类资源级动作能绑「既有单据 ID」，但 `purchase.create`、`sale.create`、
 * `payment.receipt.create`、`carrier.createAccount`、请购/采购计划/退货建单这些动作在 begin
 * 时刻**还没有单据 ID**，只能沿用常量 action。后果：同一个请求键被误用到**另一次内容不同**的
 * 创建上时，第二次会直接回放第一次的成功回执（返回别单的 ID），调用方以为建成功了。
 *
 * 这里用**请求载荷指纹**充当作用域：`<base>.<sha256(payload)[0:16]>`。
 *   · 同一次创建的重试（载荷一致）→ 同指纹 → 命中回执，幂等照旧；
 *   · 载荷不同 → 不同指纹 → 不构成重放，该建的照建（不再把别单结果冒充本单成功）；
 *   · 升级瞬间的旧行兼容：库里若已有**裸 base action** 的成功行（旧版本写的），仍然按旧语义
 *     回放——否则部署瞬间正在重试的请求会真的重复建单。
 */
async function beginCreationOperationRequest(conn, { requestKey, action, userId, payload }) {
  const key = normalizeRequestKey(requestKey)
  if (!key) return beginOperationRequest(conn, { requestKey, action, userId })

  const uid = userId != null ? Number(userId) : null
  const baseAction = String(action)

  const legacy = await getOperationRequest({ requestKey: key, action: baseAction, userId: uid, conn })
  if (legacy) {
    if (Number(legacy.status) === STATUS.SUCCESS) {
      return {
        enabled: true,
        id: Number(legacy.id),
        requestKey: key,
        action: baseAction,
        userId: uid,
        replay: true,
        pending: false,
        responseData: legacy.responseData,
        responseMessage: legacy.response_message || null,
      }
    }
    throw new AppError(
      Number(legacy.status) === STATUS.PENDING
        ? '上次提交结果仍待确认，请刷新或稍后查询结果'
        : (legacy.error_message || '上次提交失败，请重新操作'),
      409,
    )
  }

  return beginOperationRequest(conn, { requestKey: key, action: `${baseAction}.${creationFingerprint(payload)}`, userId: uid })
}

/**
 * 资源级回执查询：PDA 断网重连后拿旧客户端保存的固定 action 来问「上次到底成没成」，
 * 而库里存的已经是 `<base>.<id>`（见 beginResourceOperationRequest），所以必须做一次
 * 作用域解析，否则非调拨动作一律查不到回执（P0-6 的确认路径会重新断掉）。
 *
 * 语义（与 transfer 的旧客户端兼容分支一致）：
 *  1. 先按传入 action 精确匹配；
 *  2. 没有则查 `action = <base> OR action LIKE '<base>.%'`（同一 request_key + user_id）；
 *  3. **恰好一条**才返回它——同一请求键对应多张单据时必须保持「待核实」，
 *     绝不能任选一单成功（那正是本缺陷要消灭的错法）。
 */
async function getScopedOperationRequestStatus({ requestKey, action, userId }) {
  const requestedAction = String(action ?? '').trim()
  const exact = await getOperationRequestStatus({ requestKey, action: requestedAction, userId })
  if (exact.status !== 'not_found') return exact

  // 请求方可能传**基础 action**（旧客户端：`transfer.scanIn`），也可能传**完整 scoped action**
  // （新客户端：`transfer.scanIn.15`）。后者必须先把尾巴去掉才能在库里找到迁移前留下的
  // 旧固定 action 行——否则「上一次提交到底成没成」在升级后会一律查不到，PDA 只能靠
  // resolveServerState 兜底（CI 的 round2-transfer 用例正是守这一条，2026-09-18 修复）。
  const scoped = /^(.*)\.([1-9]\d*)$/.exec(requestedAction)
  const baseAction = scoped ? scoped[1] : requestedAction
  const requestedId = scoped ? Number(scoped[2]) : null

  const candidates = await findScopedOperationRequests({ requestKey, baseAction, userId })
  // 明确问了某一张单据时，只接受资源 ID 对得上的那一行：旧固定 action 行同样写了
  // resource_type/resource_id（见 beginResourceOperationRequest 的兼容读），所以这里能判。
  // 不做这一步就会出现「问 A 单却回 B 单回执」——正是审计点名的错法。
  const matched = requestedId == null
    ? candidates
    : candidates.filter(r => Number(r.resource_id) === requestedId)
  // 同键对应多单时保持「待核实」，不任选一单（与迁移前 transfer 的语义一致）
  if (matched.length !== 1) return exact
  return getOperationRequestStatus({ requestKey, action: matched[0].action, userId })
}

async function findScopedOperationRequests({ requestKey, baseAction, userId }) {
  const key = normalizeRequestKey(requestKey)
  if (!key || !baseAction) return []
  const uid = userId != null ? Number(userId) : null
  const [rows] = await pool.query(
    `SELECT action, resource_id FROM operation_requests
     WHERE request_key = ? AND user_id <=> ? AND (action = ? OR action LIKE ?)
     ORDER BY id LIMIT 2`,
    [key, uid, baseAction, `${baseAction}.%`],
  )
  return rows
}

/**
 * 清理超过 TTL 的 operation_requests 记录，防止表无限增长。
 * 默认保留 7 天。
 */
async function cleanupExpiredRequests({ ttlDays = 7 } = {}) {
  try {
    const [r] = await pool.query(
      'DELETE FROM operation_requests WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [ttlDays],
    )
    if (r.affectedRows > 0) {
      // 静默清理，不打印日志避免启动期噪音
    }
  } catch (e) {
    // 表可能不存在，静默忽略
    if (e.code !== 'ER_NO_SUCH_TABLE') {
      console.error('[OperationRequests] TTL 清理失败:', e.message)
    }
  }
}

/**
 * 启动定期 TTL 清理（每 6 小时一次）
 */
let cleanupTimer = null

function startCleanupSweeper({ intervalMs = 6 * 60 * 60 * 1000, ttlDays = 7 } = {}) {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => cleanupExpiredRequests({ ttlDays }), intervalMs)
  cleanupTimer.unref() // 不阻止进程退出
  // 启动时立即执行一次
  void cleanupExpiredRequests({ ttlDays })
}

module.exports = {
  STATUS,
  beginOperationRequest,
  beginResourceOperationRequest,
  beginCreationOperationRequest,
  completeOperationRequest,
  failOperationRequest,
  getOperationRequestStatus,
  getScopedOperationRequestStatus,
  cleanupExpiredRequests,
  startCleanupSweeper,
}
