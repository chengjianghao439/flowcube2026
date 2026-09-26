#!/usr/bin/env node
'use strict'

/**
 * 资金侧跨期闸门回归测试（2026-09-26 一致性审查 · 任务 7）——29 条断言
 *
 * 命题：会计期间结账（acct_periods.status=2）后，收付款/退款的核销若仍把 payment_entries
 *       写进该期间，voucher-engine 会因期间已封而跳过生凭证，于是「钱动了、账面没记」，
 *       且没有任何线索。本套件验证三层处置：
 *         层1 默认拒绝 —— 业务日期落在已结账期间 → 409 FINANCE_PERIOD_CLOSED，且分文未动
 *         层2 申请补录 —— 持 finance.period.backfill 者填原因后可提交**待审批申请**（HTTP 202），
 *              业务数据一行未写、钱一分未动；批准（须他人）与执行是另一条链
 *         层3 不再静默 —— 凭证引擎跳过已结账期间时逐条 logger.warn（见文末「层3的证据」）
 *
 * 【补录的凭证落哪一期：已拍板为「补录当期」】
 *   2026-09-26 业务口径确认：前期差错在**执行审批日所在期间**调整，不写回业务期间——业务期间
 *   已封，也不该由系统替会计挑一个「恰好还能写」的历史月份。批准执行时在该当期生成调整凭证；
 *   当期若也已结账则明确拒绝执行，不静默回落到任何期间。
 *   本套件只覆盖到「申请」这一层：批准、执行、业务落库与凭证归属由 finance-backfill-approval
 *   套件端到端断言，这里不重复断言、也不假装覆盖，见该套件的 §F/§I/§L。
 *
 * 【层3的证据】凭证引擎的逐条告警是**代码审阅**级别的证据，本套件不含端到端断言：
 *   generateVouchers 是唯一的凭证生成入口，且它会先 reconcileSalePeriods(会写销售凭证)，
 *   在共享测试库上跑全量/按期间生成会污染其它套件的数据。故层3以改动前后的代码差异为证，
 *   在此显式标注证据强度，不假装已被自动化覆盖。
 *
 * 【期间隔离】用 199001（已结账）与 199501（不存在的期间即开放）两个绝不与真实数据重叠的
 *   期间。业务日期分别是 1990-01-15 / 1995-01-15。测试不触碰任何真实期间的结账状态。
 *
 * 运行：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/flowcube-repro-downloads node tests/finance-period-guard.smoke.test.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')

const CLOSED_PERIOD = '199001'
const CLOSED_DATE = '1990-01-15'
const OPEN_PERIOD = '199501'
const OPEN_DATE = '1995-01-15'

const QTY = 10
const PRICE = 500           // 10 × 500 = 5000
const PAY1 = 1000
const PAY2 = 1000
const BACKFILL_REASON = '跨期补录回归测试：模拟上月已结账后有笔付款漏登，需补进该期间'

const LIMITED_PW = 'SmokeLimited123!'

/**
 * 把 mysql2 返回的 DATE 列（JS Date，按服务器/驱动时区还原）归一化成 YYYY-MM-DD。
 * 驱动按 +08:00 把 DATE 还原为 1990-01-15 00:00，UTC 时间轴是前一天 16:00；
 * 无论测试宿主处于北京时间还是 UTC，都必须按北京时间取年月日。
 * 与 finance-period.guard.toYmd / voucher-engine.toDateStr 同规则。
 */
