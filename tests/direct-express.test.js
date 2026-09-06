'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const base = path.resolve(__dirname, '../backend/src/modules/logistics/carrier-adapters')
function adapter(name) {
  const file = path.join(base, `${name}.js`)
  assert.ok(fs.existsSync(file), `缺少 ${name} 真实接口实现`)
  return require(file)
}
function payload(platform = 'sf') {
  return {
    waybill: { waybillNo: 'WB20260906001', freightType: 1 },
    shipment: {
      sender: { name: '测试寄件人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试仓库1号' },
      receiver: { name: '测试收件人', phone: '13900000000', province: '上海', city: '上海市', county: '青浦区', address: '测试地址2号' },
      cargoName: '测试商品', weight: 12.5,
    },
    carrier: { monthlyAccount: 'TEST_MONTHLY', productCode: platform === 'sf' ? '2' : 'DJBK', deliveryType: '3' },
    credential: { appId: 'TEST_APP', appKey: 'test-key-!*~空 格', orderPrefix: 'TEST_', mode: 'sandbox', apiBase: platform === 'sf' ? 'https://sfapi-sbox.sf-express.com/std/service' : 'https://sandbox.deppon.com/test/create', queryApiBase: 'https://sandbox.deppon.com/test/query' },
  }
}
function fakeFetch(t, body, inspect = () => {}) {
  t.mock.method(global, 'fetch', async (url, options) => {
    inspect(url, options, new URLSearchParams(options.body))
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}
function sfSuccess(id = 'WB20260906001') {
  return { apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: true, msgData: { orderId: id, waybillNoInfoList: [{ waybillType: 1, waybillNo: 'SF_TEST_001' }] } }) }
}
test('顺丰按官方SDK签名，月结寄付、订单产品、寄收件及一箱一单正确发送', async t => {
  const p = payload()
  fakeFetch(t, sfSuccess(), (url, options, form) => {
    assert.equal(url, p.credential.apiBase)
    assert.equal(options.redirect, 'error')
    const encoded = encodeURIComponent(form.get('msgData') + form.get('timestamp') + p.credential.appKey).replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+')
    assert.equal(form.get('msgDigest'), crypto.createHash('md5').update(encoded).digest('base64'))
    assert.equal(form.get('serviceCode'), 'EXP_RECE_CREATE_ORDER')
    const req = JSON.parse(form.get('msgData'))
    assert.equal(req.orderId, p.waybill.waybillNo)
    assert.equal(req.monthlyCard, 'TEST_MONTHLY')
    assert.equal(req.payMethod, 1)
    assert.equal(req.expressTypeId, 2)
    assert.equal(req.parcelQty, 1)
    assert.equal(req.totalWeight, 1)
    assert.equal(req.contactInfoList[0].contactType, 1)
    assert.equal(req.contactInfoList[1].address, '测试地址2号')
    assert.equal(req.cargoDetails[0].name, '测试商品')
    assert.equal(req.isDocall, 0)
  })
  assert.equal((await adapter('sf').createOrder(p)).trackingNo, 'SF_TEST_001')
})
test('顺丰结果查询只调用查单服务，验证订单归属', async t => {
  fakeFetch(t, sfSuccess(), (_url, _options, form) => assert.equal(form.get('serviceCode'), 'EXP_RECE_SEARCH_ORDER_RESP'))
  assert.equal((await adapter('sf').lookupOrder(payload())).trackingNo, 'SF_TEST_001')
})
test('顺丰不能接受其他订单号的成功回执', async t => {
  fakeFetch(t, sfSuccess('OTHER_ORDER'))
  await assert.rejects(adapter('sf').createOrder(payload()), e => e.uncertain === true)
})
test('顺丰重复下单/HTTP未知结果必须进入查询恢复，错误内容不泄露平台响应', async t => {
  fakeFetch(t, { apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: false, errorCode: '8016', errorMsg: 'secret-test-phone' }) })
  await assert.rejects(adapter('sf').createOrder(payload()), e => e.uncertain === true && !e.message.includes('secret-test-phone'))
})
test('德邦签名使用MD5十六进制文本再Base64，并按月结/送货产品发送', async t => {
  const p = payload('deppon')
  fakeFetch(t, { result: 'true', resultCode: '1000', logisticID: 'TEST_WB20260906001', mailNo: 'DPK_TEST_001' }, (_url, _options, form) => {
    const hex = crypto.createHash('md5').update(form.get('params') + p.credential.appKey + form.get('timestamp')).digest('hex')
    assert.equal(form.get('digest'), Buffer.from(hex).toString('base64'))
    const req = JSON.parse(form.get('params'))
    assert.equal(req.logisticID, 'TEST_WB20260906001')
    assert.equal(req.custOrderNo, 'WB20260906001')
    assert.equal(req.customerCode, 'TEST_MONTHLY')
    assert.equal(req.orderType, '2')
    assert.equal(req.transportType, 'DJBK')
    assert.equal(req.payType, '2')
    assert.equal(req.needTraceInfo, 2)
    assert.equal(req.packageInfo.totalNumber, 1)
    assert.equal(req.packageInfo.totalWeight, 1)
    assert.equal(req.packageInfo.deliveryType, '3')
    assert.equal(req.sender.mobile, p.shipment.sender.phone)
  })
  assert.equal((await adapter('deppon').createOrder(p)).trackingNo, 'DPK_TEST_001')
})
test('德邦按客户订单号查原单，不能再次create追加子件', async t => {
  fakeFetch(t, { result: 'true', data: { custOrderNo: 'WB20260906001', mailNo: 'DPK_TEST_001' } }, (url, _options, form) => {
    assert.equal(url, payload('deppon').credential.queryApiBase)
    assert.deepEqual(JSON.parse(form.get('params')), { custOrderNo: 'WB20260906001' })
  })
  assert.equal((await adapter('deppon').lookupOrder(payload('deppon'))).trackingNo, 'DPK_TEST_001')
})
test('德邦查询多运单结果要求人工核实，不能随便取第一个', async t => {
  fakeFetch(t, { result: 'true', data: { custOrderNo: 'WB20260906001', mailNo: 'DPK_1,DPK_2' } })
  await assert.rejects(adapter('deppon').lookupOrder(payload('deppon')), e => e.uncertain === true)
})
for (const platform of ['sf', 'deppon']) {
  test(`${platform} 缺少产品/凭据/地址时不发网络请求`, async t => {
    let calls = 0
    t.mock.method(global, 'fetch', async () => { calls++; throw new Error('must not send') })
    for (const mutate of [p => { p.carrier.productCode = '' }, p => { p.credential.appKey = '' }, p => { p.shipment.sender.address = '' }]) {
      const p = payload(platform); mutate(p)
      await assert.rejects(adapter(platform).createOrder(p), e => e.uncertain === false)
    }
    assert.equal(calls, 0)
  })
  test(`${platform} 网络超时为未知结果而不是普通失败`, async t => {
    t.mock.method(global, 'fetch', async () => { throw new Error('network internal secret') })
    await assert.rejects(adapter(platform).createOrder(payload(platform)), e => e.uncertain === true && !e.message.includes('secret'))
  })
  test(`${platform} 拒绝第三方网关避免凭据与地址泄露`, async t => {
    let calls = 0
    t.mock.method(global, 'fetch', async () => { calls++ })
    const p = payload(platform); p.credential.apiBase = 'https://example.org/collect'
    await assert.rejects(adapter(platform).createOrder(p), e => e.uncertain === false)
    assert.equal(calls, 0)
  })
}
test('两家下单重量固定默认1，无需手填且不受箱数或旧免重量配置影响', () => {
  for (const platform of ['sf', 'deppon']) {
    for (const count of [1, 3, 30]) {
      for (const legacyMode of [undefined, 'omit', 'zero']) {
        const p = payload(platform)
        p.waybill.packageCount = count
        p.credential.deferredWeightMode = legacyMode
        const request = adapter(platform).prepareOrder(p)
        assert.equal(platform === 'sf' ? request.totalWeight : request.packageInfo.totalWeight, 1)
        assert.equal(platform === 'sf' ? request.parcelQty : request.packageInfo.totalNumber, count)
        delete p.shipment.weight
        const withoutWeight = adapter(platform).prepareOrder(p)
        assert.equal(platform === 'sf' ? withoutWeight.totalWeight : withoutWeight.packageInfo.totalWeight, 1)
      }
    }
  }
})
test('德邦第三方付未配置时拒绝下单', async t => {
  let calls = 0
  t.mock.method(global, 'fetch', async () => { calls++ })
  const p = payload('deppon'); p.waybill.freightType = 3
  await assert.rejects(adapter('deppon').createOrder(p), /第三方/)
  assert.equal(calls, 0)
})
for (const platform of ['sf', 'deppon']) {
  test(`${platform} 件数来自实际箱数，多箱返回全部单号且数量必须一致`, async t => {
    const p = payload(platform); p.waybill.packageCount = 3
    const numbers = platform === 'sf' ? ['SF1', 'SF2', 'SF3'] : ['DPK1', 'DPK2', 'DPK3']
    const response = platform === 'sf'
      ? { apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: true, msgData: { orderId: p.waybill.waybillNo, waybillNoInfoList: numbers.map((waybillNo, i) => ({ waybillNo, waybillType: i === 0 ? 1 : 2 })) } }) }
      : { result: 'true', logisticID: 'TEST_WB20260906001', mailNo: numbers.join(','), parentMailNo: numbers[0] }
    fakeFetch(t, response, (_url, _options, form) => {
      const req = JSON.parse(form.get(platform === 'sf' ? 'msgData' : 'params'))
      assert.equal(platform === 'sf' ? req.parcelQty : req.packageInfo.totalNumber, 3)
      assert.equal(platform === 'sf' ? req.totalWeight : req.packageInfo.totalWeight, 1)
    })
    const result = await adapter(platform).createOrder(p)
    assert.deepEqual(result.trackingNos, numbers)
    assert.equal(result.trackingNo, numbers[0])
    p.waybill.packageCount = 2
    await assert.rejects(adapter(platform).createOrder(p), e => e.uncertain === true)
  })
}
test('德邦合法多箱原单查询保存全号，首号仅作为代表单号', async t => {
  const p = payload('deppon'); p.waybill.packageCount = 2
  fakeFetch(t, { result: 'true', data: { custOrderNo: p.waybill.waybillNo, mailNo: 'DPK_CHILD,DPK_PARENT' } })
  const result = await adapter('deppon').lookupOrder(p)
  assert.deepEqual(result.trackingNos, ['DPK_CHILD', 'DPK_PARENT'])
  assert.equal(result.trackingNo, 'DPK_CHILD')
})
