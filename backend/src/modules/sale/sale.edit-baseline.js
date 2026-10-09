'use strict'
const { createHash } = require('node:crypto')
const AppError = require('../../utils/AppError')
const headFields = ['id','status','customer_id','warehouse_id','total_amount','discount_amount','remark','carrier_id','carrier','freight_type','shipping_product','receiver_name','receiver_phone','receiver_address','disposal_handling_link_id']
const itemFields = ['id','product_id','warehouse_id','product_code','product_name','unit','entry_unit','quantity','entry_qty','conversion_rate','unit_price','amount','remark','reserved_qty','dispatched_qty','shipped_qty']
function values(row, fields) { return fields.map(field => row[field] == null ? null : String(row[field])) }
function editFingerprint(head, items) {
  return createHash('sha256').update(JSON.stringify([values(head, headFields), [...items].sort((a,b) => Number(a.id)-Number(b.id)).map(row => values(row,itemFields))])).digest('hex')
}
async function assertEditBaseline(conn, order, input) {
  if (!input.expectedEditFingerprint) {
    if (input.commercialModel === 'kit-v1' && input.expectedRevision === 0) throw new AppError('原单编辑依据缺失，请保留草稿并重新读取',409,'SALE_EDIT_BASELINE_REQUIRED')
    return
  }
  if (order.commercial_model === 'kit-v1') {
    if (input.expectedRevision === 0) throw new AppError('销售单已更新，请保留草稿并重新核对',409,'SALE_COMMERCIAL_REVISION_CONFLICT')
    return
  }
  const [[head]] = await conn.query('SELECT * FROM sale_orders WHERE id=?',[order.id])
  const [items] = await conn.query('SELECT * FROM sale_order_items WHERE order_id=? ORDER BY id',[order.id])
  if (editFingerprint(head,items) !== input.expectedEditFingerprint) throw new AppError('销售单已更新，请保留草稿并重新核对',409,'SALE_EDIT_BASELINE_CONFLICT')
}
function assertModel(row,input,{allowEdit=false}={}) {
  const firstEdit = allowEdit && input?.commercialModel === 'kit-v1' && input.expectedRevision === 0 && /^[a-f0-9]{64}$/.test(input.expectedEditFingerprint || '')
  if (row.commercial_model === 'kit-v1') {
    if (input?.commercialModel !== 'kit-v1' || (!firstEdit && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<=0))) throw new AppError('当前客户端暂不能处理套单，请先保留输入并更新客户端',400,'SALE_COMMERCIAL_VERSION_REQUIRED')
  } else if (input?.commercialModel != null && !firstEdit) throw new AppError('原单编辑依据缺失，请保留草稿并重新读取',400,'SALE_COMMERCIAL_MODEL_MISMATCH')
}
function assertRevision(row,input) {
  if (row.commercial_model === 'kit-v1' && Number(row.commercial_revision)!==Number(input.expectedRevision)) throw new AppError('销售单已更新，本次未保存，请保留草稿并重新核对',409,'SALE_COMMERCIAL_REVISION_CONFLICT')
}
module.exports = { editFingerprint, assertEditBaseline, assertModel, assertRevision }
