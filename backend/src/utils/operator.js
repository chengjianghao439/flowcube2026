function normalizeOperator(user = {}) {
  const userId = user.userId ?? user.id ?? null
  const username = user.username ?? null
  const realName = user.realName ?? user.real_name ?? null
  const displayName = realName || username || '未知'

  return {
    userId,
    username,
    realName: displayName,
    userName: displayName,
    operatorId: userId,
    operatorName: displayName,
  }
}

function getOperatorFromRequest(req) {
  return normalizeOperator(req?.user || {})
}

module.exports = {
  normalizeOperator,
  getOperatorFromRequest,
}
