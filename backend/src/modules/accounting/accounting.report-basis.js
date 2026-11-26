const { SOURCE_TYPES } = require('../../constants/voucherSource')

function categoryBalance(row) {
  const debit = Number(row.d), credit = Number(row.c)
  return Math.round(([1, 4, 6].includes(Number(row.category)) ? debit - credit : credit - debit) * 100) / 100
}

// 原结转凭证由调用方按 source_type 过滤；人工红字只通过本账套的准确原凭证归类。
function excludeClosingReversals(yearOnly = false) {
  const types = yearOnly ? [SOURCE_TYPES.PERIOD_CLOSE_Y] : [SOURCE_TYPES.PERIOD_CLOSE, SOURCE_TYPES.PERIOD_CLOSE_Y]
  return `NOT EXISTS (SELECT 1 FROM acct_vouchers closing_origin
    WHERE v.is_reversal=1 AND closing_origin.id=v.reversed_id AND closing_origin.company_id=v.company_id
      AND closing_origin.source_type IN (${types.map(type => `'${type}'`).join(',')}))`
}

module.exports = { categoryBalance, excludeClosingReversals }
