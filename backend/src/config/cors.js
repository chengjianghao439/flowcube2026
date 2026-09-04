function buildCorsOptions(env) {
  const corsOriginEnv = env.CORS_ORIGIN
  const corsReflect = env.CORS_REFLECT || corsOriginEnv === '*'
  const allowNullOrigin = corsReflect || env.CORS_ALLOW_NULL_ORIGIN
  const staticAllowed = new Set(
    (corsOriginEnv || (!env.IS_PROD ? 'http://localhost:5173' : ''))
      .split(',').map(value => value.trim()).filter(Boolean),
  )
  return {
    origin: corsReflect
      ? true
      : (origin, callback) => {
          // file:// Electron 请求发的是字符串 "null"，并不是缺少 Origin 头。
          // 单独开关，不能为兼容桌面端而反射任意网站。
          if (!origin || origin === 'null') return callback(null, Boolean(allowNullOrigin))
          if (staticAllowed.has(origin)) return callback(null, true)
          return callback(null, false)
        },
    credentials: true,
  }
}

module.exports = { buildCorsOptions }
