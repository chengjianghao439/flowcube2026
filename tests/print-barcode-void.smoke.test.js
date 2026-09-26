'use strict'

/**
 * 撤回收货后「作废容器条码仍可补打、已排队任务仍可领取」的真实库回归。
 *
 * 必须跑在显式回环独立测试库（`NODE_ENV=test` + `flowcube_<用途>_test`）：
 *   node tests/print-barcode-void.smoke.test.js
 *
 * 覆盖两条互相独立的路径（只堵住一条都不算修好）：
 *   ① 入口侧：补打接口必须拒绝已作废容器，且**不能只靠前端禁用**（接口可被直接调用）；
 *   ② 在途侧：容器作废后，其**尚未被领取**（PENDING）的打印任务必须一并终结——领取端
 *      `claimClientJobs` 不校验业务对象，已入队的任务否则会被照常领取并打出 qty=0 的废标签。
 *
 * 并发口径（刻意如此，勿改成「零新增」）：合法的「补打先拿到容器行锁 → 撤回随后提交」
 * 顺序下，补打是**先于**作废生效的，新增一条历史 print_job 完全正当；能断言的是
 * **撤回提交后不再有可领取的 PENDING 作废任务**。反过来「撤回先提交」时，补打必须被拒
 * 且不新增任何任务。两种顺序分别由 §6、§7 覆盖。
 */

const assert = require('node:assert/strict')
const { prepareSmokeContext, randomRef } = require('./helpers/smokeTestKit')
const labels = require('../backend/src/modules/print-jobs/print-jobs.label-command')
const dispatch = require('../backend/src/modules/print-jobs/print-jobs.dispatch')
const query = require('../backend/src/modules/print-jobs/print-jobs.query')
const { readLabelVariables } = require('../backend/src/modules/print-jobs/labelVariables')

const CONTAINER_ACTIVE = 1
const CONTAINER_EMPTY = 2
const CONTAINER_VOID = 3
const JOB_PENDING = 0
const JOB_PRINTING = 1
const JOB_DONE = 2
const JOB_FAILED = 3

