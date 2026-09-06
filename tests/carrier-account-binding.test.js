'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const file = require('node:path').resolve(__dirname, '../backend/src/modules/carriers/carriers.binding.js')
function load() { assert.ok(fs.existsSync(file), '缺少月结账号绑定实现'); return require(file) }
const row = () => ({ id: 7, name: '测试承运商', is_active: 1, platform_code: 'sf', credential_ref: 'sf_main', monthly_account: 'M001', shipping_product: '2', shipping_delivery_type: null, waybill_enabled: 0 })
const credential = () => ({ appId: 'TEST_ID', appKey: 'SECRET_MUST_NOT_LEAK', apiBase: 'https://sfapi.sf-express.com/std/service', mode: 'production' })
const setup = () => ({ products: [{ code: '2', label: '日常普快' }], verifiedAccounts: ['M001'] })
function harness({ r = row(), c = credential(), s = setup(), pending = false, references = [] } = {}) {
  const writes = []
  const conn = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async query(sql, args) {
    if (sql.includes('COUNT(*)')) return [[{ total: pending || references.some(table => sql.includes(`FROM ${table} `)) ? 1 : 0 }]]
    if (sql.startsWith('SELECT')) return [[r]]
    writes.push(args)
    if (sql.includes('SET waybill_enabled=0')) { r.waybill_enabled = 0; return [{ affectedRows: 1 }] }
    Object.assign(r, { platform_code: args[0], monthly_account: args[1], shipping_product: args[2], shipping_delivery_type: args[3], credential_ref: args[4], waybill_enabled: args[5] })
    return [{ affectedRows: 1 }]
  } }
  return { r, writes, svc: load().createBindingService({ pool: { query: conn.query, getConnection: async () => conn }, getCredential: () => c, getSetup: () => s }) }
}
function input(view, overrides = {}) { return { platformCode: 'sf', monthlyAccount: 'M001', shippingProduct: '2', shippingDeliveryType: '', enabled: false, revision: view.revision, ...overrides } }
test('状态只返回当前账号是否验收，不泄漏密钥、接入地址或其他月结账号', async () => {
  const h = harness({ s: { ...setup(), verifiedAccounts: ['M001', 'PRIVATE_OTHER_ACCOUNT'] } }); const v = await h.svc.get(7)
  assert.equal(v.canEnable, true); assert.equal(v.enabled, false)
  assert.doesNotMatch(JSON.stringify(v), /SECRET_MUST_NOT_LEAK|TEST_ID|PRIVATE_OTHER_ACCOUNT|sfapi/)
  assert.equal(v.products[0].label, '日常普快')
})
test('缺少平台配置也能先保存月结号，但不得宣称账号已验收或启用', async () => {
  const h = harness({ c: null }); const v = await h.svc.get(7)
  assert.equal(v.canEnable, false); assert.equal(v.connectionReady, false)
  const saved = await h.svc.save(7, input(v)); assert.equal(saved.monthlyAccount, 'M001')
  await assert.rejects(h.svc.save(7, input(saved, { enabled: true })), /尚未准备好/)
})
test('沙箱或未验收的月结账号不能开启正式下单', async () => {
  for (const opts of [{ c: { ...credential(), mode: 'sandbox', apiBase: 'https://sfapi-sbox.sf-express.com/std/service' } }, { s: { ...setup(), verifiedAccounts: [] } }]) {
    const h = harness(opts); const v = await h.svc.get(7); assert.equal(v.canEnable, false)
    await assert.rejects(h.svc.save(7, input(v, { enabled: true })), /尚未准备好/)
  }
})
test('更换账号先保存并暂停，不能沿用旧账号的验收状态', async () => {
  const h = harness(); let v = await h.svc.get(7)
  await assert.rejects(h.svc.save(7, input(v, { monthlyAccount: 'M002', enabled: true })), /先保存/)
  v = await h.svc.save(7, input(v, { monthlyAccount: 'M002' })); assert.equal(v.enabled, false); assert.equal(v.accountVerified, false)
})
test('过期页面保存被拒绝，防止覆盖他人修改', async () => {
  const h = harness(); const v = await h.svc.get(7); h.r.monthly_account = 'CHANGED'
  await assert.rejects(h.svc.save(7, input(v)), e => e.statusCode === 409)
  assert.equal(h.writes.length, 0)
})
test('启用中或尚有待处理运单不能换月结账号', async () => {
  for (const opts of [{ r: { ...row(), waybill_enabled: 1 } }, { pending: true }]) {
    const h = harness(opts); const v = await h.svc.get(7)
    await assert.rejects(h.svc.save(7, input(v, { monthlyAccount: 'M002' })), e => e.statusCode === 409)
  }
})
test('停用承运商、无效产品、跨平台绑定均由服务端拒绝', async () => {
  const h = harness({ r: { ...row(), is_active: 0 } }); const v = await h.svc.get(7)
  await assert.rejects(h.svc.save(7, input(v, { enabled: true })), /停用/)
  const h2 = harness(); const v2 = await h2.svc.get(7)
  await assert.rejects(h2.svc.save(7, input(v2, { shippingProduct: '99999' })), /常用服务/)
  await assert.rejects(h2.svc.save(7, input(v2, { platformCode: 'deppon' })), /快递公司/)
})
test('未设置平台的承运商自动使用所选公司的默认连接，无需仓库输入引用名', async () => {
  const h = harness({ r: { ...row(), platform_code: null, credential_ref: null, monthly_account: null, shipping_product: null } })
  const v = await h.svc.get(7, 'sf'); await h.svc.save(7, input(v))
  assert.equal(h.r.credential_ref, 'sf_main'); assert.equal(h.r.platform_code, 'sf')
})
test('配置合格且已验收的账号可以显式开启，也可重复暂停', async () => {
  const h = harness(); let v = await h.svc.get(7)
  v = await h.svc.save(7, input(v, { enabled: true })); assert.equal(v.enabled, true)
  v = await h.svc.save(7, input(v)); assert.equal(v.enabled, false)
})
test('历史资料不符合新格式时仍可单独暂停，保留原月结号与服务', async () => {
  const r = { ...row(), monthly_account: 'M'.repeat(40), shipping_product: 'OLD_INVALID_PRODUCT', waybill_enabled: 1 }
  const h = harness({ r }); const v = await h.svc.get(7)
  const paused = await h.svc.save(7, { action: 'pause', revision: v.revision })
  assert.equal(paused.enabled, false); assert.equal(paused.monthlyAccount, 'M'.repeat(40)); assert.equal(paused.shippingProduct, 'OLD_INVALID_PRODUCT')
})
test('月结号按两家接口长度校验，顺丰不能保存超过20字符的账号', async () => {
  const h = harness(); const v = await h.svc.get(7)
  await assert.rejects(h.svc.save(7, input(v, { monthlyAccount: 'M'.repeat(21) })), /月结账号/)
})

