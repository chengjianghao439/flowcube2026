const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const approvalEngine = require('../../engine/approvalEngine')
const refundActor = require('../refunds/supplier-refunds.actor')
const { PERMISSIONS: P } = require('../../constants/permissions')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')
const { assertSqlIdentifier } = require('../../utils/sqlIdentifier')

/**
 * 审批流配置（P2-7）：审批流 CRUD + 待我审批列表。
 * 审批实例的运行推进在 engine/approvalEngine.js；本模块是配置与查询面。
 *
 * 流程配置语义：
 *   - 一条流程 = approval_flows 头（业务类型 + 金额区间 + 启停）+ approval_flow_steps 节点（串行）。
 *   - 同一 biz_type 可配多条流程，按金额区间分流（区间不重叠时最精确，重叠时取 min_amount 最大者）。
 *   - 节点审批人类型：1=指定角色 2=部门负责人（0=申请人所属部门） 3=指定用户。
 */

const BIZ_TYPES = [
  { value: 'purchase_requisition', label: '采购请购单' },
  { value: 'sale_credit_override', label: '超额放行申请' },
  { value: 'expense_claim', label: '费用报销' },
  { value: 'purchase_order', label: '采购单' },
  { value: 'inventory_disposal', label: '呆滞处置单' },
  { value: 'product_price', label: '商品改价申请' }, // 2026-08-22 价格体系：改价走审批
]

const APPROVER_TYPE_LABEL = { 1: '指定角色', 2: '部门负责人', 3: '指定用户' }

/**
 * 业务类型 → 底层单据表 / 查看权限 / 仓库列（2026-09-18 审计 P2）。
 * 用于 getBizApproval 的单据级授权：审批查看权限不等于可读任意业务单据。
 * warehouseCol 为 null 的是公司级单据（财务报销、客户授信、价格申请），没有仓库维度。
 */
const BIZ_DOC_META = {
  purchase_requisition: { table: 'purchase_requisitions', permission: P.PURCHASE_REQUISITION_VIEW, warehouseCol: 'warehouse_id', name: '采购请购单', noCol: 'requisition_no', titleCol: 'title', softDelete: true },
  sale_credit_override: { table: 'sale_credit_overrides', permission: P.SALE_CREDIT_OVERRIDE_VIEW, warehouseCol: null, name: '超额放行申请', noCol: 'override_no', titleCol: 'reason', softDelete: true },
  expense_claim: { table: 'expense_claims', permission: P.FINANCE_EXPENSE_VIEW, warehouseCol: null, name: '费用报销', authorize: authorizeExpenseApproval, noCol: 'claim_no', titleCol: 'title', softDelete: true },
  purchase_order: { table: 'purchase_orders', permission: P.PURCHASE_ORDER_VIEW, warehouseCol: 'warehouse_id', name: '采购单', noCol: 'order_no', titleCol: 'remark', softDelete: true },
  inventory_disposal: { table: 'inventory_disposal_orders', permission: P.INVENTORY_DISPOSAL_VIEW, warehouseCol: 'warehouse_id', name: '呆滞处置单', noCol: 'disposal_no', titleCol: 'remark', softDelete: true },
  product_price: { table: 'price_change_requests', permission: P.PRODUCT_VIEW, warehouseCol: null, name: '商品改价申请', noCol: 'request_no', titleCol: 'reason', softDelete: false },
}

async function authorizeExpenseApproval(conn, { bizId, user }) {
  const [[claim]] = await conn.query('SELECT applicant_id FROM expense_claims WHERE id=? AND deleted_at IS NULL', [bizId])
  if (!claim) throw new AppError('费用报销单不存在', 404)
  if (Number(user?.roleId) === 1) return
  const [[viewAll]] = await conn.query(
    'SELECT 1 AS ok FROM sys_role_permissions WHERE role_id=? AND permission=? LIMIT 1',
    [Number(user?.roleId), P.FINANCE_EXPENSE_VIEW_ALL],
  )
  if (!viewAll && (!user?.userId || Number(claim.applicant_id) !== Number(user.userId))) {
    throw new AppError('无权查看他人的费用报销单', 403, 'EXPENSE_VIEW_DENIED')
  }
}

