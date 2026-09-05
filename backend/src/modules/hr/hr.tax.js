/**
 * 个税累计预扣法计算（文档10 功能4，2019 新个税）。
 *
 * 本期应预扣预缴税额 =
 *   (累计预扣预缴应纳税所得额 × 预扣率) − 速算扣除数 − 累计减免 − 累计已预扣预缴税额
 * 累计预扣预缴应纳税所得额 = 累计收入 − 累计免税收入 − 累计减除费用(5000×月) − 累计专项扣除(社保个人) − 累计专项附加扣除 − 累计其他扣除
 *
 * 纯函数：不连库，便于单测（tests/ 下逐月推演 1~12 月跨档切换）。
 */

// 预扣率表（7 级）：[上限(万元), 预扣率, 速算扣除数]；上限用 0 表示超出上一档
const TAX_TABLE = [
  { upTo: 36000, rate: 0.03, quickDeduction: 0 },
  { upTo: 144000, rate: 0.10, quickDeduction: 2520 },
  { upTo: 300000, rate: 0.20, quickDeduction: 16920 },
  { upTo: 420000, rate: 0.25, quickDeduction: 31920 },
  { upTo: 660000, rate: 0.30, quickDeduction: 52920 },
  { upTo: 960000, rate: 0.35, quickDeduction: 85920 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.45, quickDeduction: 181920 },
]

const MONTHLY_DEDUCTION = 5000 // 每月减除费用

/**
 * 计算某人某月的应预扣个税。
 * @param {object} p 参数
 * @param {number} p.monthlyGross 当月应发工资
 * @param {number} p.monthlySocialPersonal 当月个人社保公积金
 * @param {number} p.priorAccumTaxable 上月累计收入减扣除净额（允许为负；任职起月/每年年初为 0）
 * @param {number} p.priorAccumTaxPaid 上月累计已预缴（1 月为 0）
 * @param {number} [p.specialAdditional] 每月专项附加扣除（房贷/赡养老人等）
 * @returns {{ monthlyTaxable: number, accumTaxable: number, bracket: number, tax: number, accumTaxPaid: number }}
 */
function calcMonthlyTax({ monthlyGross, monthlySocialPersonal, priorAccumTaxable = 0, priorAccumTaxPaid = 0, specialAdditional = 0 }) {
  const gross = Math.max(0, Number(monthlyGross) || 0)
  const social = Math.max(0, Number(monthlySocialPersonal) || 0)
  const additional = Math.max(0, Number(specialAdditional) || 0)

  // 本月累计应纳税所得额 = 上月累计 + 本月收入 − 减除费用 − 专项扣除(社保) − 专项附加扣除
  const monthlyTaxable = gross - MONTHLY_DEDUCTION - social - additional
  // 不截断负余额：前月未用扣除必须延续，只有应扣税额截零。
  const accumTaxable = Math.round((Number(priorAccumTaxable) + monthlyTaxable) * 100) / 100

  // 累计应预扣税额（按累计所得查档）
  const bracket = TAX_TABLE.find(b => accumTaxable <= b.upTo) || TAX_TABLE[TAX_TABLE.length - 1]
  const accumTaxDue = Math.max(0, Math.round((accumTaxable * bracket.rate - bracket.quickDeduction) * 100) / 100)

  // 本期应预扣 = 累计应预扣 − 累计已预缴
  const tax = Math.max(0, Math.round((accumTaxDue - Number(priorAccumTaxPaid)) * 100) / 100)
  const accumTaxPaid = Math.round((Number(priorAccumTaxPaid) + tax) * 100) / 100

  return {
    monthlyTaxable: Math.round(monthlyTaxable * 100) / 100,
    accumTaxable,
    bracket: bracket.rate,
    tax,
    accumTaxPaid,
  }
}

/** 税后实发 = 应发 − 个人社保 − 个税 */
function netPay(gross, socialPersonal, tax) {
  return Math.max(0, Math.round((Number(gross) - Number(socialPersonal) - Number(tax)) * 100) / 100)
}

module.exports = { calcMonthlyTax, netPay, TAX_TABLE, MONTHLY_DEDUCTION }
