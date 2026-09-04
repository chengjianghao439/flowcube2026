'use strict'

const fs = require('node:fs')
const path = require('node:path')

function validateTestEnvironment(env = process.env) {
  const fail = (message) => { throw new Error(`[test-db] ${message}；请显式配置本机独立测试库，不读取 backend/.env`) }
  if (env.NODE_ENV !== 'test') fail('必须设置 NODE_ENV=test')
  if (!['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST)) fail('DB_HOST 必须是本机回环地址')
  if (!/^flowcube(?:_[a-z0-9]+)*_test$/.test(env.DB_NAME || '')) fail('DB_NAME 必须为 flowcube_test 或 flowcube_<用途>_test')
  const port = Number(env.DB_PORT)
  if (!/^\d+$/.test(String(env.DB_PORT || '')) || !Number.isInteger(port) || port < 1 || port > 65535) fail('必须显式设置合法 DB_PORT')
  if (!String(env.DB_USER || '').trim() || typeof env.DB_PASSWORD !== 'string') fail('必须显式设置 DB_USER 和 DB_PASSWORD')
  return { host: env.DB_HOST, port, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME }
}

function configureTestEnvironment({ env = process.env, file = env.FLOWCUBE_TEST_ENV_FILE } = {}) {
  const candidate = { ...env }
  if (file) {
    if (path.basename(file) !== '.env.test') throw new Error('[test-db] 测试配置文件必须命名为 .env.test，不能加载真实 .env')
    const dotenv = require('../../backend/node_modules/dotenv')
    const parsed = dotenv.parse(fs.readFileSync(path.resolve(file)))
    for (const [key, value] of Object.entries(parsed)) if (candidate[key] === undefined) candidate[key] = value
  }
  validateTestEnvironment(candidate)
  Object.assign(env, candidate)
  return env
}

module.exports = { validateTestEnvironment, configureTestEnvironment }
