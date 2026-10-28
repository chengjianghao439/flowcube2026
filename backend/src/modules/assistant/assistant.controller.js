const service = require('./assistant.service')
const { successResponse } = require('../../utils/response')

function createAssistantController(activeService = service) {
  const handle = (method, pathname) => async (req, res, next) => {
    try {
      const data = await activeService.dispatch(req, { method, pathname: typeof pathname === 'function' ? pathname(req) : pathname })
      res.setHeader('Cache-Control', 'no-store')
      return successResponse(res, data)
    } catch (error) { return next(error) }
  }
  return {
    health: handle('GET', '/health'), me: handle('GET', '/me'), tools: handle('GET', '/tools'), list: handle('GET', '/tasks'),
    chat: handle('POST', '/chat'),
    detail: handle('GET', req => `/tasks/${encodeURIComponent(req.params.id)}`),
    confirm: handle('POST', req => `/tasks/${encodeURIComponent(req.params.id)}/confirm`),
    cancel: handle('POST', req => `/tasks/${encodeURIComponent(req.params.id)}/cancel`),
  }
}

module.exports = { ...createAssistantController(), createAssistantController }
