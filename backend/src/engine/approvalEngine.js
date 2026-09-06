const AppError = require('../utils/AppError')
const { canSelfApprove } = require('../utils/selfApprove')

/**
 * 多级审批流引擎（P2-7）。只做「审批编排」，不碰业务单据的状态与金额：
 * 业务自己决定何时提交（startApproval）、审批通过/驳回后要做什么动作。
 *
 * 全部接口必须在调用方已开启的事务连接 `conn` 上执行，引擎不开事务（与 containerEngine 同范式）。
 *
 * 语义：
 *   - 按 biz_type + 金额区间选一个审批流，串行逐级（step_order 升序），上一节点通过才轮到下一节点。
 *   - 节点审批人三选一（配置）：1=指定角色 2=部门负责人 3=指定用户。
 *     startApproval 时把每节点的「命中审批人集合」解析并快照到 approval_instance_task_approvers
 *     （排除申请人本人，除非该账号被授予 sys_users.allow_self_approve）；「任一命中审批人可批」
 *     等同或签，此后流程/人员改配不影响运行中的实例。
 *   - 申请人默认不得审批自己的单（豁免见 utils/selfApprove）；超管 role_id=1 恒可代批
 *     （approver_name 记录实际经办人）。
 *   - 终态（驳回/撤销）后允许重新发起：引擎只认 status=1 审批中的活跃实例。
 *
 * 引擎不改业务单据状态；业务在 startApproval 返回 null（无匹配流程）时退回各自原单级逻辑。
 */

const INSTANCE_STATUS = { PENDING: 1, APPROVED: 2, REJECTED: 3, CANCELLED: 4 }
const TASK_STATUS = { PENDING: 1, APPROVED: 2, REJECTED: 3 }
const APPROVER_TYPE = { ROLE: 1, DEPT_MANAGER: 2, USER: 3 }

/** 按金额选流：biz_type 下 is_active=1 且 amount 落在 [min,max] 的流程，取 min_amount 最大者（最精确匹配）。 */
async function resolveFlow(conn, { bizType, amount }) {
  const [rows] = await conn.query(
    `SELECT * FROM approval_flows
      WHERE biz_type=? AND is_active=1
        AND min_amount<=? AND (max_amount IS NULL OR max_amount>=?)
      ORDER BY min_amount DESC LIMIT 1`,
    [bizType, amount, amount],
  )
  const flow = rows[0]
  if (!flow) return null
  const [steps] = await conn.query(
    'SELECT * FROM approval_flow_steps WHERE flow_id=? ORDER BY step_order ASC',
    [flow.id],
  )
  if (!steps.length) throw new AppError(`审批流「${flow.name}」没有配置审批节点，无法提交`, 400)
  return { ...flow, steps }
}

/** 解析一个配置节点的命中审批人 userId 集合；空数组表示无人可批。 */
async function resolveApproverUserIds(conn, { approverType, roleId, departmentId, userId, applicantId }) {
  if (approverType === APPROVER_TYPE.ROLE) {
    const [rows] = await conn.query(
      'SELECT id FROM sys_users WHERE role_id=? AND is_active=1 AND deleted_at IS NULL',
      [Number(roleId)],
    )
    return rows.map(r => Number(r.id))
  }
  if (approverType === APPROVER_TYPE.DEPT_MANAGER) {
    // departmentId 有值 → 指定部门；无值/0 → 申请人所属部门
    let depId = departmentId ? Number(departmentId) : null
    if (!depId) {
      const [[u]] = await conn.query(
        'SELECT department_id FROM sys_users WHERE id=? AND deleted_at IS NULL',
        [Number(applicantId)],
      )
      depId = u?.department_id ? Number(u.department_id) : null
    }
    if (!depId) return []
    const [[dep]] = await conn.query(
      'SELECT manager_id FROM sys_departments WHERE id=? AND deleted_at IS NULL',
      [depId],
    )
    if (!dep?.manager_id) return []
    const [[m]] = await conn.query(
      'SELECT id FROM sys_users WHERE id=? AND is_active=1 AND deleted_at IS NULL',
      [Number(dep.manager_id)],
    )
    return m ? [Number(m.id)] : []
  }
  if (approverType === APPROVER_TYPE.USER) {
    if (!userId) return []
    const [[u]] = await conn.query(
      'SELECT id FROM sys_users WHERE id=? AND is_active=1 AND deleted_at IS NULL',
      [Number(userId)],
    )
    return u ? [Number(u.id)] : []
  }
  return []
}

