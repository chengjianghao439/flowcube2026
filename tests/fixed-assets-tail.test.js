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
function fixture({ cost = 100, rate = .05, months = 6, source = original, closed = false, failVoucher = false, assetId = 7, companyId = 2, acquireDate = '2099-01-01' } = {}) {
  let asset = { id: assetId, company_id: companyId, status: 1, asset_no: `OFFLINE-${assetId}`, asset_name: '合成资产', acquire_date: acquireDate, original_cost: cost, residual_rate: rate, useful_months: months }
  let history = [], vouchers = [], disposals = [], checkpoint
  const events = []
  const conn = {
    beginTransaction: async () => { events.push('begin'); checkpoint = clone({ asset, history, vouchers, disposals }) },
    commit: async () => events.push('commit'),
    rollback: async () => { events.push('rollback'); ({ asset, history, vouchers, disposals } = checkpoint) },
    release: () => events.push('release'),
    query: async (sql, p = []) => {
      events.push(sql)
      if (sql.startsWith('SELECT * FROM fixed_assets WHERE id = ? AND company_id = ?')) {
        return [[...(asset.id === p[0] && asset.company_id === p[1] ? [clone(asset)] : [])]]
      }
      if (sql.includes('SELECT * FROM fixed_assets')) return [[...(asset.company_id === p[0] && asset.status === 1 && asset.acquire_date.slice(0, 7).replace('-', '') <= p[1] ? [clone(asset)] : [])]]
      if (sql.startsWith('SELECT * FROM fixed_asset_depr')) {
        assert.equal(p[0], asset.id)
        return [clone(history)]
      }
      if (sql.includes('INSERT INTO fixed_asset_depr')) {
        const id = history.length + 1
        assert.ok(!history.some(h => h.period === p[2]), 'unique(asset_id,period)')
        history.push({ id, period: p[2], depr_date: p[3], monthly_amount: p[4], accum_amount: p[5], is_disposal: p[6] })
        return [{ insertId: id }]
      }
      if (sql.includes('INSERT INTO fixed_asset_disposals')) {
        const [company, no, target, date, type, income, expense] = p
        disposals.push({ company, no, target, date, type, income, expense })
        return [{ insertId: disposals.length }]
      }
      if (sql.startsWith('UPDATE fixed_assets SET status = 3')) {
        const [date, type, income, target] = p
        assert.equal(target, asset.id)
        Object.assign(asset, { status: 3, dispose_date: date, dispose_type: type, dispose_income: income })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('UPDATE fixed_assets SET status = 2')) { asset.status = 2; return [{ affectedRows: 1 }] }
      throw new Error('Offline denied SQL: ' + sql)
    },
  }
  const stubs = {
    '../../config/db': { pool: { getConnection: async () => { events.push('connection'); return conn } } },
    '../../utils/cashMoney': require('../backend/src/utils/cashMoney'), '../../utils/AppError': AppError, '../../utils/codeGenerator': { generateDailyCode: async () => '处置夹具-99' },
    '../accounting/voucher-engine': { round2, loadAccountMap: async () => new Map(), makeSeqAllocator: async () => async () => 1, upsertVoucher: async (_conn, spec, _accounts, _seq, _user, company) => {
      assert.equal(company, companyId)
      if (typeof failVoucher === 'function' ? failVoucher(spec) : failVoucher) throw new AppError('合成凭证失败', 500, 'FIXTURE_VOUCHER_FAILURE')
      vouchers.push(clone(spec)); return { id: vouchers.length }
    } },
    '../../constants/voucherSource': { SOURCE_TYPES, DIR }, '../../utils/pagination': {}, '../../utils/backendTime': {},
    '../accounting/accounting.period.service': { assertPeriodOpen: async () => { events.push('period'); if (closed) throw new AppError('已结账', 409, 'ACCT_PERIOD_CLOSED') } },
  }
  const loaded = { exports: {} }
  vm.runInNewContext(source + '\nmodule.exports.actualDepreciateAsset = depreciateAsset;', { module: loaded, require: name => { if (!(name in stubs)) throw new Error('Offline denied module: ' + name); return stubs[name] } }, { filename })
  return {
    create: loaded.exports.createAsset,
    run: period => loaded.exports.runDepreciation({ period, companyId }, {}),
    direct: options => loaded.exports.actualDepreciateAsset(conn, asset, options, new Map(), async () => 1, {}, companyId),
    dispose: (id, data, company) => loaded.exports.disposeAsset(id, data, {}, company),
    facts: () => clone({ asset, history, vouchers, disposals }),
    events,
  }
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

test('资产 B 的实际处置单和凭证采用其最终确认金额与日期', async () => {
  const f = fixture({ assetId: 8, companyId: 1, acquireDate: '2026-01-01', rate: 0, months: 5 })
  const selected = { disposeType: 1, disposeDate: '2026-11-18', income: 112.35, expense: 4.85 }
  await assert.rejects(f.dispose(7, selected, 1), { statusCode: 404 })
  await assert.rejects(f.dispose(8, selected, 2), { statusCode: 404 })
  const result = await f.dispose(8, selected, 1)
  const facts = f.facts()
  assert.deepEqual(facts.disposals, [{
    company: 1, no: result.disposeNo, target: 8, date: selected.disposeDate,
    type: selected.disposeType, income: selected.income, expense: selected.expense,
  }])
  const voucher = facts.vouchers.find(row => row.sourceType === SOURCE_TYPES.ASSET_DISPOSAL)
  assert.equal(voucher.sourceId, result.id)
  assert.equal(voucher.voucherDate, selected.disposeDate)
  assert.deepEqual(voucher.legs.filter(leg => leg.code === '1002').map(leg => [leg.direction, leg.amount]), [
    [DIR.DEBIT, 112.35], [DIR.CREDIT, 4.85],
  ])
  assert.deepEqual(voucher.legs.filter(leg => leg.code === '6115').map(leg => [leg.direction, leg.amount]), [[DIR.CREDIT, 27.5]])
  assert.equal(result.gain, -27.5)
  assert.equal(facts.asset.status, 3)
  assert.deepEqual(f.events.slice(-2), ['commit', 'release'])
})

test('资产购置、处置的实际金额拒绝非分输入，处置未记账', async () => {
  const f = fixture()
  for (const values of [{income:100.006,expense:0},{income:100,expense:0.004}]) {
    await assert.rejects(f.dispose(7, {disposeType:1,disposeDate:'2099-02-01',...values}, 2), {code:'CASH_PRECISION_INVALID'})
  }
  assert.equal(f.facts().disposals.length, 0)
  await assert.rejects(f.create({assetName:'测试',originalCost:100.005,usefulMonths:6,acquireDate:'2099-01-01'}), {code:'CASH_PRECISION_INVALID'})
})
