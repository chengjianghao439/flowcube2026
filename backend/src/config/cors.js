function buildCorsOptions(env) {
  const corsOriginEnv = env.CORS_ORIGIN
  if (env.IS_PROD && (env.CORS_REFLECT || String(corsOriginEnv || '').split(',').some(origin => origin.trim() === '*'))) {
    throw new Error('生产 CORS 必须配置明确来源，禁止 CORS_REFLECT 和通配符')
  }
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
