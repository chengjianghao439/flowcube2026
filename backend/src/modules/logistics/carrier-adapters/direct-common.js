'use strict'

function failure(message, { code = 'WAYBILL_CONFIG_INVALID', uncertain = false } = {}) {
  return Object.assign(new Error(message), { code, uncertain })
}
function required(value, label, max = 100) {
  const s = String(value ?? '').trim()
  if (!s || s.length > max) throw failure(`请填写有效的${label}（最多 ${max} 字）`)
  return s
}
function endpoint(value, platform, mode = 'sandbox') {
  let url
  try { url = new URL(value) } catch { throw failure('请配置官方接口地址') }
  const sfHost = mode === 'production' ? 'sfapi.sf-express.com' : 'sfapi-sbox.sf-express.com'
  const allowed = platform === 'sf' ? url.hostname === sfHost
    : /(^|\.)deppon\.com(?:\.cn)?$/.test(url.hostname)
  if (!['sandbox', 'production'].includes(mode) || !allowed || url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw failure('接口必须是与所选环境对应的官方 HTTPS 地址，不允许第三方网关')
  }
  if (process.env.NODE_ENV === 'production' && mode !== 'production') throw failure('生产服务不能使用沙箱运单')
  return url.toString()
}
function credentials(credential, platform, lookup = false) {
  required(credential?.appId, '开放平台接入编码', 64)
  required(credential?.appKey, '开放平台校验密钥', 256)
  const mode = credential.mode || 'sandbox'
  const sfDefault = mode === 'production' ? 'https://sfapi.sf-express.com/std/service' : 'https://sfapi-sbox.sf-express.com/std/service'
  return endpoint(platform === 'sf' ? credential.apiBase || sfDefault : lookup ? credential.queryApiBase : credential.apiBase, platform, mode)
}
function contact(value, label, structured = false) {
  const c = value || {}
  const result = { name: required(c.name, `${label}姓名`, 32), phone: required(c.phone, `${label}电话`, 20), address: required(c.address, `${label}地址`, 200) }
  for (const key of ['province', 'city', 'county']) {
    result[key] = structured ? required(c[key], `${label}${({ province: '省份', city: '城市', county: '区县' })[key]}`, 32) : String(c[key] || '').trim()
  }
  if (!/^[+\d ()-]{5,20}$/.test(result.phone)) throw failure(`请填写有效的${label}电话`)
  return result
}
function shipment(payload, platform) {
  const s = payload.shipment || {}
  return { sender: contact(s.sender, '寄件人', platform === 'deppon'), receiver: contact(s.receiver, '收件人', platform === 'deppon'), cargoName: required(s.cargoName, '托寄物名称', 20) }
}
async function postForm(url, form) {
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw failure('平台暂未返回可确认的结果，请查询原单', { uncertain: true, code: 'WAYBILL_RESULT_UNKNOWN' })
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 1024 * 1024) { await reader.cancel(); throw new Error('response too large') }
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    // 不透传 fetch、平台报文、签名或地址，网络异常不能证明平台未受理。
    throw failure('平台响应异常或超时，请查询原单，系统不会重复下单', { uncertain: true, code: 'WAYBILL_RESULT_UNKNOWN' })
  }
}
function tracking(value) {
  const s = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(s)) throw failure('原单尚未返回唯一运单号，请核实平台结果', { uncertain: true, code: 'WAYBILL_RESULT_UNKNOWN' })
  return s
}
function packageCount(payload) {
  const count = Number(payload.waybill.packageCount ?? 1)
  if (!Number.isInteger(count) || count < 1 || count > 30) throw failure('每批实际打包件数必须在 1–30 之间')
  return count
}
function trackingResult(values, payload, primary = null) {
  const trackingNos = values.map(tracking)
  if (trackingNos.length !== packageCount(payload) || new Set(trackingNos).size !== trackingNos.length || (primary && !trackingNos.includes(primary))) {
    throw failure('平台运单数与实际箱数不一致，请核实原单', { uncertain: true })
  }
  return { trackingNo: primary || trackingNos[0], trackingNos, freight: null, printData: null }
}
module.exports = { failure, required, endpoint, credentials, shipment, postForm, tracking, packageCount, trackingResult }
