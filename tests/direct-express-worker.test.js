'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
function load() {
  const file = path.resolve(__dirname, '../backend/src/modules/logistics/logistics.direct.js')
  assert.ok(fs.existsSync(file), '缺少直连下单恢复实现')
  return require(file)
}
function harness(options = {}) {
  const calls = { create: 0, lookup: 0, commit: 0, released: 0, writes: [] }
  const row = { id: 1, status: 1, task_status: 6, waybill_no: 'WB1', platform_code: 'deppon', carrier_id: 1, warehouse_task_id: 2, freight_type: 1, credential_ref: 'db', monthly_account: 'M', shipping_product: 'DJBK', shipping_delivery_type: '3', waybill_enabled: 1, is_active: 1, shipment_json: { sender: {}, receiver: {}, cargoName: '商品', packages: [{ id: 1 }] }, ...options.row }
  const conn = {
    async beginTransaction() {}, async commit() { calls.commit++ }, async rollback() {}, release() { calls.released++ },
    async query(sql, args = []) {
      calls.writes.push([sql, args])
      if (sql.includes('FROM packages')) return [options.invalidPackages ? [] : [{ id: 1 }]]
      if (sql.startsWith('SELECT')) return [[row]]
      if (sql.includes('direct_request = ?')) { row.direct_request = JSON.parse(args[0]); row.request_key = args[1]; row.status = 2 }
      return [{ affectedRows: 1 }]
    },
  }
  const pool = { getConnection: async () => conn, query: async (sql, args = []) => { calls.writes.push([sql, args]); return [{ affectedRows: options.loseLease ? 0 : 1 }] } }
  const worker = load().createDirectWorker({ pool, getAdapter: () => ({
    prepareOrder() { if (options.invalid) throw Object.assign(new Error('缺少配置'), { uncertain: false }); return { qty: 1 } },
    async createOrder() { assert.ok(calls.commit > 0, '网络调用前必须提交事务'); calls.create++; if (options.timeout) throw Object.assign(new Error('超时'), { uncertain: true }); return { trackingNo: 'DPK1', trackingNos: ['DPK1'] } },
    async lookupOrder() { assert.ok(calls.commit > 0); calls.lookup++; return { trackingNo: 'DPK1', trackingNos: ['DPK1'] } },
  }), getCredential: () => ({ appId: 'APP', appKey: 'DO_NOT_PERSIST', mode: 'sandbox', apiBase: 'https://sandbox.deppon.com/create', queryApiBase: 'https://sandbox.deppon.com/query' }) })
  return { worker, calls, row }
}
test('首次下单持久化无密钥快照，事务外只创建一次', async () => {
  const h = harness(); await h.worker.process(1)
  assert.equal(h.calls.create, 1); assert.equal(h.calls.lookup, 0)
  assert.doesNotMatch(JSON.stringify(h.calls.writes), /DO_NOT_PERSIST/)
  assert.match(h.calls.writes.at(-1)[0], /request_key/)
})
test('网络超时记录待核实，不在同一调用重复创建', async () => {
  const h = harness({ timeout: true }); await h.worker.process(1)
  assert.equal(h.calls.create, 1)
  assert.equal(h.calls.writes.at(-1)[1][0], 6)
})
test('已提交快照无论旧状态是否待取号都只查单，不追加德邦子件', async () => {
  const snapshot = { waybill: { waybillNo: 'WB1', packageCount: 1 }, credentialRef: 'db', binding: { mode: 'sandbox', queryApiBase: 'https://sandbox.deppon.com/query', appId: 'APP', apiBase: 'https://sandbox.deppon.com/create' }, preparedRequest: {} }
  const h = harness({ row: { status: 6, direct_request: snapshot } }); await h.worker.process(1)
  assert.equal(h.calls.create, 0); assert.equal(h.calls.lookup, 1)
})
test('配置错误不发送请求，保存失败状态后可补充资料', async () => {
  const h = harness({ invalid: true }); await h.worker.process(1)
  assert.equal(h.calls.create, 0); assert.equal(h.calls.lookup, 0)
  assert.equal(h.calls.writes.at(-1)[1][0], 4)
})
test('停用承运商不自动创建新单', async () => {
  const h = harness({ row: { waybill_enabled: 0 } }); await h.worker.process(1)
  assert.equal(h.calls.create, 0)
})
test('地址解析仅拆明确省市区，不猜省份；件数只来自真实箱子', () => {
  const { addressParts, splitPackages } = load()
  assert.deepEqual(addressParts('广东省深圳市南山区科技路1号'), { province: '广东省', city: '深圳市', county: '南山区', address: '科技路1号' })
  assert.deepEqual(addressParts('上海市青浦区明珠路1号'), { province: '上海', city: '上海市', county: '青浦区', address: '明珠路1号' })
  assert.equal(addressParts('科技路1号').province, '')
  const chunks = splitPackages(Array.from({ length: 31 }, (_, i) => ({ id: i + 1 })))
  assert.deepEqual(chunks.map(p => p.length), [30, 1])
  assert.equal(new Set(chunks.flat().map(p => p.id)).size, 31)
})
test('已取消或重新打包的任务不能按旧箱数新建快递单', async () => {
  const h = harness({ row: { task_status: 8 } }); await h.worker.process(1)
  assert.equal(h.calls.create, 0)
})
test('下单快照中的箱子已作废时禁止发送', async () => {
  const h = harness({ invalidPackages: true }); await h.worker.process(1)
  assert.equal(h.calls.create, 0)
})
