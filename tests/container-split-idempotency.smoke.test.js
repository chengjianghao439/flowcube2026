#!/usr/bin/env node
'use strict'

/**
 * 回归测试：容器拆分必须按稳定请求键幂等，重放不得重复扣减/重复建盒
 * （2026-09-26 一致性审查 · 任务 4 续）
 *
 * 修复前的行为：
 *   拆分（POST /api/inventory/containers/:id/split）是「扣减源容器余量 + 新建塑料盒 +
 *   写库存流水」的真实库存写，但既没有请求键、后端也没有幂等回执——PDA 在弱网下
 *   连点或自动重试，同一个拆分请求会真的执行两次：源容器被扣两次、凭空多出一个盒子，
 *   而现场只看到「拆分成功」。同域的移库/出库早已有 X-Request-Key + 资源级 action，
 *   拆分是漏掉的那个。
 *
 * 六段：
 *   §A 首次拆分（带稳定请求键）→ 源容器扣减、新盒生成、库存总量不变
 *   §B 同请求键重放 → 返回同一回执（同一新盒），源容器不再扣、盒子不再多、流水不再增
 *   §C 换新请求键 → 照常执行（证明幂等是「同键去重」而非「把拆分锁死」）
 *   §D 不带请求键 → 老客户端照常放行（兼容性不被破坏）
 *   §E 幂等记录落库形态（action 绑源容器）
 *   §F 操作者的仓库范围被撤销后重放 → 必须 403，不得再吐回执里的新盒条码/ID。
 *      2026-09-27 二轮独立审阅 · 任务 4 补修：范围校验必须在幂等回执之前。
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/container-split-idempotency.smoke.test.js
 */

const path = require('path')
const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')
const { CONTAINER_STATUS } = require('../backend/src/engine/containerEngine')
const { PERMISSIONS } = require('../backend/src/constants/permissions')

const SRC_QTY = 10

async function createProduct(pool, label) {
  const code = randomRef(`F6-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 600, 500)",
    [code, `F6测试商品-${label}`],
  )
  return { id: Number(r.insertId), code, name: `F6测试商品-${label}`, unit: '个' }
}

/**
 * 直接造在库容器。container_type=0 且 initial_qty>1 → 不是「一件一码」个体容器，
 * 可拆分（引擎对 container_type=1 且 initial_qty=1 的才会拒绝）。
 */
async function createSourceContainer(pool, { barcode, productId, warehouseId, locationId, qty }) {
  const [r] = await pool.query(
    `INSERT INTO inventory_containers
       (barcode, container_type, product_id, warehouse_id, location_id, initial_qty, remaining_qty, status)
     VALUES (?, 0, ?, ?, ?, ?, ?, ?)`,
    [barcode, productId, warehouseId, locationId, qty, qty, CONTAINER_STATUS.ACTIVE],
  )
  return Number(r.insertId)
}

async function containerOf(pool, id) {
  const [[row]] = await pool.query(
    'SELECT id, barcode, remaining_qty, status, parent_id FROM inventory_containers WHERE id=?', [id],
  )
  return row
}

/** 拆分出的盒子：引擎会写 parent_id = 源容器 id，按它精确计数，不靠条码前缀猜。 */
async function childrenOf(pool, sourceId) {
  return dbQuery(
    pool,
    'SELECT id, barcode, remaining_qty FROM inventory_containers WHERE parent_id=? AND deleted_at IS NULL ORDER BY id ASC',
    [sourceId],
  )
}

async function logCountOf(pool, containerIds) {
  if (!containerIds.length) return 0
  const [row] = await dbQuery(
    pool,
    `SELECT COUNT(*) AS c FROM inventory_logs WHERE container_id IN (${containerIds.map(() => '?').join(',')})`,
    containerIds,
  )
  return Number(row.c)
}

async function stockQtyOf(pool, productId, warehouseId) {
  const [row] = await dbQuery(
    pool,
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, warehouseId],
  )
  return row ? Number(row.quantity) : 0
}

const SCOPE_PW = 'F6Scope123!'

async function createWarehouse(pool, suffix) {
  const [r] = await pool.query(
    'INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
    [`F6他仓-${suffix}`, `F6-WH2-${suffix}`],
  )
  return Number(r.insertId)
}

/** 限仓用户：只有拆分权限、仓库范围仅 warehouseId（用于验证「范围被撤销后重放」） */
async function createScopedSplitUser(pool, ctx, suffix, warehouseId) {
  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  const [role] = await pool.query(
    "INSERT INTO sys_roles (name, code, remark, is_system) VALUES (?, ?, 'f6 warehouse scope fixture', 0)",
    [`F6限仓角色-${suffix}`, `f6_scope_${suffix}`],
  )
  const roleId = Number(role.insertId)
  await pool.query(
    'INSERT INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
    [roleId, PERMISSIONS.INVENTORY_CONTAINER_SPLIT],
  )
  const username = `f6_scope_${suffix}`
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'F6限仓用户', ?, 'F6限仓', 1)`,
    [username, bcrypt.hashSync(SCOPE_PW, 10), roleId],
  )
  const [[u]] = await pool.query('SELECT id FROM sys_users WHERE username=? LIMIT 1', [username])
  const userId = Number(u.id)
  await pool.query(
    'INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES (?, ?)',
    [userId, Number(warehouseId)],
  )
  const auth = await login(ctx.http, username, SCOPE_PW)
  if (!auth.token) throw new Error(`限仓用户登录失败：${username}`)
  return { userId, roleId, username, token: auth.token }
}

