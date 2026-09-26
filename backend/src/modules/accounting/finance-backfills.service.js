'use strict'

/**
 * 跨期补录的申请审批（2026-09-26 一致性审查 · 任务 7 第二期）。
 *
 * 一期（迁移 258）是「同步放行 + 留痕」：持 finance.period.backfill 者填原因后当场把业务
 * 写进已结账期间。业务口径随后定为**先审批、后动账**，本模块是那条口径的实现：
 *
 *   1. 出纳在付款/核销/退款界面撞上已结账期间 → 提交**补录申请**（业务数据一律不写），
 *      落一行 finance_period_backfills(status=0)，业务界面拿到申请单号。
 *   2. **他人**（持 finance.period.backfill.approve）在补录审批页批准 → 系统按申请单上的
 *      request_snapshot 重放原请求，业务数据此时才落库，并回填 executed_*。
 *   3. 落库后立即为**补录当期**生成调整凭证（voucher_generated_at）。生成失败会把原因留在
 *      申请单上并可一键重试——不允许悄悄退回「业务已动、凭证等人来点」的状态。
 *
 * 为什么申请人不能批自己的单：这正是「人工审批留痕」的全部意义。同一个人既能申请又能批准，
 * 审批就退化成一次确认点击，事后无法回答「这笔跨期补录是谁把关的」。
 *
 * 为什么批准前不写业务：若先记账后审批，审批被驳回时这笔钱已经脱离了会计账（该期间不出凭证），
 * 要再冲回来——那才是最危险的状态。先审批、后动账，钱和账始终一起动。
 */

const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { normalizeOperator } = require('../../utils/operator')
const { APPLICATION_NO_SQL, resolvePostingPeriod, markBackfillExecuted, STATUS } = require('./finance-period.guard')
const paymentsSvc = require('../payments/payments.service')
const receiptsSvc = require('../payments/payment-receipts.service')
const refundSvc = require('../refunds/refund-orders.service')
const voucherSvc = require('./accounting.voucher.service')

const STATUS_NAME = { 0: '待审批', 1: '已批准', 2: '已驳回', 3: '历史遗留', 4: '已作废' }

const BIZ_TYPE_NAME = {
  payment: '付款登记',
  receipt: '收付款单登记',
  receipt_settle: '收付款核销',
  refund: '退款出账',
}

const SELECT_FIELDS = `
  id, ${APPLICATION_NO_SQL} AS application_no, company_id, period, business_date,
  biz_type, biz_id, biz_no, amount, reason, status,
  applicant_id, applicant_name, approver_id, approver_name, approved_at, approve_remark,
  executed_at, executed_biz_id, posting_period,
  voucher_generated_at, voucher_generate_error,
  void_reason, voided_by, voided_by_name, voided_at, created_at`

function fmt(row, { withSnapshot = false } = {}) {
  const out = {
    id: Number(row.id),
    applicationNo: row.application_no,
    period: row.period,
    businessDate: row.business_date,
    bizType: row.biz_type,
    bizTypeName: BIZ_TYPE_NAME[row.biz_type] || row.biz_type,
    bizId: row.biz_id != null ? Number(row.biz_id) : null,
    bizNo: row.biz_no,
    amount: row.amount != null ? Number(row.amount) : null,
    reason: row.reason,
    status: Number(row.status),
    statusName: STATUS_NAME[Number(row.status)] || String(row.status),
    applicantId: row.applicant_id != null ? Number(row.applicant_id) : null,
    applicantName: row.applicant_name,
    approverId: row.approver_id != null ? Number(row.approver_id) : null,
    approverName: row.approver_name,
    approvedAt: row.approved_at,
    approveRemark: row.approve_remark,
    executedAt: row.executed_at,
    executedBizId: row.executed_biz_id != null ? Number(row.executed_biz_id) : null,
    postingPeriod: row.posting_period,
    voucherGeneratedAt: row.voucher_generated_at,
    voucherGenerateError: row.voucher_generate_error,
    voidReason: row.void_reason || null,
    voidedBy: row.voided_by != null ? Number(row.voided_by) : null,
    voidedByName: row.voided_by_name || null,
    voidedAt: row.voided_at || null,
    createdAt: row.created_at,
  }
  // 已批准但还没执行成功 = 待执行（审批通过后执行失败会停在这个状态，可重试）
  out.pendingExecution = out.status === STATUS.APPROVED && !out.executedAt
  // 页面按钮该不该出现：由后端给出「状态上允不允许」，前端再叠加自己的权限判断。
  // 这两个判断散在前端会与状态机漂移（后端改了状态含义，前端还在显示旧按钮）。
  //   · 撤回   —— 待审批的单子，申请人自己可以收回；
  //   · 作废   —— 待审批（审批侧代撤）或「已批准但执行不下去」（业务已漂移、重试也执行不了）。
  out.voidableByApplicant = out.status === STATUS.PENDING
  out.voidable = out.status === STATUS.PENDING
    || (out.status === STATUS.APPROVED && !out.executedAt)
  // 「已批准 · 待执行」既可能是刚批准还没跑，也可能是执行失败停在这——两者对页面的处置相同
  // （重试执行 / 作废），不需要分开呈现。
  out.replayFailed = out.status === STATUS.APPROVED && !out.executedAt
  // 已执行但凭证没生成出来 = 需要重试生成，页面必须显著提示
  out.voucherPending = !!out.executedAt && !out.voucherGeneratedAt
  // 核销类补录不产生会计凭证（凭证在收付款单登记时就已生成）：页面应显示「本类补录不涉及凭证」，
  // 而不是「凭证待生成」——后者会让人一直等一个永远不会来的凭证。
  out.voucherNotRequired = NO_FUND_TXN_BIZ_TYPES.has(row.biz_type)
  if (out.voucherNotRequired) out.voucherPending = false
  if (withSnapshot) {
    out.requestSnapshot = row.request_snapshot
      ? (typeof row.request_snapshot === 'string' ? JSON.parse(row.request_snapshot) : row.request_snapshot)
      : null
  }
  return out
}