async function main() {
  const ctx = await prepareSmokeContext()
  const { pool } = ctx
  const code = randomRef('PVOID')
  const madeBarcodes = []
  let extraWarehouseId = null
  let passed = 0
  let failed = 0
  const check = async (title, fn) => {
    try { await fn(); passed += 1; console.log(`  [PASS] ${title}`) }
    catch (e) { failed += 1; console.error(`  [FAIL] ${title}: ${e.message}`) }
  }

  const makeContainer = async (status, seq) => {
    const barcode = `${code}I${String(seq).padStart(4, '0')}`
    const [r] = await pool.query(
      `INSERT INTO inventory_containers (barcode, product_id, warehouse_id, status, remaining_qty, initial_qty, unit)
       VALUES (?,?,?,?,?,?,?)`,
      [barcode, ctx.product.id, ctx.warehouse.id, status, status === CONTAINER_VOID ? 0 : 10, 10, '件'],
    )
    madeBarcodes.push(barcode)
    return { id: r.insertId, barcode }
  }
  const makeJob = async (container, status) => {
    const [r] = await pool.query(
      `INSERT INTO print_jobs (title, content, status, warehouse_id, ref_type, ref_id, ref_code, job_type)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['夹具', '^XA^XZ', status, ctx.warehouse.id, 'inventory_container', container.id, container.barcode, 'container_label'],
    )
    return r.insertId
  }
  const jobCount = async (containerId) => {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM print_jobs WHERE ref_type='inventory_container' AND ref_id=?", [containerId])
    return Number(n)
  }
  const pendingCount = async (containerId) => {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM print_jobs WHERE ref_type='inventory_container' AND ref_id=? AND status=0", [containerId])
    return Number(n)
  }
  const tryReprint = async (container) => {
    try {
      await labels.reprintBarcodeRecord({ category: 'inbound', recordId: container.id, createdBy: 1 })
      return { ok: true }
    } catch (e) {
      return { ok: false, code: e.code, message: e.message }
    }
  }
  /** 镜像 reprintInboundBarcode 的写入序列，供并发用例在事务内手工控制时序。 */
  const enqueuePendingWithin = (conn, container) => conn.query(
    `INSERT INTO print_jobs (title, content, status, warehouse_id, ref_type, ref_id, ref_code, job_type)
     VALUES (?,?,?,?,?,?,?,?)`,
    ['补打', '^XA^XZ', JOB_PENDING, ctx.warehouse.id, 'inventory_container', container.id, container.barcode, 'container_label'],
  )
  /** 镜像 voidReceipt 对单个容器的动作：置 VOID + 终结未领取任务。 */
  const voidWithin = async (conn, container) => {
    await conn.query('UPDATE inventory_containers SET status=?, remaining_qty=0 WHERE id=?', [CONTAINER_VOID, container.id])
    await dispatch.voidPendingPrintJobsForContainers(conn, [container.id])
  }

  try {
    console.log(`\n夹具前缀 ${code}（库 ${(await pool.query('SELECT DATABASE() db'))[0][0].db}）\n`)

    await check('ACTIVE 容器：补打成功并新增一条打印任务（不误伤的基线）', async () => {
      const c = await makeContainer(CONTAINER_ACTIVE, 1)
      await makeJob(c, JOB_DONE)
      const before = await jobCount(c.id)
      const r = await tryReprint(c)
      assert.ok(r.ok, `ACTIVE 容器应可补打，实际被拒：${r.code} ${r.message}`)
      assert.equal(await jobCount(c.id), before + 1, '补打应新增一条打印任务')
    })

    await check('VOID 容器：补打被拒（PRINT_BARCODE_CONTAINER_VOID）且不新增任务', async () => {
      const c = await makeContainer(CONTAINER_VOID, 2)
      await makeJob(c, JOB_DONE)
      const before = await jobCount(c.id)
      const r = await tryReprint(c)
      assert.equal(r.ok, false, '作废容器不应补打成功')
      assert.equal(r.code, 'PRINT_BARCODE_CONTAINER_VOID', `错误码应为 PRINT_BARCODE_CONTAINER_VOID，实际 ${r.code}`)
      assert.equal(await jobCount(c.id), before, '被拒时不得新增打印任务')
    })

    await check('EMPTY 容器：不扩大限制，补打仍可用（业务边界只收紧 VOID）', async () => {
      const c = await makeContainer(CONTAINER_EMPTY, 3)
      await makeJob(c, JOB_DONE)
      const before = await jobCount(c.id)
      const r = await tryReprint(c)
      assert.ok(r.ok, `EMPTY 应仍可补打，实际被拒：${r.code}`)
      assert.equal(await jobCount(c.id), before + 1)
    })

    await check('无打印记录的容器仍按原规则拒绝（原有校验未被破坏）', async () => {
      const c = await makeContainer(CONTAINER_ACTIVE, 4)
      const r = await tryReprint(c)
      assert.equal(r.ok, false)
      assert.equal(r.code, 'PRINT_BARCODE_NO_PRINT_RECORD')
    })

    await check('撤回终结「未领取」任务，PRINTING 不动（不宣称可撤销）', async () => {
      const c = await makeContainer(CONTAINER_ACTIVE, 5)
      const jPending = await makeJob(c, JOB_PENDING)
      const jPrinting = await makeJob(c, JOB_PRINTING)
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        await voidWithin(conn, c)
        await conn.commit()
      } finally { conn.release() }
      const [[p]] = await pool.query('SELECT status, error_message FROM print_jobs WHERE id=?', [jPending])
      const [[g]] = await pool.query('SELECT status FROM print_jobs WHERE id=?', [jPrinting])
      assert.equal(Number(p.status), JOB_FAILED, 'PENDING 任务应被终结')
      assert.equal(p.error_message, 'container voided')
      assert.equal(Number(g.status), JOB_PRINTING, 'PRINTING 的任务不得被回收（标签可能已出纸）')
    })

    await check('并发顺序一：撤回先提交 → 补打被拒且不新增任务', async () => {
      const c = await makeContainer(CONTAINER_ACTIVE, 6)
      await makeJob(c, JOB_DONE)
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        await voidWithin(conn, c)
        await conn.commit()
      } finally { conn.release() }
      const before = await jobCount(c.id)
      const r = await tryReprint(c)
      assert.equal(r.ok, false)
      assert.equal(r.code, 'PRINT_BARCODE_CONTAINER_VOID')
      assert.equal(await jobCount(c.id), before, '撤回已提交时补打不得新增任何任务')
    })

    await check('并发顺序二：补打先获锁、撤回随后提交 → 撤回完成后无可领取的 PENDING 作废任务', async () => {
      const c = await makeContainer(CONTAINER_ACTIVE, 7)
      await makeJob(c, JOB_DONE)
      const connA = await pool.getConnection()
      const connB = await pool.getConnection()
      try {
        await connA.beginTransaction()
        await connA.query('SELECT id FROM inventory_containers WHERE id=? FOR UPDATE', [c.id])
        await enqueuePendingWithin(connA, c)
        // 撤回开始：会阻塞在 connA 持有的容器行锁上
        const voidPromise = (async () => {
          await connB.beginTransaction()
          await voidWithin(connB, c)
          await connB.commit()
        })()
        await new Promise(resolve => setTimeout(resolve, 150))
        await connA.commit()          // 补打先完成：合法地留下一条历史任务
        await voidPromise              // 撤回随后完成
        const [[row]] = await pool.query('SELECT status FROM inventory_containers WHERE id=?', [c.id])
        assert.equal(Number(row.status), CONTAINER_VOID, '撤回应最终生效')
        assert.equal(await pendingCount(c.id), 0, '撤回完成后不得留下可领取的 PENDING 作废任务')
      } finally {
        connA.release()
        connB.release()
      }
    })

    // §7 通过并不依赖补打侧持容器锁：撤回的 UPDATE 会去锁「并发插入的 PENDING 任务行」，
    // 未提交的新任务同样被它挡住，所以终结逻辑本身就能兜住这种交错。
    // 真正需要容器行锁的是「读容器状态 → 判 ACTIVE → 再入队」这段的原子性，
    // 因此单独用 §7b 直接验证「产品补打接口确实在容器行锁内执行」。
    await check('§7b 补打接口确实在容器行锁内执行（锁被他人持有时不得完成）', async () => {
      const c = await makeContainer(CONTAINER_ACTIVE, 8)
      await makeJob(c, JOB_DONE)
      const holder = await pool.getConnection()
      try {
        await holder.beginTransaction()
        await holder.query('SELECT id FROM inventory_containers WHERE id=? FOR UPDATE', [c.id])
        // 判定要点：补打是否在「容器行仍被别人锁着」的这段时间里就结束了。
        // 不能用耗时阈值——测试自己固定等 300ms，会把等待也算进去，恒真。
        let finishedWhileLocked = false
        const reprintPromise = tryReprint(c).then((res) => { finishedWhileLocked = true; return res })
        await new Promise(resolve => setTimeout(resolve, 300))
        const settledEarly = finishedWhileLocked
        await holder.rollback()            // 释放容器锁，补打得以继续
        const r = await reprintPromise
        assert.ok(r.ok, `补打应最终成功：${r.code ?? ''}`)
        assert.equal(
          settledEarly, false,
          '补打在容器行仍被持有期间就完成了 → 读状态与入队不在同一把锁内（撤回收货可在此期间插进来）',
        )
      } finally { holder.release() }
    })

    await check('列表：voided 只含作废、success 不含作废、计数与行数一致', async () => {
      const voided = await query.findBarcodeRecords({ category: 'inbound', keyword: code, status: 'voided', pageSize: 100 })
      const success = await query.findBarcodeRecords({ category: 'inbound', keyword: code, status: 'success', pageSize: 100 })
      assert.ok(voided.list.length > 0, 'voided 筛选应有结果（夹具里有多张作废条码）')
      assert.ok(
        voided.list.every(r => r.barcodeStatusKey === 'voided'),
        'voided 筛选只应含作废行（判据是行级业务状态 barcodeStatusKey）',
      )
      const voidedIds = new Set(voided.list.map(r => r.recordId))
      assert.ok(
        !success.list.some(r => voidedIds.has(r.recordId)),
        'success 筛选不得混入显示为「已作废」的行',
      )
      assert.equal(voided.list.length, voided.pagination.total, 'voided 计数应与返回行数一致')
      assert.ok(voided.list.every(r => r.canReprint === false), '作废行必须不可补打（canReprint=false）')
    })

    // 2026-09-27 GUI 验收发现：作废把「最近任务结果」整个覆盖掉了。两者必须同一条记录里并存。
    await check('作废行同时给出「业务状态」与「最近任务结果」，互不覆盖', async () => {
      const voided = await query.findBarcodeRecords({ category: 'inbound', keyword: code, status: 'voided', pageSize: 100 })
      const doneRows = voided.list.filter(r => Number(r.latestJob?.status) === JOB_DONE)
      assert.ok(doneRows.length > 0, '夹具里应有「作废但任务已打印(DONE)」的行')
      assert.ok(
        doneRows.every(r => r.latestJob.statusKey === 'success'),
        '作废行的最近任务结果必须仍是 success（已打印），不能被 voided 覆盖',
      )
      assert.ok(
        doneRows.every(r => r.barcodeStatusKey === 'voided'),
        '同一行的业务状态必须仍是 voided',
      )

      // 因作废被撤回终结的任务：结果要写成「未出纸（容器已作废）」，不能说成「打印失败」。
      const aborted = voided.list.filter(r => r.latestJob?.errorMessage === 'container voided')
      assert.ok(aborted.length > 0, '夹具里应有「被撤回终结」的任务行')
      assert.ok(
        aborted.every(r => r.latestJob.statusKey === 'voided_job'),
        '被撤回终结的任务结果应为 voided_job（未出纸），而不是 failed',
      )
    })

    await check('打印模板预览取样（readLabelVariables 的 latest 分支）同样排除作废容器', async () => {
      // 专用仓库隔离，避免与本轮其它 I 码夹具相互干扰
      const [wh] = await pool.query(
        'INSERT INTO inventory_warehouses (code,name) VALUES (?,?)',
        [`${code}W`, '取样隔离仓'],
      )
      extraWarehouseId = wh.insertId
      // 必须以 I 开头：latest 分支自己带 `d.barcode LIKE 'I%'`（库存条码约定），
      // 条码不以 I 开头时该分支根本不会命中，断言会假通过——第一版就是这么写的，
      // 被反向验证抓出来（去掉排除后测试仍绿）。
      const barcode = `I${code}9001`
      const [c] = await pool.query(
        `INSERT INTO inventory_containers (barcode, product_id, warehouse_id, status, remaining_qty, initial_qty, unit)
         VALUES (?,?,?,?,?,?,?)`,
        [barcode, ctx.product.id, extraWarehouseId, CONTAINER_VOID, 0, 10, '件'],
      )
      madeBarcodes.push(barcode)
      // type=6 容器条码，id=null ⇒ 走 latest 分支；该分支只被 print-templates.preview.js 的
      // latestLabel 用于「挑一条样例数据」渲染模板预览。
      const sampled = await readLabelVariables(6, { scopeWarehouseIds: [extraWarehouseId] })
      assert.ok(
        !sampled || Number(sampled.row?.id) !== c.insertId,
        'latest 取样不得选中作废容器（否则打印模板预览会拿 qty=0 的作废容器当样例）',
      )
    })
  } finally {
    if (madeBarcodes.length) {
      await pool.query("DELETE FROM print_jobs WHERE ref_type='inventory_container' AND ref_code IN (?)", [madeBarcodes])
      await pool.query('DELETE FROM inventory_containers WHERE barcode IN (?)', [madeBarcodes])
    }
    if (extraWarehouseId) await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [extraWarehouseId])
    const [[left]] = await pool.query('SELECT COUNT(*) n FROM inventory_containers WHERE barcode IN (?)', [madeBarcodes.length ? madeBarcodes : ['__none__']])
    console.log(`\n  清理后残留容器 ${left.n}`)
    await ctx.close()
    await require('../backend/src/config/db').pool.end()
    console.log(`\n${passed} passed, ${failed} failed\n`)
    process.exit(failed ? 1 : 0)
  }
}

main().catch(error => { console.error(error); process.exit(1) })
