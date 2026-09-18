'use strict'
/**
 * 承运商「账号 / 快递公司变更」的公共闸门（2026-09-18 审计 [9]）。
 *
 * carriers 表上的月结账号、凭据引用、默认服务与 waybill_enabled 有两条写路径：
 *   ① 快递账号绑定页 → carriers.binding.save（带 revision CAS + canEnable 闸门）；
 *   ② 承运商管理页   → carriers.service.update（CRUD 高级入口）。
 * 两条路径的判定必须完全一致，否则其中一条就是绕过闸门的后门——历史上 update 正是如此：
 * 它无事务、无行锁，还能一次把月结账号连同启用开关改掉。判定抽到这里由两边共用。
 *
 * 调用前提：已在事务内，且已对 carriers 行 `SELECT ... FOR UPDATE`。
 */
const AppError = require('../../utils/AppError')

// 「还在快递公司手里」的运单状态：换账号/换平台后无法再用原账号核对或作废的，都算待处理。
const PENDING_WAYBILL_STATUSES = [1, 2, 4, 6]

/**
 * 变更月结账号或快递公司前的闸门：必须先暂停取号，且没有待处理运单。
 * @param {object}  conn           事务连接
 * @param {object}  row            加锁后的 carriers 行
 * @param {boolean} accountChanged 月结账号或快递公司是否**真的**发生变化
 */
async function assertAccountChangeAllowed(conn, row, accountChanged) {
  if (!accountChanged) return
  if (row.waybill_enabled) throw new AppError('更换月结账号前请先暂停自动下单', 409)
  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM logistics_waybills WHERE carrier_id=? AND status IN (?,?,?,?)`,
    [row.id, ...PENDING_WAYBILL_STATUSES],
  )
  if (Number(total)) throw new AppError('该承运商尚有待处理运单，请核实原单后再更换月结账号', 409)
}

/**
 * 「账号是否变化」的统一口径（两条写路径必须同口径，否则闸门会被形式上的差异绕开）。
 * 未设置平台的承运商首次选平台不算换账号——那只是补全声明，monthly 变化会单独命中。
 */
function accountChangedOf(row, { platformCode, monthlyAccount }) {
  return (row.monthly_account || '') !== (monthlyAccount || '')
    || (!!row.platform_code && row.platform_code !== platformCode)
}

module.exports = { assertAccountChangeAllowed, accountChangedOf, PENDING_WAYBILL_STATUSES }