/**
 * 发起审批。返回 { instanceId, flowName, totalSteps }；无匹配流程返回 null（业务走原单级逻辑）。
 * 逐节点解析审批人并快照到 approvers 表；任一节点无人可批或只剩申请人本人 → 400 拒绝（避免卡死）。
 */
async function startApproval(conn, { bizType, bizId, amount, applicantId, applicantName }) {
  const flow = await resolveFlow(conn, { bizType, amount })
  if (!flow) return null

  const [[active]] = await conn.query(
    'SELECT id FROM approval_instances WHERE biz_type=? AND biz_id=? AND status=1 LIMIT 1',
    [bizType, Number(bizId)],
  )
  if (active) throw new AppError('该单据已有进行中的审批，请勿重复提交', 409, 'APPROVAL_ALREADY_PENDING')

  const resolved = []
  // 申请人默认不能出现在自己的审批人名单里；被授予「允许自行审批」的账号除外
  // （单人/小团队场景，否则这里会直接把提交动作卡死，见 utils/selfApprove 的说明）。
  const applicantMayApproveSelf = await canSelfApprove(applicantId)
  for (const step of flow.steps) {
    const userIds = await resolveApproverUserIds(conn, {
      approverType: step.approver_type, roleId: step.role_id,
      departmentId: step.department_id, userId: step.user_id, applicantId,
    })
    const others = applicantMayApproveSelf ? userIds : userIds.filter(id => id !== Number(applicantId))
    if (!others.length) {
      throw new AppError(`审批流「${flow.name}」第 ${step.step_order} 级没有可用的审批人（或审批人即申请人本人），请检查流程配置或相关用户/部门设置`, 400)
    }
    resolved.push({ ...step, approverUserIds: others })
  }

  const [r] = await conn.query(
    `INSERT INTO approval_instances
       (flow_id, biz_type, biz_id, applicant_id, applicant_name, amount, current_step, status)
     VALUES (?,?,?,?,?,?,1,1)`,
    [flow.id, bizType, Number(bizId), Number(applicantId), applicantName, Number(amount)],
  )
  const instanceId = r.insertId
  for (const s of resolved) {
    const [tr] = await conn.query(
      `INSERT INTO approval_instance_tasks
         (instance_id, step_order, approver_type, approver_role_id, approver_department_id, approver_user_id, status)
       VALUES (?,?,?,?,?,?,1)`,
      [instanceId, s.step_order, s.approver_type, s.role_id, s.department_id, s.user_id],
    )
    for (const uid of s.approverUserIds) {
      await conn.query(
        `INSERT INTO approval_instance_task_approvers (task_id, instance_id, user_id) VALUES (?,?,?)`,
        [tr.insertId, instanceId, uid],
      )
    }
  }
  return { instanceId, flowName: flow.name, totalSteps: resolved.length }
}

/** 校验 operator 是否命中当前节点的审批人快照（超管恒可）。 */
async function assertCanApproveTask(conn, taskId, operator) {
  if (Number(operator?.roleId) === 1) return
  const [[row]] = await conn.query(
    'SELECT id FROM approval_instance_task_approvers WHERE task_id=? AND user_id=? LIMIT 1',
    [taskId, Number(operator?.userId)],
  )
  if (!row) throw new AppError('您不是该审批节点的审批人，无权审批', 403, 'APPROVAL_NOT_ASSIGNED')
}

