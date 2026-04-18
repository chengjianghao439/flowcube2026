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
  get JWT_SECRET() {
    return readJwtSecret()
  },
  JWT_EXPIRES_IN: readString('JWT_EXPIRES_IN', { defaultValue: '7d' }),
  CORS_ORIGIN: readString('CORS_ORIGIN', { defaultValue: IS_PROD ? '' : 'http://localhost:5173', allowEmpty: true }),
  CORS_REFLECT: readBool('CORS_REFLECT', false),
  CORS_ALLOW_NULL_ORIGIN: readBool('CORS_ALLOW_NULL_ORIGIN', !IS_PROD),
  TRUST_PROXY: readBool('TRUST_PROXY', false),
  APP_PUBLIC_URL: readString('APP_PUBLIC_URL', { defaultValue: '', allowEmpty: true }).replace(/\/$/, ''),
  APP_UPDATE_USE_GITHUB_DIRECT_URL: readBool('APP_UPDATE_USE_GITHUB_DIRECT_URL', false),
  APP_UPDATE_DOWNLOADS_DIR: readString('APP_UPDATE_DOWNLOADS_DIR', { defaultValue: '', allowEmpty: true }),
  APP_UPDATE_MANIFEST_PATH: readString('APP_UPDATE_MANIFEST_PATH', { defaultValue: '', allowEmpty: true }),
  GITHUB_OWNER: readString('GITHUB_OWNER', { defaultValue: 'chengjianghao439' }),
  GITHUB_REPO: readString('GITHUB_REPO', { defaultValue: 'flowcube2026' }),
}

if (IS_PROD) {
  if (!env.DB_USER) throw new Error('生产环境必须显式设置 DB_USER')
  if (!env.DB_PASSWORD) throw new Error('生产环境必须显式设置 DB_PASSWORD')
}

module.exports = { env }