function ymdLocal(v) {
  if (v instanceof Date) {
    const bj = new Date(v.getTime() + 8 * 3600 * 1000)
    const y = bj.getUTCFullYear()
    const m = String(bj.getUTCMonth() + 1).padStart(2, '0')
    const d = String(bj.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v || '').slice(0, 10)
}

async function createProduct(pool, label) {
  const code = randomRef(`FPT-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 600, 500)",
    [code, `跨期测试商品-${label}`],
  )
  return { id: r.insertId, code, name: `跨期测试商品-${label}`, unit: '个' }
}

async function seedPurchase(http, token, { supplier, warehouse, product, quantity, unitPrice }) {
  const resp = await http.post('/api/purchase', {
    token,
    json: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      items: [{
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice,
      }],
    },
  })
  const poId = Number(resp.data?.data?.id)
  if (!Number.isFinite(poId) || poId <= 0) throw new Error(`建采购单失败: ${JSON.stringify(resp.data)}`)
  await http.post(`/api/purchase/${poId}/confirm`, { token })
  return poId
}

/** 收货 → （必要时短装结案）→ 上架，返回上架后的任务行 */
async function receiveAndPutaway(ctx, token, { taskId, product, locationId, qty }) {
  const { http, pool, pdaHeaders } = ctx
  const recv = await http.post(`/api/inbound-tasks/${taskId}/receive`, {
    token, headers: pdaHeaders(), json: { productId: Number(product.id), packages: [{ qty }] },
  })
  if (!recv.ok) throw new Error(`收货失败: ${JSON.stringify(recv.data)}`)

  const [task] = await dbQuery(pool, 'SELECT status FROM inbound_tasks WHERE id=?', [taskId])
  if (Number(task.status) === 2) {
    const close = await http.post(`/api/inbound-tasks/${taskId}/close-receiving`, { token })
    if (!close.ok) throw new Error(`短装结案失败: ${JSON.stringify(close.data)}`)
  }

  const [box] = await dbQuery(
    pool,
    `SELECT id FROM inventory_containers
      WHERE inbound_task_id=? AND deleted_at IS NULL AND status=4 ORDER BY id`,
    [taskId],
  )
  if (!box) throw new Error('未找到待上架容器')
  const put = await http.post(`/api/inbound-tasks/${taskId}/putaway`, {
    token, headers: pdaHeaders(), json: { containerId: Number(box.id), locationId: Number(locationId) },
  })
  if (!put.ok) throw new Error(`上架失败: ${JSON.stringify(put.data)}`)
}

const payableOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, total_amount, paid_amount, balance, status, confirm_status FROM payment_records WHERE type=1 AND order_id=?',
    [poId],
  )
  return row || null
}

const entriesOf = async (pool, recordId) => dbQuery(
  pool,
  'SELECT id, amount, payment_date FROM payment_entries WHERE record_id=? ORDER BY id',
  [recordId],
)

const backfillsOf = async (pool, recordsWhere, params) => dbQuery(
  pool,
  `SELECT id, period, business_date, biz_type, biz_id, biz_no, amount, reason, status,
          applicant_name, operator_name
     FROM finance_period_backfills WHERE ${recordsWhere} ORDER BY id`,
  params,
)

const money = v => `¥${Number(v ?? 0).toFixed(2)}`

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, location, supplier } = ctx
  const cleanup = {
    productIds: [],
    poIds: [],
    backfillIds: [],
    limitedGrantAdded: false,
    limitedRoleId: null,
    // §B 自建的资金账户（独占库无现成账户可取）。§F 若真的落库（变异验证、或将来闸门被改坏），
    // 收付款单会连带写它的流水；收尾按 account_id 全清并删掉账户本身。
    accountId: null,
  }
  let step = 'init'

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')

    // ══════════════════════════════════════════════════════════════════
    // 准备：把 199001 置为已结账；备一张已财务确认的应付账款
    // ══════════════════════════════════════════════════════════════════
    log.section('准备：隔离期间 199001 置为已结账 + 一张待付款的应付')
    step = 'seed:period'
    await pool.query(
      `INSERT INTO acct_periods (company_id, period, status, closed_by_name, closed_at)
         VALUES (1, ?, 2, 'smoke-test', NOW())
       ON DUPLICATE KEY UPDATE status=2`,
      [CLOSED_PERIOD],
    )
    const [periodRows] = await dbQuery(
      pool, 'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [CLOSED_PERIOD],
    )
    log.assert('隔离期间 199001 已置为已结账(status=2)', Number(periodRows?.status) === 2, JSON.stringify(periodRows))

    step = 'seed:payable'
    const productA = await createProduct(pool, 'A')
    cleanup.productIds.push(productA.id)
    const poA = await seedPurchase(http, token, {
      supplier, warehouse, product: productA, quantity: QTY, unitPrice: PRICE,
    })
    cleanup.poIds.push(poA)

    const taskResp = await http.post('/api/inbound-tasks', { token, json: { poId: poA } })
    const taskA = Number(taskResp.data?.data?.taskId)
    if (!Number.isFinite(taskA) || taskA <= 0) throw new Error(`建收货单失败: ${JSON.stringify(taskResp.data)}`)
    await http.post(`/api/inbound-tasks/${taskA}/submit`, { token })
    await receiveAndPutaway(ctx, token, {
      taskId: taskA, product: productA, locationId: location.id, qty: QTY,
    })

    const rec = await payableOf(pool, poA)
    if (!rec || Math.abs(Number(rec.total_amount) - QTY * PRICE) > 0.01) {
      throw new Error(`未生成应付 5000：${JSON.stringify(rec)}`)
    }
    const confirmResp = await http.post(`/api/payments/${rec.id}/confirm`, { token })
    log.assert('应付已财务确认', confirmResp.ok, JSON.stringify(confirmResp.data).slice(0, 160))
    const recId = Number(rec.id)
    const payUrl = `/api/payments/${recId}/pay`

    // ══════════════════════════════════════════════════════════════════
    // §A 层1：业务日期落在已结账期间 → 默认拒绝，且分文未动
    // ══════════════════════════════════════════════════════════════════
    log.section('§A 默认拒绝：付款日期落在已结账期间')
    step = 'A:pay'
    const aResp = await http.post(payUrl, {
      token,
      json: { amount: PAY1, paymentDate: CLOSED_DATE, method: '转账', remark: '跨期拒绝用例' },
    })
    console.log(`\n[§A] HTTP ${aResp.status} ${JSON.stringify(aResp.data).slice(0, 260)}`)
    log.assert('★ 登记被拒绝（HTTP 409）', aResp.status === 409, `HTTP ${aResp.status}`)
    log.assert(
      '★ 错误码为 FINANCE_PERIOD_CLOSED',
      aResp.data?.code === 'FINANCE_PERIOD_CLOSED',
      String(aResp.data?.code),
    )
    log.assert(
      '★ 消息点明已结账期间 199001 并给出补录出路',
      typeof aResp.data?.message === 'string'
        && aResp.data.message.includes(CLOSED_PERIOD)
        && aResp.data.message.includes('跨期补录'),
      String(aResp.data?.message).slice(0, 200),
    )

    const aEntries = await entriesOf(pool, recId)
    const aRec = await payableOf(pool, poA)
    log.assert('★ 付款分录未写入（payment_entries 仍为 0 条）', aEntries.length === 0, `${aEntries.length} 条`)
    log.assert(
      '★ 账款分文未动（paid_amount 仍为 0、状态仍为未付 1）',
      aRec && Math.abs(Number(aRec.paid_amount)) < 0.01 && Number(aRec.status) === 1,
      `paid=${money(aRec?.paid_amount)} status=${aRec?.status}`,
    )
    log.assert('★ 未留下任何补录痕迹（没补录就不该有记录）', (await backfillsOf(pool, 'period=?', [CLOSED_PERIOD])).length === 0)

    // ══════════════════════════════════════════════════════════════════
    // §B 层2：持权限 + 填原因 → 放行，并落留痕
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 申请跨期补录：落待审批单，业务分文未动')
    step = 'B:account'
    // 补录申请必须指定资金账户：没有账户就没有资金流水，批准后也就生成不了调整凭证，
    // 会被预检挡在 FINANCE_BACKFILL_NO_FUND_ACCOUNT（「钱动了、会计账上没有」正是补录要
    // 消灭的状态，所以宁可申请时就拒绝）。自建一个专属账户，避免依赖库里现成的账户——
    // 本套件跑在独占空库上，那里一个账户都没有（旧版 §F 取的既有账户一直走「跳过」分支）。
    const acctResp = await http.post('/api/finance/accounts', {
      token,
      json: { name: `跨期闸门用例账户-${randomRef('A')}`, type: 1, openingBalance: 0 },
    })
    const acctId = Number(acctResp.data?.data?.id)
    if (!Number.isFinite(acctId) || acctId <= 0) {
      throw new Error(`建资金账户失败: ${JSON.stringify(acctResp.data)}`)
    }
    cleanup.accountId = acctId
    const acct = { id: acctId }

    step = 'B:apply'
    const bResp = await http.post(payUrl, {
      token,
      json: {
        amount: PAY1, paymentDate: CLOSED_DATE, method: '转账', remark: '跨期补录用例',
        accountId: acctId,
        backfillRequest: true, backfillReason: BACKFILL_REASON,
      },
    })
    console.log(`\n[§B] HTTP ${bResp.status} ${JSON.stringify(bResp.data).slice(0, 200)}`)
    log.assert(
      '★ 申请被接受（HTTP 202：是「已提交待审批」，不是登记成功）',
      bResp.status === 202,
      `HTTP ${bResp.status} ${JSON.stringify(bResp.data).slice(0, 200)}`,
    )
    log.assert(
      '★ 响应体就是那张待审批申请单（有 id 与可对外的单号）',
      !!Number(bResp.data?.data?.id) && !!bResp.data?.data?.applicationNo,
      JSON.stringify(bResp.data?.data),
    )

    const bEntries = await entriesOf(pool, recId)
    const bRec = await payableOf(pool, poA)
    log.assert(
      '★ 批准前业务分文未动（没有付款分录）',
      bEntries.length === 0,
      JSON.stringify(bEntries.map(e => ({ amount: e.amount, date: ymdLocal(e.payment_date) }))),
    )
    log.assert(
      '★ 批准前账款余额不变（已付 0、余额 5000）',
      bRec && Math.abs(Number(bRec.paid_amount)) < 0.01
        && Math.abs(Number(bRec.balance) - QTY * PRICE) < 0.01,
      `paid=${money(bRec?.paid_amount)} balance=${money(bRec?.balance)}`,
    )

    const bMarks = await backfillsOf(pool, 'period=?', [CLOSED_PERIOD])
    bMarks.forEach(m => cleanup.backfillIds.push(Number(m.id)))
    const mark = bMarks[0]
    console.log(`[§B] 待审批单：${mark ? JSON.stringify(mark) : '(无)'}`)
    log.assert(
      '★ 留下 1 条待审批单，记录了期间/业务类型/单号/金额/申请人',
      bMarks.length === 1 && mark && mark.period === CLOSED_PERIOD && Number(mark.status) === 0
        && mark.biz_type === 'payment' && Number(mark.biz_id) === recId
        && Number(mark.amount) === PAY1 && !!mark.biz_no && !!mark.applicant_name,
      JSON.stringify(mark),
    )
    log.assert('★ 申请单保留了申请人填写的原因原文', mark && mark.reason === BACKFILL_REASON, String(mark?.reason))
    log.assert(
      '★ 申请单保留真实业务日期 1990-01-15（补录受理不该把业务日期改成今天）',
      mark && ymdLocal(mark.business_date) === CLOSED_DATE,
      String(mark?.business_date),
    )

    // ══════════════════════════════════════════════════════════════════
    // §C 有付款权限但没有补录权限 → 403（权限是条件校验，不是路由级）
    // ══════════════════════════════════════════════════════════════════
    log.section('§C 无补录权限者请求补录')
    step = 'C:grant'
    const [limitedRows] = await dbQuery(
      pool,
      `SELECT r.id FROM sys_roles r JOIN sys_users u ON u.role_id = r.id
        WHERE u.username='smoke_limited' LIMIT 1`,
    )
    if (!limitedRows) throw new Error('未找到 smoke_limited 的受限角色，无法执行 §C')
    cleanup.limitedRoleId = Number(limitedRows.id)
    // 临时给它付款执行权，好让它能走到补录校验那一步（测的是「有付款权、无补录权」）
    await pool.query(
      'INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
      [cleanup.limitedRoleId, 'payment.execute'],
    )
    cleanup.limitedGrantAdded = true

    step = 'C:login'
    const limitedLogin = await login(http, 'smoke_limited', LIMITED_PW)
    const limitedToken = limitedLogin.token
    if (!limitedToken) throw new Error('smoke_limited 登录失败')

    step = 'C:pay'
    const cResp = await http.post(payUrl, {
      token: limitedToken,
      json: { amount: PAY2, paymentDate: CLOSED_DATE, backfillRequest: true, backfillReason: BACKFILL_REASON },
    })
    console.log(`\n[§C] HTTP ${cResp.status} ${JSON.stringify(cResp.data).slice(0, 200)}`)
    log.assert('★ 拒绝（HTTP 403）', cResp.status === 403, `HTTP ${cResp.status}`)
    log.assert(
      '★ 错误码为 FINANCE_BACKFILL_FORBIDDEN',
      cResp.data?.code === 'FINANCE_BACKFILL_FORBIDDEN',
      String(cResp.data?.code),
    )
    const cEntries = await entriesOf(pool, recId)
    const cRec = await payableOf(pool, poA)
    log.assert(
      '★ 拒绝后账目不变（仍无分录、已付仍 0）',
      cEntries.length === 0 && Math.abs(Number(cRec.paid_amount)) < 0.01,
      `${cEntries.length} 条，paid=${money(cRec?.paid_amount)}`,
    )
    log.assert('★ 未新增申请单', (await backfillsOf(pool, 'period=?', [CLOSED_PERIOD])).length === 1)

    // ══════════════════════════════════════════════════════════════════
    // §D 有权限但没填原因 → 400（留痕要求原因，退化成不填就没意义了）
    // ══════════════════════════════════════════════════════════════════
    log.section('§D 有权限但未填原因')
    step = 'D:no-reason'
    const dResp = await http.post(payUrl, {
      token,
      json: { amount: PAY2, paymentDate: CLOSED_DATE, backfillRequest: true },
    })
    console.log(`\n[§D] HTTP ${dResp.status} ${JSON.stringify(dResp.data).slice(0, 200)}`)
    log.assert('★ 拒绝（HTTP 400）', dResp.status === 400, `HTTP ${dResp.status}`)
    log.assert(
      '★ 错误码为 FINANCE_BACKFILL_REASON_REQUIRED',
      dResp.data?.code === 'FINANCE_BACKFILL_REASON_REQUIRED',
      String(dResp.data?.code),
    )
    log.assert(
      '★ 拒绝后账目不变',
      (await entriesOf(pool, recId)).length === 0
        && Math.abs(Number((await payableOf(pool, poA)).paid_amount)) < 0.01,
    )

    // ══════════════════════════════════════════════════════════════════
    // §E 未结账期间照常登记（闸门不能误伤正常业务）
    // ══════════════════════════════════════════════════════════════════
    log.section('§E 未结账期间正常登记不受影响')
    step = 'E:open-period'
    const eResp = await http.post(payUrl, {
      token,
      json: { amount: PAY2, paymentDate: OPEN_DATE, method: '转账', remark: '未结账期间用例' },
    })
    console.log(`\n[§E] HTTP ${eResp.status} ${JSON.stringify(eResp.data).slice(0, 160)}`)
    log.assert('★ 无需补录参数即可登记成功（HTTP 200）', eResp.ok, `HTTP ${eResp.status}`)
    const eEntries = await entriesOf(pool, recId)
    const eRec = await payableOf(pool, poA)
    log.assert(
      '★ 分录 1 条、已付 1000，业务日期就是 1995-01-15',
      eEntries.length === 1 && ymdLocal(eEntries[0].payment_date) === OPEN_DATE
        && Math.abs(Number(eRec.paid_amount) - PAY2) < 0.01,
      `${eEntries.length} 条，paid=${money(eRec?.paid_amount)}`,
    )
    log.assert(
      '★ 正常登记不产生补录申请（199001 仍只有 1 条）',
      (await backfillsOf(pool, 'period=?', [CLOSED_PERIOD])).length === 1,
    )

    // ══════════════════════════════════════════════════════════════════
    // §F 核销路径（收付款单）走同一道闸门
    // ══════════════════════════════════════════════════════════════════
    log.section('§F 核销路径同样被拦（收付款单）')
    step = 'F:account'
    // 账户与余额快照已在 §B 之前取好（收尾按同一快照还原），这里直接复用
    if (!acct) {
      console.log('[§F] 跳过：测试库没有可用的资金账户')
    } else {
      step = 'F:receipt-closed'
      const fResp = await http.post('/api/payments/receipts', {
        token,
        json: {
          type: 1,
          partyName: '跨期测试供应商',
          amount: PAY2,
          paymentDate: CLOSED_DATE,
          accountId: Number(acct.id),
          allocations: [{ recordId: recId, amount: PAY2 }],
        },
      })
      console.log(`\n[§F] HTTP ${fResp.status} ${JSON.stringify(fResp.data).slice(0, 200)}`)
      log.assert('★ 已结账期间的核销被拒（HTTP 409）', fResp.status === 409, `HTTP ${fResp.status}`)
      log.assert(
        '★ 错误码为 FINANCE_PERIOD_CLOSED',
        fResp.data?.code === 'FINANCE_PERIOD_CLOSED',
        String(fResp.data?.code),
      )
      const fRec = await payableOf(pool, poA)
      log.assert(
        '★ 账款未被核销（已付仍 1000，即 §E 那笔）',
        Math.abs(Number(fRec.paid_amount) - PAY2) < 0.01,
        `paid=${money(fRec?.paid_amount)}`,
      )
      const [fReceipts] = await dbQuery(
        pool, 'SELECT COUNT(*) AS c FROM payment_receipts WHERE payment_date=?', [CLOSED_DATE],
      )
      log.assert(
        '★ 收付款单也没落库（事务整体回滚，不留半张单）',
        Number(fReceipts.c) === 0,
        `${Number(fReceipts.c)} 张`,
      )
    }
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
    // 中途抛错必须记一条失败：否则「前面的断言碰巧全绿」时 summary 会是 0 failed，
    // 脚本退出码 0——把「用例没跑完」当成「通过」，这正是最危险的假阳性。
    log.assert(`★ 用例完整跑完（中止于 ${step}）`, false, e.message)
  } finally {
    // 按精确 ID 清理，绝不按名字/编码前缀批量删除（共享夹具自洁原则）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    if (cleanup.limitedGrantAdded) {
      await safe('sys_role_permissions',
        'DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?',
        [cleanup.limitedRoleId, 'payment.execute'])
    }
    for (const bid of cleanup.backfillIds) {
      await safe('finance_period_backfills', 'DELETE FROM finance_period_backfills WHERE id=?', [bid])
    }
    // 隔离期间 199001 是本套件插入的（准备阶段已确认原本不存在），删掉即还原
    await safe('acct_periods',
      'DELETE FROM acct_periods WHERE company_id=1 AND period IN (?, ?)', [CLOSED_PERIOD, OPEN_PERIOD])
    // §F 的收付款单：正常路径被闸门拒绝、本无残留；闸门一旦失效就会真落库。
    // 用隔离业务日期定位（1990-01-15 不可能属于真实数据，等价于精确键），
    // 并连带清掉它的核销分录、往来账事件，再把资金账户余额写回快照——
    // 漏了后者，测试库的账户余额会被每跑一次扣一次，越跑越偏。
    const strayReceipts = await dbQuery(pool, 'SELECT id FROM payment_receipts WHERE payment_date=?', [CLOSED_DATE])
    const strayIds = strayReceipts.map(r => Number(r.id))
    if (strayIds.length) {
      await safe('payment_entries(receipt)', 'DELETE FROM payment_entries WHERE receipt_id IN (?)', [strayIds])
      await safe('party_ledger_events', 'DELETE FROM party_ledger_events WHERE receipt_id IN (?)', [strayIds])
      await safe('payment_receipts', 'DELETE FROM payment_receipts WHERE id IN (?)', [strayIds])
    }
    if (cleanup.accountId != null) {
      // 账户是本套件自建的（独占库没有现成账户可取）：删掉它的全部流水与账户本身即可，
      // 不碰任何既有账户的余额。§F 期望核销被拒（什么都不写），但闸门一旦失效就会真的出账，
      // 这里按 account_id 全清，正是为那种变异留的兜底。
      await safe('finance_account_transactions',
        'DELETE FROM finance_account_transactions WHERE account_id=?', [cleanup.accountId])
      await safe('finance_accounts', 'DELETE FROM finance_accounts WHERE id=?', [cleanup.accountId])
    }
    for (const poId of cleanup.poIds) {
      const tasks = await dbQuery(pool, 'SELECT id FROM inbound_tasks WHERE purchase_order_id=?', [poId])
      for (const t of tasks) {
        await safe('inbound_task_events', 'DELETE FROM inbound_task_events WHERE task_id=?', [t.id])
        await safe('inventory_logs',
          "DELETE FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [t.id])
        await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE inbound_task_id=?', [t.id])
        await safe('inbound_task_items', 'DELETE FROM inbound_task_items WHERE task_id=?', [t.id])
        await safe('inbound_tasks', 'DELETE FROM inbound_tasks WHERE id=?', [t.id])
      }
      const recs = await dbQuery(pool, 'SELECT id FROM payment_records WHERE type=1 AND order_id=?', [poId])
      for (const r of recs) {
        // 子表必须先删干净：往来账事件与账款事件都按 record_id 引用付款单，
        // 只删 payment_entries 会留下一批指向已不存在付款单的孤儿行（实测会累积）
        await safe('party_ledger_events', 'DELETE FROM party_ledger_events WHERE record_id=?', [r.id])
        await safe('payment_record_events',
          'DELETE FROM payment_record_events WHERE payment_record_id=?', [r.id])
        await safe('payment_entries', 'DELETE FROM payment_entries WHERE record_id=?', [r.id])
        await safe('payment_records', 'DELETE FROM payment_records WHERE id=?', [r.id])
      }
      await safe('purchase_order_items', 'DELETE FROM purchase_order_items WHERE order_id=?', [poId])
      await safe('purchase_orders', 'DELETE FROM purchase_orders WHERE id=?', [poId])
    }
    for (const pid of cleanup.productIds) {
      await safe('inventory_stock', 'DELETE FROM inventory_stock WHERE product_id=?', [pid])
      await safe('product_items', 'DELETE FROM product_items WHERE id=?', [pid])
    }
    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接，socket 不 unref，
    // app/service 查询过一次就会留住事件循环——断言全绿、退出码已定，进程却吊着不退。
    // smokeTestKit.close() 只管它自建的池；两个池分开关，谁都不会被关两次。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