/** 待审批优先、然后待执行/已批准、最后是收尾的单子；同级按申请时间倒序（最近的在上面） */
const ORDER_SQL = `ORDER BY CASE status WHEN 0 THEN 0 WHEN 1 THEN 1 ELSE 2 END, id DESC`

async function findAll({ status = '', bizType = '', applicantId = null, page = 1, pageSize = 20 } = {}, companyId = 1) {
  const conds = ['company_id = ?']
  const params = [companyId]
  if (status !== '' && status != null) { conds.push('status = ?'); params.push(Number(status)) }
  if (bizType) { conds.push('biz_type = ?'); params.push(String(bizType)) }
  // applicantId 由 controller 按「是否持审批权限」决定传不传（见 finance-backfills.controller）：
  // 传了就是「只看我提交的」，出纳提交完能回查自己的单子，又看不到别人的补录金额与原因。
  if (applicantId != null) { conds.push('applicant_id = ?'); params.push(Number(applicantId)) }
  const where = `WHERE ${conds.join(' AND ')}`
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200)
  const current = Math.max(Number(page) || 1, 1)

  // voucherPending 要排除「本来就不产生凭证」的类型（见 NO_FUND_TXN_BIZ_TYPES）：那些单子
  // executed_at 有、voucher_generated_at 会一直是空，算进来会让审批页顶部永远挂着一个
  // 「凭证待生成 N」的假警报，而列表里每一行都显示「不涉及凭证」——数与行对不上，人就不信这个数了。
  const noVoucherTypes = [...NO_FUND_TXN_BIZ_TYPES]
  const noVoucherPlaceholders = noVoucherTypes.map(() => '?').join(', ')
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 0) AS pending,
            SUM(status = 1 AND executed_at IS NULL) AS pendingExecution,
            SUM(executed_at IS NOT NULL AND voucher_generated_at IS NULL
                AND biz_type NOT IN (${noVoucherPlaceholders})) AS voucherPending
       FROM finance_period_backfills ${where}`,
    [...noVoucherTypes, ...params],
  )
  const [rows] = await pool.query(
    `SELECT ${SELECT_FIELDS} FROM finance_period_backfills ${where} ${ORDER_SQL} LIMIT ? OFFSET ?`,
    [...params, size, (current - 1) * size],
  )
  return {
    list: rows.map(r => fmt(r)),
    summary: {
      total: Number(countRow.total || 0),
      pending: Number(countRow.pending || 0),
      pendingExecution: Number(countRow.pendingExecution || 0),
      voucherPending: Number(countRow.voucherPending || 0),
    },
    pagination: { page: current, pageSize: size, total: Number(countRow.total || 0) },
  }
}

async function findOne(id, companyId = 1, { applicantId = null } = {}) {
  const [[row]] = await pool.query(
    `SELECT ${SELECT_FIELDS}, request_snapshot FROM finance_period_backfills WHERE id = ? AND company_id = ?`,
    [Number(id), companyId],
  )
  if (!row) throw new AppError('补录申请不存在', 404)
  // applicantId 由 controller 对「不持审批权限」的调用者传入（见 finance-backfills.controller）：
  // 申请人能看自己提交的单子，看不到别人的补录金额与原因。service 内部调用不传该参数（不受限）。
  if (applicantId != null && Number(row.applicant_id) !== Number(applicantId)) {
    throw new AppError('无权查看他人的补录申请', 403, 'FINANCE_BACKFILL_VIEW_FORBIDDEN')
  }
  return fmt(row, { withSnapshot: true })
}

/**
 * 审批动作的公共前置：锁行 + 状态与自审校验。
 * 必须 `FOR UPDATE`：批准/驳回/执行都要先把行锁住再判状态，
 * 否则两个审批人同时批准会各自读到 status=0 都判定通过。
 */
async function lockApplicable(conn, id, operator, companyId, { actionLabel }) {
  const [[row]] = await conn.query(
    'SELECT * FROM finance_period_backfills WHERE id = ? AND company_id = ? FOR UPDATE',
    [Number(id), companyId],
  )
  if (!row) throw new AppError('补录申请不存在', 404)
  const status = Number(row.status)
  if (status === STATUS.LEGACY) {
    throw new AppError(
      '这是审批流上线前的历史补录记录（当时业务已直接写入，没有审批环节），不能在这里审批。'
      + '请人工核对它对应的业务与凭证后另行处理。',
      409,
      'FINANCE_BACKFILL_LEGACY',
    )
  }
  // 「必须他人审批」：申请人不能批准/驳回自己的单子——那正是这条审批流存在的理由
  if (row.applicant_id != null && Number(row.applicant_id) === Number(operator.operatorId)) {
    throw new AppError(
      `不能${actionLabel}自己提交的补录申请：跨期补录必须由他人复核。请让另一位持「跨期补录审批」权限的同事处理。`,
      403,
      'FINANCE_BACKFILL_SELF_APPROVE',
    )
  }
  return row
}

/**
 * 批准并执行。批准（status 0→1）与执行分两个事务：
 * 审批结论一旦落定就不该因执行失败而回退——执行失败时停在「已批准 · 待执行」，可重试。
 */
async function approve(id, operator, { remark = null } = {}, companyId = 1) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockApplicable(conn, id, operator, companyId, { actionLabel: '批准' })
    const status = Number(row.status)
    if (status === STATUS.REJECTED) {
      throw new AppError('该补录申请已被驳回，不能再次批准。如需补录请重新提交申请。', 409, 'FINANCE_BACKFILL_REJECTED')
    }
    if (status === STATUS.PENDING) {
      const [r] = await conn.query(
        `UPDATE finance_period_backfills
            SET status = ?, approver_id = ?, approver_name = ?, approved_at = NOW(), approve_remark = ?
          WHERE id = ? AND status = ?`,
        [STATUS.APPROVED, operator.operatorId ?? null, operator.operatorName ?? null, remark || null, Number(id), STATUS.PENDING],
      )
      // compareAndSet 失败说明这一瞬间被别人抢先批了：交由下面的执行阶段按最新状态处理
      if (r.affectedRows === 0) throw new AppError('该申请状态已变化，请刷新后重试', 409, 'FINANCE_BACKFILL_RACE')
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  // 批准即执行：口径是「先审批、后动账」，审批人点完批准这笔钱就该落账，不该再要一个人去点执行。
  // 执行失败时批准状态**不回退**（见本函数开头注释），此时把出路写进错误信息：审批人看到一句
  // 业务校验错误（「付款金额超出余额」）时，必须同时知道这张单现在停在哪儿、下一步能做什么，
  // 否则他只会以为「点失败了」，再点一次、再失败一次。
  try {
    return await execute(id, operator, companyId)
  } catch (e) {
    if (e instanceof AppError) {
      e.message = `${e.message}（这张申请已批准、但业务没能执行成功，可在「跨期补录审批」页重试执行；`
        + '若业务本身已经做不了了（比如账款已被别人付清），请作废它再按新情况重新申请。）'
    }
    throw e
  }
}

async function reject(id, operator, { remark = null } = {}, companyId = 1) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const row = await lockApplicable(conn, id, operator, companyId, { actionLabel: '驳回' })
    const status = Number(row.status)
    if (status === STATUS.APPROVED && row.executed_at) {
      throw new AppError('该补录已批准并已记账，不能驳回。如需冲回请按会计调整流程处理。', 409, 'FINANCE_BACKFILL_ALREADY_EXECUTED')
    }
    if (status === STATUS.REJECTED) {
      await conn.commit()
      return findOne(id, companyId)
    }
    if (status === STATUS.APPROVED) {
      throw new AppError('该补录已批准但尚未执行成功，请先执行或联系管理员处理，不能驳回。', 409, 'FINANCE_BACKFILL_APPROVED')
    }
    const reason = String(remark || '').trim()
    if (reason.length < 2) throw new AppError('驳回必须填写原因，申请人需要知道为什么被驳回', 400, 'FINANCE_BACKFILL_REJECT_REASON')
    await conn.query(
      `UPDATE finance_period_backfills
          SET status = ?, approver_id = ?, approver_name = ?, approved_at = NOW(), approve_remark = ?
        WHERE id = ? AND status = ?`,
      [STATUS.REJECTED, operator.operatorId ?? null, operator.operatorName ?? null, reason, Number(id), STATUS.PENDING],
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return findOne(id, companyId)
}

/**
 * 作废 / 撤回一张申请单：让它退出流程，**一分钱不动、业务数据一行不写**。
 *
 * 为什么必须有这条路：审批是异步的，申请时校验过的业务到批准时可能已经不可执行（账款被
 * 别人先付清、对账单退回草稿、这笔收款又被另一张退款单冲掉）。此时单子停在「已批准 ·
 * 待执行」，而 reject 不接受已批准的单（审批结论已落定，不该被驳回改写）——没有作废，
 * 这张单就永久卡在流程里，只能进数据库改。作废是那条死角的出路。
 *
 * 与驳回的区别：驳回是「这次不同意，可以改了再报」，单子回到申请人手上；作废是「这条路
 * 走不通了，重新发起」。作废后请求键仍被占着（迁移 260 的全生命周期唯一），所以**重新申请
 * 要用新的请求键**——前端重开补录对话框即可，不要复用旧键。
 *
 * 已执行（executed_at 非空）的**一律不允许作废**：钱真的收付了，凭证也已经生成，让这张单
 * 从审批页消失等于把账实不符藏起来。要冲回走会计调整流程。
 *
 * 权限（canApprove 由 controller 按 finance.period.backfill.approve 判定后传入，
 * 路由级只要求申请权限，否则没审批权限的出纳连自己的申请都撤不回）：
 *   · 待审批：申请人本人可撤回（还没被批过，撤回不推翻任何人的结论）；审批侧亦可代撤；
 *   · 已批准未执行：只有审批侧可作废——它推翻的是一份已经作出的审批结论。
 */
async function cancel(id, operator, { reason, canApprove = false } = {}, companyId = 1) {
  const text = String(reason || '').trim()
  if (text.length < 2) {
    throw new AppError('作废/撤回必须填写原因，事后要能回答这张申请为什么没执行', 400, 'FINANCE_BACKFILL_VOID_REASON')
  }
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query(
      'SELECT * FROM finance_period_backfills WHERE id = ? AND company_id = ? FOR UPDATE',
      [Number(id), companyId],
    )
    if (!row) throw new AppError('补录申请不存在', 404)
    const status = Number(row.status)
    if (status === STATUS.LEGACY) {
      throw new AppError(
        '这是审批流上线前的历史补录记录（当时业务已直接写入，没有审批环节），不能作废。'
        + '请人工核对它对应的业务与凭证后另行处理。',
        409, 'FINANCE_BACKFILL_LEGACY',
      )
    }
    if (status === STATUS.VOIDED) {
      // 幂等：重复点「作废」或断网重试返回现状，不报错也不覆盖首次的作废原因与作废人
      await conn.commit()
      return findOne(id, companyId)
    }
    if (row.executed_at) {
      throw new AppError(
        '该补录已经记账（钱已实际收付、凭证已生成），不能作废。如需冲回请按会计调整流程处理。',
        409, 'FINANCE_BACKFILL_ALREADY_EXECUTED',
      )
    }
    if (status === STATUS.REJECTED) {
      throw new AppError('该补录申请已被驳回，已经退出流程，无需再作废。要补录请重新提交申请。', 409, 'FINANCE_BACKFILL_REJECTED')
    }
    if (status === STATUS.APPROVED && !canApprove) {
      throw new AppError(
        '这张补录申请已经批准过了，撤回它会推翻那份审批结论，需要「跨期补录审批」权限。请联系审批人处理。',
        403, 'FINANCE_BACKFILL_VOID_FORBIDDEN',
      )
    }
    if (!canApprove && row.applicant_id != null && Number(row.applicant_id) !== Number(operator?.operatorId)) {
      throw new AppError('只能撤回自己提交的补录申请。', 403, 'FINANCE_BACKFILL_VOID_FORBIDDEN')
    }
    const [r] = await conn.query(
      `UPDATE finance_period_backfills
          SET status = ?, void_reason = ?, voided_by = ?, voided_by_name = ?, voided_at = NOW()
        WHERE id = ? AND status = ? AND executed_at IS NULL`,
      [STATUS.VOIDED, text, operator?.operatorId ?? null, operator?.operatorName ?? null, Number(id), status],
    )
    // 条件里带 status 与 executed_at：这一瞬间若有人刚批准并执行成功，这里必须失败而不是
    // 把一张已经动过钱的单子改成「已作废」——那会让一笔真实发生的收付从审批页消失。
    if (r.affectedRows === 0) {
      throw new AppError('该申请状态已变化，请刷新后重试', 409, 'FINANCE_BACKFILL_RACE')
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return findOne(id, companyId)
}

/**
 * 按申请单快照重放原业务请求。
 *
 * 快照的约定：**它就是重放这次调用所需的入参**（记录 id + 原请求体），由申请时的那个入口
 * 写成自己的形状——业务侧改了入参，快照必须跟着改，否则执行时静默写进错误的内容。
 * 各 biz_type 的快照形态（与三个 service 的 apply 分支一一对应）：
 *   · payment        { recordId, body }          → recordPayment(recordId, body, …)
 *   · receipt        { body }                    → receipts.create(body, …)
 *   · receipt_settle { receiptId, body }         → receipts.settle(receiptId, body, …)
 *   · refund         { orderId, warehouseIds, body } → refunds.execute(orderId, …, warehouseIds, …)
 *     （refund 的 body 不是重放入参——退款的执行参数取自退款单本身——而是**核对基准**：
 *      execute 拿它比对锁行后的现值，不一致就拒绝执行。理由见那边的 SOURCE_DRIFT 注释。）
 *
 * 以**申请人**的身份写业务单据（钱是出纳收付的，凭证/流水上的经办人应是他），审批人只记在
 * 申请单上（approver_*），两者职责在数据上分得开。这里用 normalizeOperator 而不是手写对象：
 * 各 service 读法不一（退款侧读 operator.userId / realName，收付款侧读 operatorId / operatorName），
 * 手写一半字段会让另一侧静默记成空，且不会报错。
 *
 * 请求键取自申请单的 request_key **列**，不是快照里的字段：这个键是这笔操作的永久身份
 * （见 finance-period.guard），漏了它，重放就会被业务侧当成一笔新业务，同一笔钱记两次。
 */
async function replay(conn, row, snapshot, postingPeriod) {
  const backfill = { mode: 'execute', approvedId: Number(row.id), postingPeriod, reason: row.reason }
  const applicant = normalizeOperator({ userId: row.applicant_id ?? null, realName: row.applicant_name ?? null })
  const requestKey = row.request_key ?? null
  // conn 传下去：业务写入与下面回填 executed_* 必须在**同一个事务**里，否则业务写成、痕迹没写成，
  // 申请单会永远停在「已批准 · 待执行」，而每次重试又会重放一遍业务。
  switch (row.biz_type) {
    case 'payment':
      return paymentsSvc.recordPayment(snapshot.recordId, snapshot.body, applicant, requestKey, { backfill, conn })
    case 'receipt':
      return receiptsSvc.create(snapshot.body, applicant, requestKey, { backfill, conn })
    case 'receipt_settle':
      return receiptsSvc.settle(snapshot.receiptId, snapshot.body, applicant, requestKey, { backfill, conn })
    case 'refund':
      return refundSvc.execute(snapshot.orderId, applicant, snapshot.warehouseIds ?? null, requestKey, {
        backfill, conn, expectedRefund: snapshot.body ?? null,
      })
    default:
      throw new AppError(`未知的补录业务类型「${row.biz_type}」，无法自动补写，请人工处理`, 409, 'FINANCE_BACKFILL_UNKNOWN_BIZ')
  }
}

/**
 * 执行已批准的补录：先把业务写进去（重放），再为补录当期生成调整凭证。
 *
 * 两段各自的失败处置不同，这是有意的：
 *   · 业务写入失败 → 状态停在「已批准 · 待执行」，可重试；业务那一侧是完整事务，不会半写。
 *   · 凭证生成失败 → 业务已经真实发生（钱确实动了），**不能回滚业务**；把失败原因记在申请单上
 *     （voucher_generate_error），页面显著提示并可一键重试生成。凭证生成本身是全量重算 + 幂等，
 *     重试不会重复出凭证。
 */
async function execute(id, operator, companyId = 1) {
  const conn = await pool.getConnection()
  let result, postingPeriod
  try {
    await conn.beginTransaction()
    // 锁申请行：批准 / 驳回 / 执行三个动作互斥，也让「两个审批人同时点执行」串行化——
    // 否则两边都读到 executed_at 为空，各自放行一次重放。
    const [[row]] = await conn.query(
      'SELECT * FROM finance_period_backfills WHERE id = ? AND company_id = ? FOR UPDATE',
      [Number(id), companyId],
    )
    if (!row) throw new AppError('补录申请不存在', 404)
    if (Number(row.status) !== STATUS.APPROVED) {
      throw new AppError('只有已批准的补录申请才能执行', 409, 'FINANCE_BACKFILL_NOT_APPROVED')
    }
    // 已执行过就直接返回（重复点「执行」、断网重试都走这里，靠 executed_at 判幂等，
    // 不依赖请求键——审批单上的执行业务是同一次重放，绝不能再写第二遍）
    if (row.executed_at) {
      await conn.commit()
      return { alreadyExecuted: true, application: await findOne(id, companyId) }
    }

    const snapshot = row.request_snapshot
      ? (typeof row.request_snapshot === 'string' ? JSON.parse(row.request_snapshot) : row.request_snapshot)
      : null
    if (!snapshot) {
      throw new AppError('该申请缺少原始请求快照，无法自动补写业务。请人工按申请内容登记后，另行生成凭证。', 409, 'FINANCE_BACKFILL_NO_SNAPSHOT')
    }

    // 执行前复核「补录当期」：从申请到批准之间会计可能把当期也结了，此时凭证无处可落。
    // 以**执行日**所在的当期为准（不是业务期间，也不是任何历史开放月份）。读本事务的连接：
    // 这次判断要与后面的业务写入看到同一个期间状态。
    postingPeriod = await resolvePostingPeriod(conn, companyId)

    // 业务写入与执行痕迹**同事务**：业务回滚则痕迹一并回滚，单子停在「已批准 · 待执行」可重试，
    // 不会出现「业务没写成、却记着已执行」的假状态（那会让重放与凭证状态永远不闭环）。
    result = await replay(conn, row, snapshot, postingPeriod)

    // executed_biz_id 要记「这次补录最终写成了哪条业务记录」，可各业务的返回字段名并不统一：
    //   payment  → entryId（本次付款登记的分录 id）
    //   receipt / receipt_settle / refund → id（收付款单 / 退款单 id）
    // 原来的 `result?.id` 只对后三类成立，payment 一路恒为 undefined，于是补录单执行成功后
    // executed_biz_id 一直是 NULL——事后无法从补录单反查到业务记录。这里统一归一化；
    // 将来新增 biz_type 必须让自己的返回带上其中之一。
    const executedBizId = result?.entryId ?? result?.id ?? null
    const affected = await markBackfillExecuted(conn, Number(id), {
      bizId: executedBizId,
      postingPeriod,
      executedBy: operator?.operatorId ?? null,
      executedByName: operator?.operatorName ?? null,
    })
    // 行锁已在本事务手里，正常必然 affected=1；为 0 只有一种可能：状态在锁等待期间被别人改成了
    // 非「已批准」（例如另一路把它驳回）。此时业务写入已在同一事务里发生，必须整笔回滚，
    // 绝不能提交——那会变成「业务动账了、申请单却驳回了」。
    if (affected === 0) {
      throw new AppError('该补录申请的状态已变化，本次执行未生效，请刷新后重试', 409, 'FINANCE_BACKFILL_RACE')
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  // 凭证生成放在业务**提交之后**：它是独立事务的全量重算，读的是已落库的流水与单据；
  // 塞进上面那个事务反而读不到自己未提交的写入，会把「刚补好的凭证」判成缺失。
  const vouchers = await settleVouchersFor(Number(id), postingPeriod, operator, companyId)
  return { executed: true, result, postingPeriod, ...vouchers, application: await findOne(id, companyId) }
}

// ─── 补录凭证：生成 → 核对 → 回填 ────────────────────────────────────────────

/** 资金流水 biz_type → 凭证来源。与 voucher-engine.buildFundVouchers 的四条分支一一对应。 */
const FUND_SOURCE_TYPE_SQL = `CASE t.biz_type
  WHEN 1 THEN 'receipt_in' WHEN 2 THEN 'payment_out' WHEN 3 THEN 'expense_pay' WHEN 5 THEN 'refund_pay' END`

/** 金额比较的分位容差：DECIMAL 经 JS 浮点累加后可能有尾数，严格相等会把平衡误判成不平 */
const AMOUNT_EPS = 0.005

/**
 * 哪些补录业务**本来就不产生资金流水**（也就没有会计凭证来源）。
 *
 * 目前只有收付款核销（receipt_settle）：它把已经进了账户的钱分配到各笔账款上，改的是往来台账
 * （payment_records / 对账单投影）——会计凭证在收付款单**登记**时就已按整笔金额生成，核销这一步
 * 不产生任何新的会计事项。所以对它来说「资金流水 0 条」是正常结果，不是凭证缺失。
 *
 * 不区分这一点会怎样：核销类补录执行完永远过不了核对，voucher_generate_error 一直挂着、
 * 自动重试每轮都失败——而它其实**没有账要补**，白白占着审批页的告警位，把真正需要人处理的
 * 失败淹没掉。其余三类（payment / receipt / refund）必须以资金流水为凭证来源，缺流水就是错误。
 */
const NO_FUND_TXN_BIZ_TYPES = new Set(['receipt_settle'])

/** 该申请单是否需要生成（并核对）调整凭证；未知/缺失的业务类型按「需要」处理，宁可多核对 */
async function requiresVoucher(backfillId, companyId = 1) {
  const [[row]] = await pool.query(
    'SELECT biz_type FROM finance_period_backfills WHERE id = ? AND company_id = ?',
    [Number(backfillId), companyId],
  )
  return !NO_FUND_TXN_BIZ_TYPES.has(row?.biz_type)
}

/**
 * 核对「这张申请单补录的资金流水，真的都出凭证了吗」。
 *
 * 为什么不能拿 generatePeriodVouchers 的返回来判断成功：那是**全期间**重算，返回的是这一轮
 * 所有来源的统计。它不报错只说明「这一轮跑完了」，完全不代表本申请那笔出了凭证——该流水可能
 * 压根没被驱动到、可能因落期不合法被跳过、可能凭证被冲销。拿它当成功就会把 voucher_generated_at
 * 置上，页面显示「凭证已生成」，而会计账上其实没有这笔：正是本模块要消灭的「业务已动、会计无账」，
 * 只是换了个更难发现的形式。
 *
 * 按 `finance_account_transactions.backfill_id` 反查本申请产生的每一条流水，逐条核对：
 *   ① 有**有效**凭证（什么叫有效见下）；② 期间 = 补录当期；③ 借贷各自等于该笔流水金额且分录 ≥ 2 条。
 *
 * ## 什么叫「有效凭证」——不能只看 source_id
 *
 * 迁移 232 的来源修订链：来源被重算修订时，**根凭证**（唯一持有 source_id 的那张）被标
 * status=3 归档，新的有效正向版本改用 `source_root_id` 指回根、`source_id` 置空
 * （见 voucher-source-revisions / voucher-sale-periods 的同一口径）。若这里只 JOIN
 * `source_id = t.id`，修订之后永远只能读到那张已归档的根，把「账已经重新记好了」误报成
 * 「凭证没了」，自动重试也就永远不收敛。
 *
 * 但**人工冲销必须仍判为无效**，且不能被自动重试复活：人工冲销不设 source_root_id
 * （迁移 232 的原话），正是为了让「会计主动停掉一笔账」与「系统自动重记」在数据上分得开。
 * 判据与 voucher-source-revisions 的 autoReversed 完全一致：根 status=3 且红字凭证的
 * source_root_id 也指向根 → 自动修订；否则 → 人工冲销，报错等人工处理，不自动恢复。
 *
 * 备注（证据强度：代码可查，未端到端复现）：当前**资金类**凭证不会进入修订链——upsertVoucher
 * 只在采购结算/销售类（purchase_settle / sale_revenue / sale_cogs）调用 reviseSourceVoucher，
 * 资金类重算走的是直接 UPDATE 原凭证、source_id 恒定（voucher-engine.js:144 起）。这里仍按
 * 完整语义实现，是刻意不依赖「调用方恰好不走那条路」：一旦资金类纳入修订链，写死 source_id
 * 会静默失效，而失效方向恰好是「永远报凭证缺失、自动重试永不收敛」。
 */
async function inspectBackfillVouchers(backfillId, postingPeriod, companyId = 1) {
  const voucherRequired = await requiresVoucher(backfillId, companyId)
  const [rows] = await pool.query(
    `SELECT t.id AS txn_id, t.biz_type, t.amount,
            root.id AS root_id, root.voucher_no AS root_no, root.status AS root_status,
            auto_rev.id AS auto_reversal_id,
            v.id AS voucher_id, v.voucher_no, v.period,
            (SELECT COUNT(*) FROM acct_voucher_entries e WHERE e.voucher_id = v.id) AS entry_count,
            (SELECT COALESCE(SUM(CASE WHEN e.direction = 1 THEN e.amount ELSE 0 END), 0)
               FROM acct_voucher_entries e WHERE e.voucher_id = v.id) AS debit_sum,
            (SELECT COALESCE(SUM(CASE WHEN e.direction = 2 THEN e.amount ELSE 0 END), 0)
               FROM acct_voucher_entries e WHERE e.voucher_id = v.id) AS credit_sum
       FROM finance_account_transactions t
       LEFT JOIN acct_vouchers root
              ON root.company_id = ? AND root.source_id = t.id
             AND root.source_type = ${FUND_SOURCE_TYPE_SQL}
       LEFT JOIN acct_vouchers auto_rev
              ON auto_rev.reversed_id = root.id AND auto_rev.source_root_id = root.id
       LEFT JOIN acct_vouchers v
              ON v.id = (SELECT c.id FROM acct_vouchers c
                          WHERE c.company_id = root.company_id
                            AND c.is_reversal = 0 AND c.status <> 3
                            AND (c.id = root.id OR c.source_root_id = root.id)
                          ORDER BY c.id DESC LIMIT 1)
      WHERE t.backfill_id = ?
      ORDER BY t.id`,
    [companyId, Number(backfillId)],
  )

  const problems = []
  if (rows.length === 0 && voucherRequired) {
    // 补录业务没写出任何资金流水：要么业务写入没走资金账户，要么 backfill_id 没传下去。
    // 两种都不该发生，如实报出来而不是当作「无需凭证」放过。
    problems.push('本次补录没有产生任何资金流水，无法确认凭证已生成')
  }
  for (const r of rows) {
    const amount = Number(r.amount)
    if (!r.root_id) {
      problems.push(`资金流水 #${r.txn_id}（¥${amount}）没有对应凭证`)
      continue
    }
    if (!r.voucher_id) {
      // 有根凭证但没有有效版本。两种成因的处置完全不同，不能笼统报「凭证缺失」：
      if (r.auto_reversal_id) {
        problems.push(`凭证 ${r.root_no} 已被来源重算自动冲销，但没有生成新的有效版本（需人工核查）`)
      } else {
        problems.push(`凭证 ${r.root_no} 已被人工冲销——人工冲销不会被自动恢复，请人工确认这笔补录该如何处理`)
      }
      continue
    }
    if (r.period !== postingPeriod) problems.push(`凭证 ${r.voucher_no} 落在 ${r.period}，应为补录当期 ${postingPeriod}`)
    if (Number(r.entry_count) < 2) problems.push(`凭证 ${r.voucher_no} 分录不足 2 条`)
    if (Math.abs(Number(r.debit_sum) - amount) > AMOUNT_EPS || Math.abs(Number(r.credit_sum) - amount) > AMOUNT_EPS) {
      problems.push(`凭证 ${r.voucher_no} 借贷（${Number(r.debit_sum)}/${Number(r.credit_sum)}）与该笔流水金额 ¥${amount} 不符`)
    }
  }
  return { ok: problems.length === 0, voucherRequired, txnCount: rows.length, problems }
}

