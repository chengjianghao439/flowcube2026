const rateLimit = require('express-rate-limit')
const AppError = require('../utils/AppError')

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function createApiLimiter(options = {}) {
  return rateLimit({
    windowMs: positiveInteger(options.windowMs ?? process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: positiveInteger(options.max ?? process.env.RATE_LIMIT_MAX, 1000),
    standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, message: '请求过于频繁，请稍后再试', data: null }),
  })
}

function createLoginLimiter(options = {}) {
  const limiter = rateLimit({
    windowMs: positiveInteger(options.windowMs ?? process.env.AUTH_LOGIN_WINDOW_MS, 15 * 60_000),
    max: positiveInteger(options.max ?? process.env.AUTH_LOGIN_MAX_PER_IP, 20),
    standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, message: '登录尝试过于频繁，请稍后再试', data: null }),
  })
  return (req, res, next) => {
    if (req.loginRateLimitChecked) return next()
    return limiter(req, res, error => {
      if (!error) req.loginRateLimitChecked = true
      next(error)
    })
  }
}

const loginLimiter = createLoginLimiter()

function createRequestConcurrencyGuard(max = 100) {
  let active = 0
  return (_req, res, next) => {
    if (active >= max) return res.status(429).json({ success: false, message: '服务繁忙，请稍后再试', data: null })
    active++
    let finished = false
    const release = () => { if (!finished) { finished = true; active-- } }
    res.once('finish', release)
    res.once('close', release)
    next()
  }
}

// Iterative traversal bounds the work before validators, logging or business SQL.
function validateBodyBudget(req, _res, next) {
  const stack = [{ value: req.body, depth: 0 }]
  let nodes = 0
  while (stack.length) {
    const { value, depth } = stack.pop()
    if (++nodes > 50_000 || depth > 32) return next(new AppError('请求数据结构过大或层级过深', 400, 'REQUEST_BODY_COMPLEXITY_EXCEEDED'))
    if (value && typeof value === 'object') {
      const children = Object.values(value)
      if (nodes + stack.length + children.length > 50_000) return next(new AppError('请求数据结构过大', 400, 'REQUEST_BODY_COMPLEXITY_EXCEEDED'))
      for (const child of children) stack.push({ value: child, depth: depth + 1 })
    }
  }
  next()
}

module.exports = { createApiLimiter, createLoginLimiter, loginLimiter, createRequestConcurrencyGuard, validateBodyBudget }
