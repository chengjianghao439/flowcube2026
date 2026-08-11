const { successResponse } = require('./response')

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function successRoute(handler, message = 'ok', statusCode = 200) {
  return asyncRoute(async (req, res) => {
    const result = await handler(req, res)
    const resolvedMessage = typeof message === 'function' ? message(result, req) : message
    return successResponse(res, result, resolvedMessage, statusCode)
  })
}

function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (err) {
      next(err)
    }
  }
}

function validateParams(schema) {
  return (req, res, next) => {
    try {
      req.params = schema.parse(req.params)
      next()
    } catch (err) {
      next(err)
    }
  }
}

function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.query = schema.parse(req.query)
      next()
    } catch (err) {
      next(err)
    }
  }
}

module.exports = {
  asyncRoute,
  successRoute,
  validateBody,
  validateParams,
  validateQuery,
}
