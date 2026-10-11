const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isScalar = value => value == null || ['string','number','boolean'].includes(typeof value)
function isKnownChangePayload(payload) {
  if (!isObject(payload) || payload.version !== 1 || !['line_changes','price_history_refs'].includes(payload.kind) || payload.quantityScale !== 2 || payload.priceScale !== 4 || !Array.isArray(payload.rows)) return false
  if (payload.reason != null && typeof payload.reason !== 'string') return false
  if (payload.context != null && (!isObject(payload.context) || Object.entries(payload.context).some(([key,value]) => !['warehouseTaskIds','priceHistoryIds'].includes(key) && !isScalar(value)))) return false
  if (['warehouseTaskIds','priceHistoryIds'].some(key => payload.context?.[key] != null && (!Array.isArray(payload.context[key]) || !payload.context[key].every(validId)))) return false
  if (payload.actors != null && (!isObject(payload.actors) || Object.values(payload.actors).some(value => !isObject(value) || (value.id != null && !validId(value.id)) || ['name','role'].some(key => value[key] != null && typeof value[key] !== 'string')))) return false
  if (payload.kind === 'price_history_refs' && (!Array.isArray(payload.context?.priceHistoryIds) || !payload.context.priceHistoryIds.every(id => Number.isSafeInteger(id) && id > 0))) return false
  const line = value => value == null || (isObject(value) && ['physical','ordinary','kit','price'].includes(value.kind) && Object.entries(value).every(([key,entry]) => key === 'components' || isScalar(entry)) && Array.isArray(value.components) && value.components.every(component => isObject(component) && Object.values(component).every(isScalar)))
  return payload.rows.every(row => isObject(row) && typeof row.key === 'string' && ['added','removed','changed'].includes(row.action) && (row.before != null || row.after != null) && line(row.before) && line(row.after))
}
const validId = id => Number.isSafeInteger(id) && id > 0
function taskReferences(event) {
  const payload = event._scope?.raw || event.payload
  const context = payload?.version === 1 ? payload.context || {} : payload || {}
  const ids = [], adjustments = []
  let valid = !event._scope?.invalid && isObject(context)
  for (const key of ['warehouseTaskId','taskId']) {
    if (context[key] == null) continue
    if (!validId(context[key])) valid = false
    else ids.push(context[key])
  }
  if (context.warehouseTaskIds != null) {
    if (!Array.isArray(context.warehouseTaskIds) || !context.warehouseTaskIds.every(validId)) valid = false
    else ids.push(...context.warehouseTaskIds)
  }
  if (context.tasks != null) {
    if (!Array.isArray(context.tasks) || !context.tasks.every(task => isObject(task) && validId(task.taskId))) valid = false
    else ids.push(...context.tasks.map(task => task.taskId))
  }
  if (context.adjustmentId != null) {
    if (!validId(context.adjustmentId)) valid = false
    else adjustments.push(context.adjustmentId)
  }
  if (context.saleEventId != null && !validId(context.saleEventId)) valid = false
  if (context.pending === true && context.phase === 'execution_adjustment' && !ids.length && !adjustments.length) valid = false
  return { valid, ids: [...new Set(ids)], adjustments }
}
function rowsInScope(payload, warehouseIds) {
  const allowed = Array.isArray(warehouseIds) ? new Set(warehouseIds.map(Number)) : null
  return !payload.rows.some(row => [row.before,row.after].some(line => line && (!validId(line.warehouseId) || (allowed && !allowed.has(line.warehouseId)))))
}
module.exports = { isKnownChangePayload, taskReferences, validId, rowsInScope }