function fmtFlow(r) {
  return {
    id: Number(r.id),
    bizType: r.biz_type,
    name: r.name,
    minAmount: Number(r.min_amount),
    maxAmount: r.max_amount == null ? null : Number(r.max_amount),
    isActive: !!r.is_active,
    remark: r.remark,
    createdAt: r.created_at,
  }
}

async function listFlows({ bizType = '' } = {}) {
  const conds = ['1=1']
  const params = []
  if (bizType) { conds.push('f.biz_type=?'); params.push(bizType) }
  const [rows] = await pool.query(
    `SELECT f.*, (SELECT COUNT(*) FROM approval_flow_steps s WHERE s.flow_id=f.id) AS step_count
       FROM approval_flows f WHERE ${conds.join(' AND ')} ORDER BY f.biz_type ASC, f.min_amount ASC, f.id ASC`,
    params,
  )
  return rows.map(r => ({ ...fmtFlow(r), stepCount: Number(r.step_count) }))
}

async function getFlow(id) {
  const [[f]] = await pool.query('SELECT * FROM approval_flows WHERE id=?', [Number(id)])
  if (!f) throw new AppError('审批流不存在', 404)
  const [steps] = await pool.query('SELECT * FROM approval_flow_steps WHERE flow_id=? ORDER BY step_order ASC', [Number(id)])
  return {
    ...fmtFlow(f),
    steps: steps.map(s => ({
      id: Number(s.id),
      stepOrder: Number(s.step_order),
      approverType: Number(s.approver_type),
      approverTypeName: APPROVER_TYPE_LABEL[Number(s.approver_type)] || '未知',
      roleId: s.role_id != null ? Number(s.role_id) : null,
      departmentId: s.department_id != null ? Number(s.department_id) : null,
      userId: s.user_id != null ? Number(s.user_id) : null,
    })),
  }
}

/** 校验节点配置合法性：类型字段必填、对应资源存在、步序从 1 连续。 */
function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new AppError('至少配置一个审批节点', 400)
  const sorted = [...steps].sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder))
  sorted.forEach((s, i) => {
    if (Number(s.stepOrder) !== i + 1) throw new AppError(`审批节点序号必须从 1 连续递增（第 ${i + 1} 个节点序号应为 ${i + 1}）`, 400)
    const type = Number(s.approverType)
    if (![1, 2, 3].includes(type)) throw new AppError(`节点 ${i + 1} 的审批人类型无效`, 400)
    if (type === 1 && !s.roleId) throw new AppError(`节点 ${i + 1} 指定角色类型必须选择角色`, 400)
    if (type === 2 && !(s.departmentId != null)) throw new AppError(`节点 ${i + 1} 部门负责人类型必须选择部门（0=申请人所属部门）`, 400)
    if (type === 3 && !s.userId) throw new AppError(`节点 ${i + 1} 指定用户类型必须选择用户`, 400)
  })
  return sorted
}