async function markVoucherGenerated(id) {
  await pool.query(
    'UPDATE finance_period_backfills SET voucher_generated_at = NOW(), voucher_generate_error = NULL WHERE id = ?',
    [Number(id)],
  )
}

async function markVoucherError(id, message) {
  await pool.query(
    'UPDATE finance_period_backfills SET voucher_generate_error = ? WHERE id = ?',
    [String(message || '凭证生成失败').slice(0, 300), Number(id)],
  )
}

/** 生成凭证并核对到位；核对不过就抛（调用方据此决定是记错误还是向上报） */
async function generateAndVerifyVouchers(id, postingPeriod, operator, companyId = 1) {
  // 核销类补录不产生资金流水，也就没有凭证要生成——直接跳过。既不跑那一轮全期间重算，
  // 更不能把它判成失败：那会让一张本来就不需要凭证的单子永远挂着错误、每轮重试都失败。
  if (!await requiresVoucher(id, companyId)) {
    return { voucherStats: null, vouchersVerified: 0, voucherRequired: false }
  }
  const stats = await voucherSvc.generatePeriodVouchers({
    period: postingPeriod, userId: operator?.operatorId ?? null, companyId,
  })
  const check = await inspectBackfillVouchers(id, postingPeriod, companyId)
  if (!check.ok) {
    throw new AppError(
      `补录业务已记账，但对应的调整凭证未就绪：${check.problems.join('；')}`,
      500,
      'FINANCE_BACKFILL_VOUCHER_NOT_READY',
    )
  }
  return { voucherStats: stats, vouchersVerified: check.txnCount, voucherRequired: true }
}

