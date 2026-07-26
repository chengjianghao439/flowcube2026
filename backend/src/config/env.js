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
  JWT_EXPIRES_IN: readString('JWT_EXPIRES_IN', { defaultValue: '7d' }),
  CORS_ORIGIN: readString('CORS_ORIGIN', { defaultValue: IS_PROD ? '' : 'http://localhost:5173', allowEmpty: true }),
  CORS_REFLECT: readBool('CORS_REFLECT', false),
  CORS_ALLOW_NULL_ORIGIN: readBool('CORS_ALLOW_NULL_ORIGIN', !IS_PROD),
  TRUST_PROXY: readBool('TRUST_PROXY', false),
  APP_PUBLIC_URL: readString('APP_PUBLIC_URL', { defaultValue: '', allowEmpty: true }).replace(/\/$/, ''),
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
  // PDA 设备会话强制开关。默认 false：新版部署后 PDA 仍能用旧方式作业，
  // 等设备在 ERP 里登记完、现场扫码绑定完、确认都在线了，再打开这个开关。
  // 直接以 true 上线会让所有尚未绑定的 PDA 当场全部不可用——开关只是一行 env，
  // 打开不需要重新发版，没有任何理由为了省事而冒这个险。
  PDA_SESSION_REQUIRED: readBool('PDA_SESSION_REQUIRED', false),
}

if (IS_PROD) {
  if (!env.DB_HOST) throw new Error('生产环境必须显式设置 DB_HOST')
  if (!env.DB_USER) throw new Error('生产环境必须显式设置 DB_USER')
  if (!env.DB_PASSWORD) throw new Error('生产环境必须显式设置 DB_PASSWORD')
  if (!env.DB_NAME) throw new Error('生产环境必须显式设置 DB_NAME')
  if (!env.APP_PUBLIC_URL) {
    throw new Error('生产环境必须显式设置 APP_PUBLIC_URL，避免桌面更新链进入半残运行')
  }
}

module.exports = { env }
