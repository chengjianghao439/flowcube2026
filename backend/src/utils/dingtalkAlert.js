/**
 * 钉钉机器人告警推送（2026-08-22 功能：库存/账款预警主动推送）。
 *
 * 与 scripts/lib/ops-common.sh 的 dingtalk_send 同源逻辑（运维脚本侧），这里是后端业务侧：
 * scheduler 的预警 worker 命中高危事件（逾期应收应付/低于补货点/临期批次）时推送。
 *
 * 配置：
 *   DINGTALK_ALERT_WEBHOOK — 群机器人 webhook（必填，未配置静默跳过）
 *   DINGTALK_ALERT_SECRET  — 加签密钥（推荐）。配置后按钉钉官方加签算法
 *     （timestamp+"\n"+secret → HmacSHA256 → Base64 → URL 编码）追加到 webhook；
 *     未配置则按普通 webhook 直发（不推荐，任何拿到 URL 的人都能发）。
 */

const crypto = require('crypto')
const logger = require('./logger')

const DINGTALK_WEBHOOK = () => String(process.env.DINGTALK_ALERT_WEBHOOK || '').trim()
const DINGTALK_SECRET = () => String(process.env.DINGTALK_ALERT_SECRET || '').trim()

/**
 * 钉钉加签：timestamp + "\n" + secret → HmacSHA256 → base64 → urlencode
 * 官方算法（https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages）
 */
function buildSignedUrl(webhook) {
  const secret = DINGTALK_SECRET()
  if (!secret) return webhook
  const timestamp = Date.now()
  const stringToSign = `${timestamp}\n${secret}`
  const hmac = crypto.createHmac('sha256', secret).update(stringToSign, 'utf8').digest('base64')
  const sign = encodeURIComponent(hmac)
  const sep = webhook.includes('?') ? '&' : '?'
  return `${webhook}${sep}timestamp=${timestamp}&sign=${sign}`
}

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
    const url = new URL(buildSignedUrl(webhook))
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

module.exports = { sendDingtalkAlert, buildSignedUrl }