/**
 * 「生成 → 核对 → 回填状态」的完整收尾，**不抛错**：失败原因写回申请单，由调用方决定怎么呈现。
 * 业务此时已经真实发生（钱动了），不能因为凭证这一步失败就把业务回滚——那是把账实不符变成
 * 账实两空。凭证生成是全量重算 + upsert 幂等（UNIQUE(company_id, source_type, source_id,
 * source_period)），重复重试不会多出凭证。
 */
async function settleVouchersFor(id, postingPeriod, operator, companyId) {
  try {
    const { voucherStats, vouchersVerified, voucherRequired } = await generateAndVerifyVouchers(id, postingPeriod, operator, companyId)
    await markVoucherGenerated(id)
    return { voucherStats, vouchersVerified, voucherRequired, voucherError: null }
  } catch (e) {
    const voucherError = e?.message || '凭证生成失败'
    await markVoucherError(id, voucherError)
    return { voucherStats: null, vouchersVerified: 0, voucherRequired: true, voucherError }
  }
}

/** 已执行但凭证没生成出来时的重试入口（审批页那个「重新生成凭证」按钮） */
async function regenerateVoucher(id, operator, companyId = 1) {
  const [[row]] = await pool.query(
    'SELECT id, executed_at, posting_period FROM finance_period_backfills WHERE id = ? AND company_id = ?',
    [Number(id), companyId],
  )
  if (!row) throw new AppError('补录申请不存在', 404)
  if (!row.executed_at) throw new AppError('该补录还没有记账，无需生成凭证', 409, 'FINANCE_BACKFILL_NOT_EXECUTED')
  if (!row.posting_period) {
    // 不猜期间：执行时一定会回填 posting_period，缺失说明数据被外部改动，交给人工
    throw new AppError('该申请单没有记录补录期间，无法生成凭证，请人工处理', 409, 'FINANCE_BACKFILL_NO_POSTING_PERIOD')
  }
  const vouchers = await settleVouchersFor(Number(id), row.posting_period, operator, companyId)
  if (vouchers.voucherError) {
    throw new AppError(vouchers.voucherError, 500, 'FINANCE_BACKFILL_VOUCHER_NOT_READY')
  }
  return { ...vouchers, application: await findOne(id, companyId) }
}

