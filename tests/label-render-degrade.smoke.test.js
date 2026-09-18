/** 2026-09-18 审计 P1 回归：标签渲染失败必须降级为「可补打的失败记录」，不得回滚业务事务。
 *
 * 背景：`enqueueContainerLabelJob` / `enqueuePackageLabelJob` 的调用方是收货、容器拆分、
 * 退货上架、完成装箱——这些是「货/箱已经动了」的事实记录。而 buildLabelBody 内部会跑
 * 本地渲染 worker（15s 超时、16 并发上限，可 503 LABEL_RENDER_BUSY/TIMEOUT/FAILED）。
 * 修复前渲染抛错会冒泡到调用方事务 → 整笔收货/装箱回滚，实物已收、系统无记录。
 * 修复后降级为 status=3 的 unprintable 记录（打印记录页可见、可重打），业务照常提交。
 *
 * 为什么单独一个文件：label-command 对渲染模块是**解构导入**，必须在它首次 require 之前
 * 注入桩，否则改不动已绑定的引用。
 *
 * 运行：node tests/label-render-degrade.smoke.test.js
 */
const assert = require('node:assert/strict')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const mysql = require('../backend/node_modules/mysql2/promise')

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, timezone: '+08:00', charset: 'utf8mb4',
  })
  const [[server]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db')
  assert.equal(server.db, process.env.DB_NAME)
  await conn.query("SET time_zone = '+08:00'")

  const serviceConn = {
    query: (...args) => conn.query(...args),
    beginTransaction: () => conn.query('SAVEPOINT service_transaction'),
    commit: () => conn.query('RELEASE SAVEPOINT service_transaction'),
    rollback: () => conn.query('ROLLBACK TO SAVEPOINT service_transaction'),
    release() {},
  }
  require.cache[require.resolve(path.join(ROOT, 'backend/src/config/db'))] = {
    exports: { pool: { query: (...a) => conn.query(...a), getConnection: async () => serviceConn } },
  }

  // ── 打桩必须在 require label-command 之前 ───────────────────────────────
  const rasterPath = require.resolve(path.join(ROOT, 'backend/src/modules/print-jobs/labelRasterService'))
  const busy = new Error('标签绘制繁忙，请稍后重试')
  busy.code = 'LABEL_RENDER_BUSY'
  require.cache[rasterPath] = {
    id: rasterPath, filename: rasterPath, loaded: true,
    exports: {
      renderLabelAsync: async () => {
        if (!globalThis.__AUDIT_RENDER_OK__) throw busy
        return { zpl: '^XA^FDTEST^FS^XZ' }
      },
    },
  }
  // 默认模板查不到 → 逼到本地渲染那条分支
  const tplPath = require.resolve(path.join(ROOT, 'backend/src/modules/print-jobs/labelZplTemplate'))
  const realTpl = require(tplPath)
  require.cache[tplPath].exports = { ...realTpl, getLabelZplFromDefaultTemplate: async () => null }

  const labelCmd = require(path.join(ROOT, 'backend/src/modules/print-jobs/print-jobs.label-command'))

  let failed = 0
  const test = async (name, fn) => {
    try { await conn.beginTransaction(); await fn(); console.log('  [PASS]', name) }
    catch (e) { failed++; console.error('  [FAIL]', name, '\n', e.stack) }
    finally { await conn.rollback() }
  }

  const insert = async (sql, params) => Number((await conn.query(sql, params))[0].insertId)
  const uniq = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)

  const fixture = async () => {
    const wh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'降级测试仓')", [uniq('DW')])
    const code = uniq('P')
    const productId = await insert("INSERT INTO product_items (code,name,unit,sale_price_a,cost_price) VALUES (?,'降级测试','个',20,10)", [code])
    const printerCode = uniq('PRN')
    const printerId = await insert("INSERT INTO printers (code,name,type,status) VALUES (?, '降级测试打印机', 1, 1)", [printerCode])
    // printer_bindings 上有一个**只按 print_type 的唯一键**（见测试输出与迁移排查），
    // 同一种用途全局只能存在一条绑定，所以插入前必须先清掉既有同类绑定；
    // 这些改动都在事务内，finally 的 rollback 会完整还原。
    await conn.query("DELETE FROM printer_bindings WHERE print_type = 'container_label'")
    await conn.query(
      "INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code) VALUES (?, 'container_label', ?, ?)",
      [wh, printerId, printerCode])
    const ce = require(path.join(ROOT, 'backend/src/engine/containerEngine'))
    const created = await ce.createContainer(conn, {
      productId, warehouseId: wh, initialQty: 5, unit: '个', barcode: uniq('C'),
      sourceType: ce.SOURCE_TYPE.IMPORT, sourceRefId: 1,
      containerStatus: ce.CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    return { wh, containerId: created.containerId }
  }

  await test('★P1 容器标签渲染失败时降级为 unprintable 记录，而不是抛错', async () => {
    const f = await fixture()
    const job = await labelCmd.enqueueContainerLabelJob({
      conn,
      containerId: f.containerId,
      warehouseId: f.wh,
      data: { container_code: 'AUDIT-LABEL-1', product_name: '降级测试', qty: 5 },
    })
    assert.ok(job, '必须返回降级记录（修复前这里会抛 LABEL_RENDER_BUSY）')
    assert.equal(job.unprintable, true, '必须被标记为 unprintable，便于页面提示先补打')
    assert.match(String(job.errorMessage || ''), /label render failed: LABEL_RENDER_BUSY/,
      'error_message 要写明是渲染失败，与「无可用打印机」区分开')
    const [[row]] = await conn.query('SELECT status, printer_id, content FROM print_jobs WHERE id=?', [job.id])
    assert.equal(Number(row.status), 3, '降级记录应为失败态(3)，在打印记录页可见')
    assert.equal(row.printer_id, null)
  })

  await test('对照：渲染成功时不得被降级逻辑劫持（仍是正常待打印任务）', async () => {
    const f = await fixture()
    globalThis.__AUDIT_RENDER_OK__ = true
    try {
      const job = await labelCmd.enqueueContainerLabelJob({
        conn,
        containerId: f.containerId,
        warehouseId: f.wh,
        data: { container_code: 'AUDIT-LABEL-3', product_name: '降级测试', qty: 5 },
      })
      assert.ok(job, '渲染成功必须返回打印任务')
      assert.notEqual(job.unprintable, true, '渲染成功不得被标成 unprintable')
      const [[row]] = await conn.query('SELECT status, content FROM print_jobs WHERE id=?', [job.id])
      assert.notEqual(Number(row.status), 3, '正常任务不应落到失败态(3)')
      assert.match(String(row.content || ''), /\^XA/, '正常任务必须带真实 ZPL 内容')
    } finally {
      globalThis.__AUDIT_RENDER_OK__ = false
    }
  })

  await test('★P2 箱贴渲染失败同样降级（收货与装箱两条事务内路径口径一致）', async () => {
    // 装箱是「箱已经装好了」的事实记录，与收货同级：渲染失败不得把它整笔回滚。
    const wh = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'降级测试仓')", [uniq('DW')])
    const taskId = await insert(
      "INSERT INTO warehouse_tasks (task_no,customer_name,warehouse_id,warehouse_name,status) VALUES (?, '降级测试客户', ?, '降级测试仓', 5)",
      [uniq('WT'), wh])
    const packageId = await insert('INSERT INTO packages (barcode,warehouse_task_id,status) VALUES (?,?,2)', [uniq('PKG'), taskId])
    const printerCode = uniq('PRN')
    const printerId = await insert("INSERT INTO printers (code,name,type,status) VALUES (?, '降级测试打印机', 1, 1)", [printerCode])
    await conn.query("DELETE FROM printer_bindings WHERE print_type = 'package_label'")
    await conn.query(
      "INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code) VALUES (?, 'package_label', ?, ?)",
      [wh, printerId, printerCode])
    const job = await labelCmd.enqueuePackageLabelJob({ conn, packageId })
    assert.ok(job, '必须返回降级记录（修复前这里会抛 LABEL_RENDER_BUSY，把完成装箱整笔回滚）')
    assert.equal(job.unprintable, true)
    assert.match(String(job.errorMessage || ''), /label render failed: LABEL_RENDER_BUSY/)
    const [[row]] = await conn.query('SELECT status, printer_id FROM print_jobs WHERE id=?', [job.id])
    assert.equal(Number(row.status), 3, '降级记录应为失败态(3)，在打印记录页可见')
    assert.equal(row.printer_id, null)
  })

  await conn.end()
  console.log('\n' + '═'.repeat(60))
  console.log(`  标签渲染降级回归: ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}（MySQL ${server.version}）`)
  console.log('═'.repeat(60))
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
