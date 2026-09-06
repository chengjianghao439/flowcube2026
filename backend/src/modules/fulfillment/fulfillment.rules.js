const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
const quantity = value => Math.max(0, Math.round(Number(value || 0) * 10000) / 10000)
function dateOnly(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return beijingTodayYmd(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new AppError('日期格式应为 YYYY-MM-DD', 400)
  const d = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new AppError('日期不存在', 400)
  return value
}
function addDays(value, days) { return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10) }
function deliveryEstimate({ remaining, physical, sources, processingDays, today }) {
  let left = quantity(remaining)
  const batches = []
  const available = Math.min(left, quantity(physical))
  if (available) batches.push({ quantity: available, date: today })
  left = quantity(left - available)
  for (const source of sources) {
    const take = Math.min(left, quantity(source.quantity))
    if (!take) continue
    const date = dateOnly(source.date)
    batches.push({ quantity: take, date: date && date >= today && !source.unconfirmed ? date : null })
    left = quantity(left - take)
  }
  const unknownQuantity = quantity(batches.filter(b => !b.date).reduce((n, b) => n + b.quantity, 0))
  const dates = batches.filter(b => b.date).map(b => b.date).sort()
  const known = processingDays != null && Number.isInteger(Number(processingDays)) && Number(processingDays) >= 0
  return { shortage: left, unknownQuantity,
    firstDate: known && dates.length ? addDays(dates[0], Number(processingDays)) : null,
    allDate: known && !left && !unknownQuantity && dates.length ? addDays(dates.at(-1), Number(processingDays)) : null }
}
function assertIssueAction(issue, action, result, active) {
  if (action === 'resolve') {
    if (!String(result || '').trim()) throw new AppError('请填写处理结果', 400)
    if (issue.source === 'auto' && active) throw new AppError('阻塞条件仍存在，请先完成对应业务处理', 409)
  }
  if (action === 'claim' && issue.owner_id != null) throw new AppError('事项已被认领，请刷新后转派', 409)
  if (action !== 'reopen' && issue.status === 'resolved') throw new AppError('事项已处理，请刷新', 409)
  if (action === 'reopen' && issue.status !== 'resolved') throw new AppError('事项尚未关闭', 409)
}
function isDeliveryLate({ remaining, promisedDate, allDate, sources, today }) {
  return remaining > 0 && !!promisedDate && (promisedDate < today || (!!allDate && allDate > promisedDate)
    || sources.some(s => s.bound && s.quantity > 0 && s.date && s.date > promisedDate))
}
module.exports = { dateOnly, quantity, deliveryEstimate, assertIssueAction, isDeliveryLate }
