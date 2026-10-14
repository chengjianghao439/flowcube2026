'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')
const { SOURCE_TYPES, DIR } = require('../backend/src/constants/voucherSource')
const filename = path.resolve(__dirname, '../backend/src/modules/fixed-assets/fixed-assets.service.js')
const original = fs.readFileSync(filename, 'utf8')
const engineSource = fs.readFileSync(path.resolve(__dirname, '../backend/src/modules/accounting/voucher-engine.js'), 'utf8')
const round2 = vm.runInNewContext(engineSource.match(/^const round2 = (.+)$/m)[1])
const clone = value => JSON.parse(JSON.stringify(value))
function fixture({ cost = 100, rate = .05, months = 6, source = original, closed = false, failVoucher = false } = {}) {
  let asset = { id: 7, company_id: 2, status: 1, asset_no: 'OFFLINE-7', asset_name: '合成资产', acquire_date: '2099-01-01', original_cost: cost, residual_rate: rate, useful_months: months }
  let history = [], vouchers = [], checkpoint
  const events = []
  const conn = {
    beginTransaction: async () => { events.push('begin'); checkpoint = clone({ asset, history, vouchers }) },
    commit: async () => events.push('commit'),
    rollback: async () => { events.push('rollback'); ({ asset, history, vouchers } = checkpoint) },
    release: () => events.push('release'),
    query: async (sql, p = []) => {
      events.push(sql)
      if (sql.includes('SELECT * FROM fixed_assets')) return [[...(asset.status === 1 && asset.acquire_date.slice(0, 7).replace('-', '') <= p[1] ? [clone(asset)] : [])]]
      if (sql.startsWith('SELECT * FROM fixed_asset_depr')) return [clone(history)]
      if (sql.includes('INSERT INTO fixed_asset_depr')) {
        const id = history.length + 1
        assert.ok(!history.some(h => h.period === p[2]), 'unique(asset_id,period)')
        history.push({ id, period: p[2], depr_date: p[3], monthly_amount: p[4], accum_amount: p[5], is_disposal: p[6] })
        return [{ insertId: id }]
      }
      if (sql.startsWith('UPDATE fixed_assets SET status = 2')) { asset.status = 2; return [{ affectedRows: 1 }] }
      throw new Error('Offline denied SQL: ' + sql)
    },
  }
  const stubs = {
    '../../config/db': { pool: { getConnection: async () => { events.push('connection'); return conn } } },
    '../../utils/AppError': AppError, '../../utils/codeGenerator': {},
    '../accounting/voucher-engine': { round2, loadAccountMap: async () => new Map(), makeSeqAllocator: async () => async () => 1, upsertVoucher: async (_conn, spec) => {
      if (typeof failVoucher === 'function' ? failVoucher(spec) : failVoucher) throw new AppError('合成凭证失败', 500, 'FIXTURE_VOUCHER_FAILURE')
      vouchers.push(clone(spec)); return { id: vouchers.length }
    } },
    '../../constants/voucherSource': { SOURCE_TYPES, DIR }, '../../utils/pagination': {}, '../../utils/backendTime': {},
    '../accounting/accounting.period.service': { assertPeriodOpen: async () => { events.push('period'); if (closed) throw new AppError('已结账', 409, 'ACCT_PERIOD_CLOSED') } },
  }
  const loaded = { exports: {} }
  vm.runInNewContext(source + '\nmodule.exports.actualDepreciateAsset = depreciateAsset;', { module: loaded, require: name => { if (!(name in stubs)) throw new Error('Offline denied module: ' + name); return stubs[name] } }, { filename })
  return { run: period => loaded.exports.runDepreciation({ period, companyId: 2 }, {}), direct: options => loaded.exports.actualDepreciateAsset(conn, asset, options, new Map(), async () => 1, {}, 2), facts: () => clone({ asset, history, vouchers }), events }
}
const six = ['209901', '209902', '209903', '209904', '209905', '209906']

test('向下月额15.83在第6次实际计提补到15.85，台账/响应/凭证同额', async () => {
  const f = fixture()
  let response
  for (const period of six) response = await f.run(period)
  const facts = f.facts()
  assert.deepEqual(facts.history.map(h => h.monthly_amount), [15.83, 15.83, 15.83, 15.83, 15.83, 15.85])
  assert.equal(facts.history.at(-1).accum_amount, 95)
  assert.equal(facts.asset.status, 2)
  assert.equal(response.vouchers[0].monthly, 15.85)
  assert.deepEqual(facts.vouchers.at(-1).legs.map(l => l.amount), [15.85, 15.85])
})

