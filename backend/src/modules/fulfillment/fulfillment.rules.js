const AppError = require('../../utils/AppError')
const { beijingTodayYmd } = require('../../utils/backendTime')
function dateOnly(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return beijingTodayYmd(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new AppError('日期格式应为 YYYY-MM-DD', 400)
  const d = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new AppError('日期不存在', 400)
  return value
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
module.exports = { dateOnly, assertIssueAction }
