#!/usr/bin/env node
'use strict'

/**
 * PDA 设备会话回归测试
 *
 * 设备会话给「谁在操作」之外补上「用哪台机器操作」这一维：
 *   · 绑了仓库的设备扫别仓的单据 → 直接拒绝（此前这道拦截因为票据恒空，从未触发过）
 *   · 设备丢失 → ERP 停用即吊销全部票据，那台机器当场作业不了
 *   · 重置密钥 → 旧密钥作废、旧票据吊销，必须重新扫码绑定
 *
 * 设备会话是硬性要求（没有开关）：未绑定设备的 PDA 一律作业不了。
 *
 * 运行：node tests/pda-device-session.smoke.test.js
 */

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createInboundTaskFromPurchase,
} = require('./helpers/smokeTestKit')

/**
 * 只带 X-Client 不带票据的头。
 * 注意 smokeTestKit 的 pdaHeaders() 本身就附了一张有效票据（初始化时用 SMOKE-PDA-01 建的），
 * 拿它来测「没有票据的机器」等于什么都没测——这里必须显式构造一个干净的头。
 */
function noSessionHeaders(extra = {}) {
  return { 'X-Client': 'pda', ...extra }
}

async function createProduct(pool, label) {
  const code = randomRef(`DEV-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 10, 5)",
    [code, `设备会话测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `设备会话测试商品-${label}`, unit: '个' }
}

async function createWarehouse(pool, name) {
  const [r] = await pool.query(
    'INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
    [name, randomRef('WH').slice(0, 30)],
  )
  return { id: r.insertId, name }
}

/** 走 ERP 接口登记设备，拿回一次性密钥 */
async function registerDevice(http, token, { deviceName, warehouseId }) {
  const resp = await http.post('/api/pda-devices', {
    token,
    json: { deviceName, warehouseId: warehouseId ?? null },
  })
  return { status: resp.status, data: resp.data?.data, raw: resp.data }
}

/** 用设备码+密钥换票据 */
async function openSession(http, token, { deviceCode, deviceSecret }) {
  const resp = await http.post('/api/pda/sessions', {
    token,
    json: { device_code: deviceCode, device_secret: deviceSecret },
  })
  return { status: resp.status, token: resp.data?.data?.session_token, warehouseId: resp.data?.data?.warehouse_id }
}

/** 建一张指定仓库、已提交到 PDA 的收货订单 */
async function seedInboundTask(ctx, token, warehouse) {
  const product = await createProduct(ctx.pool, 'in')
  const poResp = await createPurchaseOrder(ctx.http, token, {
    supplier: ctx.supplier, warehouse, product, quantity: 10,
  })
  const poId = Number(poResp.data?.data?.id)
  await confirmPurchaseOrder(ctx.http, token, poId)
  const taskResp = await createInboundTaskFromPurchase(ctx.http, token, poId)
  const taskId = Number(taskResp.data?.data?.taskId)
  await ctx.http.post(`/api/inbound-tasks/${taskId}/submit`, { token })
  return { taskId, product }
}

