#!/usr/bin/env node
'use strict'

/**
 * 打印机绑定的仓库范围回归测试（2026-09-26 一致性审查 · 任务 6）——16 条断言
 *
 * 病灶：printer-bindings 的 bind / unbind / list 三条路径此前**完全不校验仓库范围**。
 *   `printer_bindings.warehouse_id = 0` 是「公司级绑定」，对该类型的所有仓库生效——
 *   谁都能设，等于任何人都能改掉全公司的默认打印机；限仓用户还能替别的仓库绑打印机
 *   （把 A 仓的小票据导向 B 仓的机器）。而 list 又会把全公司的绑定和盘托出。
 *
 * 处置（产品拍板）：公司级绑定只允许不限仓用户（超管，或未配 user_warehouse_scope 者）设置；
 *   限仓用户只能绑自己范围内的仓库。列表对限仓用户只返回「公司级 + 自己仓」——
 *   公司级必须保留：defaultBindings 完全来自它，滤掉会让 PDA / 桌面端打印静默失效。
 *
 * 【顺带抓到的真实缺陷】controller 里若写成 `warehouseId || null`，公司级的 0 会被变成
 *   NULL：NULL 不参与 (warehouse_id, print_type) 唯一键去重（会插出重复行），
 *   且 unbind 的 `WHERE warehouse_id = NULL` 永远删不掉。§D/§F 专门断言落库的就是 0、且能删掉。
 *
 * 隔离：本测试用独立的 print_type（product_label）与自建的外仓，业务日期无关。
 *   收尾按 (warehouse_id, print_type) 精确还原/删除，不按名字或前缀批量删。
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/printer-binding-scope.smoke.test.js
 */

const path = require('path')
const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')

const PT = 'product_label'          // 主仓当前未绑定该类型（container/package/rack 已占用）
const SCOPED_USER = 'smoke_printer_scoped'
const SCOPED_PW = 'SmokePrinterScoped123!'
const SCOPE_DENIED = 'WAREHOUSE_SCOPE_DENIED'

