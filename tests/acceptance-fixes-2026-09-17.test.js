'use strict'
/**
 * 2026-09-17 全系统深度验收的修复守卫。
 *
 * 覆盖四类已复现问题，全部为离线断言（不连数据库）：
 *  1. 畸形 JSON 请求体必须返回 400，不能落到「未知错误」500；
 *  2. 已废弃的设置键不得再出现在设置列表、也不得被批量保存写入；
 *  3. 执行期取消订单后，明细的已占/已派发投影必须归零；
 *  4. 一致性审计脚本必须持续覆盖孤儿容器与任务锁泄漏。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// errorHandler 在加载时初始化 env（要求 JWT_SECRET ≥32 位）。离线断言用固定测试值，
// 不读真实 .env，也不连接数据库。
process.env.JWT_SECRET = process.env.JWT_SECRET || 'offline-assertion-secret-key-0123456789'

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
}

test('Zod 校验失败保持 400 与原中文说明，不因错误对象接口变化崩溃', () => {
  const { z } = require('../backend/node_modules/zod')
  const errorHandler = require('../backend/src/middleware/errorHandler')
  const parsed = z.object({ quantity: z.number().positive('数量必须大于零') }).safeParse({ quantity: 0 })
  const req = { originalUrl: '/api/test', method: 'POST', requestId: 'zod-validation-fixture' }
  const res = fakeRes()
  assert.equal(parsed.success, false)
  errorHandler(parsed.error, req, res, () => {})
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'VALIDATION_ERROR')
  assert.equal(res.body.message, '数量必须大于零')
})

test('超过既有数组上限时，在逐元素校验前拒绝，不累积海量错误', () => {
  const { z } = require('../backend/node_modules/zod')
  let parsedElements = 0
  const schema = z.array(z.string().superRefine(() => { parsedElements++ })).max(200, '明细不能超过 200 行')
  const result = schema.safeParse(Array(201).fill('fixture'))
  assert.equal(result.success, false)
  assert.equal(result.error.issues.length, 1)
  assert.equal(result.error.issues[0].message, '明细不能超过 200 行')
  assert.equal(parsedElements, 0)
  assert.deepEqual(schema.parse(['fixture']), ['fixture'])
})

// 只替换认证与控制器边界，执行真实路由中的 schema / 参数校验，不加载数据库。
function offlineRouter(relative) {
  const vm = require('node:vm')
  const { createRequire } = require('node:module')
  const filename = path.join(ROOT, 'backend/src/modules', relative)
  const localRequire = createRequire(filename)
  const next = (_req, _res, done) => done?.()
  const handlers = new Proxy({}, { get: () => next })
  const module_ = { exports: {} }
  const require_ = id => {
    if (id.endsWith('.controller') || id.endsWith('.service')) return handlers
    if (id === '../../middleware/auth') return { authMiddleware: next, requirePermission: () => next, requireAnyPermission: () => next }
    if (id === '../../middleware/apiIngress') return { loginLimiter: next }
    if (id === './system.split-device') return { splitReceiptDevice: next }
    return localRequire(id)
  }
  vm.runInNewContext(read(path.relative(ROOT, filename)), { require: require_, module: module_, exports: module_.exports }, { filename })
  return module_.exports
}

test('登录和操作回执查询保留原校验响应及中文必填提示', () => {
  const login = offlineRouter('auth/auth.routes.js').stack.find(layer => layer.route?.path === '/login').route
  const loginRes = fakeRes()
  login.stack[1].handle({ body: { username: '', password: 'fixture' } }, loginRes, () => assert.fail('无效登录不得进入控制器'))
  assert.equal(loginRes.statusCode, 400)
  assert.equal(loginRes.body.message, '账号不能为空')
  const query = offlineRouter('system/system.routes.js').stack.find(layer => layer.route?.path === '/request-status/:key').route
  for (const action of [undefined, '   ']) {
    const res = fakeRes()
    query.stack[0].handle({ query: action === undefined ? {} : { action } }, res, () => assert.fail('缺少 action 必须拒绝'))
    assert.equal(res.statusCode, 400)
    assert.equal(res.body.message, '缺少 action 参数')
  }
  const req = { query: { action: ' transfer.scanOut.7 ', warehouseId: '3' } }
  let passed = false
  query.stack[0].handle(req, fakeRes(), () => { passed = true })
  assert.equal(passed, true)
  assert.equal(req.query.action, 'transfer.scanOut.7')
  assert.equal(req.query.warehouseId, 3)
})

test('打印机和设备状态的非法枚举保留中文原因', () => {
  for (const [file, method, path_, req, message] of [
    ['printer-bindings/printer-bindings.routes.js', 'put', '/:type', { params: { type: 'invalid-fixture' } }, '无效的打印类型'],
    ['pda-devices/pda-devices.routes.js', 'put', '/:id/status', { body: { status: 'invalid-fixture' } }, '设备状态无效'],
  ]) {
    const route = offlineRouter(file).stack.find(layer => layer.route?.path === path_ && layer.route.methods[method]).route
    let error
    route.stack[1].handle(req, fakeRes(), err => { error = err })
    assert.equal(error?.issues?.[0]?.message, message)
  }
})

test('超额申请沿用原到期时间格式，分钟、秒和小数秒均兼容', () => {
  const route = offlineRouter('credit-overrides/credit-overrides.routes.js').stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route
  for (const expiresAt of ['2026-10-24T10:00Z', '2026-10-24T10:00:00Z', '2026-10-24T10:00:00.123Z', undefined]) {
    const req = { body: { saleOrderId: 7, reason: 'fixture', ...(expiresAt === undefined ? {} : { expiresAt }) } }
    let error
    route.stack[1].handle(req, fakeRes(), err => { error = err })
    assert.equal(error, undefined)
    assert.equal(req.body.expiresAt, expiresAt)
  }
  for (const expiresAt of ['2026-02-30T10:00Z', '2026-10-24T24:00Z', '2026-10-24T10:00', '2026-10-24T10:00+08:00']) {
    let error
    route.stack[1].handle({ body: { saleOrderId: 7, reason: 'fixture', expiresAt } }, fakeRes(), err => { error = err })
    assert.equal(error?.name, 'ZodError')
  }
})

test('打印机绑定省略仓库仍按原规则解析为公司级零，不提前返回校验错误', () => {
  const router = offlineRouter('printer-bindings/printer-bindings.routes.js')
  for (const method of ['put', 'delete']) {
    const route = router.stack.find(layer => layer.route?.path === '/:type' && layer.route.methods[method]).route
    for (const value of [undefined, '', null, 0, '0', '3']) {
      const warehouse = value === undefined ? {} : { warehouseId: value }
      const req = method === 'put' ? { body: { printerId: '7', ...warehouse } } : { query: warehouse }
      let error
      route.stack[2].handle(req, fakeRes(), err => { error = err })
      assert.equal(error, undefined)
      assert.equal((req.body ?? req.query).warehouseId, Number(value) || 0)
    }
  }
})

test('畸形 JSON 请求体返回 400 而不是 500', () => {
  const errorHandler = require('../backend/src/middleware/errorHandler')
  const req = { originalUrl: '/api/auth/login', method: 'POST', body: {}, params: {}, requestId: 'test-req' }
  const res = fakeRes()
  const err = Object.assign(
    new SyntaxError('Unexpected non-whitespace character after JSON at position 2'),
    { type: 'entity.parse.failed', status: 400 },
  )

  errorHandler(err, req, res, () => {})

  assert.equal(res.statusCode, 400, 'body-parser 解析失败必须是 400')
  assert.equal(res.body.success, false)
  assert.equal(res.body.code, 'BAD_REQUEST')
})

test('超大请求体返回 413，未知错误仍是 500', () => {
  const errorHandler = require('../backend/src/middleware/errorHandler')
  const req = { originalUrl: '/api/products', method: 'POST', body: {}, params: {}, requestId: 'test-req' }

  const tooLarge = fakeRes()
  errorHandler(Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 }), req, tooLarge, () => {})
  assert.equal(tooLarge.statusCode, 413)
  assert.equal(tooLarge.body.code, 'PAYLOAD_TOO_LARGE')

  const unknown = fakeRes()
  errorHandler(new Error('boom'), req, unknown, () => {})
  assert.equal(unknown.statusCode, 500, '真正的未知错误不能被降级成 4xx')
  assert.equal(unknown.body.code, 'INTERNAL_ERROR')
})

// 2026-09-17 验收 ISSUE-003 / ISSUE-016：箱贴未打印、整箱数量超计划这类 409 都带
// 可操作的中文原因，此前被兜底成 CONFLICT，前端再映射成「状态已变化，请刷新后重试」，
// 现场反复刷新永远无效。后端不得再给未带业务码的 AppError 编造通用码。
test('未带业务码的 AppError 必须保留后端中文原因，不再兜底 CONFLICT', () => {
  const errorHandler = require('../backend/src/middleware/errorHandler')
  const AppError = require('../backend/src/utils/AppError')
  const req = { originalUrl: '/api/warehouse-tasks/1999/pack-done', method: 'PUT', body: {}, params: { id: '1999' }, requestId: 'test-req' }

  const noCode = fakeRes()
  errorHandler(new AppError('箱贴仍待确认：箱号 L000493 尚未打印完成，请先收口打印任务', 409), req, noCode, () => {})
  assert.equal(noCode.statusCode, 409)
  assert.equal(noCode.body.code, null, '没有业务码时不得编造 CONFLICT')
  assert.match(noCode.body.message, /箱贴仍待确认/, '可操作的中文原因必须原样返回')

  const withCode = fakeRes()
  errorHandler(new AppError('设备绑定仓库与调拨源仓不一致，无法扫出', 403, 'PDA_WAREHOUSE_MISMATCH'), req, withCode, () => {})
  assert.equal(withCode.body.code, 'PDA_WAREHOUSE_MISMATCH', '显式业务码必须保留')
})

test('已废弃设置键从列表隐藏且不接受写入', () => {
  const source = read('backend/src/modules/settings/settings.service.js')
  const deprecated = ['sale_prefix', 'purchase_prefix', 'stockcheck_prefix', 'code_digits',
    'code_prefix_customer', 'code_prefix_supplier', 'code_prefix_product']
  for (const key of deprecated) {
    assert.match(source, new RegExp(`'${key}'`), `废弃键 ${key} 必须登记在 DEPRECATED_SETTING_KEYS`)
  }
  assert.match(source, /rows\.filter\(r => !DEPRECATED_SETTING_KEYS\.has\(r\.key_name\)\)/,
    '设置列表必须过滤废弃键')
  assert.match(source, /entries\.filter\(\(\[key\]\) => !DEPRECATED_SETTING_KEYS\.has\(key\)\)/,
    '批量保存必须跳过废弃键')
})

test('执行期取消订单必须清零明细的已占/已派发投影', () => {
  const source = read('backend/src/modules/sale/sale.service.js')
  assert.match(source, /UPDATE sale_order_items SET reserved_qty = 0, dispatched_qty = 0 WHERE order_id = \?/,
    '执行期取消（无实发）必须把 reserved_qty/dispatched_qty 归零')
  const cancelBlock = source.slice(source.indexOf('async function cancel'), source.indexOf('async function deleteOrder'))
  assert.match(cancelBlock, /UPDATE sale_order_items SET reserved_qty = 0, dispatched_qty = 0/,
    '清零语句必须位于 cancel 分支内')
})

test('一致性审计覆盖孤儿容器与任务锁泄漏', () => {
  const source = read('backend/scripts/audit-business-consistency.cjs')
  for (const id of ['container_product_orphan', 'container_warehouse_orphan', 'task_lock_leak']) {
    assert.match(source, new RegExp(`add\\('${id}'`), `审计脚本必须包含 ${id}`)
  }
})

test('角色名回填与设置文案修正有对应迁移', () => {
  const roleSync = read('backend/src/database/243_sync_user_role_name.sql')
  assert.match(roleSync, /UPDATE sys_users u\s+JOIN sys_roles r ON r\.id = u\.role_id/)
  assert.match(roleSync, /WHERE u\.role_name <> r\.name/, '回填迁移必须可重复执行')

  const remarkFix = read('backend/src/database/244_settings_remark_prefix_truth.sql')
  assert.match(remarkFix, /code_prefix_so/)
  assert.match(remarkFix, /code_digits/)
})
