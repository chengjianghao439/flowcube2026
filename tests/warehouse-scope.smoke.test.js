#!/usr/bin/env node
'use strict'

/**
 * 仓库级数据权限回归测试
 *
 * user_warehouse_scope（迁移 122）的语义：表里没有该用户的行 = 不限仓；有行 = 只能碰这些仓。
 * 此前只有 sale / warehouses / inventory 三处接了 scopeFilter，采购、收货、调拨、退货、盘点
 * 全都不过滤——A 仓的管理员能翻到 B 仓的采购价、供应商、成本，甚至能直接改 B 仓的单据状态。
 *
 * 本测试用一个只被授权「北京仓」的真实用户，逐模块验证三件事：
 *   1. 列表里看不到别的仓的单据
 *   2. 知道 id 也查不了详情（挡住绕过列表的那条路）
 *   3. 写操作被拒（能看不能改是假隔离）
 * 同时验证自己仓的单据一切照常——隔离做过头把人挡在门外，比不隔离还糟。
 *
 * 运行：node tests/warehouse-scope.smoke.test.js
 */

const path = require('path')
const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const SCOPED_USER = 'smoke_scoped'
const SCOPED_PW = 'SmokeScoped123!'
const SCOPED_ROLE_ID = 7

/** 建一个「只授权某一个仓」的用户：角色权限给足，唯一的限制来自 user_warehouse_scope */
async function ensureScopedUser(pool, allowedWarehouseId) {
  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  const { PERMISSIONS } = require(path.resolve(__dirname, '../backend/src/constants/permissions'))

  await pool.query(
    `INSERT INTO sys_roles (id, code, name, remark) VALUES (?, 'smoke_scoped', 'Smoke单仓角色', '仓库数据权限测试')
     ON DUPLICATE KEY UPDATE name=VALUES(name), remark=VALUES(remark)`,
    [SCOPED_ROLE_ID],
  )
  // 权限给全：本测试要证明的是「仓库范围」在起作用，而不是「权限点不足」造成的假阴性
  const codes = [...new Set(Object.values(PERMISSIONS).filter(v => typeof v === 'string'))]
  for (const code of codes) {
    await pool.query(
      'INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
      [SCOPED_ROLE_ID, code],
    )
  }
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'Smoke单仓用户', ?, 'Smoke单仓', 1)
     ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=VALUES(role_id),
       role_name='Smoke单仓', is_active=1, deleted_at=NULL`,
    [SCOPED_USER, bcrypt.hashSync(SCOPED_PW, 10), SCOPED_ROLE_ID],
  )
  const [user] = await dbQuery(pool, 'SELECT id FROM sys_users WHERE username=? LIMIT 1', [SCOPED_USER])
  const userId = Number(user.id)
  await pool.query('DELETE FROM user_warehouse_scope WHERE user_id=?', [userId])
  await pool.query(
    'INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES (?, ?)',
    [userId, allowedWarehouseId],
  )
  return userId
}

/** 造第二个仓库，作为「别人的仓」 */
async function ensureOtherWarehouse(pool) {
  const code = randomRef('WH-OTHER').slice(0, 30)
  const [r] = await pool.query(
    'INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
    ['Scope测试外仓', code],
  )
  return { id: r.insertId, name: 'Scope测试外仓' }
}

async function createProduct(pool, label) {
  const code = randomRef(`SC-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 10, 5)",
    [code, `Scope测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `Scope测试商品-${label}`, unit: '个' }
}

/** 用管理员在指定仓库造一张采购单，返回 id */
async function seedPurchase(http, adminToken, { supplier, warehouse, product }) {
  const resp = await http.post('/api/purchase', {
    token: adminToken,
    json: {
      supplierId: supplier.id, supplierName: supplier.name,
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      items: [{
        productId: product.id, productCode: product.code, productName: product.name,
        unit: product.unit, quantity: 10, unitPrice: 88,
      }],
    },
  })
  return Number(resp.data?.data?.id)
}

async function scenarioPurchaseScope(ctx, log, adminToken, scopedToken, mine, others) {
  log.section('采购单：列表过滤 + 详情拦截 + 写操作拦截')
  const { http, pool, supplier } = ctx
  const product = await createProduct(pool, 'po')

  const minePo = await seedPurchase(http, adminToken, { supplier, warehouse: mine, product })
  const otherPo = await seedPurchase(http, adminToken, { supplier, warehouse: others, product })

  const list = await http.get('/api/purchase?pageSize=200', { token: scopedToken })
  const ids = (list.data?.data?.list || []).map(r => Number(r.id))
  log.assert(
    '★ 列表只返回自己仓的采购单（修复前 A 仓管理员能翻到 B 仓的采购价与供应商）',
    ids.includes(minePo) && !ids.includes(otherPo),
    `自己的=${ids.includes(minePo)} 别人的=${ids.includes(otherPo)}`,
  )

  const mineDetail = await http.get(`/api/purchase/${minePo}`, { token: scopedToken })
  log.assert('自己仓的采购单详情正常可看', mineDetail.ok, `status=${mineDetail.status}`)

  const otherDetail = await http.get(`/api/purchase/${otherPo}`, { token: scopedToken })
  log.assert(
    '★ 知道 id 也查不了别人仓的详情（列表过滤挡不住直接访问）',
    otherDetail.status === 403 && otherDetail.data?.code === 'WAREHOUSE_SCOPE_DENIED',
    `status=${otherDetail.status} code=${otherDetail.data?.code}`,
  )

  const otherConfirm = await http.post(`/api/purchase/${otherPo}/confirm`, { token: scopedToken })
  log.assert(
    '★ 也改不了别人仓的单据状态（能看不能改是假隔离，这里连改都挡住）',
    otherConfirm.status === 403,
    `status=${otherConfirm.status} ${JSON.stringify(otherConfirm.data).slice(0, 120)}`,
  )

  const otherCancel = await http.post(`/api/purchase/${otherPo}/cancel`, { token: scopedToken })
  log.assert('取消别人仓的采购单同样被拒', otherCancel.status === 403, `status=${otherCancel.status}`)

  const mineConfirm = await http.post(`/api/purchase/${minePo}/confirm`, { token: scopedToken })
  log.assert('自己仓的采购单可以正常确认（隔离不能把人挡在门外）', mineConfirm.ok, `status=${mineConfirm.status}`)

  return { minePo, otherPo, product }
}

async function scenarioInboundScope(ctx, log, adminToken, scopedToken, mine, others, seeded) {
  log.section('收货订单：列表过滤 + 详情拦截 + 写操作拦截')
  const { http, pool, supplier } = ctx

  // 别人仓：新造一张采购单并建收货单
  const otherProduct = await createProduct(pool, 'in')
  const otherPo = await seedPurchase(http, adminToken, { supplier, warehouse: others, product: otherProduct })
  await http.post(`/api/purchase/${otherPo}/confirm`, { token: adminToken })
  const otherTaskResp = await http.post('/api/inbound-tasks', { token: adminToken, json: { poId: otherPo } })
  const otherTask = Number(otherTaskResp.data?.data?.taskId)

  // 自己仓：用上一场景已确认的采购单建收货单
  const mineTaskResp = await http.post('/api/inbound-tasks', { token: adminToken, json: { poId: seeded.minePo } })
  const mineTask = Number(mineTaskResp.data?.data?.taskId)

  const list = await http.get('/api/inbound-tasks?pageSize=200', { token: scopedToken })
  const ids = (list.data?.data?.list || []).map(r => Number(r.id))
  log.assert(
    '★ 收货订单列表只返回自己仓的',
    ids.includes(mineTask) && !ids.includes(otherTask),
    `自己的=${ids.includes(mineTask)} 别人的=${ids.includes(otherTask)}`,
  )

  const otherDetail = await http.get(`/api/inbound-tasks/${otherTask}`, { token: scopedToken })
  log.assert('★ 别人仓的收货订单详情被拒', otherDetail.status === 403, `status=${otherDetail.status}`)

  const otherSubmit = await http.post(`/api/inbound-tasks/${otherTask}/submit`, { token: scopedToken })
  log.assert('★ 提交别人仓的收货订单到 PDA 被拒', otherSubmit.status === 403, `status=${otherSubmit.status}`)

  const otherCancel = await http.post(`/api/inbound-tasks/${otherTask}/cancel`, { token: scopedToken })
  log.assert('取消别人仓的收货订单被拒', otherCancel.status === 403, `status=${otherCancel.status}`)

  const mineDetail = await http.get(`/api/inbound-tasks/${mineTask}`, { token: scopedToken })
  log.assert('自己仓的收货订单详情正常', mineDetail.ok, `status=${mineDetail.status}`)

  const mineSubmit = await http.post(`/api/inbound-tasks/${mineTask}/submit`, { token: scopedToken })
  log.assert('自己仓的收货订单可以正常提交', mineSubmit.ok, `status=${mineSubmit.status}`)
}

async function scenarioTransferScope(ctx, log, adminToken, scopedToken, mine, others) {
  log.section('调拨单：源仓或目标仓任一在范围内即可见')
  const { http, pool } = ctx
  const product = await createProduct(pool, 'tr')
  // 「与自己无关」必须是两个都不属于我的仓库之间的调拨，同仓调拨系统本身就不允许
  const third = await ensureOtherWarehouse(pool)

  const mk = async (from, to) => {
    const resp = await http.post('/api/transfer', {
      token: adminToken,
      json: {
        fromWarehouseId: from.id, fromWarehouseName: from.name,
        toWarehouseId: to.id, toWarehouseName: to.name,
        items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 1 }],
      },
    })
    return Number(resp.data?.data?.id)
  }

  const outbound = await mk(mine, others)   // 自己发出去
  const inbound = await mk(others, mine)    // 发给自己
  const unrelated = await mk(others, third) // 与自己无关：两端都不是我的仓

  const list = await http.get('/api/transfer?pageSize=200', { token: scopedToken })
  const ids = (list.data?.data?.list || []).map(r => Number(r.id))
  log.assert(
    '★ 自己发出的调拨可见（若要求两端都在范围内，发货方会看不到自己的单子）',
    ids.includes(outbound),
    `outbound=${outbound} 可见=${ids.includes(outbound)}`,
  )
  log.assert('★ 发给自己的调拨可见', ids.includes(inbound), `inbound=${inbound} 可见=${ids.includes(inbound)}`)
  log.assert(
    '★ 与自己两端都无关的调拨不可见',
    !ids.includes(unrelated),
    `unrelated=${unrelated} 可见=${ids.includes(unrelated)}`,
  )

  const otherDetail = await http.get(`/api/transfer/${unrelated}`, { token: scopedToken })
  log.assert('★ 无关调拨的详情被拒', otherDetail.status === 403, `status=${otherDetail.status}`)

  const otherConfirm = await http.post(`/api/transfer/${unrelated}/confirm`, { token: scopedToken })
  log.assert('★ 确认无关调拨被拒', otherConfirm.status === 403, `status=${otherConfirm.status}`)

  const mineDetail = await http.get(`/api/transfer/${outbound}`, { token: scopedToken })
  log.assert('自己参与的调拨详情正常', mineDetail.ok, `status=${mineDetail.status}`)
}

async function scenarioStockcheckAndReturnsScope(ctx, log, adminToken, scopedToken, mine, others) {
  log.section('盘点单与退货单：列表过滤 + 详情拦截')
  const { http, pool, customer, supplier } = ctx

  const mkCheck = async (warehouse) => {
    const resp = await http.post('/api/stockcheck', {
      token: adminToken,
      json: { warehouseId: warehouse.id, warehouseName: warehouse.name },
    })
    return Number(resp.data?.data?.id)
  }
  const mineCheck = await mkCheck(mine)
  const otherCheck = await mkCheck(others)

  const checkList = await http.get('/api/stockcheck?pageSize=200', { token: scopedToken })
  const checkIds = (checkList.data?.data?.list || []).map(r => Number(r.id))
  log.assert(
    '★ 盘点单列表只返回自己仓的',
    checkIds.includes(mineCheck) && !checkIds.includes(otherCheck),
    `自己的=${checkIds.includes(mineCheck)} 别人的=${checkIds.includes(otherCheck)}`,
  )
  const otherCheckDetail = await http.get(`/api/stockcheck/${otherCheck}`, { token: scopedToken })
  log.assert('★ 别人仓的盘点单详情被拒', otherCheckDetail.status === 403, `status=${otherCheckDetail.status}`)

  const otherCheckCreate = await http.post('/api/stockcheck', {
    token: scopedToken,
    json: { warehouseId: others.id, warehouseName: others.name },
  })
  log.assert(
    '★ 不能给别人仓新建盘点单（创建类写操作同样受限）',
    otherCheckCreate.status === 403,
    `status=${otherCheckCreate.status}`,
  )

  const product = await createProduct(pool, 'ret')
  const mkReturn = async (warehouse) => {
    const resp = await http.post('/api/returns/sale', {
      token: adminToken,
      json: {
        customerId: customer.id, customerName: customer.name,
        warehouseId: warehouse.id, warehouseName: warehouse.name,
        items: [{ productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: 1, unitPrice: 10 }],
      },
    })
    return Number(resp.data?.data?.id)
  }
  const mineReturn = await mkReturn(mine)
  const otherReturn = await mkReturn(others)
  if (Number.isFinite(mineReturn) && Number.isFinite(otherReturn)) {
    const rList = await http.get('/api/returns/sale?pageSize=200', { token: scopedToken })
    const rIds = (rList.data?.data?.list || []).map(r => Number(r.id))
    log.assert(
      '★ 销售退货单列表只返回自己仓的',
      rIds.includes(mineReturn) && !rIds.includes(otherReturn),
      `自己的=${rIds.includes(mineReturn)} 别人的=${rIds.includes(otherReturn)}`,
    )
    const otherRDetail = await http.get(`/api/returns/sale/${otherReturn}`, { token: scopedToken })
    log.assert('★ 别人仓的销售退货单详情被拒', otherRDetail.status === 403, `status=${otherRDetail.status}`)
  } else {
    log.assert('退货单铺底失败，跳过退货 scope 断言', false, `mine=${mineReturn} other=${otherReturn}`)
  }
}

async function scenarioUnscopedUserUnaffected(ctx, log, adminToken, others) {
  log.section('不限仓用户不受影响（表里没有行 = 不限仓）')
  const { http } = ctx
  const list = await http.get('/api/purchase?pageSize=200', { token: adminToken })
  log.assert('管理员仍能看到全部仓库的采购单', list.ok && (list.data?.data?.list || []).length > 0, `status=${list.status}`)
}

/**
 * 销售模块 scope（审计 H2 的核心：此前 11 个 sale 接口只有 list 过滤，详情/改单/占库/出库全裸奔）。
 * 受限仓用户调别人仓销售单的详情、改单、占库、出库必须被拒。
 */
async function scenarioSaleScope(ctx, log, adminToken, scopedToken, mine, others) {
  log.section('销售单：详情拦截 + 写操作拦截')
  const { http, pool, customer } = ctx
  const product = await createProduct(pool, 'sale')

  // 管理员在「别人的仓」造一张销售单（scoped 用户无权访问）
  const other = await http.post('/api/sale', {
    token: adminToken,
    json: {
      customerId: customer.id, customerName: customer.name,
      warehouseId: others.id, warehouseName: others.name,
      items: [{
        productId: product.id, productCode: product.code, productName: product.name,
        unit: product.unit, quantity: 1, unitPrice: 10,
      }],
    },
  })
  log.assert('管理员造销售单成功', other.ok, `status=${other.status}`)
  const otherSaleId = Number(other.data?.data?.id)

  // 详情被拒
  const detail = await http.get(`/api/sale/${otherSaleId}`, { token: scopedToken })
  log.assert(
    '★ 别人仓销售单详情被拒（修复前详情接口完全不过滤）',
    detail.status === 403,
    `status=${detail.status} code=${detail.data?.code}`,
  )

  // 占库被拒
  const reserve = await http.post(`/api/sale/${otherSaleId}/reserve`, { token: scopedToken, json: {} })
  log.assert(
    '★ 别人仓销售单占库被拒',
    reserve.status === 403,
    `status=${reserve.status} code=${reserve.data?.code}`,
  )

  // 出库发起被拒
  const ship = await http.post(`/api/sale/${otherSaleId}/ship`, { token: scopedToken, json: {} })
  log.assert(
    '★ 别人仓销售单发起出库被拒',
    ship.status === 403,
    `status=${ship.status} code=${ship.data?.code}`,
  )

  // 取消被拒
  const cancel = await http.post(`/api/sale/${otherSaleId}/cancel`, { token: scopedToken, json: {} })
  log.assert(
    '★ 别人仓销售单取消被拒',
    cancel.status === 403,
    `status=${cancel.status} code=${cancel.data?.code}`,
  )

  // 自己仓的销售单详情正常（隔离不能把人挡在门外）
  const mineSale = await http.post('/api/sale', {
    token: adminToken,
    json: {
      customerId: customer.id, customerName: customer.name,
      warehouseId: mine.id, warehouseName: mine.name,
      items: [{
        productId: product.id, productCode: product.code, productName: product.name,
        unit: product.unit, quantity: 1, unitPrice: 10,
      }],
    },
  })
  const mineSaleId = Number(mineSale.data?.data?.id)
  const mineDetail = await http.get(`/api/sale/${mineSaleId}`, { token: scopedToken })
  log.assert('自己仓的销售单详情正常', mineDetail.ok, `status=${mineDetail.status}`)
}

/**
 * 权限提权路径：scoped 用户被授了全部权限点（含 user.update），但它不是超管。
 * 修复前它可以经 PUT /api/users/:id 把任意账号 roleId 改成 1 从而变身超管——
 * 这就是审计 M1。现在要求：改 roleId=1 被 schema 层拦截（400，超管也不放行）。
 */
async function scenarioPrivilegeEscalationBlocked(ctx, log, adminToken, scopedToken) {  log.section('提权路径：非超管不能把账号改成超管（M1）')
  const { http, pool } = ctx

  // 造一个普通目标账号，scoped 用户试图把它抬成超管
  const [r] = await pool.query(
    "INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active) VALUES (?, '!', '提权目标', 4, '销售员', 1)",
    [`esc_${randomRef('tg').slice(0, 20)}`],
  )
  const targetId = Number(r.insertId)

  // 尝试直接改 roleId=1（HTTP 层：schema 拒绝）
  const attempt = await http.put(`/api/users/${targetId}`, {
    token: scopedToken,
    json: { realName: '提权目标', roleId: 1, isActive: true },
  })
  log.assert(
    '★ 非超管改 roleId=1 被拒（schema 层 400，修复前会成功写入）',
    attempt.status === 400,
    `status=${attempt.status} body=${JSON.stringify(attempt.data).slice(0, 120)}`,
  )

  const [check] = await dbQuery(ctx.pool, 'SELECT role_id FROM sys_users WHERE id=?', [targetId])
  log.assert('★ 目标账号角色未被改动（仍是 4）', Number(check.role_id) === 4, `role_id=${check.role_id}`)

  // 正常改 roleId=4 → 5 应该放行（证明不是把所有角色修改都禁了）
  const ok = await http.put(`/api/users/${targetId}`, {
    token: scopedToken,
    json: { realName: '提权目标', roleId: 5, isActive: true },
  })
  log.assert('非超管把普通角色改到另一普通角色仍然放行', ok.ok, `status=${ok.status} ${JSON.stringify(ok.data).slice(0, 120)}`)
  const [check2] = await dbQuery(ctx.pool, 'SELECT role_id FROM sys_users WHERE id=?', [targetId])
  log.assert('目标账号角色已改为 5', Number(check2.role_id) === 5, `role_id=${check2.role_id}`)

  // 清理目标账号
  await pool.query('UPDATE sys_users SET deleted_at = NOW() WHERE id=?', [targetId])
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token: adminToken } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!adminToken) throw new Error('管理员登录失败')

    const mine = ctx.warehouse
    const others = await ensureOtherWarehouse(ctx.pool)
    await ensureScopedUser(ctx.pool, mine.id)

    const { token: scopedToken } = await login(ctx.http, SCOPED_USER, SCOPED_PW)
    if (!scopedToken) throw new Error('单仓用户登录失败')

    const seeded = await scenarioPurchaseScope(ctx, log, adminToken, scopedToken, mine, others)
    await scenarioInboundScope(ctx, log, adminToken, scopedToken, mine, others, seeded)
    await scenarioTransferScope(ctx, log, adminToken, scopedToken, mine, others)
    await scenarioStockcheckAndReturnsScope(ctx, log, adminToken, scopedToken, mine, others)
    await scenarioUnscopedUserUnaffected(ctx, log, adminToken, others)
    await scenarioSaleScope(ctx, log, adminToken, scopedToken, mine, others)
    await scenarioPrivilegeEscalationBlocked(ctx, log, adminToken, scopedToken)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[WAREHOUSE-SCOPE] 未捕获异常：', e)
  process.exit(1)
})
