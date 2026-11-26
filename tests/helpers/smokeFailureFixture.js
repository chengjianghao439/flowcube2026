'use strict'

// 只在独立子进程中加载。让 smoke 正文失败，并观测自身、应用两个连接池的关闭。
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '../..')
const failure = () => { throw Error('W4_SMOKE_FIXTURE_FAILURE') }
const pool = { query: async () => [[]], end: async () => console.log('W4_APP_CLOSED') }
const context = { pool, http: {}, warehouse: { id: 1 }, printer: { id: 1 }, close: async () => console.log('W4_CONTEXT_CLOSED') }
const fake = {
  createLogger: () => ({ section: failure, assert: failure, summary: () => ({ failed: 0 }) }),
  prepareSmokeContext: async () => context, login: failure, dbQuery: failure, randomRef: failure,
}
function replace(relative, exports) {
  const key = require.resolve(path.join(root, relative))
  const mod = new Module(key)
  mod.exports = exports
  mod.loaded = true
  require.cache[key] = mod
}
replace('backend/src/config/db', { pool })
replace('backend/src/engine/containerEngine', {})
replace('backend/src/modules/return-tasks/return-tasks.service', {})
replace('tests/helpers/smokeTestKit', fake)
