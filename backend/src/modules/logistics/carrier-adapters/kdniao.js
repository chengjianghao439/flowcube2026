/**
 * 快递鸟（KDNiao）电子面单适配器 —— 真实平台对接骨架（文档 06）。
 *
 * ⚠️ 本地/离线**无法端到端验收**：需要快递鸟商户的 EBusinessID + AppKey（走 env，见 config/env.getWaybillCredential），
 * 且要真实网络到快递鸟网关。缺凭据时本适配器**明确抛错**（不静默失败、不假装成功），
 * 由 worker 把运单置为"取号失败"并留错误信息。真实联调请在 .env 配置：
 *   WAYBILL_<credentialRef>_APP_ID     -> 快递鸟 EBusinessID
 *   WAYBILL_<credentialRef>_APP_KEY    -> 快递鸟 AppKey
 *   WAYBILL_<credentialRef>_API_BASE   -> 网关地址（如 https://api.kdniao.com/api/EOrderService）
 * 承运商侧 platform_carrier 填快递鸟的快递公司编码（如 SF/YTO/ZTO），monthly_account 填月结账号。
 *
 * 本文件保留了快递鸟的**签名与报文结构**（RequestData + RequestType + DataSign=Base64(MD5(data+appKey))），
 * 以便真实联调时直接可用；HTTP 只在这里、且只被 worker（事务外）调用。
 */
const crypto = require('crypto')

const REQUEST_TYPE_CREATE = '1007' // 电子面单打印（云打印）
const REQUEST_TYPE_TRACK = '1002'  // 即时查询轨迹

function assertConfigured(credential, apiBase) {
  if (!credential || !credential.appId || !credential.appKey) {
    const err = new Error('快递鸟凭据未配置（需 EBusinessID/AppKey），本地无法取号；请在 .env 配置 WAYBILL_<ref>_APP_ID/APP_KEY 或改用 mock 平台联调')
    err.code = 'WAYBILL_CREDENTIAL_MISSING'
    throw err
  }
  if (!apiBase) {
    const err = new Error('快递鸟网关地址未配置（WAYBILL_<ref>_API_BASE）')
    err.code = 'WAYBILL_API_BASE_MISSING'
    throw err
  }
}

// 快递鸟签名：Base64( MD5( urlencode?无：直接 data+appKey ) )。data 为 RequestData 的 JSON 串。
function sign(dataJson, appKey) {
  const md5 = crypto.createHash('md5').update(dataJson + appKey, 'utf8').digest()
  return md5.toString('base64')
}

async function postForm(apiBase, form, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = new URLSearchParams(form).toString()
    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: controller.signal,
    })
    if (!resp.ok) {
      const err = new Error(`快递鸟网关 HTTP ${resp.status}`)
      err.code = 'WAYBILL_HTTP_ERROR'
      throw err
    }
    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

async function createOrder(payload) {
  const { credential } = payload
  const apiBase = credential?.apiBase
  assertConfigured(credential, apiBase)
  const wb = payload?.waybill || {}
  const carrier = payload?.carrier || {}

  const requestData = {
    OrderCode: wb.waybillNo,                 // 用内部单号作 orderCode，平台按 orderCode 幂等
    ShipperCode: carrier.platformCarrier,    // 快递公司编码
    PayType: 3,                              // 3=月结
    ExpType: 1,                              // 标准快递
    CustomerName: carrier.monthlyAccount,    // 月结客户编码/账号
    Receiver: {
      Name: wb.receiverName,
      Mobile: wb.receiverPhone,
      Address: wb.receiverAddress,
    },
    Commodity: [{ GoodsName: '商品' }],
    IsReturnPrintTemplate: 1,                // 要求返回云面单打印数据
  }
  const dataJson = JSON.stringify(requestData)
  const form = {
    RequestData: dataJson,
    EBusinessID: credential.appId,
    RequestType: REQUEST_TYPE_CREATE,
    DataSign: sign(dataJson, credential.appKey),
    DataType: '2',
  }
  const json = await postForm(apiBase, form)
  if (!json || json.Success === false) {
    const err = new Error(`快递鸟取号失败：${json?.Reason || '未知错误'}`)
    err.code = 'WAYBILL_PLATFORM_REJECTED'
    throw err
  }
  const order = json.Order || {}
  const printTemplate = json.PrintTemplate || ''
  // 快递鸟云面单模板通常是 HTML/图片，热敏 ZPL 需商户模板配置为 ZPL 输出；
  // 若返回非 ZPL，标记为 image/pdf 由前端本地打印（见文档 5.4），不塞进 ZPL 队列。
  const printData = /\^XA/.test(printTemplate)
    ? { type: 'zpl', content: printTemplate }
    : { type: 'image_url', content: printTemplate }
  return {
    trackingNo: order.LogisticCode,
    freight: order.Freight != null ? Number(order.Freight) : null,
    printData,
    raw: json,
  }
}

async function queryTrack(trackingNo, ctx = {}) {
  const credential = ctx.credential
  const apiBase = credential?.apiBase
  assertConfigured(credential, apiBase)
  const requestData = { ShipperCode: ctx.platformCarrier, LogisticCode: trackingNo }
  const dataJson = JSON.stringify(requestData)
  const form = {
    RequestData: dataJson,
    EBusinessID: credential.appId,
    RequestType: REQUEST_TYPE_TRACK,
    DataSign: sign(dataJson, credential.appKey),
    DataType: '2',
  }
  const json = await postForm(apiBase, form)
  const traces = Array.isArray(json?.Traces) ? json.Traces : []
  return traces.map(t => ({
    eventTime: t.AcceptTime,
    statusCode: t.Action || null,
    description: t.AcceptStation,
    location: t.Location || null,
  }))
}

module.exports = { createOrder, queryTrack }
