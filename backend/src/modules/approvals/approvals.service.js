const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const approvalEngine = require('../../engine/approvalEngine')

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

/** 审批待办列表（引擎只按 user_id 命中，这里补业务概要 + 分页）。 */
async function listPending({ page = 1, pageSize = 20 }, userId) {
  const ps = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const offset = (Number(page) - 1) * ps
  const totalRows = await approvalEngine.listPendingTasks(pool, { userId })
  const total = totalRows.length
  const rows = totalRows.slice(offset, offset + ps)

  // N+1 优化：按 biz_type 分组后批量查询，避免逐行查询
  const bizTypeMeta = {
    purchase_requisition: { table: 'purchase_requisitions', noCol: 'requisition_no', titleCol: 'title', statusCol: 'status' },
  }
  const grouped = {}
  for (const r of rows) {
    if (!grouped[r.biz_type]) grouped[r.biz_type] = []
    grouped[r.biz_type].push(Number(r.biz_id))
  }
  const bizCache = {}
  for (const [bizType, ids] of Object.entries(grouped)) {
    const meta = bizTypeMeta[bizType]
    if (!meta || !ids.length) continue
    const placeholders = ids.map(() => '?').join(',')
    const [rows2] = await pool.query(
      `SELECT id, ${meta.noCol} AS no, ${meta.titleCol} AS title, ${meta.statusCol} AS status FROM ${meta.table} WHERE id IN (${placeholders})`,
      ids,
    )
    for (const b of rows2) bizCache[`${bizType}:${b.id}`] = { no: b.no || '', title: b.title || '', status: b.status ?? null }
  }

  const list = rows.map(r => {
    const key = `${r.biz_type}:${r.biz_id}`
    const biz = bizCache[key] || {}
    return {
      instanceId: Number(r.instance_id),
      taskId: Number(r.task_id),
      bizType: r.biz_type,
      bizId: Number(r.biz_id),
      no: biz.no || '',
      title: biz.title || '',
      status: biz.status ?? null,
      applicantId: Number(r.applicant_id),
      applicantName: r.applicant_name,
      amount: Number(r.amount),
      currentStep: Number(r.current_step),
      flowId: Number(r.flow_id),
      createdAt: r.created_at,
    }
  })
  return { list, pagination: { page: Number(page), pageSize: ps, total } }
}

/** 供业务详情页查询审批进度（含终态历史）。 */
async function getBizApproval({ bizType, bizId }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
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
