'use strict'

/**
 * 批 A · 塑料盒作业流：放货 / 混批 / 还原整件
 *
 * 断言口径（不是「打日志看结果」）：HTTP 状态码 + **数据库库存事实**（容器余量、
 * inventory_stock 汇总、inventory_logs 快照、print_jobs 条数、混合标识两跳继承）。
 * 任一项失败即 `process.exitCode = 1`，可被 CI 当作真实红。
 *
 * 只在显式回环独立测试库运行（prepareSmokeContext 已校验 NODE_ENV/回环/库名并绑定 127.0.0.1）。
 */
const assert = require('node:assert/strict')

// 本批**只允许**在本批独立库运行：在任何连接/迁移之前先断言确切库名，
// 不能只依赖 smokeTestKit 的通用 flowcube_*_test 形态检查。
const EXPECTED_DB = 'flowcube_plastic_box_20260929_test'
assert.equal(process.env.DB_NAME, EXPECTED_DB, `本批用例只允许在 ${EXPECTED_DB} 运行，实际 ${process.env.DB_NAME}`)
assert.equal(process.env.DB_HOST, '127.0.0.1', '必须走本机回环')
assert.equal(Number(process.env.DB_PORT), 3307, '必须走本机 3307')

const {
  prepareSmokeContext, login, dbQuery, randomRef,
  createPurchaseOrder, confirmPurchaseOrder, createInboundTaskFromPurchase,
} = require('./helpers/smokeTestKit')

// ── 渲染失败注入（**默认透传真实实现**，仅 §7d 用例临时打开开关）──────────────
// 必须在 backend 侧首次 require 这两个模块**之前**打桩：print-jobs.label-command 对它们
// 都是解构导入，之后再改 require.cache 不会影响已绑定的引用
// （同 tests/label-render-degrade.smoke.test.js 顶部的原因）。
const nodePath = require('node:path')
const PB_ROOT = nodePath.resolve(__dirname, '..')
const rasterPath = require.resolve(nodePath.join(PB_ROOT, 'backend/src/modules/print-jobs/labelRasterService'))
const realRaster = require(rasterPath)
require.cache[rasterPath].exports = {
  ...realRaster,
  renderLabelAsync: async (input) => {
    if (globalThis.__PB_FORCE_RENDER_FAIL__) {
      const e = new Error('标签绘制繁忙，请稍后重试')
      e.code = 'LABEL_RENDER_BUSY'
      throw e
    }
    return realRaster.renderLabelAsync(input)
  },
}
const tplPath = require.resolve(nodePath.join(PB_ROOT, 'backend/src/modules/print-jobs/labelZplTemplate'))
const realTpl = require(tplPath)
require.cache[tplPath].exports = {
  ...realTpl,
  // 开关打开时返回 null，把入队逼到「本地光栅渲染」那条分支（模板存在时不会走它）
  getLabelZplFromDefaultTemplate: async (t, v) =>
    globalThis.__PB_FORCE_RENDER_FAIL__ ? null : realTpl.getLabelZplFromDefaultTemplate(t, v),
}

const svc = require('../backend/src/modules/plastic-boxes/plastic-boxes.service')