async function createFlow({ bizType, name, minAmount = 0, maxAmount = null, isActive = true, remark, steps }) {
  if (!BIZ_TYPES.some(b => b.value === bizType)) throw new AppError('业务类型无效', 400)
  const n = String(name || '').trim()
  if (!n) throw new AppError('流程名称不能为空', 400)
  const sorted = validateSteps(steps)
  // 同一业务类型的金额区间不允许与现有流程重叠（避免分流歧义）
  const overlap = await checkOverlap(pool, { bizType, minAmount, maxAmount, excludeId: null })
  if (overlap) throw new AppError(`金额区间与现有流程「${overlap.name}」重叠，请调整`, 409)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [r] = await conn.query(
      'INSERT INTO approval_flows (biz_type,name,min_amount,max_amount,is_active,remark) VALUES (?,?,?,?,?,?)',
      [bizType, n, Number(minAmount), maxAmount == null ? null : Number(maxAmount), isActive ? 1 : 0, remark || null],
    )
    const flowId = r.insertId
    for (const s of sorted) {
      await conn.query(
        `INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,role_id,department_id,user_id)
         VALUES (?,?,?,?,?,?)`,
        [flowId, Number(s.stepOrder), Number(s.approverType),
          s.approverType === 1 ? Number(s.roleId) : null,
          s.approverType === 2 ? Number(s.departmentId) : null,
          s.approverType === 3 ? Number(s.userId) : null],
      )
    }
    await conn.commit()
    return { id: flowId }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/**
 * 区间重叠校验：新流程 [minAmount, maxAmount] 与现有流程区间相交即冲突。
 * 区间重叠 ⇔ 新下限 ≤ 现上限 且 现下限 ≤ 新上限（NULL 上限视为 +∞）。
 */
async function checkOverlap(conn, { bizType, minAmount, maxAmount, excludeId }) {
  const newMin = Number(minAmount) || 0
  const newMax = maxAmount == null ? null : Number(maxAmount)
  const [rows] = await conn.query(
    `SELECT name FROM approval_flows
      WHERE biz_type=?
        AND (? <= IFNULL(max_amount, ?))
        AND (min_amount <= IFNULL(?, ?))
        AND id<>?
      LIMIT 1`,
    [bizType, newMin, Number.MAX_SAFE_INTEGER, newMax, Number.MAX_SAFE_INTEGER, excludeId ?? -1],
  )
  return rows[0] || null
}

async function updateFlow(id, { name, minAmount, maxAmount, isActive, remark, steps }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[f]] = await conn.query('SELECT * FROM approval_flows WHERE id=? FOR UPDATE', [Number(id)])
    if (!f) throw new AppError('审批流不存在', 404)
    // 金额区间/节点可改：运行中的实例已是快照，不受改配影响；历史实例的归属由实例自身字段记录。
    // 仅改名的流程不影响任何历史（区间是选流依据，但已建实例不重新选流）。
    const n = String(name || '').trim()
    if (!n) throw new AppError('流程名称不能为空', 400)
    if (steps !== undefined) validateSteps(steps)

    await conn.query(
      'UPDATE approval_flows SET name=?,min_amount=?,max_amount=?,is_active=?,remark=? WHERE id=?',
      [n,
        minAmount !== undefined ? Number(minAmount) : Number(f.min_amount),
        maxAmount === undefined ? f.max_amount : (maxAmount == null ? null : Number(maxAmount)),
        isActive !== undefined ? (isActive ? 1 : 0) : Number(f.is_active),
        remark !== undefined ? remark : f.remark, Number(id)],
    )
    if (steps !== undefined) {
      await conn.query('DELETE FROM approval_flow_steps WHERE flow_id=?', [Number(id)])
      for (const s of validateSteps(steps)) {
        await conn.query(
          `INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,role_id,department_id,user_id)
           VALUES (?,?,?,?,?,?)`,
          [Number(id), Number(s.stepOrder), Number(s.approverType),
            s.approverType === 1 ? Number(s.roleId) : null,
            s.approverType === 2 ? Number(s.departmentId) : null,
            s.approverType === 3 ? Number(s.userId) : null],
        )
      }
    }
    await conn.commit()
    return { id: Number(id) }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 删除流程：有运行中实例或历史实例时禁止删除（审批留痕不可断链）。 */
async function removeFlow(id) {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM approval_instances WHERE flow_id=?', [Number(id)])
  if (Number(n) > 0) throw new AppError('该审批流已被使用（存在审批实例），不能删除；请停用', 409)
  await pool.query('DELETE FROM approval_flows WHERE id=?', [Number(id)])
  await pool.query('DELETE FROM approval_flow_steps WHERE flow_id=?', [Number(id)])
  return { id: Number(id) }
}

const DOCUMENT_PENDING_META = {
  purchase_order: { approvePermission: P.PURCHASE_ORDER_APPROVE, pendingStatus: 5, creatorCol: 'operator_id', creatorNameCol: 'operator_name', amountCol: 'total_amount', submittedCol: null },
  inventory_disposal: { approvePermission: P.INVENTORY_DISPOSAL_APPROVE, pendingStatus: 2, creatorCol: 'operator_id', creatorNameCol: 'operator_name', amountCol: 'total_value', submittedCol: null },
  expense_claim: { approvePermission: P.FINANCE_EXPENSE_APPROVE, pendingStatus: 2, creatorCol: 'applicant_id', creatorNameCol: 'applicant_name', amountCol: 'total_amount', submittedCol: 'submitted_at' },
}

// RF is a business confirmation document, never an approval-engine flow type.
const SUPPLIER_REFUND_PENDING = {
  permissions: [P.SUPPLIER_REFUND_VIEW, P.SUPPLIER_REFUND_CONFIRM, P.PURCHASE_ORDER_VIEW, P.RETURN_ORDER_VIEW, P.PAYMENT_VIEW],
}

/** 统一只读待办：运行中引擎节点及既有业务单级审核；动作仍由原业务负责。 */
async function listPending({ page = 1, pageSize = 20 }, user) {
  const userId = Number(user?.userId), roleId = Number(user?.roleId)
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(roleId) || roleId <= 0) throw new AppError('请先登录', 401)
  const requestedPage = Number(page), requestedSize = Number(pageSize)
  const p = Math.min(100000, Math.max(1, Math.trunc(Number.isFinite(requestedPage) ? requestedPage || 1 : 1)))
  const ps = Math.min(100, Math.max(1, Math.trunc(Number.isFinite(requestedSize) ? requestedSize || 20 : 20)))
  const scope = roleId === 1 ? null : user.warehouseIds ?? null
  const conn = await pool.getConnection()
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const required = [...new Set([P.APPROVAL_TASK_VIEW, P.FINANCE_EXPENSE_VIEW_ALL, ...Object.values(BIZ_DOC_META).map(m => m.permission), ...Object.values(DOCUMENT_PENDING_META).map(m => m.approvePermission), ...SUPPLIER_REFUND_PENDING.permissions])]
    const [permissions] = await conn.query('SELECT permission FROM sys_role_permissions WHERE role_id=? AND permission IN (?)', [roleId, required])
    const held = new Set(permissions.map(row => row.permission))
    const can = permission => roleId === 1 || held.has(permission)
    const [[actor]] = await conn.query('SELECT allow_self_approve FROM sys_users WHERE id=? AND deleted_at IS NULL LIMIT 1', [userId])
    const selfApproval = Number(actor?.allow_self_approve) === 1 ? 1 : 0
    const parts = [], params = []
    for (const [bizType, meta] of Object.entries(BIZ_DOC_META)) {
      const table = meta.table
      assertSqlIdentifier(table, 'approval document table')
      const noCol = assertSqlIdentifier(meta.noCol, 'approval document number')
      const titleCol = assertSqlIdentifier(meta.titleCol, 'approval document title')
      const conds = [meta.softDelete ? 'd.deleted_at IS NULL' : '1=1']
      const branchParams = [bizType, userId]
      if (!can(P.APPROVAL_TASK_VIEW) || !can(meta.permission)) conds.push('1=0')
      if (meta.warehouseCol) {
        const warehouseCol = assertSqlIdentifier(meta.warehouseCol, 'approval document warehouse')
        const filter = scopeFilter(scope, `d.${warehouseCol}`)
        if (filter.sql) conds.push(filter.sql.replace(/^ AND /, ''))
        branchParams.push(...filter.params)
      }
      if (bizType === 'expense_claim' && !can(P.FINANCE_EXPENSE_VIEW_ALL)) { conds.push('d.applicant_id=?'); branchParams.push(userId) }
      // 六类只关联当前本人快照；新单级审核菜单权不能放宽此集合。
      parts.push(`SELECT 'engine' AS source_kind,i.id AS instance_id,t.id AS task_id,i.biz_type,i.biz_id,
        i.applicant_id,i.applicant_name,i.amount,i.current_step,i.flow_id,i.created_at,
        i.created_at AS submitted_at,'submitted' AS time_kind,i.created_at AS pending_at,
        d.${noCol} AS no,d.${titleCol} AS title,d.status
        FROM approval_instance_task_approvers a
        JOIN approval_instance_tasks t ON t.id=a.task_id
        JOIN approval_instances i ON i.id=a.instance_id AND i.status=1 AND i.biz_type=?
        JOIN ${table} d ON d.id=i.biz_id
        WHERE a.user_id=? AND t.status=1 AND t.step_order=i.current_step AND ${conds.join(' AND ')}`)
      params.push(...branchParams)
    }
    for (const [bizType, document] of Object.entries(DOCUMENT_PENDING_META)) {
      const meta = BIZ_DOC_META[bizType]
      const table = meta.table
      assertSqlIdentifier(table, 'pending business table')
      const noCol = assertSqlIdentifier(meta.noCol, 'pending business number')
      const titleCol = assertSqlIdentifier(meta.titleCol, 'pending business title')
      const creatorCol = assertSqlIdentifier(document.creatorCol, 'pending creator')
      const creatorNameCol = assertSqlIdentifier(document.creatorNameCol, 'pending creator name')
      const amountCol = assertSqlIdentifier(document.amountCol, 'pending original amount')
      const submittedCol = document.submittedCol ? assertSqlIdentifier(document.submittedCol, 'pending submitted time') : null
      const submittedSql = submittedCol ? `d.${submittedCol}` : 'NULL'
      const pendingTimeSql = submittedCol ? `COALESCE(d.${submittedCol},d.created_at)` : 'd.created_at'
      const conds = ['d.deleted_at IS NULL', 'd.status=?', `(?=1 OR d.${creatorCol} IS NULL OR d.${creatorCol}<>?)`]
      const branchParams = [bizType, document.pendingStatus, selfApproval, userId]
      if (!can(meta.permission) || !can(document.approvePermission)) conds.push('1=0')
      if (meta.warehouseCol) {
        const warehouseCol = assertSqlIdentifier(meta.warehouseCol, 'pending business warehouse')
        const filter = scopeFilter(scope, `d.${warehouseCol}`)
        if (filter.sql) conds.push(filter.sql.replace(/^ AND /, ''))
        branchParams.push(...filter.params)
      }
      if (bizType === 'expense_claim' && !can(P.FINANCE_EXPENSE_VIEW_ALL)) { conds.push('d.applicant_id=?'); branchParams.push(userId) }
      conds.push('NOT EXISTS (SELECT 1 FROM approval_instances active WHERE active.biz_type=? AND active.biz_id=d.id AND active.status=1)')
      branchParams.push(bizType)
      parts.push(`SELECT 'document' AS source_kind,NULL AS instance_id,NULL AS task_id,? AS biz_type,d.id AS biz_id,
        d.${creatorCol} AS applicant_id,d.${creatorNameCol} AS applicant_name,d.${amountCol} AS amount,
        NULL AS current_step,NULL AS flow_id,d.created_at,${submittedSql} AS submitted_at,
        '${submittedCol ? 'submitted' : 'created'}' AS time_kind,${pendingTimeSql} AS pending_at,
        d.${noCol} AS no,d.${titleCol} AS title,d.status FROM ${table} d WHERE ${conds.join(' AND ')}`)
      params.push(...branchParams)
    }
    const currentRefundActor = await refundActor.load(conn, userId, false)
    const refundCan = permission => currentRefundActor.roleId === 1 || currentRefundActor.permissions.includes(permission)
    const refundConditions = ['d.company_id=1', 'd.status=?', '(?=1 OR d.created_by<>?)',
      'po.deleted_at IS NULL', 'pr.deleted_at IS NULL', 'po.id=d.purchase_order_id',
      'pr.purchase_order_id=po.id', 'pr.supplier_id=po.supplier_id', 'd.supplier_id=po.supplier_id',
      'd.warehouse_id=pr.warehouse_id', 'pr.warehouse_id=po.warehouse_id',
      'd.warehouse_id>0', 'po.warehouse_id>0', 'pr.warehouse_id>0']
    const refundParams = ['supplier_refund', 1, currentRefundActor.allowSelfApprove ? 1 : 0, userId]
    if (!SUPPLIER_REFUND_PENDING.permissions.every(refundCan)) refundConditions.push('1=0')
    for (const col of ['d.warehouse_id', 'po.warehouse_id', 'pr.warehouse_id']) {
      const filter = scopeFilter(currentRefundActor.warehouseIds, col)
      if (filter.sql) refundConditions.push(filter.sql.replace(/^ AND /, ''))
      refundParams.push(...filter.params)
    }
    parts.push(`SELECT 'document' AS source_kind,NULL AS instance_id,NULL AS task_id,? AS biz_type,d.id AS biz_id,
      d.created_by AS applicant_id,creator.real_name AS applicant_name,d.amount,
      NULL AS current_step,NULL AS flow_id,d.created_at,NULL AS submitted_at,
      'created' AS time_kind,d.created_at AS pending_at,d.refund_no AS no,d.remark AS title,d.status
      FROM supplier_refund_orders d
      JOIN purchase_orders po ON po.id=d.purchase_order_id
      JOIN purchase_returns pr ON pr.id=d.purchase_return_id
      LEFT JOIN sys_users creator ON creator.id=d.created_by
      WHERE ${refundConditions.join(' AND ')}`)
    params.push(...refundParams)
    const from = `FROM (${parts.join(' UNION ALL ')}) pending`
    const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total ${from}`, params)
    const [rows] = await conn.query(`SELECT pending.* ${from}
      ORDER BY pending.pending_at DESC,pending.source_kind ASC,pending.biz_type ASC,pending.biz_id DESC,pending.current_step DESC,pending.task_id DESC LIMIT ? OFFSET ?`, [...params, ps, (p - 1) * ps])
    const list = rows.map(r => {
      const sourceKind = r.source_kind === 'document' ? 'document' : 'engine'
      const document = sourceKind === 'document'
      return { sourceKind, entryKey: document ? `document:${r.biz_type}:${r.biz_id}:${r.biz_type === 'supplier_refund' ? 'confirm' : 'approve'}` : `engine:${r.biz_type}:${r.biz_id}:${r.current_step}:${r.task_id}`,
        instanceId: document ? null : Number(r.instance_id), taskId: document ? null : Number(r.task_id),
        bizType: r.biz_type, bizId: Number(r.biz_id), no: r.no || '', title: r.title || '', status: r.status ?? null,
        applicantId: r.applicant_id == null ? null : Number(r.applicant_id), applicantName: r.applicant_name || '', amount: Number(r.amount),
        currentStep: document ? null : Number(r.current_step), flowId: document ? null : Number(r.flow_id),
        createdAt: r.created_at, submittedAt: r.submitted_at ?? null, timeKind: r.time_kind }
    })
    await conn.commit()
    return { list, pagination: { page: p, pageSize: ps, total: Number(total) } }
  } catch (error) { await conn.rollback(); throw error } finally { conn.release() }
}

/** 供业务详情页查询审批进度（含终态历史）。 */
async function getBizApproval({ bizType, bizId, user = null, scopeWarehouseIds = null }) {
  const meta = Object.hasOwn(BIZ_DOC_META, bizType) ? BIZ_DOC_META[bizType] : null
  if (!meta) throw new AppError('业务类型无效', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 单据级授权（2026-09-18 审计 P2）：本接口此前只挂 APPROVAL_TASK_VIEW，任何有审批查看
    // 权限的登录用户都能用任意 bizId 枚举出单据的审批金额、申请人与各节点审批意见。
    // 这里要求同时持有底层单据的查看权限；有仓库列的类型再做范围校验。
    // 用 SQL 直查角色权限而不是依赖中间件注入的 req.user.permissions，避免依赖挂载顺序。
    if (user && Number(user.roleId) !== 1) {
      const [[allowed]] = await conn.query(
        'SELECT 1 AS ok FROM sys_role_permissions WHERE role_id=? AND permission=? LIMIT 1',
        [Number(user.roleId), meta.permission],
      )
      if (!allowed) throw new AppError('无权查看该单据的审批信息', 403, 'APPROVAL_BIZ_FORBIDDEN')
    }
    if (meta.warehouseCol) {
      const warehouseCol = meta.warehouseCol
      assertSqlIdentifier(warehouseCol, 'approval warehouse column')
      const table = meta.table
      assertSqlIdentifier(table, 'approval document table')
      const [[doc]] = await conn.query(
        `SELECT ${warehouseCol} AS wh FROM ${table} WHERE id=? LIMIT 1`, [bizId])
      if (doc) assertInScope(scopeWarehouseIds, doc.wh, meta.name)
    }
    if (meta.authorize) await meta.authorize(conn, { bizId, user })
    const got = await approvalEngine.getLatestInstanceByBiz(conn, { bizType, bizId })
    if (!got) {
      // 纯读事务无写入，commit 安全（避免 rollback 抛错落入 catch 二次 rollback 的双重回滚）
      await conn.commit()
      return null
    }
    const { instance, tasks } = got
    const result = {
      instanceId: Number(instance.id),
      flowId: Number(instance.flow_id),
      status: Number(instance.status),
      applicantId: Number(instance.applicant_id),
      applicantName: instance.applicant_name,
      amount: Number(instance.amount),
      currentStep: Number(instance.current_step),
      rejectReason: instance.reject_reason,
      finishedAt: instance.finished_at,
      createdAt: instance.created_at,
      tasks: tasks.map(t => ({
        stepOrder: Number(t.step_order),
        status: Number(t.status),
        approverName: t.approver_name,
        comment: t.comment,
        actionAt: t.action_at,
      })),
    }
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { BIZ_TYPES, listFlows, getFlow, createFlow, updateFlow, removeFlow, listPending, getBizApproval }