/**
 * 自动重试「业务已记账、调整凭证还没出来」的申请单（由 scheduler 定时调用）。
 *
 * 为什么必须有自动重试，而不能只留页面上的重试按钮：凭证失败后，钱已经动了、会计账上没有这笔，
 * 这正是本模块要消灭的状态。若只能等人想起来去点重试，它就会一直挂着——出纳以为流程走完了、
 * 审批人以为已经批准了，没有人会再回头看这张单子，于是「业务已动、会计无账」长期存在。
 * 定时扫描让它自己收敛；手动重试入口仍保留，财务当场发现可以立即重试，不必等下一轮。
 *
 * 逐张独立 try/catch：一张失败不影响其它张，失败原因写回该单，下一轮继续试。
 * 期间已结账这类原因不会自愈，会持续停在 error 上等人工处理——这是刻意的：系统不该自己
 * 替会计决定去动一个已封的期间。
 */
async function retryPendingVoucherGeneration({ limit = 50 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, company_id, posting_period FROM finance_period_backfills
      WHERE executed_at IS NOT NULL AND voucher_generated_at IS NULL
      ORDER BY id LIMIT ?`,
    [Number(limit)],
  )
  const result = { scanned: rows.length, succeeded: 0, failed: 0 }
  for (const r of rows) {
    const companyId = Number(r.company_id) || 1
    if (!r.posting_period) {
      await markVoucherError(Number(r.id), '申请单没有记录补录期间，无法自动生成凭证，请人工处理')
      result.failed += 1
      continue
    }
    try {
      const { vouchersVerified } = await generateAndVerifyVouchers(Number(r.id), r.posting_period, null, companyId)
      await markVoucherGenerated(Number(r.id))
      result.succeeded += 1
      logger.info(`补录申请 ${r.id} 的调整凭证已自动补齐（${vouchersVerified} 笔流水）`, { id: r.id }, 'accounting')
    } catch (e) {
      await markVoucherError(Number(r.id), e?.message || '凭证生成失败')
      result.failed += 1
    }
  }
  return result
}

module.exports = {
  STATUS,
  findAll,
  findOne,
  approve,
  reject,
  cancel,
  execute,
  regenerateVoucher,
  retryPendingVoucherGeneration,
  // 导出供对账/测试复用：判定「某张申请单的调整凭证是否真的到位」是审计与排障都要用的能力，
  // 不希望测试或对账脚本再抄一份 SQL（抄一份就会与核对口径漂移）。
  inspectBackfillVouchers,
}
