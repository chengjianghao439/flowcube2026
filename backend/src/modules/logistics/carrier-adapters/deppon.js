'use strict'
const crypto = require('node:crypto')
const { failure, required, credentials, shipment, postForm, packageCount, trackingResult } = require('./direct-common')

function prepareOrder(payload) {
  credentials(payload.credential, 'deppon')
  credentials(payload.credential, 'deppon', true) // 开通查原单能力后才允许自动下单
  const product = required(payload.carrier?.productCode, '德邦产品编码', 32)
  if (!['XJTK', 'DJTK', 'XJBK', 'DJBK', 'XJTH', 'DJTH', 'YTYDS'].includes(product)) throw failure('请选择与德邦约定的快递或大货产品编码')
  const deliveryType = required(payload.carrier?.deliveryType, '德邦送货方式', 1)
  if (!['1', '3', '4'].includes(deliveryType)) throw failure('德邦送货方式应为自提、送货不上楼或送货上楼')
  const s = shipment(payload, 'deppon')
  const freightType = Number(payload.waybill.freightType)
  if (freightType === 3) throw failure('德邦当前不支持第三方付，请选择寄付或到付')
  if (![1, 2].includes(freightType)) throw failure('请选择订单运费方式')
  const prefix = required(payload.credential.orderPrefix, '德邦渠道单号前缀', 20)
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw failure('德邦渠道单号前缀格式不正确')
  const orderId = required(payload.waybill.waybillNo, '内部运单号', 32)
  const logisticID = required(prefix + orderId, '德邦渠道单号（含前缀）', 32)
  const toContact = c => ({ name: c.name, mobile: c.phone, province: c.province, city: c.city, county: c.county, address: c.address })
  return {
    companyCode: payload.credential.appId, logisticID, custOrderNo: orderId,
    customerCode: required(payload.carrier?.monthlyAccount, '德邦月结账号', 32),
    orderType: '2', transportType: product, needTraceInfo: 2, payType: freightType === 1 ? '2' : '1',
    sender: toContact(s.sender), receiver: toContact(s.receiver),
    // 德邦此字段为单件/均重（kg）；按用户约定默认 1，最终实重由快递员确认。
    packageInfo: { cargoName: s.cargoName, totalNumber: packageCount(payload), totalWeight: 1, deliveryType },
    gmtCommit: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' '), isOut: 'N',
  }
}
async function call(payload, data, lookup) {
  const url = credentials(payload.credential, 'deppon', lookup)
  const params = JSON.stringify(data)
  const timestamp = String(Date.now())
  const hex = crypto.createHash('md5').update(params + payload.credential.appKey + timestamp).digest('hex')
  const result = await postForm(url, { params, timestamp, companyCode: payload.credential.appId, digest: Buffer.from(hex, 'utf8').toString('base64') })
  if (result?.result !== true && result?.result !== 'true') throw failure('德邦未返回成功结果，请在开放平台核实原单', { uncertain: true, code: 'WAYBILL_RESULT_UNKNOWN' })
  if (lookup) {
    if (result.data?.custOrderNo !== payload.waybill.waybillNo) throw failure('德邦查询订单归属不一致，请核实原单', { uncertain: true })
    // 查询契约只保证全号集合，不保证母号优先；首号仅用作列表代表单号。
    return trackingResult(String(result.data.mailNo || '').split(','), payload)
  }
  if (result.logisticID && result.logisticID !== data.logisticID) throw failure('德邦返回订单归属不一致，请核实原单', { uncertain: true })
  return trackingResult(String(result.mailNo || '').split(','), payload, result.parentMailNo || null)
}
async function createOrder(payload) { return call(payload, payload.preparedRequest || prepareOrder(payload), false) }
async function lookupOrder(payload) { return call(payload, { custOrderNo: required(payload.waybill.waybillNo, '内部运单号', 32) }, true) }
module.exports = { prepareOrder, createOrder, lookupOrder }
