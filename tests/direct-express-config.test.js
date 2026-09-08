'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
// 检查部署契约，不加载实际 .env。实际 Compose 渲染另以虚构配置验证。
test('Docker 向后端传递两家正式接入配置，前端不接收凭据', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../docker-compose.yml'), 'utf8')
  const backend = source.split('\n  backend:')[1].split('\n  frontend:')[0]
  const frontend = source.split('\n  frontend:')[1]
  for (const platform of ['SF', 'DEPPON']) {
    for (const field of ['APP_ID', 'APP_KEY', 'MODE', 'API_BASE', 'VERIFIED_MONTHLY_ACCOUNTS']) {
      const key = `WAYBILL_${platform}_MAIN_${field}`
      assert.ok(backend.includes(`${key}: \${${key}:-`), `缺少 ${key} 的部署传递`)
      assert.ok(!frontend.includes(key))
    }
  }
  for (const key of ['WAYBILL_SF_MAIN_PRODUCTS', 'WAYBILL_DEPPON_MAIN_QUERY_API_BASE', 'WAYBILL_DEPPON_MAIN_ORDER_PREFIX']) {
    assert.ok(backend.includes(`${key}: \${${key}:-`), `缺少 ${key} 的部署传递`)
  }
  assert.match(backend, /WAYBILL_SF_MAIN_MODE: \$\{WAYBILL_SF_MAIN_MODE:-production\}/)
  assert.match(backend, /WAYBILL_DEPPON_MAIN_MODE: \$\{WAYBILL_DEPPON_MAIN_MODE:-production\}/)
})
