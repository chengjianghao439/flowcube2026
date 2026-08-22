/**
 * 钉钉机器人告警推送（2026-08-22 功能：库存/账款预警主动推送）。
 *
 * 与 scripts/lib/ops-common.sh 的 dingtalk_send 同源逻辑（运维脚本侧），这里是后端业务侧：
 * scheduler 的预警 worker 命中高危事件（逾期应收应付/低于补货点/临期批次）时推送。
 * 未配置 DINGTALK_ALERT_WEBHOOK 时静默跳过（不阻塞调度器）。
 */

const logger = require('./logger')

const DINGTALK_WEBHOOK = () => String(process.env.DINGTALK_ALERT_WEBHOOK || '').trim()

/**
 * 推送一条钉钉告警（markdown 格式）。
 * @param {string} title 标题
 * @param {string} text 正文（markdown）
 * @returns {Promise<boolean>} 是否推送成功（未配置也返回 false，不算失败）
 */
async function sendDingtalkAlert(title, text) {
  const webhook = DINGTALK_WEBHOOK()
  if (!webhook) return false
  try {
    const url = new URL(webhook)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { title, text },
      }),
      signal: AbortSignal.timeout(5000),
    })
    const body = await res.json().catch(() => ({}))
    if (body.errcode !== 0) {
      logger.warn(`[dingtalk] 推送失败 errcode=${body.errcode} errmsg=${body.errmsg}`, {}, 'DingtalkAlert')
      return false
    }
    return true
  } catch (e) {
    // 外部 I/O 失败不炸调度器，记日志即可
    logger.warn(`[dingtalk] 推送异常：${e.message}`, {}, 'DingtalkAlert')
    return false
  }
}

module.exports = { sendDingtalkAlert }