test('解绑清除月结资料但保留承运商平台、凭据引用和历史归属', async () => {
  const h = harness(); const v = await h.svc.get(7)
  const next = await h.svc.save(7, { action: 'unbind', revision: v.revision })
  assert.equal(next.monthlyAccount, ''); assert.equal(next.enabled, false)
  assert.equal(next.shippingProduct, ''); assert.equal(next.platformCode, 'sf')
  assert.equal(h.r.credential_ref, 'sf_main')
})
test('解绑拒绝启用账号、待处理运单和旧版本，且不写入', async () => {
  for (const options of [{ r: { ...row(), waybill_enabled: 1 } }, { pending: true }, {}]) {
    const h = harness(options); const v = await h.svc.get(7)
    await assert.rejects(h.svc.save(7, { action: 'unbind', revision: Object.keys(options).length ? v.revision : 'old' }), e => e.statusCode === 409)
    assert.equal(h.writes.length, 0)
  }
})
test('删除拒绝绑定、启用和历史引用，允许删除未使用的空记录', async () => {
  for (const options of [{}, { r: { ...row(), monthly_account: null, waybill_enabled: 1 } }, { r: { ...row(), monthly_account: null }, pending: true }]) {
    const h = harness(options)
    await assert.rejects(h.svc.remove(7), e => e.statusCode === 409)
    assert.equal(h.writes.length, 0)
  }
  const h = harness({ r: { ...row(), monthly_account: null } })
  await h.svc.remove(7)
  assert.equal(h.writes.length, 1)
})

test('快捷新增将资料一次保存为暂停状态，重试只返回原账号', async () => {
  const writes = []; let response = null
  const conn = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async query(sql, args) {
    if (sql.includes('maxNum')) return [[{ maxNum: 8 }]]
    writes.push({ sql, args }); return [{ insertId: 9 }]
  } }
  const operations = { async beginOperationRequest() { return response ? { replay: true, responseData: response } : {} }, async completeOperationRequest(_conn, _state, result) { response = result.data } }
  const svc = load().createBindingService({ pool: { getConnection: async () => conn }, operations })
  assert.equal(typeof svc.create, 'function', '缺少快捷新增能力')
  const data = { name: '仓库顺丰', platformCode: 'sf', monthlyAccount: '00123' }
  const result = await svc.create(data, { requestKey: 'test-create-account', userId: 1 })
  assert.equal(result.id, 9)
  assert.deepEqual(await svc.create(data, { requestKey: 'test-create-account', userId: 1 }), result)
  assert.equal(writes.length, 1)
  assert.ok(writes[0].args.includes('00123')); assert.ok(writes[0].args.includes('sf_main'))
  assert.match(writes[0].sql, /waybill_enabled/)
})


test('销售、运单、运费明细、结算单任一历史引用均独立阻止删除', async () => {
  for (const table of ['sale_orders', 'logistics_waybills', 'logistics_freight_bills', 'logistics_freight_settlements']) {
    const h = harness({ r: { ...row(), monthly_account: null }, references: [table] })
    await assert.rejects(h.svc.remove(7), /已有订单/)
    assert.equal(h.writes.length, 0)
  }
})
