const AppError = require('./AppError')

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
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

function validatePositiveIntParam(paramName = 'id', label = '编号') {
  return (req, _res, next) => {
    const raw = String(req.params?.[paramName] ?? '').trim()
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return next(new AppError(`${label}无效`, 400, 'INVALID_ID'))
    }
    next()
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
  validateBody,
  validateParams,
  validatePositiveIntParam,
  validateQuery,
}
