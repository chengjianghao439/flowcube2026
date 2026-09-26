/**
 * 商品改价申请（2026-08-22 价格体系·审批闭环）。
 *
 * 流程：申请改价（草稿）→ 提交（走 approvalEngine bizType=product_price 审批）
 *   → 审批通过后自动更新 product_items 价格并写 product_price_history（change_source='approval'）
 *   → 驳回/取消则不变价。
 *
 * 复用：approvalEngine（startApproval/approveStep/rejectStep/cancelInstance）、
 *       product_price_history 表（213）、codeGenerator.generateDailyCode。
 */

const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertSqlIdentifier } = require('../../utils/sqlIdentifier')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const approvalEngine = require('../../engine/approvalEngine')
const { normalizePagination } = require('../../utils/pagination')

const STATUS = { 1: '待审批', 2: '已通过', 3: '已驳回', 4: '已取消' }
const genNo = conn => generateDailyCode(conn, 'PCR', 'price_change_requests', 'request_no')

// 价格类型 → product_items 列映射
const PRICE_COLUMN = { sale: 'sale_price', a: 'sale_price_a', b: 'sale_price_b', c: 'sale_price_c', d: 'sale_price_d', cost: 'cost_price' }

const fmt = r => ({
  id: Number(r.id),
  requestNo: r.request_no,
  productId: Number(r.product_id),
  productCode: r.product_code,
  productName: r.product_name,
  articleNumber: r.article_number || null,
  spec: r.spec || null,
  color: r.color || null,
  priceType: r.price_type,
  oldPrice: r.old_price != null ? Number(r.old_price) : null,
  newPrice: Number(r.new_price),
  reason: r.reason || null,
  status: Number(r.status),
  statusName: STATUS[r.status] || '未知',
  applicantId: r.applicant_id != null ? Number(r.applicant_id) : null,
  applicantName: r.applicant_name || null,
  createdAt: r.created_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null, productId = null, applicantId = null } = {}) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = []
  const params = []
  if (keyword) { conds.push('(request_no LIKE ? OR product_code LIKE ? OR product_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  if (status) { conds.push('status = ?'); params.push(Number(status)) }
  if (productId) { conds.push('product_id = ?'); params.push(Number(productId)) }
  // applicantId 用于「只看自己的申请」过滤（普通用户非超管时由 controller 强制传）
  if (applicantId != null) { conds.push('applicant_id = ?'); params.push(Number(applicantId)) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM price_change_requests ${where}`, params)
  const [rows] = await pool.query(
    `SELECT pcr.*, p.article_number, p.spec, p.color
       FROM price_change_requests pcr
       JOIN product_items p ON p.id = pcr.product_id
      ${where} ORDER BY pcr.created_at DESC, pcr.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total: Number(total) } }
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT pcr.*, p.article_number, p.spec, p.color
       FROM price_change_requests pcr
       JOIN product_items p ON p.id = pcr.product_id
      WHERE pcr.id = ?`, [Number(id)])
  if (!row) throw new AppError('改价申请不存在', 404)
  return fmt(row)
}

/** 创建改价申请（草稿，未提交审批）。校验新价合法 + 与现价不同。 */
async function create(d, operator) {
  const productId = Number(d.productId)
  const priceType = String(d.priceType || 'sale')
  const newPrice = Number(d.newPrice)
  if (!(Number.isInteger(productId) && productId > 0)) throw new AppError('请选择商品', 400)
  if (!PRICE_COLUMN[priceType]) throw new AppError('价格类型无效', 400)
  if (!Number.isFinite(newPrice) || newPrice < 0) throw new AppError('新价格必须大于等于 0', 400)

  const [[product]] = await pool.query(
    'SELECT id, code, name, sale_price, sale_price_a, sale_price_b, sale_price_c, sale_price_d, cost_price FROM product_items WHERE id = ? AND deleted_at IS NULL',
    [productId],
  )
  if (!product) throw new AppError('商品不存在', 404)
  const column = PRICE_COLUMN[priceType]
  const oldPrice = Number(product[column] ?? 0)
  if (oldPrice === newPrice) throw new AppError('新价格与现价相同，无需申请改价', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO price_change_requests
         (request_no, product_id, product_code, product_name, price_type, old_price, new_price, reason, status, applicant_id, applicant_name)
       VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
      [requestNo, productId, product.code, product.name, priceType, oldPrice, newPrice, d.reason || null,
       operator?.userId || null, operator?.realName || operator?.username || null],
    )
    await conn.commit()
    return { id: r.insertId, requestNo }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 提交审批：启动 approvalEngine 审批实例（状态仍为 1 待审批，审批动作才流转） */
async function submit(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'price_change_requests', id, columns: 'id, request_no, product_id, new_price, status', entityName: '改价申请', deletedAt: false })
    assertStatusAction('priceChangeRequest', 'submit', row.status)
    const inst = await approvalEngine.startApproval(conn, {
      bizType: 'product_price',
      bizId: Number(id),
      amount: Number(row.new_price),
      applicantId: operator?.userId ?? null,
      applicantName: operator?.realName || operator?.username || '未知',
    })
    if (!inst) {
      throw new AppError('未找到适用的商品改价审批流，请管理员启用审批流并检查金额范围后重新提交', 409, 'PRICE_CHANGE_APPROVAL_FLOW_REQUIRED')
    }
    await conn.query('UPDATE price_change_requests SET approval_id=? WHERE id=?', [inst.instanceId, id])
    await conn.commit()
    return { id: Number(id), approvalId: inst.instanceId }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/**
 * 审批动作（由审批通过的实例触发时调用）：通过 → 更新商品价格 + 写历史。
 *
 * **历史旧价取「审批瞬间的真实当前价」**（2026-09-27 P8 修复）：本函数在**同一事务内**
 * 对商品行加 `FOR UPDATE` 后读当前值。申请创建时写入 `price_change_requests.old_price`
 * 只是**申请时的展示快照**——期间主档可能被手工改价（`products.update`）或另一张申请先通过，
 * 拿它当历史旧价会与真实变更前价格不符。
 *
 * 锁顺序：本函数在 `price_change_requests` 行锁与审批实例/任务锁**之后**才取商品行锁；
 * `products.update` 只锁商品行、不锁申请单，**不构成环**。
 */
async function applyApprovedPrice(conn, { requestId }) {
  const [[req]] = await conn.query('SELECT * FROM price_change_requests WHERE id=?', [requestId])
  if (!req || Number(req.status) !== 2) return // 非通过态，跳过
  const column = PRICE_COLUMN[req.price_type]
  // create 入口在 :83 已挡非法 price_type；审批通过路径读的是库里的历史值，
  // 不能依赖「当初写入时校验过」，这里独立再挡一次（2026-09-18 收口）。
  assertSqlIdentifier(column, 'column')

  const [[current]] = await conn.query(
    `SELECT \`${column}\` AS current_price FROM product_items WHERE id=? AND deleted_at IS NULL FOR UPDATE`,
    [req.product_id],
  )
  // 商品不存在或已软删：**必须 fail-loud 并回滚整个审批事务**。
  // 不能在这里 `return`——调用方 approve() 已经把审批实例与申请单置为「已通过」，
  // 静默返回会 commit 出「已批准却未改价、也无历史」的不一致状态。
  // （正常软删有 price_change_requests 引用保护，但异常/历史数据仍可能落到这里。）
  if (!current) {
    throw new AppError('改价目标商品不存在或已删除，本次改价未生效，审批已回滚', 409, 'PRICE_CHANGE_PRODUCT_MISSING')
  }
  const actualOldPrice = current.current_price == null ? null : Number(current.current_price)

  await conn.query(`UPDATE product_items SET \`${column}\`=? WHERE id=? AND deleted_at IS NULL`, [Number(req.new_price), req.product_id])
  await conn.query(
    `INSERT INTO product_price_history
       (product_id, product_code, product_name, price_type, old_price, new_price, change_source, approval_id, operator_id, operator_name, remark)
     VALUES (?,?,?,?,?,?, 'approval', ?, ?, ?, ?)`,
    [req.product_id, req.product_code, req.product_name, req.price_type, actualOldPrice, Number(req.new_price),
     req.approval_id || null, req.applicant_id || null, req.applicant_name || null, req.reason || '改价审批通过'],
  )
}

