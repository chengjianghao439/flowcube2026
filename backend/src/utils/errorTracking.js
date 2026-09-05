'use strict'
const Sentry = require('@sentry/node')
let initialized = false

/** 只启用显式异常上报；不自动采集 HTTP、SQL、请求体或个人资料。 */
function initializeErrorTracking({ dsn = '', environment = process.env.NODE_ENV, transport, sendClientReports = true } = {}) {
  if (!String(dsn).trim()) return false
  if (initialized) return true
  Sentry.init({
    dsn: String(dsn).trim(), environment, defaultIntegrations: false, sendDefaultPii: false, sendClientReports,
    ...(transport ? { transport } : {}),
    beforeSend(event) {
      delete event.request
      delete event.user
      delete event.breadcrumbs
      return event
    },
  })
  initialized = true
  return true
}

function captureUnexpectedError(error, { requestId, method, route } = {}) {
  if (!initialized) return
  let eventId
  Sentry.withScope(scope => {
    if (method) scope.setTag('method', method)
    if (route) scope.setTag('route', route)
    if (requestId) scope.setExtra('requestId', requestId)
    eventId = Sentry.captureException(error)
  })
  return eventId
}

module.exports = { initializeErrorTracking, captureUnexpectedError }
