'use strict'
const crypto = require('node:crypto')
const AppError = require('../../utils/AppError')
const { assertQtyScale } = require('../../utils/qtyPrecision')

const SOURCE_CREATE = 'disposal.handling.source.create'
const DATA_INVALID = 'DISPOSAL_HANDLING_DATA_INVALID'
const fail = () => { throw new AppError('处理来源数量或身份不一致，请保留记录并人工核对', 409, DATA_INVALID) }
function safeId(value, label = 'ID') {
  if (!(typeof value === 'number' || typeof value === 'string' && /^[1-9]\d*$/.test(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new AppError(`${label}必须为单个正安全整数`, 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  return Number(value)
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new AppError('处理意图/操作UUID格式不正确', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  return value.toLowerCase()
}
function requestKey(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 100) throw new AppError('请保留原操作请求键', 400, 'REQUEST_KEY_REQUIRED')
  return value
}
function stableJson(value) {
  // JSON.stringify first applies real JSON semantics (undefined omission/null array slots).
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
}
const fingerprint = json => crypto.createHash('sha256').update(json).digest('hex')
function validateCreateBody(body) {
  const keys = ['intentUuid', 'operationUuid', 'productId', 'warehouseId', 'unit', 'handlingType', 'quantity']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(body, key))) throw new AppError('处理意图参数不完整或包含不允许的来源字段', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  uuid(body.intentUuid); uuid(body.operationUuid)
  if (typeof body.productId !== 'number' || typeof body.warehouseId !== 'number') throw new AppError('商品和仓库ID必须为正安全整数', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  safeId(body.productId, '商品ID'); safeId(body.warehouseId, '仓库ID')
  if (typeof body.unit !== 'string' || !body.unit || body.unit !== body.unit.trim() || Array.from(body.unit).length > 20 || ![1, 2, 3].includes(body.handlingType)) throw new AppError('基本单位或处理方式不正确', 400, 'DISPOSAL_HANDLING_INPUT_INVALID')
  if (typeof body.quantity !== 'number' || !Number.isFinite(body.quantity) || body.quantity <= 0 || body.quantity > 9999999999.99) throw new AppError('意图基本量必须为合法正数', 400, 'QTY_INVALID')
  assertQtyScale(body.quantity, '意图基本量')
  return Object.fromEntries(keys.map(key => [key, body[key]]))
}
function storedUnits(value, positive = false) {
  const n = Number(value)
  if (value == null || String(value).trim() === '' || !Number.isFinite(n) || n < 0 || positive && n === 0 || n > 9999999999.99) fail()
  try { assertQtyScale(n) } catch { fail() }
  const units = Math.round(n * 100)
  if (!Number.isSafeInteger(units)) fail()
  return units
}
function assertSource(row) {
  if (!row || ![row.id, row.product_id, row.warehouse_id].every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0) || typeof row.unit !== 'string' || !row.unit) fail()
  return storedUnits(row.quantity, true)
}
function calculateBudget(source, links) {
  const q = assertSource(source)
  let allocated = 0, released = 0
  for (const link of links) {
    if (Number(link.source_id) !== Number(source.id) || Number(link.product_id) !== Number(source.product_id) || Number(link.warehouse_id) !== Number(source.warehouse_id) || link.unit !== source.unit
      || !['sale_order', 'purchase_return', 'inventory_disposal'].includes(link.target_type)
      || ![link.id, link.target_id, link.target_line_id].every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)) fail()
    const a = storedUnits(link.allocated_quantity, true), r = storedUnits(link.released_quantity)
    const e = link.final_executed_quantity == null ? null : storedUnits(link.final_executed_quantity)
    if (!['ACTIVE', 'TERMINATED'].includes(link.state) || r > a || e != null && (e > a || r > a - e)
      || link.state === 'ACTIVE' && (r !== 0 || e != null) || link.state === 'TERMINATED' && (e == null || r !== a - e)) fail()
    allocated += a; released += r
    if (!Number.isSafeInteger(allocated) || !Number.isSafeInteger(released)) fail()
  }
  const consumed = allocated - released
  if (consumed < 0 || consumed > q) fail()
  // H1只计算意图/分配基础预算，尚未接H3真实执行事实，不能以目标状态推算E。
  return { intentionQuantity: q / 100, allocatedQuantity: allocated / 100, releasedQuantity: released / 100, consumedQuantity: consumed / 100, availableQuantity: (q - consumed) / 100, actualExecutedQuantity: null, progress: links.length ? '待核对' : '待关联' }
}
module.exports = { SOURCE_CREATE, safeId, uuid, requestKey, stableJson, fingerprint, validateCreateBody, calculateBudget, assertSource }