/** 审批（复用审批流）：通过/驳回/取消 都与业务状态联动。 */
async function approve(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'price_change_requests', id, columns: 'id, status', entityName: '改价申请', deletedAt: false })
    assertStatusAction('priceChangeRequest', 'approve', row.status)
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'product_price', bizId: Number(id) })
    if (!active) throw new AppError('改价申请无进行中的审批实例', 409)
    const r = await approvalEngine.approveStep(conn, { instanceId: active.instance.id, operator, comment: null })
    // approveStep 返回 { status }：2=实例已全部通过（此时才生效改价）
    if (r.status === 2) {
      await compareAndSetStatus(conn, { table: 'price_change_requests', id, fromStatus: 1, toStatus: 2, entityName: '改价申请' })
      await applyApprovedPrice(conn, { requestId: Number(id) })
    }
    await conn.commit()
    return { id: Number(id), finished: r.status === 2 }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function reject(id, { reason, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'price_change_requests', id, columns: 'id, status', entityName: '改价申请', deletedAt: false })
    assertStatusAction('priceChangeRequest', 'reject', row.status)
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'product_price', bizId: Number(id) })
    if (!active) throw new AppError('改价申请无进行中的审批实例', 409)
    await approvalEngine.rejectStep(conn, { instanceId: active.instance.id, operator, comment: reason || null })
    await compareAndSetStatus(conn, { table: 'price_change_requests', id, fromStatus: 1, toStatus: 3, entityName: '改价申请' })
    await conn.commit()
    return { id: Number(id) }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 取消：待审批 → 已取消（同时取消审批实例） */
async function cancel(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockStatusRow(conn, { table: 'price_change_requests', id, columns: 'id, status', entityName: '改价申请', deletedAt: false })
    const rule = assertStatusAction('priceChangeRequest', 'cancel', row.status)
    const active = await approvalEngine.getActiveInstanceByBiz(conn, { bizType: 'product_price', bizId: Number(id) })
    if (active) {
      await approvalEngine.cancelInstance(conn, { instanceId: active.instance.id, operator })
    }
    await compareAndSetStatus(conn, { table: 'price_change_requests', id, fromStatus: rule.from, toStatus: rule.to, entityName: '改价申请' })
    await conn.commit()
    return { id: Number(id) }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

module.exports = { findAll, findById, create, submit, approve, reject, cancel, STATUS }