async function scenarioRegisterAndBind(ctx, log, token) {
  log.section('设备登记：密钥只发一次，之后取不回来')
  const { http, pool, warehouse } = ctx

  const created = await registerDevice(http, token, { deviceName: '回归测试机A', warehouseId: warehouse.id })
  log.assert('登记设备成功', created.status === 201, JSON.stringify(created.raw).slice(0, 160))
  log.assert(
    '★ 响应里带出设备码与 64 位密钥（现场据此生成绑定二维码）',
    /^PDA-\d{6}-[0-9A-F]{4}$/.test(created.data?.deviceCode || '') && (created.data?.deviceSecret || '').length === 64,
    `code=${created.data?.deviceCode} secretLen=${(created.data?.deviceSecret || '').length}`,
  )

  const detail = await http.get(`/api/pda-devices/${created.data.id}`, { token })
  log.assert(
    '★ 再查详情拿不到密钥（库里只存 bcrypt 哈希，丢了只能重置）',
    detail.ok && detail.data?.data?.deviceSecret === undefined,
    JSON.stringify(detail.data?.data).slice(0, 160),
  )

  const [row] = await dbQuery(pool, 'SELECT secret_hash FROM pda_devices WHERE id=?', [created.data.id])
  log.assert(
    '★ 数据库里存的是哈希而不是明文密钥',
    String(row.secret_hash).startsWith('$2') && String(row.secret_hash) !== created.data.deviceSecret,
    String(row.secret_hash).slice(0, 20),
  )

  const session = await openSession(http, token, created.data)
  log.assert('用密钥可以换到设备票据', session.status === 200 && !!session.token, `status=${session.status}`)
  log.assert(
    '★ 票据带回设备绑定的仓库（跨仓拦截据此判定）',
    Number(session.warehouseId) === Number(warehouse.id),
    `票据仓库=${session.warehouseId} 期望=${warehouse.id}`,
  )

  const wrongSecret = await openSession(http, token, { deviceCode: created.data.deviceCode, deviceSecret: 'x'.repeat(64) })
  log.assert('错误密钥换不到票据', wrongSecret.status === 401, `status=${wrongSecret.status}`)

  return { device: created.data, sessionToken: session.token }
}

async function scenarioCrossWarehouseBlocked(ctx, log, token, bound) {
  log.section('跨仓拦截：绑了 A 仓的机器扫 B 仓的单据必须被拒')
  const { http, pdaSessionHeaders } = ctx

  const otherWarehouse = await createWarehouse(ctx.pool, '设备会话外仓')
  const mine = await seedInboundTask(ctx, token, ctx.warehouse)
  const others = await seedInboundTask(ctx, token, otherWarehouse)

  const okResp = await http.post(`/api/inbound-tasks/${mine.taskId}/receive`, {
    token,
    headers: pdaSessionHeaders(bound.sessionToken),
    json: { productId: Number(mine.product.id), packages: [{ qty: 1 }] },
  })
  log.assert('本仓的收货正常放行', okResp.ok, `status=${okResp.status} ${JSON.stringify(okResp.data).slice(0, 140)}`)

  const blocked = await http.post(`/api/inbound-tasks/${others.taskId}/receive`, {
    token,
    headers: pdaSessionHeaders(bound.sessionToken),
    json: { productId: Number(others.product.id), packages: [{ qty: 1 }] },
  })
  log.assert(
    '★ 本机扫别仓的收货单被拒（修复前 req.pda 恒为 null，这道拦截从未触发过）',
    blocked.status === 403,
    `status=${blocked.status} ${JSON.stringify(blocked.data).slice(0, 160)}`,
  )

  const [items] = [await dbQuery(ctx.pool, 'SELECT COALESCE(SUM(received_qty),0) AS q FROM inbound_task_items WHERE task_id=?', [others.taskId])]
  log.assert('被拒时别仓那张单一件都没入账', Number(items[0].q) === 0, `received=${items[0].q}`)
}

async function scenarioDisableRevokes(ctx, log, token, bound) {
  log.section('设备停用：票据立刻失效（设备丢失时的止血手段）')
  const { http, pdaSessionHeaders } = ctx

  const task = await seedInboundTask(ctx, token, ctx.warehouse)
  const before = await http.post(`/api/inbound-tasks/${task.taskId}/receive`, {
    token, headers: pdaSessionHeaders(bound.sessionToken),
    json: { productId: Number(task.product.id), packages: [{ qty: 1 }] },
  })
  log.assert('停用前可正常作业', before.ok, `status=${before.status}`)

  const off = await http.put(`/api/pda-devices/${bound.device.id}/status`, { token, json: { status: 'disabled' } })
  log.assert('停用设备成功', off.ok, JSON.stringify(off.data).slice(0, 140))
  log.assert(
    '★ 停用同时吊销了在用会话（只改状态不吊票据的话，那台机器还能用到票据过期）',
    Number(off.data?.data?.revokedSessions) >= 1,
    `revoked=${off.data?.data?.revokedSessions}`,
  )

  const [sessions] = [await dbQuery(
    ctx.pool,
    'SELECT COUNT(*) AS n FROM pda_device_sessions WHERE device_id=? AND revoked_at IS NULL',
    [bound.device.id],
  )]
  log.assert('库里已无该设备的有效会话', Number(sessions[0].n) === 0, `剩余=${sessions[0].n}`)

  // 观察模式下被吊销的票据等同于「没带票据」→ 放行；强制模式下必须 403。
  // 数量刻意与上一次不同：同商品同箱型 30 秒内重复提交会命中重复扫码防重（P1-5），
  // 那是另一条正确生效的闸门，会掩盖这里真正要验的设备会话行为。
  const after = await http.post(`/api/inbound-tasks/${task.taskId}/receive`, {
    token, headers: pdaSessionHeaders(bound.sessionToken),
    json: { productId: Number(task.product.id), packages: [{ qty: 2 }] },
  })
  log.assert(
    '★ 被吊销票据的机器立刻作业不了（丢失设备的止血闭环到此完整）',
    after.status === 403 && after.data?.code === 'PDA_SESSION_REQUIRED',
    `status=${after.status} code=${after.data?.code}`,
  )

  const backOn = await http.put(`/api/pda-devices/${bound.device.id}/status`, { token, json: { status: 'active' } })
  log.assert('可以重新启用设备', backOn.ok, `status=${backOn.status}`)
}