async function ensureScopedUser(pool, allowedWarehouseId) {
  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  const { PERMISSIONS } = require(path.resolve(__dirname, '../backend/src/constants/permissions'))
  await pool.query(
    `INSERT INTO sys_roles (code, name, remark) VALUES ('smoke_printer_scoped', 'Smoke打印绑定角色', '任务6回归')
     ON DUPLICATE KEY UPDATE name=VALUES(name), remark=VALUES(remark)`,
  )
  const [[role]] = await pool.query("SELECT id FROM sys_roles WHERE code='smoke_printer_scoped' LIMIT 1")
  const roleId = Number(role.id)
  // 权限给全：本用例要证明的是「仓库范围」在拦，不是权限点不足造成的假阴性
  for (const code of [...new Set(Object.values(PERMISSIONS).filter(v => typeof v === 'string'))]) {
    await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [roleId, code])
  }
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'Smoke打印绑定用户', ?, 'Smoke打印绑定', 1)
     ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=VALUES(role_id),
       role_name='Smoke打印绑定', is_active=1, deleted_at=NULL`,
    [SCOPED_USER, bcrypt.hashSync(SCOPED_PW, 10), roleId],
  )
  const [[user]] = await pool.query('SELECT id FROM sys_users WHERE username=? LIMIT 1', [SCOPED_USER])
  const userId = Number(user.id)
  await pool.query('DELETE FROM user_warehouse_scope WHERE user_id=?', [userId])
  await pool.query('INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES (?, ?)', [userId, allowedWarehouseId])
  return { userId, roleId }
}

async function main() {
  const log = createLogger('打印机绑定仓库范围')
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, printer } = ctx

  let step = 'init'
  const cleanup = { otherWarehouseId: null, userId: null, roleId: null, snapshots: [] }

  /** 快照某个 (warehouse_id, print_type) 的既有绑定，收尾据此还原或删除 */
  const snapshot = async (warehouseId) => {
    const [row] = await dbQuery(
      pool, 'SELECT warehouse_id, print_type, printer_id, printer_code FROM printer_bindings WHERE warehouse_id=? AND print_type=?',
      [warehouseId, PT],
    )
    cleanup.snapshots.push({ warehouseId, row: row || null })
    return row || null
  }

  try {
    const { token: adminToken } = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    if (!adminToken) throw new Error('管理员登录失败')

    step = 'prepare'
    const otherCode = randomRef('WH-PRN').slice(0, 30)
    const wr = await pool.query('INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)',
      ['打印绑定测试外仓', otherCode])
    cleanup.otherWarehouseId = Number(wr[0].insertId)

    const scoped = await ensureScopedUser(pool, Number(warehouse.id))
    cleanup.userId = scoped.userId
    cleanup.roleId = scoped.roleId

    // 三个 (warehouse, PT) 组合都要在改动前快照
    await snapshot(0)                                  // 公司级
    await snapshot(Number(warehouse.id))                // 自己仓
    await snapshot(cleanup.otherWarehouseId)            // 外仓
    const otherBefore = cleanup.snapshots[2].row

    const { token: scopedToken } = await login(http, SCOPED_USER, SCOPED_PW)
    if (!scopedToken) throw new Error('限仓用户登录失败')

    // ══════════════════════════════════════════════════════════════════
    log.section('§A 限仓用户不能设公司级绑定（不传 warehouseId 即公司级）')
    step = 'A'
    const aResp = await http.put(`/api/printer-bindings/${PT}`, {
      token: scopedToken, json: { printerId: printer.id },
    })
    log.assert('★ 设公司级绑定被拒（403）', aResp.status === 403, `HTTP ${aResp.status} ${JSON.stringify(aResp.data)}`)
    log.assert('★ 错误码为 WAREHOUSE_SCOPE_DENIED', aResp.data?.code === SCOPE_DENIED, String(aResp.data?.code))
    const [aRow] = await dbQuery(
      pool, 'SELECT id FROM printer_bindings WHERE warehouse_id=0 AND print_type=?', [PT],
    )
    log.assert('★ 公司级绑定没被改动（库内仍是快照状态）',
      (aRow ? 1 : 0) === (cleanup.snapshots[0].row ? 1 : 0),
      `改后${aRow ? '有' : '无'} / 改前${cleanup.snapshots[0].row ? '有' : '无'}`)

    // ══════════════════════════════════════════════════════════════════
    log.section('§B 限仓用户不能替别的仓库绑打印机')
    step = 'B'
    const bResp = await http.put(`/api/printer-bindings/${PT}`, {
      token: scopedToken, json: { printerId: printer.id, warehouseId: cleanup.otherWarehouseId },
    })
    log.assert('★ 绑外仓被拒（403）', bResp.status === 403, `HTTP ${bResp.status}`)
    const [bRow] = await dbQuery(
      pool, 'SELECT id FROM printer_bindings WHERE warehouse_id=? AND print_type=?', [cleanup.otherWarehouseId, PT],
    )
    log.assert('★ 外仓没多出绑定', (bRow ? 1 : 0) === (otherBefore ? 1 : 0), `${bRow ? '有' : '无'}`)

    // ══════════════════════════════════════════════════════════════════
    log.section('§C 限仓用户绑自己的仓：照常放行（隔离做过头比不隔离还糟）')
    step = 'C'
    const cResp = await http.put(`/api/printer-bindings/${PT}`, {
      token: scopedToken, json: { printerId: printer.id, warehouseId: Number(warehouse.id) },
    })
    log.assert('★ 绑自己仓成功（200）', cResp.status === 200, `HTTP ${cResp.status} ${JSON.stringify(cResp.data)}`)
    const [cRow] = await dbQuery(
      pool, 'SELECT printer_id FROM printer_bindings WHERE warehouse_id=? AND print_type=?',
      [Number(warehouse.id), PT],
    )
    log.assert('★ 落库的是本次指定的打印机', cRow && Number(cRow.printer_id) === Number(printer.id),
      `printer_id=${cRow?.printer_id} 期望=${printer.id}`)

    // ══════════════════════════════════════════════════════════════════
    log.section('§D 超管设公司级：必须落成 warehouse_id=0，不能是 NULL')
    step = 'D'
    const dResp = await http.put(`/api/printer-bindings/${PT}`, {
      token: adminToken, json: { printerId: printer.id },
    })
    log.assert('★ 超管设公司级成功（200）', dResp.status === 200, `HTTP ${dResp.status} ${JSON.stringify(dResp.data)}`)
    const [dRow] = await dbQuery(
      pool, 'SELECT warehouse_id FROM printer_bindings WHERE warehouse_id=0 AND print_type=?', [PT],
    )
    log.assert('★ 公司级绑定的 warehouse_id 就是 0（写成 NULL 会导致唯一键失效、且删不掉）',
      !!dRow && Number(dRow.warehouse_id) === 0, `warehouse_id=${dRow ? dRow.warehouse_id : '(无此行)'}`)

    // ══════════════════════════════════════════════════════════════════
    log.section('§E 列表：限仓用户只看到「公司级 + 自己仓」，且公司级必须留着')
    step = 'E'
    const eResp = await http.get('/api/printer-bindings', { token: scopedToken })
    const routes = eResp.data?.data?.routes || []
    const defaults = eResp.data?.data?.defaultBindings || {}
    const whIds = routes.map(r => Number(r.warehouse_id))
    log.assert('★ 看得到自己仓的绑定', whIds.includes(Number(warehouse.id)), JSON.stringify(whIds))
    log.assert('★ 看得到公司级绑定（滤掉会让 PDA 打印静默失效）', whIds.includes(0), JSON.stringify(whIds))
    log.assert('★ 看不到别的仓库的绑定', !whIds.includes(cleanup.otherWarehouseId), JSON.stringify(whIds))
    log.assert('★ defaultBindings 里有该类型的公司级默认',
      !!defaults[PT] && Number(defaults[PT].warehouse_id) === 0,
      JSON.stringify(Object.keys(defaults)))

    // ══════════════════════════════════════════════════════════════════
    log.section('§F 解除绑定同样受范围约束')
    step = 'F'
    const fResp = await http.delete(`/api/printer-bindings/${PT}?warehouseId=0`, { token: scopedToken })
    log.assert('★ 限仓用户解绑公司级被拒（403）', fResp.status === 403, `HTTP ${fResp.status}`)
    const gResp = await http.delete(`/api/printer-bindings/${PT}?warehouseId=0`, { token: adminToken })
    log.assert('★ 超管解绑公司级成功（200）', gResp.status === 200, `HTTP ${gResp.status} ${JSON.stringify(gResp.data)}`)
    const [fRow] = await dbQuery(
      pool, 'SELECT id FROM printer_bindings WHERE warehouse_id=0 AND print_type=?', [PT],
    )
    log.assert('★ 公司级绑定确实被删掉了（warehouse_id=0 可删，写成 NULL 就删不掉）', !fRow, fRow ? '仍在' : '已删')
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
  } finally {
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    // 按 (warehouse_id, print_type) 精确还原：快照有则还原原值，无则删除本测试新增的
    for (const s of cleanup.snapshots) {
      if (!s || s.warehouseId == null) continue
      if (s.row) {
        await safe('printer_bindings(还原)',
          'UPDATE printer_bindings SET printer_id=?, printer_code=? WHERE warehouse_id=? AND print_type=?',
          [s.row.printer_id, s.row.printer_code, s.warehouseId, PT])
      } else {
        await safe('printer_bindings(删除)',
          'DELETE FROM printer_bindings WHERE warehouse_id=? AND print_type=?', [s.warehouseId, PT])
      }
    }
    if (cleanup.roleId != null) {
      await safe('sys_role_permissions', 'DELETE FROM sys_role_permissions WHERE role_id=?', [cleanup.roleId])
    }
    if (cleanup.userId != null) {
      await safe('user_warehouse_scope', 'DELETE FROM user_warehouse_scope WHERE user_id=?', [cleanup.userId])
      await safe('sys_users', 'DELETE FROM sys_users WHERE id=?', [cleanup.userId])
    }
    await safe('sys_roles', "DELETE FROM sys_roles WHERE code='smoke_printer_scoped'")
    if (cleanup.otherWarehouseId != null) {
      await safe('inventory_warehouses', 'DELETE FROM inventory_warehouses WHERE id=?', [cleanup.otherWarehouseId])
    }
    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接、socket 不 unref，
    // app/service 查询过一次就会留住事件循环——断言全绿、退出码已定，进程却吊着不退
    // （2026-09-26 实测：本套件 16 passed/0 failed 后吊住 11 分钟，被人工终止）。
    // smokeTestKit.close() 只管它自建的池；两个池分开关，谁都不会被关两次。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
