'use strict'
// 官方合同与签名来源见 docs/direct-express-2026-09-06.md。
const crypto = require('node:crypto')
const { failure, required, credentials, shipment, postForm, packageCount, trackingResult } = require('./direct-common')

function prepareOrder(payload) {
  credentials(payload.credential, 'sf')
  const product = required(payload.carrier?.productCode, '顺丰产品编码', 5)
  if (!/^\d+$/.test(product) || Number(product) < 1) throw failure('顺丰产品编码必须为已开通的正整数编码')
  const s = shipment(payload, 'sf')
  const payMethod = Number(payload.waybill.freightType)
  if (![1, 2, 3].includes(payMethod)) throw failure('请选择订单运费方式')
  // 第三方月结账户不能擅自使用寄方默认月结卡。
  if (payMethod === 3) throw failure('第三方付需另外确认第三方月结账号，当前请使用寄付或到付')
  const req = {
    language: 'zh-CN', orderId: required(payload.waybill.waybillNo, '内部运单号', 64),
    monthlyCard: required(payload.carrier?.monthlyAccount, '顺丰月结账号', 20),
    // 按用户约定默认传 1 千克；仅用于下单，最终实重由快递员确认。
    payMethod, expressTypeId: Number(product), parcelQty: packageCount(payload), totalWeight: 1, isDocall: 0,
    cargoDetails: [{ name: s.cargoName, count: packageCount(payload), unit: '箱' }],
    contactInfoList: [s.sender, s.receiver].map((c, index) => ({ contactType: index + 1, country: 'CN', contact: c.name, mobile: c.phone, province: c.province, city: c.city, county: c.county, address: c.address })),
  }
  return req
}
async function call(payload, serviceCode, data) {
  const url = credentials(payload.credential, 'sf')
  const msgData = JSON.stringify(data)
  const timestamp = String(Date.now())
  // 与官方 PHP urlencode 相同：空格为 +，对拼接原文编码后取 MD5 二进制。
  const encoded = new URLSearchParams({ x: msgData + timestamp + payload.credential.appKey }).toString().slice(2).replace(/\*/g, '%2A')
  const result = await postForm(url, { partnerID: payload.credential.appId, requestID: crypto.randomUUID(), serviceCode, timestamp, msgData, msgDigest: crypto.createHash('md5').update(encoded).digest('base64') })
  if (result?.apiResultCode !== 'A1000') throw failure('顺丰网关未确认受理，请核对开放平台权限后查询原单', { uncertain: true, code: 'WAYBILL_RESULT_UNKNOWN' })
  let business
  try { business = typeof result.apiResultData === 'string' ? JSON.parse(result.apiResultData) : result.apiResultData } catch { /* 下方按未知结果处理 */ }
  if (business?.success !== true) {
    const code = /^[A-Za-z0-9_-]{1,20}$/.test(String(business?.errorCode)) ? String(business.errorCode) : 'UNKNOWN'
    throw failure(`顺丰未返回成功结果（${code}），请在开放平台核实`, { uncertain: true, code: 'WAYBILL_RESULT_UNKNOWN' })
  }
  const info = business.msgData
  if (!info || info.orderId !== payload.waybill.waybillNo) throw failure('顺丰返回订单归属不一致，请核实原单', { uncertain: true })
  const numbers = info.waybillNoInfoList
  const primary = Array.isArray(numbers) ? numbers.filter(n => Number(n.waybillType) === 1) : []
  if (primary.length !== 1) throw failure('顺丰尚未返回唯一母运单号，请核实原单', { uncertain: true })
  return trackingResult(numbers.map(n => n.waybillNo), payload, primary[0].waybillNo)
}
async function createOrder(payload) { return call(payload, 'EXP_RECE_CREATE_ORDER', payload.preparedRequest || prepareOrder(payload)) }
async function lookupOrder(payload) { return call(payload, 'EXP_RECE_SEARCH_ORDER_RESP', { orderId: required(payload.waybill.waybillNo, '内部运单号', 64), searchType: '1', language: 'zh-CN' }) }
module.exports = { prepareOrder, createOrder, lookupOrder }
