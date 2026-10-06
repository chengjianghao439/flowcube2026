'use strict'
const AppError = require('../../utils/AppError')
const rules = require('./disposal.handling.rules')
const HEAD_FIELDS = Object.freeze(['id','disposal_no','warehouse_id','warehouse_name','status','total_value','remark','operator_id','operator_name','approved_by','approved_by_name','approved_at','reject_reason','disposed_at','created_at','updated_at','deleted_at','disposal_handling_link_id'])
const ITEM_FIELDS = Object.freeze(['id','disposal_id','product_id','product_code','product_name','unit','quantity','unit_value','dispose_type','remark','created_at'])
const invalid = () => new AppError('旧单完整历史资料或数量不合法，请保留预览并人工核对', 409, 'DISPOSAL_CONVERSION_SNAPSHOT_INVALID')
function fields(row, names) {
  if (!row || names.some(name => !Object.hasOwn(row, name) || row[name] === undefined)) throw invalid()
  const result = JSON.parse(rules.stableJson(Object.fromEntries(names.map(name => [name, row[name]]))))
  for (const name of names.filter(name => name.endsWith('_at'))) if (row[name] != null && (typeof result[name] !== 'string' || !Number.isFinite(Date.parse(result[name])))) throw invalid()
  return result
}
function decimal(value, scale) {
  // DECIMAL text, without Number/toFixed rounding or current-master reinterpretation.
  const match = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<fraction>\d+))?$/.exec(String(value))
  if (value == null || !match || match.groups.whole.length > 10) throw invalid()
  const { sign, whole, fraction = '' } = match.groups
  if (fraction.slice(scale).replace(/0/g, '')) throw invalid()
  return sign + whole + '.' + fraction.slice(0, scale).padEnd(scale, '0')
}
function serialize(rawHead, rawItems) {
  const head = fields(rawHead, HEAD_FIELDS)
  head.total_value = decimal(rawHead.total_value, 4)
  if (!Array.isArray(rawItems)) throw invalid()
  const items = rawItems.map(row => {
    const item = fields(row, ITEM_FIELDS)
    item.quantity = decimal(row.quantity, 2); item.unit_value = decimal(row.unit_value, 4)
    return item
  }).sort((a, b) => Number(a.id) - Number(b.id))
  const approval = { approved_by: head.approved_by, approved_by_name: head.approved_by_name, approved_at: head.approved_at }
  return { version: 1, head, items, approval }
}
module.exports = { serialize }
