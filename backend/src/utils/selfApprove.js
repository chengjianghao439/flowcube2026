const { pool } = require('../config/db')
const AppError = require('./AppError')

/**
 * 「申请人不得审批自己提交的单」内控的统一入口。
 *
 * 背景：全仓原本有 5 处各写一遍的自批检查（费用报销 / 采购单 / 采购申请 / 授信放行，
 * 以及 approvalEngine 在提交时把申请人剔出审批人名单）。它们都是硬性禁止、无任何豁免，
 * 结果单人或小团队场景下这些单据永远走不完——报销卡在付款前（付款账户选择器不出现），
 * 改价申请更早，提交那一刻就报「没有可用的审批人」。
 *
 * 现在改为**按用户授予**豁免：`sys_users.allow_self_approve = 1` 的人可以审批自己的单。
 * 为什么是用户属性而不是全局开关——谁能自批是人的属性（老板、单人记账员），不是系统的
 * 属性；逐人授予也留下了「谁被豁免了内控」的明确记录。默认 0，升级无行为变化。
 *
 * 该字段只有超管能改（users.service 层校验），否则持 user.update 权限者可自我豁免。
 *
 * 不做缓存：审批是低频动作，且缓存会让「刚收回某人的自批权」延迟生效——
 * 内控收紧必须立即生效，不能等 TTL。
 */
async function canSelfApprove(userId) {
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0) return false
  const [[row]] = await pool.query(
    'SELECT allow_self_approve FROM sys_users WHERE id=? AND deleted_at IS NULL LIMIT 1',
    [id],
  )
  return Number(row?.allow_self_approve) === 1
}

/**
 * 若操作人就是申请人且没有自批豁免，则抛 403。
 * @param applicantId 单据的申请人/提交人 id
 * @param operatorId  当前操作人 id
 * @param message     业务自定义的中文错误文案（如「不能审批自己提交的报销单，请由他人审批」）
 */
async function assertNotSelfApproval(applicantId, operatorId, message) {
  if (Number(applicantId) !== Number(operatorId)) return
  if (await canSelfApprove(operatorId)) return
  throw new AppError(`${message}（如需自行审批，请让管理员在用户管理中开启该账号的「允许自行审批」）`, 403, 'SELF_APPROVAL_DENIED')
}

module.exports = { canSelfApprove, assertNotSelfApproval }