/**
 * 审批通过：把当前待审批节点 CAS 置通过，推进到下一节点或实例通过。
 * 返回 { status, currentStep, totalSteps }——业务据 status 决定单据动作。
 */
async function approveStep(conn, { instanceId, operator, comment }) {
  const inst = await lockActiveInstance(conn, instanceId)
  const currentTask = await lockCurrentTask(conn, inst)
  await assertCanApproveTask(conn, currentTask.id, operator)

  const [r] = await conn.query(
    `UPDATE approval_instance_tasks SET status=2, approver_name=?, action_at=NOW(), comment=?
      WHERE id=? AND status=1`,
    [operator?.realName ?? null, comment || null, currentTask.id],
  )
  if (!r.affectedRows) throw new AppError('该审批节点已被处理，请刷新后查看', 409, 'APPROVAL_CONFLICT')

  const [[{ max }]] = await conn.query(
    'SELECT MAX(step_order) AS max FROM approval_instance_tasks WHERE instance_id=?',
    [instanceId],
  )
  const nextStep = currentTask.step_order + 1
  if (Number(max) >= nextStep) {
    await conn.query('UPDATE approval_instances SET current_step=? WHERE id=?', [nextStep, instanceId])
    return { instanceId, status: INSTANCE_STATUS.PENDING, currentStep: nextStep, totalSteps: Number(max) }
  }
  await conn.query(
    'UPDATE approval_instances SET status=2, current_step=?, finished_at=NOW() WHERE id=?',
    [currentTask.step_order, instanceId],
  )
  return { instanceId, status: INSTANCE_STATUS.APPROVED, currentStep: currentTask.step_order, totalSteps: Number(max) }
}

/** 驳回：当前待审批节点置驳回，实例置驳回。业务据状态把单据打回。 */
async function rejectStep(conn, { instanceId, operator, comment }) {
  const inst = await lockActiveInstance(conn, instanceId)
  const currentTask = await lockCurrentTask(conn, inst)
  await assertCanApproveTask(conn, currentTask.id, operator)
  if (!String(comment || '').trim()) throw new AppError('请填写驳回原因', 400)

  const [r] = await conn.query(
    `UPDATE approval_instance_tasks SET status=3, approver_name=?, action_at=NOW(), comment=?
      WHERE id=? AND status=1`,
    [operator?.realName ?? null, String(comment).trim(), currentTask.id],
  )
  if (!r.affectedRows) throw new AppError('该审批节点已被处理，请刷新后查看', 409, 'APPROVAL_CONFLICT')
  await conn.query(
    'UPDATE approval_instances SET status=3, reject_reason=?, finished_at=NOW() WHERE id=?',
    [String(comment).trim(), instanceId],
  )
  return { instanceId, status: INSTANCE_STATUS.REJECTED, currentStep: currentTask.step_order }
}

/** 申请人（或超管）撤销进行中的审批。业务把单据从待审批撤回。 */
async function cancelInstance(conn, { instanceId, operator }) {
  const inst = await lockActiveInstance(conn, instanceId)
  if (Number(operator?.roleId) !== 1 && Number(operator?.userId) !== Number(inst.applicant_id)) {
    throw new AppError('只有申请人本人或超管可以撤销审批', 403)
  }
  await conn.query(
    `UPDATE approval_instance_tasks SET status=3, action_at=NOW(), comment='申请人撤销'
      WHERE instance_id=? AND status=1`,
    [instanceId],
  )
  await conn.query(
    'UPDATE approval_instances SET status=4, finished_at=NOW() WHERE id=?',
    [instanceId],
  )
  return { instanceId, status: INSTANCE_STATUS.CANCELLED }
}

