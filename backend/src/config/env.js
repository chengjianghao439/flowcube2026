function readString(name, options = {}) {
  const { defaultValue = '', required = false, allowEmpty = false } = options
  const raw = process.env[name]
  if (raw === undefined || raw === null) {
    if (required) throw new Error(`缺少环境变量 ${name}`)
    return defaultValue
  }
  const value = String(raw).trim()
  if (!allowEmpty && required && !value) {
    throw new Error(`环境变量 ${name} 不能为空`)
  }
  return value || defaultValue
}

function readInt(name, options = {}) {
  const { defaultValue, required = false } = options
  const raw = process.env[name]
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (required && defaultValue === undefined) throw new Error(`缺少环境变量 ${name}`)
    return defaultValue
  }
  const value = Number.parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(value)) {
    throw new Error(`环境变量 ${name} 必须是整数`)
  }
  return value
}

function readBool(name, defaultValue = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase()
  if (!raw) return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

const NODE_ENV = readString('NODE_ENV', { defaultValue: 'development' })
const IS_PROD = NODE_ENV === 'production'

function readJwtSecret() {
  const value = readString('JWT_SECRET', { required: true })
  if (value.length < 32) {
    throw new Error('安全配置错误：JWT_SECRET 未设置或长度不足 32 位')
  }
  return value
}

const env = {
  NODE_ENV,
  IS_PROD,
  PORT: readInt('PORT', { defaultValue: 3000 }),
  DB_HOST: readString('DB_HOST', { defaultValue: '127.0.0.1' }),
  DB_PORT: readInt('DB_PORT', { defaultValue: 3306 }),
  DB_USER: readString('DB_USER', { defaultValue: 'flowcube' }),
  DB_PASSWORD: readString('DB_PASSWORD', { defaultValue: '', allowEmpty: true }),
  DB_NAME: readString('DB_NAME', { defaultValue: 'flowcube' }),
  JWT_SECRET: readJwtSecret(),
  // 密钥轮换（P2-15）：过渡期内可配置旧密钥，旧 token 仍可校验（新 token 用 JWT_SECRET 签发），
  // 切换后移除本变量即完成轮换。空/未配置 = 无旧密钥，只认 JWT_SECRET。
  JWT_SECRET_PREVIOUS: readString('JWT_SECRET_PREVIOUS', { defaultValue: '', allowEmpty: true }),
  // access token 有效期（2026-08-21 权衡修复：从 24h 缩到 2h，泄露窗口大幅缩短；
  // 长期运行客户端靠 refresh token 自动续期，不受影响）
  JWT_ACCESS_EXPIRES_IN: readString('JWT_ACCESS_EXPIRES_IN', { defaultValue: '2h' }),
  // refresh token 有效期（默认 30 天；一次性轮换 + jti 会话表，被泄露后重放即失效）
  JWT_REFRESH_EXPIRES_IN: readString('JWT_REFRESH_EXPIRES_IN', { defaultValue: '30d' }),
  CORS_ORIGIN: readString('CORS_ORIGIN', { defaultValue: IS_PROD ? '' : 'http://localhost:5173', allowEmpty: true }),
  CORS_REFLECT: readBool('CORS_REFLECT', false),
  CORS_ALLOW_NULL_ORIGIN: readBool('CORS_ALLOW_NULL_ORIGIN', !IS_PROD),
  TRUST_PROXY: readBool('TRUST_PROXY', false),
  APP_PUBLIC_URL: readString('APP_PUBLIC_URL', { defaultValue: '', allowEmpty: true }).replace(/\/$/, ''),
  // 日志集中检索（P2-12）：配置后 warn/error 级日志异步推送 Grafana Loki；未配置则完全无副作用
  LOKI_URL: readString('LOKI_URL', { defaultValue: '', allowEmpty: true }),
  APP_UPDATE_USE_GITHUB_DIRECT_URL: readBool('APP_UPDATE_USE_GITHUB_DIRECT_URL', false),
  APP_UPDATE_DOWNLOADS_DIR: readString('APP_UPDATE_DOWNLOADS_DIR', {
    defaultValue: '/var/www/flowcube-downloads',
  }),
  APP_UPDATE_MANIFEST_PATH: readString('APP_UPDATE_MANIFEST_PATH', { defaultValue: '', allowEmpty: true }),
  GITHUB_OWNER: readString('GITHUB_OWNER', { defaultValue: 'chengjianghao439' }),
  GITHUB_REPO: readString('GITHUB_REPO', { defaultValue: 'flowcube2026' }),
  // 连接池默认 30：业务事务普遍偏长（一次收货要建 N 个容器 + N 条打印任务，
  // 一次出库要逐商品扣容器 + 同步缓存 + 写日志），10 条连接在几十单并发时就会被占满，
  // 后续请求全部排队等待，表现为「系统卡住」而非报错。生产可用 DB_POOL_SIZE 覆盖，
  // 上调时注意不要超过 MySQL 的 max_connections（默认 151）除以实例数。
  DB_POOL_SIZE: readInt('DB_POOL_SIZE', { defaultValue: 30 }),
  // 超收金额闸门（元）：单次收货造成的超收金额超过它就要求二次确认，与 20% 比例闸门并列，
  // 任一超限即触发。纯比例闸门对大单形同虚设（应到 10000 件可静默超收 1999 件），
  // 而超收会随上架自动结算直接进应付。默认 500 元——按"错一次也就是一顿饭钱"的量级取，
  // 客单价高的仓库应调高，避免正常收货被频繁打断（审计 P1-3）。
  OVER_RECEIVE_CONFIRM_AMOUNT: readInt('OVER_RECEIVE_CONFIRM_AMOUNT', { defaultValue: 500 }),
}

/**
 * 快递面单平台凭据解析（文档 06）。
 *
 * 硬约束：app_id / app_key / app_secret **绝不入库明文**，只走环境变量。
 * carriers.credential_ref 只存"用哪一组凭据"的引用名（如 kdniao_main），运行时在此映射到
 * 对应的 env 变量组 WAYBILL_<REF大写>_APP_ID/APP_KEY/APP_SECRET/API_BASE。
 * 返回值只在 worker（事务外）调用适配器时使用，永不落库、不入日志、不返回前端。
 *
 * @param {string} credentialRef - carriers.credential_ref
 * @returns {{appId:string, appKey:string, appSecret:string, apiBase:string}|null}
 */
function getWaybillCredential(credentialRef) {
  const ref = String(credentialRef || '').trim()
  if (!ref) return null
  const key = ref.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const appId     = readString(`WAYBILL_${key}_APP_ID`,     { defaultValue: '', allowEmpty: true })
  const appKey    = readString(`WAYBILL_${key}_APP_KEY`,    { defaultValue: '', allowEmpty: true })
  const appSecret = readString(`WAYBILL_${key}_APP_SECRET`, { defaultValue: '', allowEmpty: true })
  const apiBase   = readString(`WAYBILL_${key}_API_BASE`,   { defaultValue: '', allowEmpty: true })
  if (!appKey && !appSecret && !appId) return null
  return { appId, appKey, appSecret, apiBase }
}

if (IS_PROD) {
  if (!env.DB_HOST) throw new Error('生产环境必须显式设置 DB_HOST')
  if (!env.DB_USER) throw new Error('生产环境必须显式设置 DB_USER')
  if (!env.DB_PASSWORD) throw new Error('生产环境必须显式设置 DB_PASSWORD')
  if (!env.DB_NAME) throw new Error('生产环境必须显式设置 DB_NAME')
  if (!env.APP_PUBLIC_URL) {
    throw new Error('生产环境必须显式设置 APP_PUBLIC_URL，避免桌面更新链进入半残运行')
  }
  // 2026-08-22 加固：反代后必须显式 TRUST_PROXY=1——否则登录限流按代理 IP 计数，
  // 所有客户端共享一个配额，可被单点爆破打满造成全员登录 DoS（见 auth.routes 限流注释）。
  if (!env.TRUST_PROXY) {
    throw new Error('生产环境必须显式设置 TRUST_PROXY=1（位于反代之后，登录限流按真实客户端 IP 计数）')
  }
}

module.exports = { env, getWaybillCredential }