async function split(ctx, token, containerId, body, requestKey) {
  const opts = { token, json: body }
  if (requestKey) opts.headers = { 'X-Request-Key': requestKey }
  return ctx.http.post(`/api/inventory/containers/${containerId}/split`, opts)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { http, pool, warehouse, location } = ctx
  const suffix = randomRef('f6').replace(/[^a-zA-Z0-9]/g, '').slice(-8)
  const cleanup = {
    containerIds: [], productIds: [], requestKeys: [],
    userIds: [], roleIds: [], warehouseIds: [],
  }
  let step = 'init'

  try {
    const admin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    if (!admin.token) throw new Error('smoke_admin 登录失败')

    step = 'fixtures'
    const product = await createProduct(pool, suffix)
    cleanup.productIds.push(product.id)
    const srcId = await createSourceContainer(pool, {
      barcode: randomRef(`F6SRC-${suffix}`).slice(0, 60),
      productId: product.id,
      warehouseId: warehouse.id,
      locationId: location.id,
      qty: SRC_QTY,
    })
    cleanup.containerIds.push(srcId)
    const srcBefore = await containerOf(pool, srcId)
    log.assert(
      '前置：源容器已就绪（在库、数量 10）',
      Number(srcBefore.status) === Number(CONTAINER_STATUS.ACTIVE) && Number(srcBefore.remaining_qty) === SRC_QTY,
      `status=${srcBefore.status} remaining=${srcBefore.remaining_qty}`,
    )

    // ── §A 首次拆分：带稳定请求键 ──
    log.section('§A 带请求键的首次拆分 → 扣减源容器、生成新盒、总量不变')
    step = 'A:split'
    const keyA = `${suffix}-split-A`
    cleanup.requestKeys.push(keyA)
    const first = await split(ctx, admin.token, srcId, { qty: 4, printLabel: false }, keyA)
    console.log(`\n[首次拆分] HTTP ${first.status} ${JSON.stringify(first.data).slice(0, 240)}`)
    log.assert('★ 首次拆分成功（200）', first.ok, JSON.stringify(first.data).slice(0, 240))

    step = 'A:read'
    const srcA = await containerOf(pool, srcId)
    const kidsA = await childrenOf(pool, srcId)
    const stockA = await stockQtyOf(pool, product.id, warehouse.id)
    const newBarcodeA = first.data?.data?.newBarcode
    console.log(`[首次拆分后] 源容器 ${srcBefore.remaining_qty}→${srcA.remaining_qty} 子盒 ${kidsA.length} 个 库存总量 ${stockA}`)
    log.assert(
      '★ 源容器只扣减本次拆分数量（10 → 6）',
      Number(srcA.remaining_qty) === SRC_QTY - 4,
      `remaining=${srcA.remaining_qty}（期望 ${SRC_QTY - 4}）`,
    )
    log.assert(
      '★ 新盒只建了一个、数量为拆出量',
      kidsA.length === 1 && Number(kidsA[0].remaining_qty) === 4,
      `子盒 ${kidsA.length} 个，数量 [${kidsA.map(k => k.remaining_qty).join(',')}]`,
    )
    log.assert(
      '★ 返回的新盒条码与库里那条一致（回执可核对）',
      newBarcodeA && kidsA.length === 1 && String(kidsA[0].barcode) === String(newBarcodeA),
      `回执 ${newBarcodeA} / 库 ${kidsA[0]?.barcode}`,
    )
    log.assert(
      '★ 拆分不改变库存总量（10 → 10，货只是换了容器）',
      stockA === SRC_QTY,
      `库存总量 ${stockA}（期望 ${SRC_QTY}）`,
    )

    const logsAfterA = await logCountOf(pool, [srcId, ...kidsA.map(k => k.id)])
    log.assert('★ 拆分写了库存流水（源容器/新盒可见这次转移）', logsAfterA > 0, `流水 ${logsAfterA} 条`)

    // ── §B 同请求键重放：必须原样回执，不得再动库存 ──
    log.section('§B 同请求键重放 → 原样回执，不再动库存')
    step = 'B:replay'
    const replay = await split(ctx, admin.token, srcId, { qty: 4, printLabel: false }, keyA)
    console.log(`[同键重放] HTTP ${replay.status} ${JSON.stringify(replay.data).slice(0, 240)}`)

    step = 'B:read'
    const srcB = await containerOf(pool, srcId)
    const kidsB = await childrenOf(pool, srcId)
    const stockB = await stockQtyOf(pool, product.id, warehouse.id)
    const logsAfterB = await logCountOf(pool, [srcId, ...kidsB.map(k => k.id)])
    console.log(`[同键重放后] 源容器 ${srcB.remaining_qty} 子盒 ${kidsB.length} 个 库存总量 ${stockB} 流水 ${logsAfterB} 条`)

    log.assert('★ 重放仍返回成功', replay.ok, `HTTP ${replay.status}`)
    log.assert(
      '★ 重放返回的是同一份回执（同一个新盒条码/ID），调用方无从察觉是重放',
      replay.data?.data?.newBarcode === newBarcodeA
        && Number(replay.data?.data?.newContainerId) === Number(kidsA[0]?.id),
      `回执 ${replay.data?.data?.newBarcode} / 首次 ${newBarcodeA}`,
    )
    log.assert(
      '★ 源容器没有被第二次扣减（仍 6，旧行为会变成 2）',
      Number(srcB.remaining_qty) === SRC_QTY - 4,
      `remaining=${srcB.remaining_qty}（期望 ${SRC_QTY - 4}）`,
    )
    log.assert(
      '★ 没有凭空多出一个盒子（子盒仍 1 个，旧行为会变成 2）',
      kidsB.length === 1,
      `子盒 ${kidsB.length} 个（期望 1）`,
    )
    log.assert(
      '★ 库存总量仍然不变（重复拆分不得凭空增加库存）',
      stockB === SRC_QTY,
      `库存总量 ${stockB}（期望 ${SRC_QTY}）`,
    )
    log.assert(
      '★ 没有重复写库存流水（审计痕不被重放污染）',
      logsAfterB === logsAfterA,
      `重放前 ${logsAfterA} 条 → 重放后 ${logsAfterB} 条`,
    )

    // ── §C 换新请求键：幂等不等于锁死 ──
    log.section('§C 换新请求键 → 照常执行（幂等不能被误做成「拆分一次就锁死」）')
    step = 'C:split'
    const keyC = `${suffix}-split-C`
    cleanup.requestKeys.push(keyC)
    const second = await split(ctx, admin.token, srcId, { qty: 2, printLabel: false }, keyC)
    step = 'C:read'
    const srcC = await containerOf(pool, srcId)
    const kidsC = await childrenOf(pool, srcId)
    const stockC = await stockQtyOf(pool, product.id, warehouse.id)
    console.log(`[换键再拆] HTTP ${second.status} 源容器 ${srcC.remaining_qty} 子盒 ${kidsC.length} 个 库存总量 ${stockC}`)
    log.assert(
      '★ 新请求键下拆分确实执行了（源容器 6 → 4、子盒 2 个）',
      second.ok && Number(srcC.remaining_qty) === SRC_QTY - 6 && kidsC.length === 2,
      `HTTP ${second.status} remaining=${srcC.remaining_qty} 子盒=${kidsC.length}`,
    )
    log.assert('★ 库存总量仍为 10', stockC === SRC_QTY, `库存总量 ${stockC}`)

    // ── §D 不带请求键：老客户端兼容 ──
    log.section('§D 不带请求键 → 老客户端照常放行')
    step = 'D:split'
    const noKey = await split(ctx, admin.token, srcId, { qty: 1, printLabel: false })
    step = 'D:read'
    const srcD = await containerOf(pool, srcId)
    const kidsD = await childrenOf(pool, srcId)
    console.log(`[无键拆分] HTTP ${noKey.status} 源容器 ${srcD.remaining_qty} 子盒 ${kidsD.length} 个`)
    log.assert(
      '★ 无请求键时正常执行（不因缺键而拒绝老客户端）',
      noKey.ok && Number(srcD.remaining_qty) === SRC_QTY - 7 && kidsD.length === 3,
      `HTTP ${noKey.status} remaining=${srcD.remaining_qty} 子盒=${kidsD.length}`,
    )
    cleanup.containerIds.push(...kidsD.map(k => k.id))

    // ── §E 幂等记录本身：资源级 action 绑定了源容器 ──
    log.section('§E 幂等记录落库形态（action 绑源容器，防「同键换单」）')
    step = 'E:request'
    const reqRows = await dbQuery(
      pool,
      'SELECT request_key, action, status, resource_type, resource_id FROM operation_requests WHERE request_key=?',
      [keyA],
    )
    console.log(`[幂等记录] ${JSON.stringify(reqRows)}`)
    log.assert(
      '★ 请求键已落库且标记成功',
      reqRows.length === 1 && Number(reqRows[0].status) === 1,
      JSON.stringify(reqRows),
    )
    log.assert(
      '★ action 把源容器 ID 绑进了作用域（container.split.<id>）',
      reqRows.length === 1 && String(reqRows[0].action) === `container.split.${srcId}`,
      reqRows.length ? `action=${reqRows[0].action}` : '(无记录)',
    )
    log.assert(
      '★ 回执写了 resource_type/resource_id，可反查是哪个容器的拆分',
      reqRows.length === 1 && String(reqRows[0].resource_type) === 'inventory_container'
        && Number(reqRows[0].resource_id) === srcId,
      reqRows.length ? `resource_type=${reqRows[0].resource_type} resource_id=${reqRows[0].resource_id}` : '(无记录)',
    )

    // ── §F 仓库范围被撤销后的重放：回执不得越过「现在还有没有权读」 ──
    log.section('§F 仓库范围被撤销后重放 → 403，不得再吐回执（新盒条码/ID 是真实库存信息）')
    step = 'F:fixture'
    const otherWarehouseId = await createWarehouse(pool, suffix)
    cleanup.warehouseIds.push(otherWarehouseId)
    const srcF = await createSourceContainer(pool, {
      barcode: randomRef(`F6SRCF-${suffix}`).slice(0, 60),
      productId: product.id,
      warehouseId: warehouse.id,
      locationId: location.id,
      qty: 5,
    })
    cleanup.containerIds.push(srcF)
    const scoped = await createScopedSplitUser(pool, ctx, suffix, warehouse.id)
    cleanup.userIds.push(scoped.userId)
    cleanup.roleIds.push(scoped.roleId)
    log.assert('前置：限仓用户就绪（有拆分权限、范围仅本仓）', !!scoped.token, `user=${scoped.username}`)

    step = 'F:scoped-split'
    const keyF = `${suffix}-split-F`
    cleanup.requestKeys.push(keyF)
    const scopedFirst = await split(ctx, scoped.token, srcF, { qty: 2, printLabel: false }, keyF)
    console.log(`\n[限仓用户首次拆分] HTTP ${scopedFirst.status} ${JSON.stringify(scopedFirst.data).slice(0, 240)}`)
    log.assert(
      '前置：范围内用户拆分成功（证明此前确实有权，不是「一开始就没权限」）',
      scopedFirst.ok && Number(scopedFirst.data?.data?.newContainerId) > 0,
      JSON.stringify(scopedFirst.data).slice(0, 240),
    )
    const receiptBarcodeF = String(scopedFirst.data?.data?.newBarcode || '')
    const srcFAfterFirst = await containerOf(pool, srcF)
    const kidsFAfterFirst = await childrenOf(pool, srcF)
    const logsFAfterFirst = await logCountOf(pool, [srcF, ...kidsFAfterFirst.map(k => k.id)])
    cleanup.containerIds.push(...kidsFAfterFirst.map(k => k.id))
    log.assert(
      '前置：首拆已落地（源 5 → 3、子盒 1 个、流水已写）',
      Number(srcFAfterFirst.remaining_qty) === 3 && kidsFAfterFirst.length === 1 && logsFAfterFirst > 0,
      `remaining=${srcFAfterFirst.remaining_qty} 子盒=${kidsFAfterFirst.length} 流水=${logsFAfterFirst}`,
    )

    step = 'F:revoke'
    // 「撤销范围」= 把范围换成另一个仓库。不能删空：空范围在 loadUserWarehouseScope 里
    // 被当成「不限仓」（rows.length ? ... : null），删空反而放权。范围是请求级读取的，
    // 同一个 token 继续用即可生效，无需重新登录。
    await pool.query(
      'UPDATE user_warehouse_scope SET warehouse_id=? WHERE user_id=?',
      [otherWarehouseId, scoped.userId],
    )
    const scopeRows = await dbQuery(
      pool, 'SELECT warehouse_id FROM user_warehouse_scope WHERE user_id=?', [scoped.userId],
    )
    log.assert(
      '前置：范围已改到他仓（不再包含容器所在仓）',
      scopeRows.length === 1 && Number(scopeRows[0].warehouse_id) === Number(otherWarehouseId),
      `warehouse_id=${scopeRows[0]?.warehouse_id}（期望 ${otherWarehouseId}）`,
    )

    step = 'F:replay-after-revoke'
    const replayF = await split(ctx, scoped.token, srcF, { qty: 2, printLabel: false }, keyF)
    console.log(`[权限撤销后重放] HTTP ${replayF.status} ${JSON.stringify(replayF.data).slice(0, 240)}`)
    log.assert(
      '★ 范围撤销后重放被拒绝（403）——修复前这里会 200 并原样返回同一份回执',
      replayF.status === 403,
      `实际 HTTP ${replayF.status}：${JSON.stringify(replayF.data).slice(0, 200)}`,
    )
    log.assert(
      '★ 错误码为 WAREHOUSE_SCOPE_DENIED',
      replayF.data?.code === 'WAREHOUSE_SCOPE_DENIED',
      JSON.stringify(replayF.data).slice(0, 200),
    )
    log.assert(
      '★ 响应里不含此前拆出的新盒条码/回执数据（不再泄露库存信息）',
      replayF.data?.data == null
        && receiptBarcodeF.length > 0
        && !JSON.stringify(replayF.data).includes(receiptBarcodeF),
      `回执 ${JSON.stringify(replayF.data?.data ?? null)} / 首次新盒 ${receiptBarcodeF}`,
    )

    step = 'F:read-after-revoke'
    const srcFAfter = await containerOf(pool, srcF)
    const kidsFAfter = await childrenOf(pool, srcF)
    const logsFAfter = await logCountOf(pool, [srcF, ...kidsFAfter.map(k => k.id)])
    log.assert(
      '★ 被拒的重放没有任何副作用（源容器余量、子盒个数、流水条数都不变）',
      Number(srcFAfter.remaining_qty) === Number(srcFAfterFirst.remaining_qty)
        && kidsFAfter.length === kidsFAfterFirst.length
        && logsFAfter === logsFAfterFirst,
      `remaining=${srcFAfterFirst.remaining_qty}→${srcFAfter.remaining_qty} `
        + `子盒=${kidsFAfterFirst.length}→${kidsFAfter.length} 流水=${logsFAfterFirst}→${logsFAfter}`,
    )

    step = 'F:fresh-key-after-revoke'
    const keyF2 = `${suffix}-split-F2`
    cleanup.requestKeys.push(keyF2)
    const freshF = await split(ctx, scoped.token, srcF, { qty: 1, printLabel: false }, keyF2)
    log.assert(
      '★ 对照：换新请求键同样 403（拒绝来自当前范围校验，与是否重放无关）',
      freshF.status === 403,
      `实际 HTTP ${freshF.status}：${JSON.stringify(freshF.data).slice(0, 200)}`,
    )
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
    process.exitCode = 1
  } finally {
    // 按精确 ID 清理，绝不按名字/编码前缀批量删除（共享夹具自洁原则）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    // 先摘掉父子引用再删，避免自引用外键阻塞
    for (const id of cleanup.containerIds) {
      await safe('inventory_logs', 'DELETE FROM inventory_logs WHERE container_id=?', [id])
      await safe('inventory_containers(parent_id)', 'UPDATE inventory_containers SET parent_id=NULL WHERE id=?', [id])
    }
    for (const id of cleanup.containerIds) {
      await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE id=?', [id])
    }
    for (const key of cleanup.requestKeys) {
      await safe('operation_requests', 'DELETE FROM operation_requests WHERE request_key=?', [key])
    }
    for (const pid of cleanup.productIds) {
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [pid])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [pid])
    }
    for (const userId of cleanup.userIds) {
      await safe('user_warehouse_scope', 'DELETE FROM user_warehouse_scope WHERE user_id=?', [userId])
      await safe('sys_users', 'DELETE FROM sys_users WHERE id=?', [userId])
    }
    for (const roleId of cleanup.roleIds) {
      await safe('sys_role_permissions', 'DELETE FROM sys_role_permissions WHERE role_id=?', [roleId])
      await safe('sys_roles', 'DELETE FROM sys_roles WHERE id=?', [roleId])
    }
    for (const wid of cleanup.warehouseIds) {
      await safe('inventory_warehouses', 'DELETE FROM inventory_warehouses WHERE id=?', [wid])
    }

    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接、socket 不 unref，
    // app/service 查询过一次就会留住事件循环，断言全绿、退出码已定进程却吊着不退。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