async function main() {
  const ctx = await prepareSmokeContext({ requestTimeoutMs: 30000 })
  const { pool, http, warehouse, location, product, supplier, customer, pdaHeaders, close } = ctx

  let passed = 0
  let failed = 0
  const check = async (title, fn) => {
    try { await fn(); passed++; console.log(`[PASS] ${title}`) }
    catch (e) { failed++; console.error(`[FAIL] ${title}\n        ${e.message}`) }
  }

  // 登录必须也在**资源释放**的保护范围内：下面的 try/finally 在登录之后才开始，
  // 覆盖不到这一段，登录失败（或 token 为空断言失败）会漏掉 close/pool.end 造成泄漏。
  // 不改共享测试框架，就地补一次等价释放后原样抛出（失败自然非 0）。
  let token
  try {
    const authed = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = authed.token
    assert.ok(token, '管理员应登录成功')
  } catch (e) {
    try { await close() } catch (e2) { console.error(`[FAIL] 登录失败后释放测试服务/连接池出错：${e2.message}`) }
    try { await require('../backend/src/config/db').pool.end() } catch (e2) { console.error(`[FAIL] 登录失败后关闭全局连接池出错：${e2.message}`) }
    throw e
  }

  const key = (p) => `${p}-${randomRef('K')}`

  /** 走真实业务链（采购→收货→上架）造一个整件库存码 */
  async function makeWholeContainer(qty, opts = {}) {
    const po = await createPurchaseOrder(http, token, { supplier, warehouse, product, quantity: qty })
    assert.equal(po.status, 201, `采购单创建失败：${JSON.stringify(po.data).slice(0, 200)}`)
    const poId = po.data.data.id
    assert.equal((await confirmPurchaseOrder(http, token, poId)).status, 200, '采购单确认失败')
    const it = await createInboundTaskFromPurchase(http, token, poId)
    assert.equal(it.status, 201, `入库任务创建失败：${JSON.stringify(it.data).slice(0, 200)}`)
    const taskId = it.data.data.taskId ?? it.data.data.id
    assert.equal((await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })).status, 200, '入库提交失败')
    const body = { productId: product.id, qty }
    if (opts.batchNo) body.batchNo = opts.batchNo
    if (opts.expDate) body.expDate = opts.expDate
    const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, { token, headers: pdaHeaders(), json: body })
    assert.equal(recv.status, 200, `收货失败：${JSON.stringify(recv.data).slice(0, 200)}`)
    const containerId = recv.data.data.containerId
    const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
      token, headers: pdaHeaders(), json: { containerId, locationId: location.id },
    })
    assert.equal(put.status, 200, `上架失败：${JSON.stringify(put.data).slice(0, 200)}`)
    return containerId
  }

  async function createEmptyBox() {
    const r = await http.post('/api/plastic-boxes', {
      token, json: { productId: product.id, warehouseId: warehouse.id, locationId: location.id },
    })
    assert.equal(r.status, 201, `建盒失败：${JSON.stringify(r.data).slice(0, 200)}`)
    return r.data.data.id
  }

  const containerOf = async (id) => (await dbQuery(pool, 'SELECT remaining_qty, status, is_mixed_batch, batch_no, exp_date FROM inventory_containers WHERE id=?', [id]))[0]
  const stockQty = async () => {
    const rows = await dbQuery(pool, 'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [product.id, warehouse.id])
    return rows.length ? Number(rows[0].quantity) : 0
  }
  // ref_type 必须一起限定：ref_id 是各单据共用列，别的单据 ID 可能与容器 ID 撞号
  const printJobCount = async (containerId) =>
    Number((await dbQuery(
      pool,
      "SELECT COUNT(*) AS c FROM print_jobs WHERE ref_id=? AND ref_type='inventory_container' AND job_type='container_label'",
      [containerId],
    ))[0].c)

  const fillReq = (boxId, sourceContainerId, k, extra = {}) =>
    http.post(`/api/plastic-boxes/${boxId}/fill`, {
      token, headers: { 'X-Request-Key': k }, json: { sourceContainerId, ...extra },
    })
  const repackReq = (boxId, body, k) =>
    http.post(`/api/plastic-boxes/${boxId}/repack`, { token, headers: { 'X-Request-Key': k }, json: body })

  try {
    // ── 1. 放货：按来源整件全部放入，库存守恒 ─────────────────────────────────
    await check('放货把来源整件全部放入，来源转空，库存汇总不变', async () => {
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      const before = await stockQty()
      const r = await fillReq(box, src, key('fill'))
      assert.equal(r.status, 200, `放货失败：${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(r.data.data.targetQtyAfter, 200)
      const srcRow = await containerOf(src)
      assert.equal(Number(srcRow.remaining_qty), 0, '来源应被转空')
      assert.equal(Number(srcRow.status), 2, '来源应转为 EMPTY')
      const boxRow = await containerOf(box)
      assert.equal(Number(boxRow.remaining_qty), 200)
      assert.equal(await stockQty(), before, '库存汇总必须守恒')
    })

    // ── 2. 同键重放返回原结果；范围校验必须覆盖重放 ─────────────────────────
    await check('同键重放返回原结果（来源已空仍成功）', async () => {
      const src = await makeWholeContainer(120)
      const box = await createEmptyBox()
      const k = key('replay')
      const r1 = await fillReq(box, src, k)
      assert.equal(r1.status, 200)
      const r2 = await fillReq(box, src, k)
      assert.equal(r2.status, 200, `同键重放应成功：${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(r2.data.data.targetQtyAfter, r1.data.data.targetQtyAfter, '重放应返回原结果')
      const boxRow = await containerOf(box)
      assert.equal(Number(boxRow.remaining_qty), 120, '重放不得重复转移')
    })

    await check('范围校验覆盖重放：无该仓权限的同键重放必须被拒', async () => {
      const src = await makeWholeContainer(60)
      const box = await createEmptyBox()
      const k = key('scope-replay')
      const adminUserId = 1
      // 第一次：有权限，成功
      await svc.fill(box, { sourceContainerId: src, requestKey: k }, { userId: adminUserId }, [warehouse.id])
      // 第二次：同键、同用户，但范围不含该仓 —— 不能因为命中重放就跳过范围校验
      await assert.rejects(
        () => svc.fill(box, { sourceContainerId: src, requestKey: k }, { userId: adminUserId }, [999999]),
        (e) => e.statusCode === 403 || /权限|范围/.test(String(e.message || '')),
        '重放路径未做仓库范围校验',
      )
    })

    // ── 3. 混批：不同批次（都无有效期）允许混，混合标识两跳继承 ───────────────
    await check('同商品不同批次（均无有效期）可混，盒置混合标识且不挂单一批次', async () => {
      const src1 = await makeWholeContainer(100, { batchNo: 'A1' })
      const src2 = await makeWholeContainer(50, { batchNo: 'A2' })
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src1, key('mix1'))).status, 200)
      const r2 = await fillReq(box, src2, key('mix2'))
      assert.equal(r2.status, 200, `不同批次应允许混放：${JSON.stringify(r2.data).slice(0, 200)}`)
      const row = await containerOf(box)
      assert.equal(Number(row.remaining_qty), 150)
      assert.equal(Number(row.is_mixed_batch), 1, '混批后应置混合标识')
      assert.equal(row.batch_no, null, '混批后不得再挂单一批次')
    })

    await check('混合标识两跳继承：混合盒还原出的整件码再倒入别盒仍为混合', async () => {
      const src1 = await makeWholeContainer(80, { batchNo: 'B1' })
      const src2 = await makeWholeContainer(80, { batchNo: 'B2' })
      const box1 = await createEmptyBox()
      await fillReq(box1, src1, key('hop1'))
      await fillReq(box1, src2, key('hop2'))          // box1 混合
      const rp = await repackReq(box1, { perBoxQty: 80, boxCount: 2 }, key('hop-repack'))
      assert.equal(rp.status, 200, `还原失败：${JSON.stringify(rp.data).slice(0, 200)}`)
      assert.equal(rp.data.data.created.length, 2)
      for (const c of rp.data.data.created) {
        const row = await containerOf(c.containerId)
        assert.equal(Number(row.is_mixed_batch), 1, '混合盒还原出的整件码应是混合来源')
      }
      // 第二跳：混合来源码倒入另一个盒，该盒也应变混合
      const box2 = await createEmptyBox()
      const r2 = await fillReq(box2, rp.data.data.created[0].containerId, key('hop3'))
      assert.equal(r2.status, 200, `第二跳放货失败：${JSON.stringify(r2.data).slice(0, 200)}`)
      const row2 = await containerOf(box2)
      assert.equal(Number(row2.is_mixed_batch), 1, '混合来源倒入的盒也应为混合')
    })

    await check('效期保护不可绕：目标有到期日时，混合来源（无批次）也不得并入', async () => {
      // 目标：无批次但有到期日
      const expSrc = await makeWholeContainer(70, { expDate: '2026-12-31' })
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, expSrc, key('exp1'))).status, 200)
      // 来源：无批次、无日期、混合来源
      const m1 = await makeWholeContainer(30, { batchNo: 'M1' })
      const m2 = await makeWholeContainer(30, { batchNo: 'M2' })
      const mixBox = await createEmptyBox()
      await fillReq(mixBox, m1, key('exp-m1'))
      await fillReq(mixBox, m2, key('exp-m2'))
      const rp = await repackReq(mixBox, { items: [30] }, key('exp-repack'))
      assert.equal(rp.status, 200)
      const mixedSrc = rp.data.data.created[0].containerId
      const r = await fillReq(box, mixedSrc, key('exp-merge'))
      assert.equal(r.status, 409, `有到期日时不得并入：${JSON.stringify(r.data).slice(0, 200)}`)
    })

    // ── 4. 还原整件：精度、上限、互斥、库存日志快照、打印条数 ────────────────
    await check('还原整件精度：超出两位小数必须拒绝，不得静默取整', async () => {
      const box = await createEmptyBox()
      const src = await makeWholeContainer(100)
      assert.equal((await fillReq(box, src, key('prec-fill'))).status, 200)
      const rQuick = await repackReq(box, { perBoxQty: 1.005, boxCount: 1 }, key('prec-1'))
      assert.equal(rQuick.status, 400, `perBoxQty 超两位应拒绝：${JSON.stringify(rQuick.data).slice(0, 200)}`)
      const rItems = await repackReq(box, { items: [1.005] }, key('prec-2'))
      assert.equal(rItems.status, 400, `items 超两位应拒绝：${JSON.stringify(rItems.data).slice(0, 200)}`)
      const row = await containerOf(box)
      assert.equal(Number(row.remaining_qty), 100, '拒绝后盒内余量不得变化')
    })

    await check('还原整件上限：箱数与清单长度都在造码前被拒', async () => {
      const box = await createEmptyBox()
      const src = await makeWholeContainer(100)
      assert.equal((await fillReq(box, src, key('cap-fill'))).status, 200)
      assert.equal((await repackReq(box, { perBoxQty: 1, boxCount: 101 }, key('cap-1'))).status, 400)
      assert.equal((await repackReq(box, { perBoxQty: 1, boxCount: 1000000 }, key('cap-2'))).status, 400, '巨大箱数须在造数组前被拒')
      assert.equal((await repackReq(box, { items: new Array(101).fill(1) }, key('cap-3'))).status, 400, '清单长度超上限应被拒')
    })

    await check('还原整件参数互斥按字段是否出现判定（items:[] 也算占位）', async () => {
      const box = await createEmptyBox()
      const src = await makeWholeContainer(100)
      assert.equal((await fillReq(box, src, key('mutex-fill'))).status, 200)
      const r = await repackReq(box, { items: [], perBoxQty: 10, boxCount: 1 }, key('mutex'))
      assert.equal(r.status, 400, '同时出现两种输入应拒绝')
    })

    await check('还原整件写库存日志用的是真实库存快照（非 0）', async () => {
      const box = await createEmptyBox()
      const src = await makeWholeContainer(100)
      assert.equal((await fillReq(box, src, key('log-fill'))).status, 200)
      const before = await stockQty()
      const r = await repackReq(box, { perBoxQty: 50, boxCount: 2 }, key('log-repack'))
      assert.equal(r.status, 200, `还原失败：${JSON.stringify(r.data).slice(0, 200)}`)
      const logs = await dbQuery(
        pool,
        `SELECT before_qty, after_qty FROM inventory_logs
          WHERE container_id=? AND log_source_type='container_split' ORDER BY id DESC LIMIT 2`,
        [box],
      )
      assert.ok(logs.length > 0, '应有容器转移流水')
      for (const l of logs) {
        assert.equal(Number(l.before_qty), before, `库存日志快照应等于真实库存 ${before}，实际 ${l.before_qty}`)
        assert.equal(Number(l.after_qty), before)
      }
      assert.equal(await stockQty(), before, '还原整件不改变库存总量')
    })

    await check('还原整件每箱各产生一条打印任务；同键重放不重复建任务', async () => {
      const box = await createEmptyBox()
      const src = await makeWholeContainer(100)
      assert.equal((await fillReq(box, src, key('pr-fill'))).status, 200)
      const k = key('pr-repack')
      const r1 = await repackReq(box, { perBoxQty: 50, boxCount: 2 }, k)
      assert.equal(r1.status, 200)
      const created = r1.data.data.created
      assert.equal(created.length, 2)
      const counts1 = await Promise.all(created.map((c) => printJobCount(c.containerId)))
      for (const n of counts1) assert.equal(n, 1, '每个整件码应有一条打印任务')
      const r2 = await repackReq(box, { perBoxQty: 50, boxCount: 2 }, k)
      assert.equal(r2.status, 200)
      const counts2 = await Promise.all(created.map((c) => printJobCount(c.containerId)))
      for (let i = 0; i < counts2.length; i++) {
        assert.equal(counts2[i], counts1[i], '同键重放不得新增打印任务')
      }
      const totalOfProduct = Number((await dbQuery(
        pool,
        "SELECT COUNT(*) AS c FROM inventory_containers WHERE source_ref_id=? AND source_ref_type='plastic_box_repack'",
        [box],
      ))[0].c)
      assert.equal(totalOfProduct, 2, '同键重放不得重复建码')
    })

    // ── 5. 并发守恒（**不等于**已证明锁下重读缺口被红测打中） ────────────────
    // 说明：新旧引擎在该并发下都表现为「一次成功、一次被拒」，因此本用例只证明
    // 「并发不产生双计/残留」，**不独立证明**「无锁快照缺口」——后者另见静态审查与
    // 下方 expectedSourceQty 快照守卫用例。
    await check('并发守恒已验：同一来源并发全量放货，总量守恒且来源不残留', async () => {
      const src = await makeWholeContainer(100)
      const box1 = await createEmptyBox()
      const box2 = await createEmptyBox()
      const before = await stockQty()
      const [r1, r2] = await Promise.all([
        fillReq(box1, src, key('conc-1')),
        fillReq(box2, src, key('conc-2')),
      ])
      assert.ok([r1.status, r2.status].some((s) => s === 200), `至少一次成功：${r1.status}/${r2.status}`)
      const srcRow = await containerOf(src)
      const inBoxes = Number((await containerOf(box1)).remaining_qty) + Number((await containerOf(box2)).remaining_qty)
      assert.equal(Number(srcRow.remaining_qty) + inBoxes, 100, '并发下总量必须守恒、来源不得留下残余')
      assert.equal(Number(srcRow.remaining_qty), 0, '来源应被转空')
      assert.equal(await stockQty(), before, '库存汇总不变')
    })

    // ── 7. PDA 分支：带票据必须校验设备与设备仓 ──────────────────────────────
    await check('PDA 分支：同仓设备可放货；无效票据与跨仓必须拒绝', async () => {
      const src = await makeWholeContainer(60)
      const box = await createEmptyBox() // 设备仓 = warehouse.id

      // 同仓：smoke 设备（绑定 warehouse.id）→ 允许
      const okRes = await http.post(`/api/plastic-boxes/${box}/fill`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('pda-ok') }, json: { sourceContainerId: src },
      })
      assert.equal(okRes.status, 200, `同仓 PDA 应可放货：${JSON.stringify(okRes.data).slice(0, 200)}`)

      // 无效票据 → 拒绝（不能因为带了头就放行）
      const bad = await http.post(`/api/plastic-boxes/${box}/fill`, {
        token,
        headers: { 'X-Client': 'pda', 'X-PDA-Session': 'not-a-real-token', 'X-Request-Key': key('pda-bad') },
        json: { sourceContainerId: src },
      })
      assert.equal(bad.status, 403, `无效票据必须拒绝：${JSON.stringify(bad.data).slice(0, 200)}`)

      // **缺票**但带 X-Client: pda → 也必须被拒（不能「没票就当 PC」放行）
      const noTicket = await http.post(`/api/plastic-boxes/${box}/fill`, {
        token,
        headers: { 'X-Client': 'pda', 'X-Request-Key': key('pda-noticket') },
        json: { sourceContainerId: src },
      })
      assert.equal(noTicket.status, 403, `带 PDA 标记但缺票必须拒绝：${JSON.stringify(noTicket.data).slice(0, 200)}`)

      // 跨仓：目标盒在另一个仓库，设备仓仍是 warehouse.id → 拒绝
      const otherWh = await http.post('/api/warehouses', { token, json: { name: `PB-A-OTHER-${randomRef('W')}`, type: 1 } })
      const otherWhId = otherWh.data?.data?.id
      assert.ok(otherWhId, '应能建第二个仓库')
      const box2 = await http.post('/api/plastic-boxes', {
        token, json: { productId: product.id, warehouseId: otherWhId },
      })
      assert.equal(box2.status, 201, `建别仓盒应成功：${JSON.stringify(box2.data).slice(0, 200)}`)
      const cross = await http.post(`/api/plastic-boxes/${box2.data.data.id}/fill`, {
        token, headers: { ...pdaHeaders(), 'X-Request-Key': key('pda-cross') }, json: { sourceContainerId: src },
      })
      assert.equal(cross.status, 403, `跨仓 PDA 必须拒绝：${JSON.stringify(cross.data).slice(0, 200)}`)
    })

    // ── 8. 真实合法第二次操作 ────────────────────────────────────────────────
    await check('合法的第二次放货：新键对另一来源执行，成功且盒累加', async () => {
      const src1 = await makeWholeContainer(90)
      const src2 = await makeWholeContainer(40)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src1, key('second-1'))).status, 200)
      const r2 = await fillReq(box, src2, key('second-2'))
      assert.equal(r2.status, 200, `第二次合法放货应成功：${JSON.stringify(r2.data).slice(0, 200)}`)
      assert.equal(r2.data.data.targetQtyAfter, 130)
      const row = await containerOf(box)
      assert.equal(Number(row.remaining_qty), 130)
    })

    // ── 6. 还原整件的入队变量是真实商品名（对着**不经 guard 的模板编译**比对） ──
    // 标签内容是 ZPL **光栅位图**（^GFA），读不出文本，不能 includes 中文品名。
    // 因此用「期望值」= 直接用同一模板编译「正确商品名」的变量（**不经过 enqueue 的
    // guard**），再与 repack 实际入队任务的 content 逐字节比较：若入队变量被覆盖成空名，
    // 实际 content 会与这个期望值不同 → 该用例能真正打中缺口。
    await check('还原整件实际入队变量含真实商品名（对着模板编译的期望值比对）', async () => {
      const { getLabelZplFromDefaultTemplate } = require('../backend/src/modules/print-jobs/labelZplTemplate')
      const { readLabelVariables } = require('../backend/src/modules/print-jobs/labelVariables')

      const box = await createEmptyBox()
      const src = await makeWholeContainer(40)
      assert.equal((await fillReq(box, src, key('name-fill'))).status, 200)
      const r = await repackReq(box, { items: [40] }, key('name-repack'))
      assert.equal(r.status, 200)
      const newId = r.data.data.created[0].containerId

      const jobs = await dbQuery(
        pool,
        "SELECT id, status, printer_id, content FROM print_jobs WHERE ref_id=? AND ref_type='inventory_container' AND job_type='container_label' ORDER BY id DESC LIMIT 1",
        [newId],
      )
      assert.equal(jobs.length, 1, '应有一条容器标签打印任务')
      const actual = String(jobs[0].content || '')
      assert.ok(actual.startsWith('^XA'), '应已渲染出 ZPL 内容')
      assert.ok(jobs[0].printer_id != null && Number(jobs[0].status) === 0, '应为待打印，而不是降级失败记录')

      // 期望值：用容器真实模板变量 + 真实商品名，**直接走模板编译器**（不经 enqueue 的 guard）
      const varsRes = await readLabelVariables(6, { id: newId })
      assert.ok(varsRes?.vars, '应能取到容器的模板变量')
      const baseVars = { ...varsRes.vars, container_code: varsRes.vars.container_code, qty: 40 }
      const expected = await getLabelZplFromDefaultTemplate(6, { ...baseVars, product_name: product.name })
      assert.ok(expected, '模板编译应返回内容')
      assert.equal(actual, expected, '实际入队变量里的商品名应为真实商品名，而不是被 null 覆盖成空名')

      // 鉴别力守卫（不经 guard）：把商品名置空再编译一次，必须与正确名不同——
      // 否则模板根本不渲染品名，本用例无从判断
      const blank = await getLabelZplFromDefaultTemplate(6, { ...baseVars, product_name: '' })
      assert.notEqual(blank, expected, '模板确实渲染商品名（否则本用例没有鉴别力）')
    })

    // ── 6b. 整数商品：逐箱数量为小数必须拒绝 ─────────────────────────────────
    await check('整数商品：逐箱数量填小数必须拒绝', async () => {
      const [[origPolicy]] = await pool.query('SELECT allow_decimal_qty FROM product_items WHERE id=?', [product.id])
      await dbQuery(pool, 'UPDATE product_items SET allow_decimal_qty=0 WHERE id=?', [product.id])
      try {
        const box = await createEmptyBox()
        const src = await makeWholeContainer(20)
        assert.equal((await fillReq(box, src, key('int-fill'))).status, 200)
        const r = await repackReq(box, { perBoxQty: 1.5, boxCount: 2 }, key('int-repack'))
        assert.equal(r.status, 400, `整数商品不接受小数：${JSON.stringify(r.data).slice(0, 200)}`)
        const row = await containerOf(box)
        assert.equal(Number(row.remaining_qty), 20, '拒绝后盒内余量不得变化')
      } finally {
        // 恢复**读到的原值**，不盲设 1
        await dbQuery(pool, 'UPDATE product_items SET allow_decimal_qty=? WHERE id=?', [origPolicy.allow_decimal_qty, product.id])
      }
    })

    // ── 6c. 无可用打印机：真实降级分支 ───────────────────────────────────────
    await check('无可用打印机：业务已提交，打印降级为可补打失败记录（原因非渲染失败）', async () => {
      // 先取快照，逐原值恢复（不盲设 status=1）
      const printerSnapshot = await dbQuery(pool, 'SELECT id, status FROM printers')
      const bindings = await dbQuery(pool, 'SELECT printer_id, print_type, warehouse_id FROM printer_bindings')
      await dbQuery(pool, 'UPDATE printers SET status=0')
      await dbQuery(pool, 'DELETE FROM printer_bindings')
      try {
        const box = await createEmptyBox()
        const src = await makeWholeContainer(30)
        assert.equal((await fillReq(box, src, key('np-fill'))).status, 200)
        const r = await repackReq(box, { items: [30] }, key('np-repack'))
        assert.equal(r.status, 200, '无打印机不得回滚业务事务')
        assert.ok(r.data.data.noPrinterCount >= 1, '应报告「未打印」数量')
        const newId = r.data.data.created[0].containerId
        const row = await containerOf(newId)
        assert.equal(Number(row.remaining_qty), 30, '业务数据必须已落库')
        const jobs = await dbQuery(
          pool,
          "SELECT status, printer_id, error_message FROM print_jobs WHERE ref_id=? AND ref_type='inventory_container' ORDER BY id DESC LIMIT 1",
          [newId],
        )
        assert.equal(jobs.length, 1, '应留下可补打的打印记录')
        assert.equal(Number(jobs[0].status), 3, '应为降级失败记录')
        assert.equal(jobs[0].printer_id, null)
        assert.ok(
          !/label render failed/.test(String(jobs[0].error_message || '')),
          `「无打印机」的原因不应写成「渲染失败」（实际：${jobs[0].error_message}）`,
        )
      } finally {
        for (const p of printerSnapshot) {
          await dbQuery(pool, 'UPDATE printers SET status=? WHERE id=?', [p.status, p.id])
        }
        if (bindings.length) {
          await dbQuery(
            pool,
            'INSERT INTO printer_bindings (printer_id, print_type, warehouse_id) VALUES ?',
            [bindings.map((b) => [b.printer_id, b.print_type, b.warehouse_id])],
          )
        }
      }
    })

    // ── 6d. 范围校验覆盖重放（还原整件） ─────────────────────────────────────
    await check('范围校验覆盖重放（还原整件）：无该仓权限的同键重放必须被拒', async () => {
      const box = await createEmptyBox()
      const src = await makeWholeContainer(20)
      assert.equal((await fillReq(box, src, key('rs-fill'))).status, 200)
      const k = key('rs-repack')
      await svc.repack(box, { items: [10], requestKey: k }, { userId: 1 }, [warehouse.id])
      await assert.rejects(
        () => svc.repack(box, { items: [10], requestKey: k }, { userId: 1 }, [999999]),
        (e) => e.statusCode === 403 || /权限|范围/.test(String(e.message || '')),
        '重放路径未做仓库范围校验',
      )
    })

    // ── 7a. 还原整件：取满成功 ──────────────────────────────────────────────
    await check('还原整件取满：合计等于盒余量可成功，盒余 0 且转 EMPTY', async () => {
      const src = await makeWholeContainer(20)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '放货失败')
      const r = await repackReq(box, { items: [20] }, key('repack-full'))
      assert.equal(r.status, 200, `取满应成功：${JSON.stringify(r.data).slice(0, 200)}`)
      const row = await containerOf(box)
      assert.equal(Number(row.remaining_qty), 0, '取满后盒内余量应为 0')
      assert.equal(Number(row.status), 2, '取满后盒应转 EMPTY(status=2)')
    })

    // ── 7b. 还原整件：超量被拒且零副作用 ────────────────────────────────────
    await check('还原整件超量：被拒且盒余量与容器数都不变（零副作用）', async () => {
      const src = await makeWholeContainer(30)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '放货失败')
      const beforeQty = Number((await containerOf(box)).remaining_qty)
      const countOf = async () => Number((await dbQuery(
        pool,
        'SELECT COUNT(*) AS c FROM inventory_containers WHERE product_id=? AND warehouse_id=?',
        [product.id, warehouse.id],
      ))[0].c)
      const beforeCount = await countOf()
      const r = await repackReq(box, { items: [beforeQty + 1] }, key('repack-over'))
      assert.ok(r.status >= 400, `超量应被拒，实际 status=${r.status}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), beforeQty, '超量被拒后盒内余量不得变化')
      assert.equal(await countOf(), beforeCount, '超量被拒后不得新建容器')
    })

    // ── 7c. 混合来源倒入「曾装效期、已被清空」的空盒 ─────────────────────────
    await check('混合来源倒入清空后的空盒：清掉残留旧效期并置混合标识', async () => {
      // 造混合来源：同一盒倒入两个不同批次（均无有效期）后再还原成整件码
      const b1 = await makeWholeContainer(10, { batchNo: 'MIXA' })
      const b2 = await makeWholeContainer(10, { batchNo: 'MIXB' })
      const mixBox = await createEmptyBox()
      assert.equal((await fillReq(mixBox, b1, key('fill'))).status, 200, '放货 1 失败')
      assert.equal((await fillReq(mixBox, b2, key('fill'))).status, 200, '混合放货失败')
      assert.equal(Number((await containerOf(mixBox)).is_mixed_batch), 1, '前置：混盒应置混合标识')
      const mixRepack = await repackReq(mixBox, { items: [20] }, key('repack-mix'))
      assert.equal(mixRepack.status, 200, '混合盒还原失败')
      const mixedCode = mixRepack.data.data.created[0].containerId

      // 目标盒：曾装带效期货 → 全部还原。清空路径只改数量/状态，旧 exp_date 会残留在空盒上
      const dated = await makeWholeContainer(10, { expDate: '2027-01-01' })
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, dated, key('fill'))).status, 200, '放货失败')
      assert.equal((await repackReq(box, { items: [10] }, key('repack-drain'))).status, 200, '清空失败')
      const before = await containerOf(box)
      assert.equal(Number(before.remaining_qty), 0, '盒应已清空')
      assert.ok(before.exp_date != null, '前置：清空后旧效期仍残留（本用例以此为前提）')

      // 倒入混合来源：旧效期必须被清、并置混合标识
      assert.equal((await fillReq(box, mixedCode, key('fill-mixed'))).status, 200, '混合来源倒入失败')
      const after = await containerOf(box)
      assert.equal(after.exp_date, null, '倒入混合来源后不得残留旧效期')
      assert.equal(Number(after.is_mixed_batch), 1, '应置混合标识')
    })

    // ── 7d. 标签渲染失败降级：业务已提交，只有标签降级 ───────────────────────
    await check('还原整件标签渲染失败：业务已提交，降级为可补打失败记录（原因=渲染失败）', async () => {
      const src = await makeWholeContainer(10)
      const box = await createEmptyBox()
      assert.equal((await fillReq(box, src, key('fill'))).status, 200, '放货失败')
      const beforeQty = Number((await containerOf(box)).remaining_qty)
      globalThis.__PB_FORCE_RENDER_FAIL__ = true
      let r
      try {
        r = await repackReq(box, { items: [5] }, key('repack-renderfail'))
      } finally {
        globalThis.__PB_FORCE_RENDER_FAIL__ = false
      }
      assert.equal(r.status, 200, `渲染失败不得回滚业务：${JSON.stringify(r.data).slice(0, 200)}`)
      const d = r.data.data
      assert.equal(Number(d.renderFailedCount), 1, '须计为渲染失败 1 条')
      assert.equal(Number(d.noPrinterCount), 0, '不得误记为「无可用打印机」')
      assert.equal(Number((await containerOf(box)).remaining_qty), beforeQty - 5, '库存必须已提交扣减')
      const jobs = await dbQuery(
        pool,
        "SELECT status, error_message FROM print_jobs WHERE ref_id=? AND ref_type='inventory_container' ORDER BY id DESC LIMIT 1",
        [d.created[0].containerId],
      )
      assert.equal(Number(jobs[0].status), 3, '降级记录应为失败态 3（打印记录页可见、可补打）')
      assert.match(String(jobs[0].error_message || ''), /label render failed/, '失败原因须写明渲染失败')
    })

    // ── 8. 放货负例矩阵（A1 Step6）：跨商品 / 跨仓 / 目标非 B / 单件个体 ──────
    // 夹具一律走真实业务链（采购→收货→上架）；**不手改锁/状态/库存**。
    await check('放货负例矩阵：跨商品 / 跨仓 / 目标非B / 单件个体 各 4xx 且零副作用', async () => {
      // 局部夹具：在**指定仓库+商品**下走真实链造整件（仅为本用例参数化，不动共享 helper）
      const makeWholeIn = async (whRow, locId, prodRow, qty) => {
        const po = await createPurchaseOrder(http, token, { supplier, warehouse: whRow, product: prodRow, quantity: qty })
        assert.equal(po.status, 201, `采购单创建失败：${JSON.stringify(po.data).slice(0, 150)}`)
        const poId = po.data.data.id
        assert.equal((await confirmPurchaseOrder(http, token, poId)).status, 200, '采购确认失败')
        const it = await createInboundTaskFromPurchase(http, token, poId)
        assert.equal(it.status, 201, `入库任务创建失败：${JSON.stringify(it.data).slice(0, 150)}`)
        const taskId = it.data.data.taskId ?? it.data.data.id
        assert.equal((await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })).status, 200, '入库提交失败')
        const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
          token, headers: pdaHeaders(), json: { productId: prodRow.id, qty },
        })
        assert.equal(recv.status, 200, `收货失败：${JSON.stringify(recv.data).slice(0, 150)}`)
        const cid = recv.data.data.containerId
        const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
          token, headers: pdaHeaders(), json: { containerId: cid, locationId: locId },
        })
        assert.equal(put.status, 200, `上架失败：${JSON.stringify(put.data).slice(0, 150)}`)
        return cid
      }

      // 零副作用快照：盒余量 + 来源余量 + 该商品同仓容器数 + inventory_logs 总数
      const snap = async (boxId, srcId, prodId, whId) => ({
        box: Number((await containerOf(boxId)).remaining_qty),
        src: Number((await containerOf(srcId)).remaining_qty),
        containers: Number((await dbQuery(pool,
          'SELECT COUNT(*) c FROM inventory_containers WHERE product_id=? AND warehouse_id=?',
          [prodId, whId]))[0].c),
        logs: Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_logs'))[0].c),
        // 实物库存缓存：与「预占(reserved)」不同一件事，不能把 reserved 变化当库存量变化
        stock: await stockQty(),
      })
      // 只接受 4xx：**500 不算「被拒绝」**，必须当成失败
      const assertRejected = (r, label) => assert.ok(
        r.status >= 400 && r.status < 500,
        `${label} 必须 4xx（500 不接受），实际 ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`,
      )

      // ── 本用例专用主数据：一律**自建**（不依赖库内偶然种子 id=2 等；CI 空专库同样可跑）──
      const stamp = Date.now().toString(36)
      const catResp = await http.post('/api/categories', { token, json: { name: `PB矩阵品类-${stamp}` } })
      assert.equal(catResp.status, 201, `建分类失败：${JSON.stringify(catResp.data).slice(0, 150)}`)
      const categoryId = Number(catResp.data.data?.id ?? catResp.data.data)
      assert.ok(Number.isSafeInteger(categoryId) && categoryId > 0, '应取得自建分类 id')

      const prodResp = await http.post('/api/products', {
        token,
        json: {
          name: `PB矩阵商品-${stamp}`, categoryId, supplierId: Number(supplier.id),
          unit: '件', spec: '标准', color: '白', costPrice: 5,
        },
      })
      assert.equal(prodResp.status, 201, `建商品失败：${JSON.stringify(prodResp.data).slice(0, 200)}`)
      const otherProductId = Number(prodResp.data.data.id)
      const otherProduct = {
        id: otherProductId,
        code: prodResp.data.data.code ?? `PBCAT${otherProductId}`,
        name: prodResp.data.data.name ?? `PB矩阵商品-${stamp}`,
        unit: '件',
      }

      const whResp = await http.post('/api/warehouses', { token, json: { name: `PB矩阵仓-${stamp}`, type: 1 } })
      assert.equal(whResp.status, 201, `建仓库失败：${JSON.stringify(whResp.data).slice(0, 200)}`)
      const otherWhId = Number(whResp.data.data.id)
      // 刻意**不自建库位**：库位编码由 zone/aisle/rack/level/position 拼成，固定值在重复运行时会撞旧夹具
      // （400 DUPLICATE_ENTRY）；而建盒的 locationId 本就可选，跨仓负例只需要「另一仓的空盒」。

      // ① 跨商品：来源是**自建的另一商品** → 目标盒绑主商品
      {
        const src = await makeWholeIn(warehouse, location.id, otherProduct, 10)
        const box = await createEmptyBox()
        const before = await snap(box, src, product.id, warehouse.id)
        assertRejected(await fillReq(box, src, key('neg-xprod')), '跨商品放货')
        assert.deepEqual(await snap(box, src, product.id, warehouse.id), before, '跨商品放货必须零副作用')
      }

      // ② 跨仓：**盒在自建的另一仓库**、来源在主仓（PDA 设备绑主仓，故不在异仓收货）
      {
        const src = await makeWholeContainer(10) // 主仓来源
        const boxResp = await http.post('/api/plastic-boxes', {
          token, json: { productId: product.id, warehouseId: otherWhId },
        })
        assert.equal(boxResp.status, 201, `异仓建盒失败：${JSON.stringify(boxResp.data).slice(0, 150)}`)
        const box = boxResp.data.data.id
        const before = await snap(box, src, product.id, warehouse.id)
        assertRejected(await fillReq(box, src, key('neg-xwh')), '跨仓放货')
        assert.deepEqual(await snap(box, src, product.id, warehouse.id), before, '跨仓放货必须零副作用')
      }

      // ③ 目标非 B：把「盒 id」位置传成一个整件 I 的 id
      {
        const src = await makeWholeContainer(10)
        const notABox = await makeWholeContainer(10) // 用它的 id 当"目标盒"
        const before = await snap(notABox, src, product.id, warehouse.id)
        assertRejected(await fillReq(notABox, src, key('neg-notb')), '目标非 B 放货')
        assert.deepEqual(await snap(notABox, src, product.id, warehouse.id), before, '目标非 B 放货必须零副作用')
      }

      // ④ 单件个体：来源 initial_qty=1（isIndividualContainer）
      {
        const src = await makeWholeContainer(1)
        const box = await createEmptyBox()
        const row = await containerOf(src)
        assert.equal(Number(row.remaining_qty), 1, '前置：单件来源应为 1 件')
        const before = await snap(box, src, product.id, warehouse.id)
        const r = await fillReq(box, src, key('neg-individual'))
        assertRejected(r, '单件个体放货')
        assert.match(String(r.data?.message || ''), /单件|个体|INDIVIDUAL/i, '应给出「单件不可并入」的原因')
        assert.deepEqual(await snap(box, src, product.id, warehouse.id), before, '单件个体放货必须零副作用')
      }
    })

    // ── 9. 旧接口兼容（A1 Step7）：旧 split + targetContainerId 的 partial 拆分 ──
    await check('旧接口兼容：POST /inventory/containers/:id/split 带 targetContainerId 的 partial 拆分行为不变', async () => {
      const src = await makeWholeContainer(200)
      const box = await createEmptyBox()
      const before = await stockQty()
      const r = await http.post(`/api/inventory/containers/${src}/split`, {
        token, json: { qty: 50, targetContainerId: box },
      })
      assert.equal(r.status, 200, `旧 split 应成功：${JSON.stringify(r.data).slice(0, 200)}`)
      assert.equal(Number((await containerOf(src)).remaining_qty), 150, '来源应剩 150')
      assert.equal(Number((await containerOf(box)).remaining_qty), 50, '目标盒应为 50')
      assert.equal(await stockQty(), before, 'partial 拆分不改变库存总量')
    })

    // ── 10. 来源被真实拣货锁定（合法链：sale → reserve → ship → scan-logs）──────
    await check('来源已被拣货任务锁定：放货 4xx 且零副作用（夹具走真实销售/拣货链，不手改锁）', async () => {
      const snap = async (boxId, srcId) => ({
        box: Number((await containerOf(boxId)).remaining_qty),
        src: Number((await containerOf(srcId)).remaining_qty),
        containers: Number((await dbQuery(pool,
          'SELECT COUNT(*) c FROM inventory_containers WHERE product_id=? AND warehouse_id=?',
          [product.id, warehouse.id]))[0].c),
        logs: Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_logs'))[0].c),
        // 实物库存缓存：与「预占(reserved)」不是同一件事，不能把 reserved 变化当库存量变化
        stock: await stockQty(),
      })
      const assertRejected = (r, label) => assert.ok(
        r.status >= 400 && r.status < 500,
        `${label} 必须 4xx（500 不接受），实际 ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`,
      )

      const src = await makeWholeContainer(30)
      const srcBarcode = (await dbQuery(pool, 'SELECT barcode FROM inventory_containers WHERE id=?', [src]))[0].barcode
      const box = await createEmptyBox()

      const sale = await http.post('/api/sale', {
        token,
        json: {
          customerId: Number(customer.id),
          customerName: customer.name,
          warehouseId: Number(warehouse.id),
          warehouseName: warehouse.name,
          remark: randomRef('pb-neg-lock'),
          items: [{
            productId: Number(product.id),
            productCode: product.code,
            productName: product.name,
            unit: product.unit,
            quantity: 30,
            unitPrice: 10,
          }],
        },
      })
      assert.equal(sale.status, 201, `建销售单失败：${JSON.stringify(sale.data).slice(0, 200)}`)
      const saleId = sale.data.data.id
      assert.equal((await http.post(`/api/sale/${saleId}/reserve`, { token })).status, 200, '占库失败')
      const shipResp = await http.post(`/api/sale/${saleId}/ship`, { token })
      assert.ok(shipResp.ok, `发货(生成拣货任务)失败：${JSON.stringify(shipResp.data).slice(0, 200)}`)
      const [saleRow] = await dbQuery(pool, 'SELECT task_id FROM sale_orders WHERE id=?', [saleId])
      const taskId = Number(saleRow.task_id)
      assert.ok(Number.isSafeInteger(taskId) && taskId > 0, '发货后应生成拣货任务')
      const [wti] = await dbQuery(pool, 'SELECT id FROM warehouse_task_items WHERE task_id=? ORDER BY id LIMIT 1', [taskId])
      const itemId = Number(wti.id)

      // 用合法扫码入口锁容器（**不手改 locked_by_task_id**）
      const pick = await http.post('/api/scan-logs', {
        token,
        headers: pdaHeaders(),
        json: {
          taskId, itemId, containerId: src, barcode: srcBarcode,
          productId: Number(product.id), qty: 30, scanMode: '整件',
        },
      })
      assert.ok(pick.ok, `拣货扫码失败：${JSON.stringify(pick.data).slice(0, 200)}`)
      // 注意：containerOf 的选择列**不含** locked_by_task_id，必须单独查
      const lockedRow = (await dbQuery(pool, 'SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [src]))[0]
      assert.equal(Number(lockedRow.locked_by_task_id ?? 0), taskId, '前置：来源应已被任务锁定')

      // 基线必须在**锁定夹具完成之后、fill 之前**取（否则会把锁定本身的变化算进"副作用"）
      const before = await snap(box, src)
      assertRejected(await fillReq(box, src, key('neg-locked')), '来源被拣货锁定后放货')
      assert.deepEqual(await snap(box, src), before, '来源锁定后放货必须零副作用')

      // ── 收尾：走**拣货退回**真实链，并回查「锁是否真的解除」 ────────────────
      // 注意：POST /sale/:id/cancel 返回 200 只表示**进入了拣货退回**，
      // **不证明**来源锁已清、任务已完结——必须继续走归还扫码并用 DB 事实回查。
      const cancel = await http.post(`/api/sale/${saleId}/cancel`, { token })
      assert.ok(cancel.ok, `取消销售单失败：${JSON.stringify(cancel.data).slice(0, 200)}`)
      const detail = await http.get(`/api/warehouse-tasks/${taskId}/cancel-return-detail`, { token })
      if (!detail.ok) {
        console.log(`[INFO] 部分收尾：cancel-return-detail 不可用（status=${detail.status}）；来源锁未解除，夹具保留不物理删除`)
      } else {
        const ret = await http.post('/api/scan-logs/cancel-return', {
          token,
          headers: pdaHeaders(),
          json: { taskId, containerId: src, barcode: srcBarcode, locationId: location.id },
        })
        if (!ret.ok) {
          console.log(`[INFO] 部分收尾：归还扫码未走通（status=${ret.status} ${JSON.stringify(ret.data).slice(0, 150)}）；来源锁未解除，夹具保留`)
        } else {
          // 归还成功后**回查 DB 事实**：来源锁必须已清
          const afterRow = (await dbQuery(pool, 'SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [src]))[0]
          assert.equal(afterRow.locked_by_task_id, null, '归还扫码成功后来源锁定应被解除')
          const taskRow = (await dbQuery(pool, 'SELECT status FROM warehouse_tasks WHERE id=?', [taskId]))[0]
          console.log(`[INFO] 收尾完成：来源锁已解除；任务 ${taskId} status=${taskRow.status}`)
        }
      }
    })

    // ── 11. expectedSourceQty 并发快照守卫（上方并发用例注释所指的真实用例）────
    await check('expectedSourceQty 快照与来源当前量不符：409 且不写库存/流水', async () => {
      const src = await makeWholeContainer(20)
      const box = await createEmptyBox()
      const before = {
        box: Number((await containerOf(box)).remaining_qty),
        src: Number((await containerOf(src)).remaining_qty),
        logs: Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_logs'))[0].c),
      }
      // 传入一个与来源当前量不符的快照守卫值
      const r = await fillReq(box, src, key('snapshot-mismatch'), { expectedSourceQty: 999 })
      assert.equal(r.status, 409, `快照不符应 409，实际 ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`)
      assert.equal(Number((await containerOf(box)).remaining_qty), before.box, '快照不符不得改动目标盒')
      assert.equal(Number((await containerOf(src)).remaining_qty), before.src, '快照不符不得改动来源')
      assert.equal(Number((await dbQuery(pool, 'SELECT COUNT(*) c FROM inventory_logs'))[0].c), before.logs,
        '快照不符不得写库存流水')
    })

    // ── 12. 混合标识传递补齐（A2）：非空混合盒 + 单批来源；曾混合的空盒 + 单批来源 ──
    await check('混合标识传递：非空混合盒并入单批仍为混合；曾混合的空盒倒入单批来源重置为单批', async () => {
      // 造混合盒：两个不同批次（均无有效期）倒入同一盒
      const b1 = await makeWholeContainer(10, { batchNo: 'MIXP' })
      const b2 = await makeWholeContainer(10, { batchNo: 'MIXQ' })
      const mixBox = await createEmptyBox()
      assert.equal((await fillReq(mixBox, b1, key('fill'))).status, 200, '放货 1 失败')
      assert.equal((await fillReq(mixBox, b2, key('fill'))).status, 200, '混合放货失败')
      assert.equal(Number((await containerOf(mixBox)).is_mixed_batch), 1, '前置：盒应已为混合')

      // ① 非空 mixed + 单批来源 ⇒ 仍为 1，**不得被清回 0**
      const single = await makeWholeContainer(10, { batchNo: 'SOLO' })
      assert.equal((await fillReq(mixBox, single, key('fill'))).status, 200, '混合盒并入单批来源应成功')
      assert.equal(Number((await containerOf(mixBox)).is_mixed_batch), 1, '非空混合盒并入单批后仍应为混合')

      // ② 曾混合的空盒 + 单批来源 ⇒ 重置为 0（单批）
      const mixQty = Number((await containerOf(mixBox)).remaining_qty)
      assert.equal((await repackReq(mixBox, { items: [mixQty] }, key('repack-drain'))).status, 200, '清空混合盒失败')
      const emptyRow = await containerOf(mixBox)
      assert.equal(Number(emptyRow.remaining_qty), 0, '前置：盒应已清空')
      assert.equal(Number(emptyRow.is_mixed_batch), 1, '前置：清空路径不重写标识，混合标识仍在')
      const fresh = await makeWholeContainer(10, { batchNo: 'SOLO2' })
      assert.equal((await fillReq(mixBox, fresh, key('fill'))).status, 200, '空混合盒倒入单批来源应成功')
      assert.equal(Number((await containerOf(mixBox)).is_mixed_batch), 0, '曾混合的空盒倒入单批来源应重置为单批')

      // ③ 非空 + **同批次** ⇒ 仍为单批(0)（不因"再倒入一次"被误置混合）
      {
        const g1 = await makeWholeContainer(10, { batchNo: 'SAME1' })
        const g2 = await makeWholeContainer(10, { batchNo: 'SAME1' })
        const box = await createEmptyBox()
        assert.equal((await fillReq(box, g1, key('fill'))).status, 200, '放货 1 失败')
        assert.equal(Number((await containerOf(box)).is_mixed_batch), 0, '前置：单批盒标识应为 0')
        assert.equal((await fillReq(box, g2, key('fill'))).status, 200, '同批次再倒入应成功')
        assert.equal(Number((await containerOf(box)).is_mixed_batch), 0, '同批次非空盒仍应为单批(0)')
      }

      // ④ **非空单批盒** + 混合来源 ⇒ 置 1（此前只验过"空盒 ← 混合来源"）
      {
        const s1 = await makeWholeContainer(10, { batchNo: 'MSRC1' })
        const s2 = await makeWholeContainer(10, { batchNo: 'MSRC2' })
        const mixSrcBox = await createEmptyBox()
        assert.equal((await fillReq(mixSrcBox, s1, key('fill'))).status, 200, '放货 1 失败')
        assert.equal((await fillReq(mixSrcBox, s2, key('fill'))).status, 200, '混合放货失败')
        const mixSrcQty = Number((await containerOf(mixSrcBox)).remaining_qty)
        const mixSrcRepack = await repackReq(mixSrcBox, { items: [mixSrcQty] }, key('repack-mixsrc'))
        assert.equal(mixSrcRepack.status, 200, '混合盒还原失败')
        const mixedSourceId = mixSrcRepack.data.data.created[0].containerId

        const solo = await makeWholeContainer(10, { batchNo: 'SOLOX' })
        const box = await createEmptyBox()
        assert.equal((await fillReq(box, solo, key('fill'))).status, 200, '放货失败')
        assert.equal(Number((await containerOf(box)).is_mixed_batch), 0, '前置：应为非空单批盒')
        assert.equal((await fillReq(box, mixedSourceId, key('fill'))).status, 200, '混合来源倒入非空单批盒应成功')
        assert.equal(Number((await containerOf(box)).is_mixed_batch), 1, '非空单批盒并入混合来源应置为混合(1)')
      }
    })
  } finally {
    // 收尾不吞错：close 或全局 pool 关闭失败要显式记录，不能静默掩盖为「通过」
    try {
      await close()
    } catch (e) {
      failed++
      console.error(`[FAIL] 关闭测试服务/连接池失败：${e.message}`)
    }
    try {
      await require('../backend/src/config/db').pool.end()
    } catch (e) {
      failed++
      console.error(`[FAIL] 关闭全局连接池失败：${e.message}`)
    }
  }

  console.log(`\n${'='.repeat(50)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(50)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error('套件异常终止：', e); process.exitCode = 1 })