async function lockActiveInstance(conn, instanceId) {
  const [rows] = await conn.query(
    'SELECT * FROM approval_instances WHERE id=? FOR UPDATE',
    [Number(instanceId)],
  )
  const inst = rows[0]
  if (!inst) throw new AppError('审批不存在', 404)
  if (Number(inst.status) !== INSTANCE_STATUS.PENDING) {
    throw new AppError('该审批已结束，无法操作', 409, 'APPROVAL_FINISHED')
  }
  return inst
}

async function lockCurrentTask(conn, inst) {
  const [rows] = await conn.query(
    `SELECT * FROM approval_instance_tasks
      WHERE instance_id=? AND step_order=? AND status=1 FOR UPDATE`,
    [inst.id, Number(inst.current_step)],
  )
  if (!rows[0]) throw new AppError('当前审批节点已处理，请刷新后查看', 409, 'APPROVAL_CONFLICT')
  return rows[0]
}

/** 取某业务单据的活跃实例（审批中）及其节点，供业务判断是否走引擎/查进度。无则返回 null。 */
async function getActiveInstanceByBiz(conn, { bizType, bizId }) {
  const [rows] = await conn.query(
    'SELECT * FROM approval_instances WHERE biz_type=? AND biz_id=? AND status=1 ORDER BY id DESC LIMIT 1',
    [bizType, Number(bizId)],
  )
  const inst = rows[0]
  if (!inst) return null
  const [tasks] = await conn.query(
    'SELECT * FROM approval_instance_tasks WHERE instance_id=? ORDER BY step_order ASC',
    [inst.id],
  )
  return { instance: inst, tasks }
}

/** 取某业务单据最近一条审批记录（含终态），供详情页展示审批历史。无则返回 null。 */
async function getLatestInstanceByBiz(conn, { bizType, bizId }) {
  const [rows] = await conn.query(
    'SELECT * FROM approval_instances WHERE biz_type=? AND biz_id=? ORDER BY id DESC LIMIT 1',
    [bizType, Number(bizId)],
  )
  const inst = rows[0]
  if (!inst) return null
  const [tasks] = await conn.query(
    'SELECT * FROM approval_instance_tasks WHERE instance_id=? ORDER BY step_order ASC',
    [inst.id],
  )
  return { instance: inst, tasks }
}

/**
 * 待办列表：某用户当前待审批的节点。
 * 命中条件 = 该用户出现在某审批中实例的当前节点 approvers 快照中。
 * 由调用方补业务单号/名称（引擎不知道业务表结构）。
 */
const PENDING_TASKS_FROM = `FROM approval_instance_task_approvers a
       JOIN approval_instance_tasks t ON t.id=a.task_id
       JOIN approval_instances i ON i.id=a.instance_id AND i.status=1
      WHERE a.user_id=? AND t.status=1 AND t.step_order=i.current_step`

async function countPendingTasks(pool, { userId }) {
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${PENDING_TASKS_FROM}`, [Number(userId)])
  return Number(total)
}

async function listPendingTasks(pool, { userId, page = 1, pageSize = 100 }) {
  const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 100)))
  const offset = (Math.max(1, Math.trunc(Number(page) || 1)) - 1) * size
  const [rows] = await pool.query(
    `SELECT i.id AS instance_id, i.biz_type, i.biz_id, i.applicant_id, i.applicant_name,
            i.amount, i.flow_id, i.created_at, i.current_step,
            t.id AS task_id, t.step_order, t.approver_name, t.created_at AS task_created_at
       ${PENDING_TASKS_FROM}
      ORDER BY i.created_at DESC, i.id DESC, t.id DESC LIMIT ? OFFSET ?`,
    [Number(userId), size, offset],
  )
  return rows
}

module.exports = {
  INSTANCE_STATUS, TASK_STATUS, APPROVER_TYPE,
  startApproval, approveStep, rejectStep, cancelInstance,
  getActiveInstanceByBiz, getLatestInstanceByBiz, listPendingTasks, countPendingTasks,
}