test('向上月额16.67仍按剩余上限在第6次提16.65', async () => {
  const f = fixture({ rate: 0 })
  for (const period of six) await f.run(period)
  assert.equal(f.facts().history.at(-1).monthly_amount, 16.65)
  assert.equal(f.facts().history.at(-1).accum_amount, 100)
})

test('已提足后重复末期/旧期/新期均不新增台账或凭证', async () => {
  const f = fixture()
  for (const period of six) await f.run(period)
  const before = f.facts()
  for (const period of ['209906', '209901', '209907']) await f.run(period)
  assert.deepEqual(f.facts(), before)
})

test('尚使用中的已有期间重试不改旧台账/凭证，已有更后期间亦保持原重放', async () => {
  const f = fixture()
  await f.run('209901'); await f.run('209902')
  const before = f.facts()
  const response = await f.run('209901')
  assert.equal(response.skipped, 1)
  assert.deepEqual(f.facts(), before)
})

test('新期间早于已有latest仍拒绝并rollback/release', async () => {
  const f = fixture()
  await f.run('209903')
  const before = f.facts()
  await assert.rejects(f.run('209902'), { code: 'ASSET_DEPRECIATION_ORDER' })
  assert.deepEqual(f.facts(), before)
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release'])
})

test('跳月每请求只计1笔；日历第6个月不提前补齐，实际第6笔再补差', async () => {
  const f = fixture()
  await f.run('209901'); await f.run('209906')
  assert.equal(f.facts().history.length, 2)
  assert.equal(f.facts().history.at(-1).monthly_amount, 15.83)
  for (const period of ['209907', '209908', '209909', '209910']) await f.run(period)
  assert.equal(f.facts().history.length, 6)
  assert.equal(f.facts().history.at(-1).monthly_amount, 15.85)
  assert.equal(f.facts().history[1].period, '209906')
})

test('已知未修边界：0.01/600月月额0不新增零台账或自动按日历追补', async () => {
  const f = fixture({ cost: .01, rate: 0, months: 600 })
  for (const period of ['209901', '214812']) {
    const response = await f.run(period)
    assert.equal(response.ran, 0)
  }
  assert.equal(f.facts().history.length, 0)
  assert.equal(f.facts().vouchers.length, 0)
  assert.equal(f.facts().asset.status, 1)
})

test('账套期间闸门仍在读取/锁定资产之前，关闭期间不写资产台账', async () => {
  const f = fixture({ closed: true })
  await assert.rejects(f.run('209901'), { code: 'ACCT_PERIOD_CLOSED' })
  assert.ok(f.events.includes('period'))
  assert.equal(f.events.some(e => typeof e === 'string' && /SELECT \* FROM fixed_assets/.test(e)), false)
  assert.equal(f.facts().history.length, 0)
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release'])
})

test('凭证失败仍回滚本次台账及状态，保留先前5期原值', async () => {
  const f = fixture({ failVoucher: spec => spec.voucherDate === '2099-06-28' })
  for (const period of six.slice(0, 5)) await f.run(period)
  const before = f.facts()
  await assert.rejects(f.run('209906'), { code: 'FIXTURE_VOUCHER_FAILURE' })
  assert.deepEqual(f.facts(), before)
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release'])
})

test('处置当期走同一helper：若正好第6笔，尾差额与本次折旧凭证一致', async () => {
  const f = fixture()
  for (const period of six.slice(0, 5)) await f.run(period)
  const response = await f.direct({ period: '209906', date: '2099-06-15', isDisposal: true })
  assert.equal(response.monthly, 15.85)
  assert.equal(f.facts().history.at(-1).is_disposal, 1)
  assert.deepEqual(f.facts().vouchers.at(-1).legs.map(l => l.amount), [15.85, 15.85])
})

test('恢复旧Math.min判式会让实际末期行为断言失败（反向守卫）', async () => {
  const changed = original.replace(/const actualMonthly = monthly > 0[\s\S]*?: Math\.min\(monthly, remaining\)/, 'const actualMonthly = Math.min(monthly, remaining)')
  assert.notEqual(changed, original)
  const f = fixture({ source: changed })
  for (const period of six) await f.run(period)
  assert.throws(() => assert.equal(f.facts().history.at(-1).monthly_amount, 15.85), { code: 'ERR_ASSERTION' })
})
