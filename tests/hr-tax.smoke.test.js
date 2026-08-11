#!/usr/bin/env node
'use strict'

/**
 * 个税累计预扣法纯函数单测（文档10 功能4）。
 *
 * 验证：逐月推演跨档预扣率切换、期末累计正确、与官方口径（月薪 3 万无专项扣除）一致。
 * 运行：node tests/hr-tax.smoke.test.js
 */

const { calcMonthlyTax, netPay } = require('../backend/src/modules/hr/hr.tax')

let passed = 0, failed = 0
function assert(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  [PASS] ${name}`) }
  else { failed += 1; console.error(`  [FAIL] ${name} ${extra}`) }
}

function r2(n) { return Math.round(n * 100) / 100 }

let priorTaxable = 0, priorPaid = 0
const taxesByMonth = []
const accumByMonth = []
for (let m = 1; m <= 12; m++) {
  const r = calcMonthlyTax({ monthlyGross: 30000, monthlySocialPersonal: 0, priorAccumTaxable: priorTaxable, priorAccumTaxPaid: priorPaid })
  taxesByMonth.push(r.tax)
  accumByMonth.push(r.accumTaxable)
  priorTaxable = r.accumTaxable
  priorPaid = r.accumTaxPaid
}

assert('1月个税 = 25000×3% = 750', taxesByMonth[0] === 750, `got ${taxesByMonth[0]}`)
// 2月累计 50000 已跨入 10% 档：累计税 50000×10%−2520=2480 → 本月 2480−750=1730
assert('2月累计50000跨入10%档，本月税 = 1730', taxesByMonth[1] === 1730, `got ${taxesByMonth[1]}`)
// 3月累计 75000 → 10%档累计 4980 → 本月 4980−2480=2500
assert('3月累计75000（10%档），本月税 = 2500', taxesByMonth[2] === 2500, `got ${taxesByMonth[2]}`)
assert('3月累计应纳税所得 75000', accumByMonth[2] === 75000, `got ${accumByMonth[2]}`)
// 全年累计：30000×12−5000×12 = 300000 → 20%档(速算16920) → 累计税 300000×20%−16920=43080
const yearTotalTax = taxesByMonth.reduce((s, t) => s + t, 0)
assert('全年累计个税 43080（20%档）', r2(yearTotalTax) === 43080, `got ${yearTotalTax}`)

// 社保扣除：月薪 30000、个人社保 1500/月
const rWithSocial = calcMonthlyTax({ monthlyGross: 30000, monthlySocialPersonal: 1500, priorAccumTaxable: 0, priorAccumTaxPaid: 0 })
assert('1月含个人社保1500：应纳税所得 = 30000-5000-1500 = 23500 → 税 705', rWithSocial.tax === 705, `got ${rWithSocial.tax}`)

// 实发
assert('实发 = 应发 − 个人社保 − 个税', netPay(30000, 1500, 705) === 27795, `got ${netPay(30000, 1500, 705)}`)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