async function scenarioResetSecret(ctx, log, token) {
  log.section('重置密钥：旧密钥作废且吊销票据')
  const { http, warehouse } = ctx

  const created = await registerDevice(http, token, { deviceName: '回归测试机B', warehouseId: warehouse.id })
  const first = await openSession(http, token, created.data)
  log.assert('前置：拿到第一张票据', !!first.token, `status=${first.status}`)

  const reset = await http.post(`/api/pda-devices/${created.data.id}/reset-secret`, { token })
  log.assert('重置密钥成功', reset.ok, JSON.stringify(reset.data).slice(0, 140))
  log.assert(
    '★ 新密钥与旧密钥不同，且旧票据被吊销',
    reset.data?.data?.deviceSecret && reset.data.data.deviceSecret !== created.data.deviceSecret
      && Number(reset.data?.data?.revokedSessions) >= 1,
    `revoked=${reset.data?.data?.revokedSessions}`,
  )

  const oldSecret = await openSession(http, token, created.data)
  log.assert('★ 旧密钥再也换不到票据', oldSecret.status === 401, `status=${oldSecret.status}`)

  const newSecret = await openSession(http, token, {
    deviceCode: created.data.deviceCode,
    deviceSecret: reset.data.data.deviceSecret,
  })
  log.assert('新密钥可以换到票据', newSecret.status === 200 && !!newSecret.token, `status=${newSecret.status}`)
}

async function scenarioNoSessionBehaviour(ctx, log, token) {
  log.section('未绑定设备的机器：一律不许作业')
  const { http } = ctx
  const task = await seedInboundTask(ctx, token, ctx.warehouse)

  const resp = await http.post(`/api/inbound-tasks/${task.taskId}/receive`, {
    token, headers: noSessionHeaders(),
    json: { productId: Number(task.product.id), packages: [{ qty: 1 }] },
  })
  log.assert(
    '★ 没有设备票据一律不许作业，且提示指向「去绑定」而不是含糊报错',
    resp.status === 403 && resp.data?.code === 'PDA_SESSION_REQUIRED'
      && /绑定/.test(String(resp.data?.message || '')),
    `status=${resp.status} code=${resp.data?.code} msg=${resp.data?.message}`,
  )
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  // 设备票据以 X-PDA-Session 传递，与 X-Client: pda 是两件事，这里一并带上
  ctx.pdaSessionHeaders = (sessionToken, extra = {}) => ({
    ...ctx.pdaHeaders(),
    'X-PDA-Session': sessionToken,
    ...extra,
  })
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败')


    const bound = await scenarioRegisterAndBind(ctx, log, token)
    await scenarioCrossWarehouseBlocked(ctx, log, token, bound)
    await scenarioDisableRevokes(ctx, log, token, bound)
    await scenarioResetSecret(ctx, log, token)
    await scenarioNoSessionBehaviour(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[PDA-DEVICE-SESSION] 未捕获异常：', e)
  process.exit(1)
})
