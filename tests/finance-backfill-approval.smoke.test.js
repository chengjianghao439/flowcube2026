#!/usr/bin/env node
'use strict'

/**
 * 跨期补录「申请 → 他人审批 → 执行」审批流端到端（2026-09-26 一致性审查 · 任务 7 第二期）
 *
 * 命题：业务日期落在**已结账**会计期间时，钱不能当场动（否则凭证引擎跳过已封期间，出现
 *       「钱动了、会计账上没有」）。处置是**先审批、后动账**——申请只落一张待审批单、业务
 *       分文不写；**他人**批准后才重放原请求落库，并为补录当期生成调整凭证。
 *
 * 覆盖的分支（每条都对应一个可能被改坏的行为）：
 *   §A 默认拒绝       —— 不带补录参数 → 409，业务分文未动
 *   §B 申请           —— 202 + 申请单号，**业务仍未动**（这是整个口径的支点）；同键重发同一张单
 *   §C 换键第二笔     —— 换请求键提交同金额的第二笔业务必须落成第二张单（丢账比重复记账更糟）
 *   §D 申请权限       —— 无 finance.period.backfill 者请求补录 → 403；只持审批权限者能看队列
 *   §E 自审被拒       —— 申请人不能批准自己的单 → 403（审批流存在的全部理由）
 *   §F 他人批准并执行 —— 业务落库（日期仍是原业务日期）+ executed/posting_period 回填
 *                        + 资金流水挂 backfill_id 与补录当期凭证日期 + **从 acct_vouchers /
 *                        acct_voucher_entries 逐项核对调整凭证**（按本次流水 source_id 精确
 *                        定位：期间=补录当期、借 2202 / 贷 1002、借贷平衡且等于付款额、
 *                        摘要标「（跨期补录）」）——不再是「生成时间 or 失败原因二选一」
 *   §F2 缺科目映射     —— 临时软删 1002 后走完整申请→审批：业务照动、凭证**不生成**、
 *                        原因写回单子等重试、手工重试仍失败；科目还原后重试成功补出凭证。
 *                        前后比对期间凭证指纹，验证「只波及本单」而非假设整体回滚
 *   §G 驳回           —— 业务不落库，驳回后再批准被拒
 *   §H 无资金账户     —— 申请即拒（否则批准后留下永远补不出凭证的差异）
 *   §I 业务漂移       —— 审批期间账款被付清 → 批准后执行失败停在「已批准 · 待执行」→
 *                        **可作废退出**（这正是本次补丁修的死角）→ 同键重放明确报错
 *   §J 撤回与越权撤回 —— 仅持申请权者撤回自己的待审批单可行；撤回**别人**的单被拒
 *   §K 历史遗留行     —— 不能审批、不能作废，只能人工核对
 *   §L 核销类补录     —— 不产生会计凭证，页面不该显示「凭证待生成」
 *   §M 未结账期间     —— 闸门不能误伤正常业务
 *   §N 退款补录       —— 快照固定出款账户/金额/日期/客户与原单（审批人看得见钱往哪走）；
 *                        执行时核对锁行后的现值，源单被改动 → 409 SOURCE_DRIFT 停在「已批准 ·
 *                        待执行」且钱一分未动 → 可作废退出
 *   §O 补录当期被结账 —— 申请后、批准前把**补录当期本身**结掉（§A 测的是业务日期那张期间，
 *                        这里测的是执行这天的当期）：执行 → 409 FINANCE_BACKFILL_POSTING_PERIOD_CLOSED，
 *                        停在「已批准 · 待执行」，分录/流水/账款分文未动。这是闸门那道的**反例**——
 *                        没它，「当期结了就不会先动钱」只是文档里的一句话。
 *                        ⚠ 该节会临时改动真实当期行，先快照、finally 按原值还原（原本不存在则删）
 *
 * 【期间隔离】用 199001（已结账）与 199501（不存在的期间即开放）两个绝不与真实数据重叠的
 *   期间，业务日期 1990-01-15 / 1995-01-15。测试不触碰任何真实期间的结账状态。
 *   申请人联系人用 smoke_admin（超管豁免 finance.period.backfill），审批人用 smoke_limited
 *   （临时授审批权），这样「申请人不能批自己的单」天然可测。
 *
 * 运行（必须走守卫，独占库）：
 *   sh /tmp/run-test-backfill.sh flowcube_bfappr_test node tests/finance-backfill-approval.smoke.test.js
 */

const {
  createLogger, prepareSmokeContext, dbQuery, login, randomRef,
} = require('./helpers/smokeTestKit')

const CLOSED_PERIOD = '199001'
const CLOSED_DATE = '1990-01-15'
const OPEN_DATE = '1995-01-15'

const QTY = 10
const PRICE = 500           // 10 × 500 = 5000
const PAY1 = 1000
const PAY2 = 1000
const BACKFILL_REASON = '跨期补录回归测试：上月已结账后有笔付款漏登，需补进该期间'
const REJECT_REASON = '金额与合同不符，请核对后重新提交'
const VOID_REASON = '账款已被另一笔正常付款付清，这笔补录付款已无法执行'

const LIMITED_PW = 'SmokeLimited123!'

/** 补录当期 = 执行审批日所在的北京时区会计期间（与 finance-period.guard.resolvePostingPeriod 同规则） */
function expectedPostingPeriod() {
  const bj = new Date(Date.now() + 8 * 3600 * 1000)
  return `${bj.getUTCFullYear()}${String(bj.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 把 mysql2 返回的 DATE 列归一化成 YYYY-MM-DD。驱动按 +08:00 解析，
 * 测试宿主即使处于 UTC 也须按北京时间取年月日。
 */
function ymdLocal(v) {
  if (v instanceof Date) {
    const bj = new Date(v.getTime() + 8 * 3600 * 1000)
    return `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, '0')}-${String(bj.getUTCDate()).padStart(2, '0')}`
  }
  return String(v || '').slice(0, 10)
}

async function createProduct(pool, label) {
  const code = randomRef(`BFA-${label}`).slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, ?, '个', 600, 500)",
    [code, `补录审批用例商品-${label}`],
  )
  return { id: r.insertId, code, name: `补录审批用例商品-${label}`, unit: '个' }
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
        productId: product.id, productCode: product.code, productName: product.name,
        unit: product.unit, quantity, unitPrice,
      }],
    },
  })
  const poId = Number(resp.data?.data?.id)
  if (!Number.isFinite(poId) || poId <= 0) throw new Error(`建采购单失败: ${JSON.stringify(resp.data)}`)
  await http.post(`/api/purchase/${poId}/confirm`, { token })
  return poId
}

/** 收货 → （必要时短装结案）→ 上架 */
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

/** 建一张已财务确认的应付账款，返回 { poId, recId } */
async function seedConfirmedPayable(ctx, token, { supplier, warehouse, location, product, label }) {
  const { pool, http } = ctx
  const poId = await seedPurchase(http, token, { supplier, warehouse, product, quantity: QTY, unitPrice: PRICE })
  const taskResp = await http.post('/api/inbound-tasks', { token, json: { poId } })
  const taskId = Number(taskResp.data?.data?.taskId)
  if (!Number.isFinite(taskId) || taskId <= 0) throw new Error(`建收货单失败(${label}): ${JSON.stringify(taskResp.data)}`)
  await http.post(`/api/inbound-tasks/${taskId}/submit`, { token })
  await receiveAndPutaway(ctx, token, { taskId, product, locationId: location.id, qty: QTY })

  const [rec] = await dbQuery(pool, 'SELECT * FROM payment_records WHERE type=1 AND order_id=?', [poId])
  if (!rec || Math.abs(Number(rec.total_amount) - QTY * PRICE) > 0.01) {
    throw new Error(`未生成应付 ${QTY * PRICE}（${label}）：${JSON.stringify(rec)}`)
  }
  const confirmResp = await http.post(`/api/payments/${rec.id}/confirm`, { token })
  if (!confirmResp.ok) throw new Error(`应付确认失败（${label}）：${JSON.stringify(confirmResp.data)}`)
  return { poId, recId: Number(rec.id) }
}

const payableOf = async (pool, poId) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, total_amount, paid_amount, balance, status, confirm_status FROM payment_records WHERE type=1 AND order_id=?',
    [poId],
  )
  return row || null
}
const entriesOf = (pool, recordId) => dbQuery(
  pool, 'SELECT id, amount, payment_date FROM payment_entries WHERE record_id=? ORDER BY id', [recordId],
)
/** 单行 */
const backfillOfId = async (pool, id) => {
  const [row] = await dbQuery(pool, 'SELECT * FROM finance_period_backfills WHERE id=?', [id])
  return row || null
}
const backfillIdsInPeriod = async (pool, period) => {
  const rows = await dbQuery(pool, 'SELECT id FROM finance_period_backfills WHERE period=? ORDER BY id', [period])
  return rows.map(r => Number(r.id))
}
const txnsOfAccount = (pool, accountId) => dbQuery(
  pool, 'SELECT * FROM finance_account_transactions WHERE account_id=? ORDER BY id', [accountId],
)

/**
 * 本次资金流水对应的调整凭证。
 *
 * 必须按 `source_type + source_id` **精确定位**：同一个期间里可能有上百张凭证（本库就有 80+），
 * 只看期间、只看金额或者"取最新一张"都会张冠李戴——证明不了"这张流水出了这张凭证"。
 */
const vouchersOfSource = (pool, sourceType, sourceId) => dbQuery(
  pool,
  `SELECT id, voucher_no, voucher_date, period, source_type, source_id, source_no, summary,
          total_debit, total_credit, status, is_reversal, source_hash
     FROM acct_vouchers WHERE company_id=1 AND source_type=? AND source_id=? ORDER BY id`,
  [sourceType, sourceId],
)
const voucherEntriesOf = (pool, voucherId) => dbQuery(
  pool,
  `SELECT line_no, account_code, account_name, direction, amount, summary
     FROM acct_voucher_entries WHERE voucher_id=? ORDER BY line_no`,
  [voucherId],
)

/**
 * 期间内全部凭证的指纹（id → 关键字段拼串）。
 *
 * 用于证明「临时软删科目只波及本单」——这个命题**不能靠"反正整体事务会回滚"去假设**：
 * `regenerate-voucher` 走的 `generatePeriodVouchers` 是全期间重算，一旦哪天改成逐条容错，
 * 同期间几十张别的凭证就会被一起改写或标记失败。用前后快照比对把它变成可验证的断言，
 * 不成立就直接红，而不是留一句注释提醒后来者。
 */
async function vouchersFingerprint(pool, period) {
  const rows = await dbQuery(
    pool,
    `SELECT id, source_type, source_id, total_debit, total_credit, status, is_reversal, source_hash
       FROM acct_vouchers WHERE company_id=1 AND period=? ORDER BY id`,
    [period],
  )
  return new Map(rows.map(r => [
    Number(r.id),
    `${r.source_type}|${r.source_id}|${r.total_debit}|${r.total_credit}|${r.status}|${r.is_reversal}|${r.source_hash}`,
  ]))
}

/** 差异描述（快照比对失败时给出"哪张、变了什么"，而不是只报"不相等"） */
function fingerprintDiff(before, after) {
  const out = []
  for (const [id, sig] of before) {
    if (!after.has(id)) out.push(`#${id} 消失`)
    else if (after.get(id) !== sig) out.push(`#${id} ${sig} → ${after.get(id)}`)
  }
  for (const [id] of after) if (!before.has(id)) out.push(`#${id} 新增`)
  return out
}

/**
 * 造销售单 + 已收账款（同 refund-orders.smoke.test 的做法：直接插库，免去走完整销售链路——
 * 本套件要的是「一张可退款的单子」，不是销售流程本身）。
 */
async function seedSaleWithPaid(pool, totalAmount, paidAmount) {
  const orderNo = `SO-${randomRef('BFR').slice(0, 12)}`
  const [r] = await pool.query(
    `INSERT INTO sale_orders (order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, total_amount, operator_id, operator_name)
     VALUES (?, 1, '退款补录用例客户', 1, '测试仓', 3, ?, 1, '退款补录用例')`,
    [orderNo, totalAmount],
  )
  const orderId = r.insertId
  await pool.query(
    `INSERT INTO payment_records (type, order_id, order_no, party_name, total_amount, paid_amount, balance, status, confirm_status)
     VALUES (2, ?, ?, '退款补录用例客户', ?, ?, ?, ?, 1)`,
    [orderId, orderNo, totalAmount, paidAmount, totalAmount - paidAmount, paidAmount >= totalAmount ? 3 : 2],
  )
  const [rec] = await dbQuery(pool, 'SELECT id FROM payment_records WHERE order_id=? AND type=2', [orderId])
  return { orderId, orderNo, paymentRecordId: Number(rec.id) }
}

/** 退款单**当前行**：漂移核对要的是库里的现值，不是接口渲染出来的展示值 */
const refundOfId = async (pool, id) => {
  const [row] = await dbQuery(
    pool,
    'SELECT id, refund_no, sale_order_no, customer_name, amount, status, account_id, refund_date, payment_record_id'
    + ' FROM refund_orders WHERE id=?',
    [id],
  )
  return row || null
}
const recordOfId = async (pool, id) => {
  const [row] = await dbQuery(pool, 'SELECT paid_amount, balance FROM payment_records WHERE id=?', [id])
  return row || null
}

const money = v => `¥${Number(v ?? 0).toFixed(2)}`

async function main() {
  const log = createLogger()
  // 本套件是多阶段的资金/审批闭环，某一步挂住（后端等行锁）时希望明确失败而不是无限等待，
  // 所以显式要求单请求超时；这是本套件自己的选择，不改动其它套件的等待语义。
  const ctx = await prepareSmokeContext({ requestTimeoutMs: 30000 })
  const { pool, http, warehouse, location, supplier } = ctx
  const EXP_PERIOD = expectedPostingPeriod()
  const cleanup = {
    productIds: [], poIds: [], backfillIds: [], limitedRoleId: null, granted: [],
    saleOrderIds: [], refundIds: [], extraAccountIds: [],
    // 本套件自己补进去的会计科目（缺失时才插）；收尾按精确 id 删，不按 code 批量删
    insertedAccountIds: [],
    // §O 会把**真实的当期行**临时改成已结账，这里存原值快照供还原（原本不存在则记为新建、用完删）
    postingPeriodSnapshot: null,
  }
  let step = 'init'
  let keySeq = 0
  const reqKey = (tag) => `smoke-bfa-${tag}-${Date.now().toString(36)}-${++keySeq}`

  // 整轮看门狗：某个 step 挂住（后端等行锁、连不上库、死循环）时不能让脚本无限等下去，
  // 否则「没结束」会被误读成「还在跑」甚至「通过」。正常走完约 20 秒，180 秒只在真异常时触发；
  // 触发时以退出码 2 明确区分「挂住」与「断言失败(1)」，并说明清理没跑（此刻查库本身也可能挂住）。
  const WATCHDOG_MS = 180000
  const watchdog = setTimeout(() => {
    console.error(`\n[看门狗] 用例超过 ${WATCHDOG_MS / 1000} 秒未结束，最后 step=${step}。强制退出，清理未执行。`)
    process.exit(2)
  }, WATCHDOG_MS)
  watchdog.unref()

  const grant = async (perm) => {
    await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)',
      [cleanup.limitedRoleId, perm])
    cleanup.granted.push(perm)
  }
  const revoke = async (perm) => {
    await pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?',
      [cleanup.limitedRoleId, perm])
    cleanup.granted = cleanup.granted.filter(p => p !== perm)
  }

  /**
   * §O 把补录当期临时置为已结账，用完必须按**原值**还原——不是简单地「删掉这一行」：
   * 当期行在真实库里通常是存在的（只是未结账），删掉它等于改动了不属于本套件的状态。
   * 原本存在 → 逐列回写快照（只更该行的 company_id/period 之外的列）；原本不存在 → 删本轮新建行。
   * 幂等：done 之后不再重复执行（正常路径取 finally 之前先调一次，全局 finally 再兜一道）。
   */
  const restorePostingPeriod = async () => {
    const snap = cleanup.postingPeriodSnapshot
    if (!snap || snap.done) return
    snap.done = true
    if (!snap.existed) {
      await pool.query('DELETE FROM acct_periods WHERE company_id=1 AND period=?', [snap.period])
      return
    }
    const cols = Object.keys(snap.before).filter(c => c !== 'company_id' && c !== 'period')
    const setClause = cols.map(c => '`' + c + '`=?').join(', ')
    await pool.query(
      `UPDATE acct_periods SET ${setClause} WHERE company_id=1 AND period=?`,
      [...cols.map(c => snap.before[c]), snap.period],
    )
  }

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const token = adminLogin.token
    if (!token) throw new Error('smoke_admin 登录失败')
    const adminUserId = Number(adminLogin.user?.userId ?? adminLogin.user?.id)

    // ══════════════════════════════════════════════════════════════════
    // 准备：199001 置为已结账 + 资金账户 + 一张已确认应付 5000
    // ══════════════════════════════════════════════════════════════════
    log.section('准备：199001 置为已结账 + 资金账户 + 已确认应付 5000')
    step = 'seed:period'
    await pool.query(
      `INSERT INTO acct_periods (company_id, period, status, closed_by_name, closed_at)
         VALUES (1, ?, 2, 'smoke-test', NOW())
       ON DUPLICATE KEY UPDATE status=2`,
      [CLOSED_PERIOD],
    )
    const [pr] = await dbQuery(pool, 'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [CLOSED_PERIOD])
    log.assert('隔离期间 199001 已结账(status=2)', Number(pr?.status) === 2, JSON.stringify(pr))
    const [curPeriod] = await dbQuery(pool, 'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [EXP_PERIOD])
    log.assert(
      `补录当期 ${EXP_PERIOD} 未结账（否则执行会被拒，属环境问题而非缺陷）`,
      !curPeriod || Number(curPeriod.status) !== 2,
      JSON.stringify(curPeriod),
    )

    step = 'seed:accounts'
    // 凭证链正例要求**科目映射齐备**：缺科目时引擎按设计「留痕待生成」（这正是 §F2 反例要验的行为），
    // 只靠"生成时间或失败原因二选一"是证不出用户真正要看的「审批后在当期生成调整凭证」的。
    // 迁移 177 预置了这套科目，但不是每个测试库都跑过它，所以这里按 code 幂等核对：存在就**原样不动**
    // （不覆盖既有 name/余额方向），缺哪个补哪个，补进去的记 id 由收尾精确删除。
    // 付款核销凭证的两条腿就是这两个：借 2202 应付账款 / 贷 1002 银行存款（账户 type=1）。
    const REQUIRED_ACCOUNTS = [
      { code: '1002', name: '银行存款', category: 1, balanceDir: 1, auxType: 0 },
      { code: '2202', name: '应付账款', category: 2, balanceDir: 2, auxType: 1 },
    ]
    const accountGaps = []
    for (const [i, a] of REQUIRED_ACCOUNTS.entries()) {
      const existing = await dbQuery(pool, 'SELECT id FROM acct_accounts WHERE company_id=1 AND code=?', [a.code])
      if (existing.length) continue
      const [ins] = await pool.query(
        `INSERT INTO acct_accounts (company_id, code, name, category, balance_dir, level, is_leaf, aux_type, is_preset, sort_order)
         VALUES (1, ?, ?, ?, ?, 1, 1, ?, 1, ?)`,
        [a.code, a.name, a.category, a.balanceDir, a.auxType, 900 + i],
      )
      cleanup.insertedAccountIds.push(Number(ins.insertId))
      accountGaps.push(a.code)
    }
    log.assert('凭证所需的科目映射齐备（缺失时已幂等补齐）',
      true, accountGaps.length ? `本库缺失、已补：${accountGaps.join(',')}` : '库中已有 1002/2202，未改动')

    step = 'seed:account'
    const acctResp = await http.post('/api/finance/accounts', {
      token,
      json: { name: `补录审批用例账户-${randomRef('A')}`, type: 1, openingBalance: 0 },
    })
    const accountId = Number(acctResp.data?.data?.id)
    if (!Number.isFinite(accountId) || accountId <= 0) throw new Error(`建资金账户失败: ${JSON.stringify(acctResp.data)}`)
    cleanup.accountId = accountId
    log.assert('测试资金账户已创建（独占库无现成账户，必须自建）', true, `id=${accountId}`)

    step = 'seed:payable'
    const productA = await createProduct(pool, 'A')
    cleanup.productIds.push(productA.id)
    const { poId: poA, recId } = await seedConfirmedPayable(ctx, token, {
      supplier, warehouse, location, product: productA, label: 'A',
    })
    cleanup.poIds.push(poA)
    log.assert('已生成并确认应付 5000', true, `po=${poA} record=${recId}`)

    const payUrl = `/api/payments/${recId}/pay`
    const payBody = (extra = {}) => ({
      amount: PAY1, paymentDate: CLOSED_DATE, method: '转账', accountId, remark: '补录审批用例', ...extra,
    })

    // ══════════════════════════════════════════════════════════════════
    // §A 默认拒绝
    // ══════════════════════════════════════════════════════════════════
    log.section('§A 默认拒绝：付款日期落在已结账期间')
    step = 'A:pay'
    const aResp = await http.post(payUrl, { token, json: payBody() })
    console.log(`\n[§A] HTTP ${aResp.status} ${JSON.stringify(aResp.data).slice(0, 220)}`)
    log.assert('★ 登记被拒绝（HTTP 409）', aResp.status === 409, `HTTP ${aResp.status}`)
    log.assert('★ 错误码 FINANCE_PERIOD_CLOSED', aResp.data?.code === 'FINANCE_PERIOD_CLOSED', String(aResp.data?.code))
    log.assert(
      '★ 提示点明已结账期间并给出补录出路',
      typeof aResp.data?.message === 'string'
        && aResp.data.message.includes(CLOSED_PERIOD) && aResp.data.message.includes('跨期补录'),
      String(aResp.data?.message).slice(0, 200),
    )
    log.assert('★ 付款分录未写入', (await entriesOf(pool, recId)).length === 0)
    const aRec = await payableOf(pool, poA)
    log.assert('★ 账款分文未动', Math.abs(Number(aRec.paid_amount)) < 0.01 && Number(aRec.status) === 1,
      `paid=${money(aRec?.paid_amount)} status=${aRec?.status}`)
    log.assert('★ 未产生补录单', (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length === 0)
    log.assert('★ 未产生资金流水', (await txnsOfAccount(pool, accountId)).length === 0)

    // ══════════════════════════════════════════════════════════════════
    // §B 申请：只落待审批单，业务一行不写；同键重发同一张
    // ══════════════════════════════════════════════════════════════════
    log.section('§B 申请：202 + 申请单号，业务仍未动')
    step = 'B:apply'
    const bKey = reqKey('apply')
    const bResp = await http.post(payUrl, {
      token, headers: { 'X-Request-Key': bKey },
      json: payBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    console.log(`\n[§B] HTTP ${bResp.status} ${JSON.stringify(bResp.data).slice(0, 260)}`)
    log.assert('★ 返回 202（已受理待审批，不是登记成功）', bResp.status === 202,
      `HTTP ${bResp.status} ${JSON.stringify(bResp.data).slice(0, 200)}`)
    const bApp = bResp.data?.data
    log.assert('★ 返回申请单号 BF-…', typeof bApp?.applicationNo === 'string' && bApp.applicationNo.startsWith('BF-'),
      String(bApp?.applicationNo))
    const bId = Number(bApp?.id)
    if (Number.isFinite(bId) && bId > 0) cleanup.backfillIds.push(bId)

    log.assert('★ 业务仍未动：付款分录 0 条', (await entriesOf(pool, recId)).length === 0)
    const bRec = await payableOf(pool, poA)
    log.assert('★ 业务仍未动：应收账款已付仍 0', Math.abs(Number(bRec.paid_amount)) < 0.01, `paid=${money(bRec?.paid_amount)}`)
    log.assert('★ 业务仍未动：无资金流水', (await txnsOfAccount(pool, accountId)).length === 0)
    const bRow = await backfillOfId(pool, bId)
    log.assert('★ 申请单已落库且状态=0 待审批', Number(bRow?.status) === 0, `status=${bRow?.status}`)
    log.assert('★ 申请单记录了期间/业务/金额/申请人/原因',
      bRow && bRow.period === CLOSED_PERIOD && bRow.biz_type === 'payment'
        && Number(bRow.biz_id) === recId && Math.abs(Number(bRow.amount) - PAY1) < 0.01
        && Number(bRow.applicant_id) === adminUserId && bRow.reason === BACKFILL_REASON,
      JSON.stringify({ period: bRow?.period, biz: bRow?.biz_type, amount: bRow?.amount, applicant: bRow?.applicant_id }))
    log.assert('★ 申请单存了重放快照（批准后据此重放，不能只有个金额）',
      !!bRow?.request_snapshot && JSON.stringify(bRow.request_snapshot).includes(String(recId)),
      String(bRow?.request_snapshot).slice(0, 120))
    log.assert('★ 批准前没有执行痕迹', !bRow?.executed_at && !bRow?.posting_period)

    step = 'B:replay'
    const b2Resp = await http.post(payUrl, {
      token, headers: { 'X-Request-Key': bKey },
      json: payBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    console.log(`\n[§B] 同键重发 HTTP ${b2Resp.status} ${JSON.stringify(b2Resp.data).slice(0, 200)}`)
    log.assert('★ 同键重发返回 202 且是同一张单', b2Resp.status === 202 && Number(b2Resp.data?.data?.id) === bId,
      `HTTP ${b2Resp.status} id=${b2Resp.data?.data?.id}`)
    log.assert('★ 同键重发没有新增第二张申请单', (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length === 1)
    log.assert('★ 同键重发同样不动业务', (await entriesOf(pool, recId)).length === 0)

    // ══════════════════════════════════════════════════════════════════
    // §C 换键提交同金额的第二笔 → 必须是新的一张单
    // ══════════════════════════════════════════════════════════════════
    log.section('§C 换请求键提交同内容第二笔')
    step = 'C:newkey'
    const cResp = await http.post(payUrl, {
      token, headers: { 'X-Request-Key': reqKey('apply2') },
      json: payBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    const cId = Number(cResp.data?.data?.id)
    if (Number.isFinite(cId) && cId > 0) cleanup.backfillIds.push(cId)
    log.assert('★ 换键提交同金额 → 落成第二张单（丢账比重复记账更糟）',
      cResp.status === 202 && cId !== bId, `HTTP ${cResp.status} ids=${bId}/${cId}`)
    log.assert('★ 前一张单未被执行（两次申请都不动账）', (await entriesOf(pool, recId)).length === 0)

    // ══════════════════════════════════════════════════════════════════
    // §D 权限：无 finance.period.backfill 者申请被拒；审批人能看到队列
    // ══════════════════════════════════════════════════════════════════
    log.section('§D 无补录申请权限者请求补录')
    step = 'D:grant'
    const [limitedRole] = await dbQuery(
      pool,
      "SELECT r.id FROM sys_roles r JOIN sys_users u ON u.role_id = r.id WHERE u.username='smoke_limited' LIMIT 1",
    )
    if (!limitedRole) throw new Error('未找到 smoke_limited 的受限角色')
    cleanup.limitedRoleId = Number(limitedRole.id)
    // smoke_limited 兼作审批人：给「付款执行」好让它走到闸门那一步，给审批权好让它批别人的单。
    // 刻意**不给** finance.period.backfill —— 它不该能申请补录。
    await grant('payment.execute')
    await grant('finance.period.backfill.approve')

    step = 'D:login'
    const limitedLogin = await login(http, 'smoke_limited', LIMITED_PW)
    const limitedToken = limitedLogin.token
    const limitedUserId = Number(limitedLogin.user?.userId ?? limitedLogin.user?.id)
    if (!limitedToken) throw new Error('smoke_limited 登录失败')

    step = 'D:apply'
    const beforeD = (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length
    const dResp = await http.post(payUrl, {
      token: limitedToken, headers: { 'X-Request-Key': reqKey('denied') },
      json: payBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    console.log(`\n[§D] HTTP ${dResp.status} ${JSON.stringify(dResp.data).slice(0, 200)}`)
    log.assert('★ 拒绝（HTTP 403）', dResp.status === 403, `HTTP ${dResp.status}`)
    log.assert('★ 错误码 FINANCE_BACKFILL_FORBIDDEN', dResp.data?.code === 'FINANCE_BACKFILL_FORBIDDEN', String(dResp.data?.code))
    log.assert('★ 未新增申请单', (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length === beforeD)

    step = 'D:list'
    const dList = await http.get('/api/accounting/backfills', { token: limitedToken })
    log.assert('★ 只持审批权限的人能看到补录队列（列表 OR 语义，不被申请权限挡住）',
      dList.ok && Array.isArray(dList.data?.data?.list),
      `HTTP ${dList.status} ${JSON.stringify(dList.data).slice(0, 160)}`)

    // ══════════════════════════════════════════════════════════════════
    // §E 自审被拒
    // ══════════════════════════════════════════════════════════════════
    log.section('§E 申请人不能批准自己的申请')
    step = 'E:self-approve'
    const eResp = await http.post(`/api/accounting/backfills/${bId}/approve`, { token, json: { remark: '自批试试' } })
    console.log(`\n[§E] HTTP ${eResp.status} ${JSON.stringify(eResp.data).slice(0, 220)}`)
    log.assert('★ 拒绝（HTTP 403）', eResp.status === 403, `HTTP ${eResp.status}`)
    log.assert('★ 错误码 FINANCE_BACKFILL_SELF_APPROVE', eResp.data?.code === 'FINANCE_BACKFILL_SELF_APPROVE', String(eResp.data?.code))
    const eRow = await backfillOfId(pool, bId)
    log.assert('★ 单子仍是待审批', Number(eRow?.status) === 0, `status=${eRow?.status}`)
    log.assert('★ 业务仍未动', (await entriesOf(pool, recId)).length === 0)

    // ══════════════════════════════════════════════════════════════════
    // §F 他人批准 → 业务落库 + 凭证落补录当期
    // ══════════════════════════════════════════════════════════════════
    log.section('§F 他人批准：业务落库，凭证归补录当期')
    step = 'F:approve'
    const fResp = await http.post(`/api/accounting/backfills/${bId}/approve`, {
      token: limitedToken, json: { remark: '核对无误，同意补录' },
    })
    console.log(`\n[§F] HTTP ${fResp.status} ${JSON.stringify(fResp.data).slice(0, 300)}`)
    log.assert('★ 批准成功（HTTP 200）', fResp.ok, `HTTP ${fResp.status} ${JSON.stringify(fResp.data).slice(0, 200)}`)

    const fEntries = await entriesOf(pool, recId)
    log.assert('★ 付款分录已落库，业务日期仍是 1990-01-15（不是今天）',
      fEntries.length === 1 && ymdLocal(fEntries[0].payment_date) === CLOSED_DATE,
      JSON.stringify(fEntries.map(e => ({ amount: e.amount, date: ymdLocal(e.payment_date) }))))
    const fRec = await payableOf(pool, poA)
    log.assert('★ 账款已更新（已付 1000、余额 4000）',
      Math.abs(Number(fRec.paid_amount) - PAY1) < 0.01
        && Math.abs(Number(fRec.balance) - (QTY * PRICE - PAY1)) < 0.01,
      `paid=${money(fRec?.paid_amount)} balance=${money(fRec?.balance)}`)

    const fRow = await backfillOfId(pool, bId)
    log.assert('★ 执行痕迹已回填（executed_at + executed_biz_id）',
      !!fRow?.executed_at && Number(fRow?.executed_biz_id) === Number(fEntries[0]?.id),
      `executed_at=${fRow?.executed_at} bizId=${fRow?.executed_biz_id}`)
    log.assert('★ 凭证归属期间=执行审批日当期（当期调整，不是改两年前的账）',
      fRow?.posting_period === EXP_PERIOD, `posting_period=${fRow?.posting_period} 期望=${EXP_PERIOD}`)
    log.assert('★ 审批人记在申请单上、与申请人是两个人',
      Number(fRow?.approver_id) === limitedUserId && Number(fRow?.applicant_id) === adminUserId,
      `approver=${fRow?.approver_id} applicant=${fRow?.applicant_id}`)
    log.assert('★ 状态=1 已批准', Number(fRow?.status) === 1, `status=${fRow?.status}`)

    const fTxns = await txnsOfAccount(pool, accountId)
    log.assert('★ 资金流水已产生 1 条（钱确实动了）', fTxns.length === 1, `${fTxns.length} 条`)
    log.assert('★ 流水挂了 backfill_id（供凭证核对反查）', Number(fTxns[0]?.backfill_id) === bId,
      `backfill_id=${fTxns[0]?.backfill_id}`)
    log.assert('★ 流水的凭证归属日期落在补录当期',
      ymdLocal(fTxns[0]?.voucher_date_override).slice(0, 7).replace('-', '') === EXP_PERIOD,
      `voucher_date_override=${ymdLocal(fTxns[0]?.voucher_date_override)} 期望期间=${EXP_PERIOD}`)
    log.assert('★ 流水的真实发生日期未被改写（银行对账依据）',
      ymdLocal(fTxns[0]?.happened_at) === CLOSED_DATE, `happened_at=${ymdLocal(fTxns[0]?.happened_at)}`)

    // 凭证这一步：§F 要证明的是**用户选定的口径**——审批通过后在**补录当期**生成一张调整凭证，
    // 而不是「只要有个结果、没静默丢账就行」。原来的「生成时间 or 失败原因二选一」在凭证其实没
    // 生成出来时**照样绿**，等于把「环境缺科目」和「功能正常」记成同一分。故这里把凭证从
    // acct_vouchers / acct_voucher_entries 里捞出来逐项对账；「缺映射时留痕待生成」由 §F2 反例专测。
    const fVouchers = await vouchersOfSource(pool, 'payment_out', Number(fTxns[0]?.id))
    log.assert('★ 付款流水已有对应凭证（审批后即出账，不是停在待生成）',
      fVouchers.length === 1,
      `${fVouchers.length} 张${fRow?.voucher_generate_error ? `；单上 error=${fRow.voucher_generate_error}` : ''}`)
    const fV = fVouchers[0] || null
    if (fV) {
      log.assert('★ 凭证期间 = 补录当期（当期调整，不是改两年前的账）',
        fV.period === EXP_PERIOD, `period=${fV.period} 期望=${EXP_PERIOD}`)
      log.assert('★ 凭证已生效、非红冲', Number(fV.status) === 1 && Number(fV.is_reversal) === 0,
        `status=${fV.status} is_reversal=${fV.is_reversal}`)
      log.assert('★ 凭证头借贷平衡，且借贷方合计都等于本次付款额',
        Number(fV.total_debit) === PAY1 && Number(fV.total_credit) === PAY1,
        `借方=${money(fV.total_debit)} 贷方=${money(fV.total_credit)} 期望各 ${money(PAY1)}`)
      log.assert('★ 摘要标出「（跨期补录）」——会计一眼能认出这是调整分录',
        String(fV.summary || '').includes('（跨期补录）'), `summary=${fV.summary}`)
      log.assert('★ 凭证挂着来源单号（能从凭证回查回业务）', !!fV.source_no, `source_no=${fV.source_no}`)

      const fLegs = await voucherEntriesOf(pool, Number(fV.id))
      const fDebit = fLegs.filter(l => Number(l.direction) === 1)
      const fCredit = fLegs.filter(l => Number(l.direction) === 2)
      log.assert('★ 分录两条：借 2202 应付账款 / 贷 1002 银行存款',
        fLegs.length === 2 && fDebit.length === 1 && fCredit.length === 1
          && fDebit[0].account_code === '2202' && fCredit[0].account_code === '1002',
        fLegs.map(l => `${l.account_code}/${Number(l.direction) === 1 ? '借' : '贷'}${l.amount}`).join(' '))
      const debitSum = fDebit.reduce((s, l) => s + Number(l.amount), 0)
      const creditSum = fCredit.reduce((s, l) => s + Number(l.amount), 0)
      log.assert('★ 分录借贷相等（会计恒等式），且两腿都等于本次付款额',
        Math.abs(debitSum - creditSum) < 0.01
          && Math.abs(debitSum - PAY1) < 0.01 && Math.abs(creditSum - PAY1) < 0.01,
        `借=${money(debitSum)} 贷=${money(creditSum)} 期望各 ${money(PAY1)}`)
    }
    log.assert('★ 申请单上留下生成时间（列表能看出已出账）',
      !!fRow?.voucher_generated_at, `voucher_generated_at=${fRow?.voucher_generated_at}`)
    log.assert('★ 生成成功时不留失败原因（generated 与 error 不并存）',
      !fRow?.voucher_generate_error, `error=${fRow?.voucher_generate_error}`)

    // ══════════════════════════════════════════════════════════════════
    // §F2 缺映射反例：科目缺失时「业务已记账、凭证待生成 + 原因留痕」，补回后可重试补出
    //
    // 反例不是"跑出个 error 就算数"：这里临时软删凭证要用到的 1002 科目，再完整走一遍
    // 申请 → 审批，验证没法记账时系统**不装作记完了**，而是把原因留在单子上等重试；
    // 科目补回后同一个重试入口又能把凭证补出来。
    //
    // 影响面要**验证**、不能假设：regenerate-voucher 内部是全期间 generatePeriodVouchers，
    // 软删科目会波及该期间所有凭证。所以前后各取一次期间指纹，断言「除本单外零变化」——
    // 哪天它改成逐条容错、别的凭证被顺手改写，这条断言会红，而不是留句注释给人踩。
    // ══════════════════════════════════════════════════════════════════
    log.section('§F2 缺科目映射：凭证待生成 + 原因留痕，补回后可重试补出')
    step = 'F2:snapshot-before'
    const fpBefore = await vouchersFingerprint(pool, EXP_PERIOD)

    step = 'F2:seed'
    // 用一张**独立的**应付账款，不动 §F 那张 §G/§I 还依赖的账款：
    // 在 §F 的账款上再付一笔会把它的余额从 4000 改成 3000，而 §I 要求把这笔账款付清、
    // §G 又断言「分录仍只有 §F 那 1 条」——连带 12 条断言全红，且红在别处、极难定位。
    const productF2 = await createProduct(pool, 'F2')
    cleanup.productIds.push(productF2.id)
    const { poId: poF2, recId: recF2 } = await seedConfirmedPayable(ctx, token, {
      supplier, warehouse, location, product: productF2, label: 'F2',
    })
    cleanup.poIds.push(poF2)
    const f2PayUrl = `/api/payments/${recF2}/pay`

    step = 'F2:apply'
    const f2Resp = await http.post(f2PayUrl, {
      token, headers: { 'X-Request-Key': reqKey('f2map') },
      json: { amount: PAY2, paymentDate: CLOSED_DATE, method: '转账', accountId,
        remark: '缺映射反例', backfillRequest: true, backfillReason: BACKFILL_REASON },
    })
    const f2Id = Number(f2Resp.data?.data?.id)
    log.assert('§F2 补录申请已受理（HTTP 202）', f2Resp.status === 202 && f2Id > 0,
      `HTTP ${f2Resp.status} id=${f2Id}`)
    if (f2Id > 0) cleanup.backfillIds.push(f2Id)

    const f2Acc = (await dbQuery(pool, 'SELECT id, deleted_at FROM acct_accounts WHERE company_id=1 AND code=?', ['1002']))[0]
    if (!f2Acc) throw new Error('环境缺 1002 科目，无法构造缺映射反例')
    let f2TxnId = null
    step = 'F2:approve-without-mapping'
    await pool.query('UPDATE acct_accounts SET deleted_at=NOW() WHERE id=?', [Number(f2Acc.id)])
    try {
      const f2Approve = await http.post(`/api/accounting/backfills/${f2Id}/approve`, {
        token: limitedToken, json: { remark: '同意（缺映射反例）' },
      })
      console.log(`\n[§F2] HTTP ${f2Approve.status} ${JSON.stringify(f2Approve.data).slice(0, 280)}`)
      const f2Row = await backfillOfId(pool, f2Id)
      log.assert('★ 科目缺失不回滚业务：钱照样动（账实不能两空）',
        !!f2Row?.executed_at, `executed_at=${f2Row?.executed_at}`)
      log.assert('★ 本次付款分录已落库（业务确实执行）',
        (await entriesOf(pool, recF2)).length === 1, `${(await entriesOf(pool, recF2)).length} 条`)

      const f2TxnRow = (await dbQuery(pool,
        'SELECT id FROM finance_account_transactions WHERE backfill_id=? ORDER BY id DESC LIMIT 1', [f2Id]))[0]
      f2TxnId = Number(f2TxnRow?.id)
      log.assert('★ 本次资金流水已产生', Number.isFinite(f2TxnId) && f2TxnId > 0, `txnId=${f2TxnId}`)

      const f2Vouchers = await vouchersOfSource(pool, 'payment_out', f2TxnId)
      log.assert('★ 缺映射时凭证**确实没生成**（不是"生成了一张错的"）',
        f2Vouchers.length === 0, `${f2Vouchers.length} 张`)
      log.assert('★ 失败原因写回申请单（可重试，不是静默丢账）',
        !!f2Row?.voucher_generate_error, `error=${f2Row?.voucher_generate_error}`)
      log.assert('★ 单子停在「已执行 · 凭证待生成」，不当成已完成',
        !!f2Row?.executed_at && !f2Row?.voucher_generated_at,
        `executed_at=${f2Row?.executed_at} generated=${f2Row?.voucher_generated_at}`)

      const f2RetryFail = await http.post(`/api/accounting/backfills/${f2Id}/regenerate-voucher`, {
        token: limitedToken, json: {},
      })
      log.assert('★ 科目仍缺时手工重试依然失败，不假装成功',
        f2RetryFail.status === 500 && f2RetryFail.data?.code === 'FINANCE_BACKFILL_VOUCHER_NOT_READY',
        `HTTP ${f2RetryFail.status} code=${f2RetryFail.data?.code}`)

      // 就在**还软删着科目**的状态下取一次指纹：这次重试走的是全期间 generatePeriodVouchers
      // （同期间几十张别的凭证都在它的重算范围内），缺科目 → 整体回滚 → 应当**连一张都没动**。
      // 这才是"影响面"的正面证据；等到科目还原后再比，就分不清哪些变化是软删造成的、
      // 哪些只是重算顺带把其他待生成流水补齐了（后者是正向补齐，不算波及）。
      step = 'F2:snapshot-during-break'
      const fpDuringBreak = await vouchersFingerprint(pool, EXP_PERIOD)
      const duringDiff = fingerprintDiff(fpBefore, fpDuringBreak)
      log.assert('★ 软删期间那次全期间重算整体回滚：同期间凭证一张没改、一张没少',
        duringDiff.length === 0, duringDiff.join('; ') || '无差异')
    } finally {
      // 无论断言怎么走都要还原科目：否则后续段落与同库其它用例一起被带偏
      await pool.query('UPDATE acct_accounts SET deleted_at=? WHERE id=?', [f2Acc.deleted_at, Number(f2Acc.id)])
    }
    const f2AccAfter = (await dbQuery(pool, 'SELECT deleted_at FROM acct_accounts WHERE id=?', [Number(f2Acc.id)]))[0]
    log.assert('★ 临时软删的科目已还原（不污染库）',
      f2AccAfter?.deleted_at == null, `deleted_at=${f2AccAfter?.deleted_at}`)

    step = 'F2:retry-after-restore'
    const f2Retry = await http.post(`/api/accounting/backfills/${f2Id}/regenerate-voucher`, {
      token: limitedToken, json: {},
    })
    console.log(`\n[§F2] 重试 HTTP ${f2Retry.status} ${JSON.stringify(f2Retry.data).slice(0, 200)}`)
    log.assert('★ 科目补回后重试成功（重试入口确实能把凭证补出来）', f2Retry.ok, `HTTP ${f2Retry.status}`)
    const f2After = await backfillOfId(pool, f2Id)
    log.assert('★ 重试成功后 error 清空、生成时间落上',
      !f2After?.voucher_generate_error && !!f2After?.voucher_generated_at,
      `error=${f2After?.voucher_generate_error} generated=${f2After?.voucher_generated_at}`)
    const f2Final = await vouchersOfSource(pool, 'payment_out', f2TxnId)
    log.assert('★ 凭证这次真的落库了', f2Final.length === 1, `${f2Final.length} 张`)
    if (f2Final[0]) {
      const f2Legs = await voucherEntriesOf(pool, Number(f2Final[0].id))
      const f2D = f2Legs.filter(l => Number(l.direction) === 1).reduce((s, l) => s + Number(l.amount), 0)
      const f2C = f2Legs.filter(l => Number(l.direction) === 2).reduce((s, l) => s + Number(l.amount), 0)
      log.assert('★ 补出的凭证借贷平衡、在补录当期、金额等于本次付款',
        Math.abs(f2D - f2C) < 0.01 && Math.abs(f2D - PAY2) < 0.01 && f2Final[0].period === EXP_PERIOD,
        `借=${money(f2D)} 贷=${money(f2C)} period=${f2Final[0].period}`)
    }

    step = 'F2:snapshot-after'
    const fpAfter = await vouchersFingerprint(pool, EXP_PERIOD)
    // 科目还原后的这次重试是**成功**的：它同样全期间重算，除了本单凭证，
    // 还会把该期间其他「业务已记账、凭证待生成」的单子一并补齐（正向补齐，属设计行为）。
    // 所以要验的不是"零新增"，而是「**已有**凭证一张没被改写、一张没被删掉」。
    const afterDiff = fingerprintDiff(fpBefore, fpAfter).filter(d => !d.endsWith('新增'))
    log.assert('★ 软删科目没有改写或删除同期间任何已有凭证',
      afterDiff.length === 0, afterDiff.join('; ') || '无差异')

    // ══════════════════════════════════════════════════════════════════
    // §G 驳回：业务不落库，驳回后不能再批准
    // ══════════════════════════════════════════════════════════════════
    log.section('§G 驳回')
    step = 'G:reject'
    const gResp = await http.post(`/api/accounting/backfills/${cId}/reject`, {
      token: limitedToken, json: { remark: REJECT_REASON },
    })
    console.log(`\n[§G] HTTP ${gResp.status} ${JSON.stringify(gResp.data).slice(0, 200)}`)
    log.assert('★ 驳回成功', gResp.ok, `HTTP ${gResp.status}`)
    const gRow = await backfillOfId(pool, cId)
    log.assert('★ 状态=2 已驳回，原因原文留痕', Number(gRow?.status) === 2 && gRow?.approve_remark === REJECT_REASON,
      `status=${gRow?.status} remark=${gRow?.approve_remark}`)
    log.assert('★ 被驳回的单子没有落业务（分录仍只有 §F 那 1 条）', (await entriesOf(pool, recId)).length === 1)

    step = 'G:approve-after-reject'
    const g2Resp = await http.post(`/api/accounting/backfills/${cId}/approve`, { token: limitedToken, json: {} })
    log.assert('★ 驳回后不能再批准', g2Resp.status === 409 && g2Resp.data?.code === 'FINANCE_BACKFILL_REJECTED',
      `HTTP ${g2Resp.status} code=${g2Resp.data?.code}`)

    // ══════════════════════════════════════════════════════════════════
    // §H 无资金账户：申请即拒
    // ══════════════════════════════════════════════════════════════════
    log.section('§H 无资金账户的跨期付款申请')
    step = 'H:no-account'
    const beforeH = (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length
    const hResp = await http.post(payUrl, {
      token, headers: { 'X-Request-Key': reqKey('noacct') },
      json: { amount: PAY2, paymentDate: CLOSED_DATE, method: '转账', backfillRequest: true, backfillReason: BACKFILL_REASON },
    })
    console.log(`\n[§H] HTTP ${hResp.status} ${JSON.stringify(hResp.data).slice(0, 220)}`)
    log.assert('★ 申请被拒（HTTP 400）', hResp.status === 400, `HTTP ${hResp.status}`)
    log.assert('★ 错误码 FINANCE_BACKFILL_NO_FUND_ACCOUNT',
      hResp.data?.code === 'FINANCE_BACKFILL_NO_FUND_ACCOUNT', String(hResp.data?.code))
    log.assert('★ 未落申请单（不留一个永远补不出凭证的差异）',
      (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length === beforeH)

    // ══════════════════════════════════════════════════════════════════
    // §I 业务漂移：审批期间账款被付清 → 执行失败 → 可作废退出
    // ══════════════════════════════════════════════════════════════════
    log.section('§I 审批期间业务漂移 → 卡在「已批准 · 待执行」→ 作废退出')
    step = 'I:apply'
    const iKey = reqKey('drift')
    const iResp = await http.post(payUrl, {
      token, headers: { 'X-Request-Key': iKey },
      json: payBody({ amount: PAY2, backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    const iId = Number(iResp.data?.data?.id)
    if (Number.isFinite(iId) && iId > 0) cleanup.backfillIds.push(iId)
    log.assert('★ 漂移用例：申请已受理（202）', iResp.status === 202,
      `HTTP ${iResp.status} ${JSON.stringify(iResp.data).slice(0, 160)}`)

    // 审批期间：这 4000 元余额在**未结账**期间被另一笔正常付款付清
    step = 'I:settle-elsewhere'
    const paidLeft = QTY * PRICE - PAY1
    const iSettle = await http.post(payUrl, {
      token, json: { amount: paidLeft, paymentDate: OPEN_DATE, method: '转账', accountId, remark: '审批期间把账款付清' },
    })
    const iRecNow = await payableOf(pool, poA)
    log.assert('★ 审批期间账款已被付清（余额 0、状态 3）',
      iSettle.ok && Number(iRecNow.status) === 3 && Math.abs(Number(iRecNow.balance)) < 0.01,
      `HTTP ${iSettle.status} status=${iRecNow?.status} balance=${money(iRecNow?.balance)}`)
    // 这笔正常付款本身会写一条分录与一条流水，后面的「补录没落账」断言以它们为基准
    const entriesAfterSettle = (await entriesOf(pool, recId)).length
    const txnsAfterSettle = (await txnsOfAccount(pool, accountId)).length
    log.assert('★ 基准：正常付款那笔已落 1 条分录（共 2 条）', entriesAfterSettle === 2, `${entriesAfterSettle} 条`)

    step = 'I:approve-fails'
    const iApprove = await http.post(`/api/accounting/backfills/${iId}/approve`, {
      token: limitedToken, json: { remark: '同意' },
    })
    console.log(`\n[§I] 批准 HTTP ${iApprove.status} ${JSON.stringify(iApprove.data).slice(0, 320)}`)
    log.assert('★ 批准时报错（业务已不可执行）', !iApprove.ok && iApprove.status >= 400, `HTTP ${iApprove.status}`)
    log.assert('★ 错误信息给出出路（说明已批准、可重试执行 / 作废重报）',
      typeof iApprove.data?.message === 'string'
        && iApprove.data.message.includes('作废') && iApprove.data.message.includes('重试'),
      String(iApprove.data?.message).slice(0, 240))
    const iRow = await backfillOfId(pool, iId)
    log.assert('★ 状态停在「已批准 · 待执行」（批准结论不回退，业务未写）',
      Number(iRow?.status) === 1 && !iRow?.executed_at,
      `status=${iRow?.status} executed=${iRow?.executed_at}`)
    log.assert('★ 补录执行失败未新增任何分录（业务事务整体回滚）',
      (await entriesOf(pool, recId)).length === entriesAfterSettle,
      `${(await entriesOf(pool, recId)).length} 条（基准 ${entriesAfterSettle}）`)

    step = 'I:reject-blocked'
    const iReject = await http.post(`/api/accounting/backfills/${iId}/reject`, {
      token: limitedToken, json: { remark: '想驳回但状态不允许' },
    })
    log.assert('★ 已批准的单子不能被驳回（审批结论已落定，驳回会改写它）',
      iReject.status === 409 && iReject.data?.code === 'FINANCE_BACKFILL_APPROVED',
      `HTTP ${iReject.status} code=${iReject.data?.code}`)

    step = 'I:cancel'
    const iCancel = await http.post(`/api/accounting/backfills/${iId}/cancel`, {
      token: limitedToken, json: { reason: VOID_REASON },
    })
    console.log(`\n[§I] 作废 HTTP ${iCancel.status} ${JSON.stringify(iCancel.data).slice(0, 220)}`)
    log.assert('★ 卡住的单子可以作废退出（HTTP 200）——这就是本次补丁修的死角', iCancel.ok, `HTTP ${iCancel.status}`)
    const iRowAfter = await backfillOfId(pool, iId)
    log.assert('★ 状态=4 已作废', Number(iRowAfter?.status) === 4, `status=${iRowAfter?.status}`)
    log.assert('★ 作废留痕：原因/人/时间齐全',
      iRowAfter?.void_reason === VOID_REASON && Number(iRowAfter?.voided_by) === limitedUserId && !!iRowAfter?.voided_at,
      JSON.stringify({ reason: iRowAfter?.void_reason, by: iRowAfter?.voided_by, at: iRowAfter?.voided_at }))
    const txnCountAfterVoid = (await txnsOfAccount(pool, accountId)).length
    log.assert('★ 作废一分钱没动（分录数不变、流水数不变）',
      (await entriesOf(pool, recId)).length === entriesAfterSettle && txnCountAfterVoid === txnsAfterSettle,
      `分录 ${(await entriesOf(pool, recId)).length}（基准 ${entriesAfterSettle}）、流水 ${txnCountAfterVoid}（基准 ${txnsAfterSettle}）`)

    // 注：这张单的请求键在**业务状态已变**（账款已付清）的情况下重放，会在只读预检处就被
    // 拦下（400 FINANCE_BACKFILL_NOT_APPLICABLE），走不到「已作废」的判定——两种都是明确拒绝、
    // 都不静默，但错误码取决于当前业务状态。要稳定验证「已作废的键不会被当成本次申请」，
    // 得用业务状态未变的场景，见 §J。
    step = 'I:replay-after-void'
    const iReplay = await http.post(payUrl, {
      token, headers: { 'X-Request-Key': iKey },
      json: payBody({ amount: PAY2, backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    log.assert('★ 作废单上的请求键重放被明确拒绝，绝不静默当成本次申请受理',
      iReplay.status >= 400 && iReplay.status !== 202 && !!iReplay.data?.code,
      `HTTP ${iReplay.status} code=${iReplay.data?.code}`)

    // ══════════════════════════════════════════════════════════════════
    // §J 撤回：仅持申请权者可撤回自己的单；撤回别人的单被拒
    // ══════════════════════════════════════════════════════════════════
    log.section('§J 撤回自己的申请 / 越权撤回别人的申请')
    // §I 已把 recId 那笔账款付清，这里换一张干净的应付，撤回与越权用例才有可执行的业务前提
    step = 'J:seed-payable'
    const productD = await createProduct(pool, 'D')
    cleanup.productIds.push(productD.id)
    const { poId: poD, recId: recD } = await seedConfirmedPayable(ctx, token, {
      supplier, warehouse, location, product: productD, label: 'D',
    })
    cleanup.poIds.push(poD)
    const payUrlD = `/api/payments/${recD}/pay`
    const jBody = (extra = {}) => ({
      amount: PAY2, paymentDate: CLOSED_DATE, method: '转账', accountId, remark: '撤回用例', ...extra,
    })

    // 卸掉审批权、给上申请权：此刻 limited 是「只会申请的出纳」，才是撤回这条路的真实使用者
    // （保留审批权时 canApprove=true，走的是「审批侧代撤」分支，测不到申请人自助撤回）
    step = 'J:swap-perms'
    await revoke('finance.period.backfill.approve')
    await grant('finance.period.backfill')
    const jLogin = await login(http, 'smoke_limited', LIMITED_PW)
    const jToken = jLogin.token
    if (!jToken) throw new Error('smoke_limited 重新登录失败')

    step = 'J:apply-own'
    const jKey = reqKey('withdraw')
    const jResp = await http.post(payUrlD, {
      token: jToken, headers: { 'X-Request-Key': jKey },
      json: jBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    const jId = Number(jResp.data?.data?.id)
    if (Number.isFinite(jId) && jId > 0) cleanup.backfillIds.push(jId)
    log.assert('★ 撤回用例：出纳自己的申请已受理', jResp.status === 202,
      `HTTP ${jResp.status} ${JSON.stringify(jResp.data).slice(0, 160)}`)
    if (!Number.isFinite(jId) || jId <= 0) throw new Error(`撤回用例的申请单未建立（§J 后续断言依赖它）`)

    step = 'J:cancel-own'
    const jCancel = await http.post(`/api/accounting/backfills/${jId}/cancel`, {
      token: jToken, json: { reason: '金额填错了，重新申请' },
    })
    console.log(`\n[§J] 自己撤回 HTTP ${jCancel.status} ${JSON.stringify(jCancel.data).slice(0, 200)}`)
    log.assert('★ 仅持申请权者可撤回自己的待审批申请（canApprove=false 的申请人自助分支）', jCancel.ok,
      `HTTP ${jCancel.status} ${JSON.stringify(jCancel.data).slice(0, 160)}`)
    const jRow = await backfillOfId(pool, jId)
    log.assert('★ 撤回后状态=4，原因与撤回人留痕',
      Number(jRow?.status) === 4 && jRow?.void_reason === '金额填错了，重新申请'
        && Number(jRow?.voided_by) === limitedUserId,
      JSON.stringify({ status: jRow?.status, reason: jRow?.void_reason, by: jRow?.voided_by }))

    // 业务状态未变的场景下，作废单上的请求键重放必须明确拒回——不能静默当成本次申请受理，
    // 否则出纳会拿到一个永不执行的申请单号。（§I 那张单的账款已付清，会先被只读预检拦下。）
    step = 'J:replay-after-void'
    const jReplay = await http.post(payUrlD, {
      token: jToken, headers: { 'X-Request-Key': jKey },
      json: jBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    console.log(`\n[§J] 作废后同键重放 HTTP ${jReplay.status} ${JSON.stringify(jReplay.data).slice(0, 200)}`)
    log.assert('★ 已作废单上的请求键重放 → 409 FINANCE_BACKFILL_VOIDED',
      jReplay.status === 409 && jReplay.data?.code === 'FINANCE_BACKFILL_VOIDED',
      `HTTP ${jReplay.status} code=${jReplay.data?.code}`)
    log.assert('★ 重放不产生新申请单（作废的单子仍是那 1 张）',
      (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).filter(x => x === jId).length === 1)

    step = 'J:apply-others'
    const j2Resp = await http.post(payUrlD, {
      token, headers: { 'X-Request-Key': reqKey('others') },
      json: jBody({ backfillRequest: true, backfillReason: BACKFILL_REASON }),
    })
    const j2Id = Number(j2Resp.data?.data?.id)
    if (Number.isFinite(j2Id) && j2Id > 0) cleanup.backfillIds.push(j2Id)
    log.assert('★ 越权用例：admin 的申请已受理', j2Resp.status === 202,
      `HTTP ${j2Resp.status} ${JSON.stringify(j2Resp.data).slice(0, 160)}`)
    if (!Number.isFinite(j2Id) || j2Id <= 0) throw new Error('越权用例的申请单未建立（§J 后续断言依赖它）')

    step = 'J:cancel-others'
    const j2Cancel = await http.post(`/api/accounting/backfills/${j2Id}/cancel`, {
      token: jToken, json: { reason: '顺手撤掉别人的单' },
    })
    log.assert('★ 只能撤回自己提交的：撤回别人的单被拒（403 FINANCE_BACKFILL_VOID_FORBIDDEN）',
      j2Cancel.status === 403 && j2Cancel.data?.code === 'FINANCE_BACKFILL_VOID_FORBIDDEN',
      `HTTP ${j2Cancel.status} code=${j2Cancel.data?.code}`)
    const j2Row = await backfillOfId(pool, j2Id)
    log.assert('★ 别人的单未被改动', Number(j2Row?.status) === 0 && !j2Row?.voided_at,
      `status=${j2Row?.status} voided_at=${j2Row?.voided_at}`)
    // 也看不到别人的单（列表/详情按申请人过滤）
    const j2Detail = await http.get(`/api/accounting/backfills/${j2Id}`, { token: jToken })
    log.assert('★ 仅持申请权者看不到别人的补录申请详情（403 FINANCE_BACKFILL_VIEW_FORBIDDEN）',
      j2Detail.status === 403 && j2Detail.data?.code === 'FINANCE_BACKFILL_VIEW_FORBIDDEN',
      `HTTP ${j2Detail.status} code=${j2Detail.data?.code}`)

    // 恢复审批权，供 §L 使用
    step = 'J:restore'
    await revoke('finance.period.backfill')
    await grant('finance.period.backfill.approve')

    // ══════════════════════════════════════════════════════════════════
    // §K 历史遗留行：不能审批、不能作废
    // ══════════════════════════════════════════════════════════════════
    log.section('§K 历史遗留行（status=3）不可审批/作废')
    step = 'K:insert-legacy'
    const [legacyIns] = await pool.query(
      `INSERT INTO finance_period_backfills
         (company_id, period, business_date, biz_type, biz_id, biz_no, amount, reason, status, operator_name)
       VALUES (1, ?, ?, 'payment', ?, 'BF-LEGACY-ROW', ?, '第一期同步补录遗留，无审批环节', 3, 'smoke-test')`,
      [CLOSED_PERIOD, CLOSED_DATE, recId, PAY1],
    )
    const legacyId = Number(legacyIns.insertId)
    cleanup.backfillIds.push(legacyId)
    const kApprove = await http.post(`/api/accounting/backfills/${legacyId}/approve`, { token: limitedToken, json: {} })
    log.assert('★ 历史行不能批准（找不到「谁批的」这回事）',
      kApprove.status === 409 && kApprove.data?.code === 'FINANCE_BACKFILL_LEGACY',
      `HTTP ${kApprove.status} code=${kApprove.data?.code}`)
    const kCancel = await http.post(`/api/accounting/backfills/${legacyId}/cancel`, {
      token: limitedToken, json: { reason: '试图作废历史行' },
    })
    log.assert('★ 历史行不能作废（业务早已落库，标成作废会把已发生的账藏起来）',
      kCancel.status === 409 && kCancel.data?.code === 'FINANCE_BACKFILL_LEGACY',
      `HTTP ${kCancel.status} code=${kCancel.data?.code}`)

    // ══════════════════════════════════════════════════════════════════
    // §L 核销类补录：不产生会计凭证
    // ══════════════════════════════════════════════════════════════════
    log.section('§L 收付款单类补录的凭证口径')
    step = 'L:seed-payable'
    const productB = await createProduct(pool, 'B')
    cleanup.productIds.push(productB.id)
    const { poId: poB, recId: recB } = await seedConfirmedPayable(ctx, token, {
      supplier, warehouse, location, product: productB, label: 'B',
    })
    cleanup.poIds.push(poB)

    const lBody = {
      type: 1, partyName: supplier.name, amount: PAY1, paymentDate: CLOSED_DATE,
      accountId, allocations: [{ recordId: recB, amount: PAY1 }],
    }
    step = 'L:closed'
    const lClosed = await http.post('/api/payments/receipts', { token, json: lBody })
    log.assert('★ 已结账期间的收付款单登记被拒（409 FINANCE_PERIOD_CLOSED）',
      lClosed.status === 409 && lClosed.data?.code === 'FINANCE_PERIOD_CLOSED',
      `HTTP ${lClosed.status} code=${lClosed.data?.code}`)

    step = 'L:apply'
    const lResp = await http.post('/api/payments/receipts', {
      token, headers: { 'X-Request-Key': reqKey('receipt') },
      json: { ...lBody, backfillRequest: true, backfillReason: BACKFILL_REASON },
    })
    const lId = Number(lResp.data?.data?.id)
    if (Number.isFinite(lId) && lId > 0) cleanup.backfillIds.push(lId)
    log.assert('★ 收付款单类补录申请已受理（202）', lResp.status === 202,
      `HTTP ${lResp.status} ${JSON.stringify(lResp.data).slice(0, 200)}`)
    const lRow0 = await backfillOfId(pool, lId)
    log.assert('★ 申请单业务类型为收付款单登记（receipt）', lRow0?.biz_type === 'receipt', String(lRow0?.biz_type))
    log.assert('★ 申请时未被核销（业务未动）', Math.abs(Number((await payableOf(pool, poB)).paid_amount)) < 0.01)

    step = 'L:approve'
    const lApprove = await http.post(`/api/accounting/backfills/${lId}/approve`, { token: limitedToken, json: {} })
    console.log(`\n[§L] 批准 HTTP ${lApprove.status} ${JSON.stringify(lApprove.data).slice(0, 260)}`)
    log.assert('★ 批准成功', lApprove.ok, `HTTP ${lApprove.status} ${JSON.stringify(lApprove.data).slice(0, 200)}`)
    const lRow = await backfillOfId(pool, lId)
    log.assert('★ 已执行（executed_at 有值）', !!lRow?.executed_at, String(lRow?.executed_at))
    log.assert('★ 业务已落库：该账款被核销 1000',
      Math.abs(Number((await payableOf(pool, poB)).paid_amount) - PAY1) < 0.01,
      `paid=${money((await payableOf(pool, poB)).paid_amount)}`)

    // 登记类补录**需要**凭证（voucherNotRequired=false）；核销类**不需要**（true 且不显示待生成）。
    // 这两条是页面口径的支点：口径错了，页面要么一直挂着永远不会来的「凭证待生成」，
    // 要么把真正缺的凭证藏起来。
    const lDetail = (await http.get(`/api/accounting/backfills/${lId}`, { token })).data?.data
    log.assert('★ 登记类补录：会产生凭证（voucherNotRequired=false）', lDetail?.voucherNotRequired === false,
      JSON.stringify({ notRequired: lDetail?.voucherNotRequired, pending: lDetail?.voucherPending }))

    step = 'L:settle-row'
    // 核销类（receipt_settle）在执行时本就不写资金流水，因此没有凭证来源。
    // 这里按精确列直接构造一行已执行的核销补录，验的是**页面/接口的口径**是否与此一致
    // （真实 settle 流程的跨期申请路径由 §I 的同一套 apply/approve 代码覆盖）。
    //
    // 断言用**前后差分**而不是 `=== 0`：§F/§L 那两笔在测试环境里凭证生成失败（缺科目映射，
    // 已在 §F 留痕并计入 voucherPending，这是实现的设计行为）。写死 0 会把「环境缺数据」
    // 误判成「核销类没被排除」——要验的命题只是**插入核销类前后这个数不变**。
    const beforeLSummary = (await http.get('/api/accounting/backfills?status=1', { token })).data?.data?.summary
    const [settleIns] = await pool.query(
      `INSERT INTO finance_period_backfills
         (company_id, period, business_date, biz_type, biz_id, biz_no, amount, reason, status,
          operator_name, executed_at, posting_period)
       VALUES (1, ?, ?, 'receipt_settle', ?, 'BF-SETTLE-ROW', ?, '核销类补录', 1,
               'smoke-test', NOW(), ?)`,
      [CLOSED_PERIOD, CLOSED_DATE, recB, PAY1, EXP_PERIOD],
    )
    const settleId = Number(settleIns.insertId)
    cleanup.backfillIds.push(settleId)
    const settleDetail = (await http.get(`/api/accounting/backfills/${settleId}`, { token })).data?.data
    log.assert('★ 核销类补录：不需要凭证（voucherNotRequired=true）', settleDetail?.voucherNotRequired === true,
      JSON.stringify({ notRequired: settleDetail?.voucherNotRequired }))
    log.assert('★ 核销类补录：不显示「凭证待生成」（voucherPending=false）——否则页面永远挂着假警报',
      settleDetail?.voucherPending === false, JSON.stringify({ pending: settleDetail?.voucherPending }))
    const lSummary = (await http.get('/api/accounting/backfills?status=1', { token })).data?.data?.summary
    log.assert('★ 列表统计的 voucherPending 也不把核销类算进去（数与行对得上）',
      Number(lSummary?.voucherPending) === Number(beforeLSummary?.voucherPending)
        && Number(lSummary?.total) === Number(beforeLSummary?.total) + 1,
      `含核销类前 voucherPending=${beforeLSummary?.voucherPending} total=${beforeLSummary?.total}；`
      + `插入后 voucherPending=${lSummary?.voucherPending} total=${lSummary?.total}`)

    // ══════════════════════════════════════════════════════════════════
    // §M 未结账期间正常登记不受影响
    // ══════════════════════════════════════════════════════════════════
    log.section('§M 未结账期间正常登记不受影响')
    step = 'M:seed'
    const productC = await createProduct(pool, 'C')
    cleanup.productIds.push(productC.id)
    const { poId: poC, recId: recC } = await seedConfirmedPayable(ctx, token, {
      supplier, warehouse, location, product: productC, label: 'C',
    })
    cleanup.poIds.push(poC)
    const beforeM = (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length

    step = 'M:pay'
    const mResp = await http.post(`/api/payments/${recC}/pay`, {
      token, json: { amount: PAY1, paymentDate: OPEN_DATE, method: '转账', accountId, remark: '未结账期间' },
    })
    log.assert('★ 未结账期间无需补录参数即可登记', mResp.ok, `HTTP ${mResp.status} ${JSON.stringify(mResp.data).slice(0, 160)}`)
    log.assert('★ 正常登记不产生补录单', (await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length === beforeM,
      `${(await backfillIdsInPeriod(pool, CLOSED_PERIOD)).length} vs ${beforeM}`)

    // ══════════════════════════════════════════════════════════════════
    // §N 退款补录：快照锁住资金去向，源单被改动则拒绝执行
    // ══════════════════════════════════════════════════════════════════
    // 退款与前三类不同：要执行的业务**早就存在**（退款单是活单据），执行参数取自它自己那一行。
    // 于是「审批人批的」与「执行时读到的」可能是两份东西。这一节锁死两件事：
    //   ① 申请快照必须固定出款账户/金额/日期/客户与原单——否则审批人只看得见一个单号，
    //      钱从哪个账户出去全靠自己去别处翻；
    //   ② 执行时拿快照核对锁行后的现值，被改过就拒绝执行、停在「已批准 · 待执行」。
    log.section('§N 退款补录：快照锁资金去向 + 源单改动拒绝执行')
    step = 'N:seed'
    const saleN = await seedSaleWithPaid(pool, 1000, 800)
    cleanup.saleOrderIds.push(saleN.orderId)
    const refundAccResp = await http.post('/api/finance/accounts', {
      token, json: { name: `退款补录用例账户-${randomRef('RA')}`, type: 2, openingBalance: 0 },
    })
    const refundAccId = Number(refundAccResp.data?.data?.id)
    if (!Number.isFinite(refundAccId) || refundAccId <= 0) throw new Error(`建退款账户失败: ${JSON.stringify(refundAccResp.data)}`)
    cleanup.extraAccountIds.push(refundAccId)

    step = 'N:create-refund'
    const nCreate = await http.post('/api/refunds', {
      token,
      json: {
        saleOrderId: saleN.orderId, amount: 300, accountId: refundAccId,
        refundDate: CLOSED_DATE, remark: '退款补录用例',
      },
    })
    const refundId = Number(nCreate.data?.data?.id)
    if (!Number.isInteger(refundId)) throw new Error(`建退款单失败: ${JSON.stringify(nCreate.data)}`)
    cleanup.refundIds.push(refundId)
    const nSubmit = await http.post(`/api/refunds/${refundId}/submit`, { token })
    log.assert('退款单已确认（进入可执行态）', nSubmit.ok, `HTTP ${nSubmit.status}`)

    step = 'N:default-deny'
    const n1 = await http.post(`/api/refunds/${refundId}/execute`, {
      token, headers: { 'X-Request-Key': reqKey('nn1') },
    })
    console.log(`\n[§N1] HTTP ${n1.status} ${JSON.stringify(n1.data).slice(0, 200)}`)
    log.assert('★ 退款日期落在已结账期间：不带宽限参数被拦下（HTTP 409）', n1.status === 409, `HTTP ${n1.status}`)
    log.assert('★ 业务分文未动（退款单仍是已确认）', Number((await refundOfId(pool, refundId))?.status) === 2,
      `status=${(await refundOfId(pool, refundId))?.status}`)

    step = 'N:apply'
    const n2 = await http.post(`/api/refunds/${refundId}/execute`, {
      token,
      headers: { 'X-Request-Key': reqKey('nn2') },
      json: { backfillRequest: true, backfillReason: BACKFILL_REASON },
    })
    console.log(`\n[§N2] HTTP ${n2.status} ${JSON.stringify(n2.data).slice(0, 260)}`)
    const nBid = Number(n2.data?.data?.id)
    log.assert('★ 申请返回 202 + 申请单', n2.status === 202 && Number.isInteger(nBid),
      `HTTP ${n2.status} body=${JSON.stringify(n2.data).slice(0, 160)}`)
    if (Number.isInteger(nBid)) cleanup.backfillIds.push(nBid)
    log.assert('★ 退款单仍未执行', Number((await refundOfId(pool, refundId))?.status) === 2)
    log.assert('★ 账款未被冲减（申请不动钱）',
      Math.abs(Number((await recordOfId(pool, saleN.paymentRecordId))?.paid_amount) - 800) < 0.01,
      String((await recordOfId(pool, saleN.paymentRecordId))?.paid_amount))
    log.assert('★ 退款账户没有流水（钱没出去）', (await txnsOfAccount(pool, refundAccId)).length === 0)

    step = 'N:snapshot'
    const nDetail = await http.get(`/api/accounting/backfills/${nBid}`, { token: limitedToken })
    const nSnap = nDetail.data?.data?.requestSnapshot
    console.log(`\n[§N3] 快照 ${JSON.stringify(nSnap)}`)
    log.assert('★ 待审批单的详情对审批人可见（HTTP 200）', nDetail.ok, `HTTP ${nDetail.status}`)
    log.assert('★ 快照固定了出款账户', Number(nSnap?.body?.accountId) === refundAccId, String(nSnap?.body?.accountId))
    log.assert('★ 快照固定了退款金额', Math.abs(Number(nSnap?.body?.amount) - 300) < 0.01, String(nSnap?.body?.amount))
    log.assert('★ 快照固定了退款日期', ymdLocal(nSnap?.body?.refundDate) === CLOSED_DATE, String(nSnap?.body?.refundDate))
    log.assert('★ 快照固定了原销售单与客户',
      nSnap?.body?.saleOrderNo === saleN.orderNo && nSnap?.body?.customerName === '退款补录用例客户',
      JSON.stringify({ saleOrderNo: nSnap?.body?.saleOrderNo, customerName: nSnap?.body?.customerName }))

    step = 'N:approve'
    const n4 = await http.post(`/api/accounting/backfills/${nBid}/approve`, {
      token: limitedToken, json: { remark: '核对退款账户与金额无误' },
    })
    console.log(`\n[§N4] HTTP ${n4.status} ${JSON.stringify(n4.data).slice(0, 260)}`)
    log.assert('★ 他人批准后执行成功（HTTP 200）', n4.ok, `HTTP ${n4.status} ${JSON.stringify(n4.data).slice(0, 160)}`)
    log.assert('★ 退款单已完成', Number((await refundOfId(pool, refundId))?.status) === 3,
      `status=${(await refundOfId(pool, refundId))?.status}`)
    log.assert('★ 账款已冲减（800 → 500）',
      Math.abs(Number((await recordOfId(pool, saleN.paymentRecordId))?.paid_amount) - 500) < 0.01,
      String((await recordOfId(pool, saleN.paymentRecordId))?.paid_amount))
    const nTxns = await txnsOfAccount(pool, refundAccId)
    log.assert('★ 钱按快照里的账户出去（1 条出账流水）', nTxns.length === 1, `${nTxns.length} 条`)
    log.assert('★ 流水挂 backfill_id，真实出账日期仍是原退款日期',
      Number(nTxns[0]?.backfill_id) === nBid && ymdLocal(nTxns[0]?.happened_at) === CLOSED_DATE,
      JSON.stringify({ backfillId: nTxns[0]?.backfill_id, happenedAt: ymdLocal(nTxns[0]?.happened_at) }))

    // 第五步：源单在申请之后被改动 —— 批的和执行的不再是同一笔
    step = 'N:drift-seed'
    const saleN2 = await seedSaleWithPaid(pool, 1000, 800)
    cleanup.saleOrderIds.push(saleN2.orderId)
    const accOtherResp = await http.post('/api/finance/accounts', {
      token, json: { name: `退款漂移用例账户-${randomRef('RB')}`, type: 2, openingBalance: 0 },
    })
    const accOtherId = Number(accOtherResp.data?.data?.id)
    if (!Number.isFinite(accOtherId) || accOtherId <= 0) throw new Error(`建漂移账户失败: ${JSON.stringify(accOtherResp.data)}`)
    cleanup.extraAccountIds.push(accOtherId)
    const driftCreate = await http.post('/api/refunds', {
      token,
      json: {
        saleOrderId: saleN2.orderId, amount: 300, accountId: refundAccId,
        refundDate: CLOSED_DATE, remark: '退款漂移用例',
      },
    })
    const refund2Id = Number(driftCreate.data?.data?.id)
    if (!Number.isInteger(refund2Id)) throw new Error(`建第二张退款单失败: ${JSON.stringify(driftCreate.data)}`)
    cleanup.refundIds.push(refund2Id)
    await http.post(`/api/refunds/${refund2Id}/submit`, { token })
    const driftApply = await http.post(`/api/refunds/${refund2Id}/execute`, {
      token,
      headers: { 'X-Request-Key': reqKey('nn5') },
      json: { backfillRequest: true, backfillReason: BACKFILL_REASON },
    })
    const driftBid = Number(driftApply.data?.data?.id)
    log.assert('第二张补录申请已提交（HTTP 202）',
      driftApply.status === 202 && Number.isInteger(driftBid), `HTTP ${driftApply.status}`)
    if (Number.isInteger(driftBid)) cleanup.backfillIds.push(driftBid)

    // 退款单没有编辑接口，正常流程改不动它——所以只能直改库来构造这个场景。
    // 这正是护栏要防的那类改动：DB 直改、以后新增的编辑功能、或别的模块写这张表。
    await pool.query('UPDATE refund_orders SET account_id=?, amount=? WHERE id=?', [accOtherId, 350, refund2Id])
    step = 'N:drift-approve'
    const driftApprove = await http.post(`/api/accounting/backfills/${driftBid}/approve`, {
      token: limitedToken, json: { remark: '同意' },
    })
    console.log(`\n[§N5] HTTP ${driftApprove.status} ${JSON.stringify(driftApprove.data).slice(0, 300)}`)
    log.assert('★ 源单被改动：拒绝执行（HTTP 409）', driftApprove.status === 409, `HTTP ${driftApprove.status}`)
    log.assert('★ 错误码 FINANCE_BACKFILL_SOURCE_DRIFT',
      driftApprove.data?.code === 'FINANCE_BACKFILL_SOURCE_DRIFT', String(driftApprove.data?.code))
    const driftRow = await backfillOfId(pool, driftBid)
    log.assert('★ 停在「已批准 · 待执行」（status=1 且无 executed_at）',
      Number(driftRow?.status) === 1 && !driftRow?.executed_at,
      JSON.stringify({ status: driftRow?.status, executedAt: driftRow?.executed_at }))
    log.assert('★ 钱一分没动：退款单仍已确认、新账户无流水、账款未冲减',
      Number((await refundOfId(pool, refund2Id))?.status) === 2
        && (await txnsOfAccount(pool, accOtherId)).length === 0
        && (await txnsOfAccount(pool, refundAccId)).length === 1
        && Math.abs(Number((await recordOfId(pool, saleN2.paymentRecordId))?.paid_amount) - 800) < 0.01,
      JSON.stringify({
        refundStatus: (await refundOfId(pool, refund2Id))?.status,
        otherTxns: (await txnsOfAccount(pool, accOtherId)).length,
        paid: (await recordOfId(pool, saleN2.paymentRecordId))?.paid_amount,
      }))

    step = 'N:cancel'
    const driftCancel = await http.post(`/api/accounting/backfills/${driftBid}/cancel`, {
      token: limitedToken, json: { reason: '退款单已被改动，作废后按新情况重新申请' },
    })
    log.assert('★ 可作废退出（不卡在一张永远执行不了的补录单上）',
      driftCancel.ok && Number((await backfillOfId(pool, driftBid))?.status) === 4,
      `HTTP ${driftCancel.status} status=${(await backfillOfId(pool, driftBid))?.status}`)

    // ══════════════════════════════════════════════════════════════════
    // §O 补录当期**本身**也被结账 → 执行被拒、业务分文不写
    //
    // §A 验的是「业务日期落在已结账期间」被拒。这里验的是**另一道防线**：业务日期那张期间是
    // 开放的（199001 已结、1995-01-15 那笔的期间开放），但从申请到批准之间，会计把**补录当期**
    // （= 执行这天所属期间）也结掉了——凭证此时无处可落。
    //
    // 口径必须是「拒绝执行、停在已批准待执行」，**不是**「钱先划走、凭证再想办法」：后者会让
    // 已封期间凭空多出一笔资金流水，凭证永远补不出来。§F 证明当期开放时走得通；这一节证明
    // 当期关闭时**走不通**——没有反例，「闸门存在」就只是文档里的一句话（AGENTS §0.2）。
    //
    // ⚠ 这一节会临时改动**真实的当期行**（不是 199001 那种隔离期间），所以：先连原值一起快照 →
    //   用完立即按原值还原（原本不存在就删本轮新建行）。还原失败会让同库后续所有凭证生成停摆，
    //   故还原放在本节 finally 里执行，全局 finally 再兜一道。
    // ══════════════════════════════════════════════════════════════════
    log.section('§O 补录当期本身也被结账 → 执行被拒，业务分文不写')
    step = 'O:seed'
    const productO = await createProduct(pool, 'O')
    cleanup.productIds.push(productO.id)
    const { poId: poO, recId: recO } = await seedConfirmedPayable(ctx, token, {
      supplier, warehouse, location, product: productO, label: 'O',
    })
    cleanup.poIds.push(poO)
    const oPayUrl = `/api/payments/${recO}/pay`

    step = 'O:apply'
    const oResp = await http.post(oPayUrl, {
      token,
      headers: { 'X-Request-Key': reqKey('period-closed') },
      json: {
        amount: PAY1,
        paymentDate: CLOSED_DATE,
        method: '转账',
        accountId,
        remark: '补录当期已结账用例',
        backfillRequest: true,
        backfillReason: BACKFILL_REASON,
      },
    })
    const oId = Number(oResp.data?.data?.id)
    log.assert('★ 申请已受理（202 + 申请单号）', oResp.status === 202 && Number.isInteger(oId),
      `HTTP ${oResp.status} ${JSON.stringify(oResp.data).slice(0, 160)}`)
    if (Number.isInteger(oId)) cleanup.backfillIds.push(oId)

    const oEntriesBefore = (await entriesOf(pool, recO)).length
    const oTxnsBefore = (await txnsOfAccount(pool, accountId)).length

    // 批准之前把补录当期结掉：这正是要防的竞态（申请时当期还开着）
    step = 'O:close-current-period'
    const [oCurRows] = await pool.query(
      'SELECT * FROM acct_periods WHERE company_id=1 AND period=?', [EXP_PERIOD])
    cleanup.postingPeriodSnapshot = {
      period: EXP_PERIOD, existed: oCurRows.length > 0, before: oCurRows[0] || null, done: false,
    }
    await pool.query(
      `INSERT INTO acct_periods (company_id, period, status, closed_by_name, closed_at)
         VALUES (1, ?, 2, 'smoke-test-O', NOW())
       ON DUPLICATE KEY UPDATE status=2, closed_by_name='smoke-test-O', closed_at=NOW()`,
      [EXP_PERIOD],
    )
    const [oClosed] = await dbQuery(pool, 'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [EXP_PERIOD])
    log.assert(`★ 补录当期 ${EXP_PERIOD} 已被临时结账（原行已快照，用完按原值还原）`,
      Number(oClosed?.status) === 2, `status=${oClosed?.status}`)

    step = 'O:approve'
    const oApprove = await http.post(`/api/accounting/backfills/${oId}/approve`, {
      token: limitedToken, json: { remark: '核对无误，同意补录' },
    })
    console.log(`\n[§O] 批准 HTTP ${oApprove.status} ${JSON.stringify(oApprove.data).slice(0, 320)}`)
    log.assert('★ 执行被拒绝（HTTP 409）——不是「钱先动、凭证再想办法」',
      oApprove.status === 409, `HTTP ${oApprove.status} ${JSON.stringify(oApprove.data).slice(0, 200)}`)
    log.assert('★ 错误码 FINANCE_BACKFILL_POSTING_PERIOD_CLOSED',
      oApprove.data?.code === 'FINANCE_BACKFILL_POSTING_PERIOD_CLOSED', String(oApprove.data?.code))
    log.assert('★ 提示点明是补录当期、并给出出路（先反结账）',
      typeof oApprove.data?.message === 'string'
        && oApprove.data.message.includes(EXP_PERIOD) && oApprove.data.message.includes('反结账'),
      String(oApprove.data?.message).slice(0, 240))

    const oRow = await backfillOfId(pool, oId)
    log.assert('★ 停在「已批准 · 待执行」：批准结论已落定、执行痕迹为空',
      Number(oRow?.status) === 1 && !oRow?.executed_at,
      JSON.stringify({ status: oRow?.status, executedAt: oRow?.executed_at }))
    log.assert('★ 未回填落期与业务 id —— 业务这一侧完全没写成',
      !oRow?.posting_period && !oRow?.executed_biz_id,
      JSON.stringify({ postingPeriod: oRow?.posting_period, bizId: oRow?.executed_biz_id }))

    const oRec = await payableOf(pool, poO)
    log.assert('★ 业务分文不写：付款分录 0 条、账款已付仍 0、状态仍 1',
      (await entriesOf(pool, recO)).length === oEntriesBefore
        && Math.abs(Number(oRec?.paid_amount)) < 0.01 && Number(oRec?.status) === 1,
      `entries=${(await entriesOf(pool, recO)).length} paid=${money(oRec?.paid_amount)} status=${oRec?.status}`)
    log.assert('★ 一分钱没动：资金流水数不变（审批人也绕不过闸门把钱先划走）',
      (await txnsOfAccount(pool, accountId)).length === oTxnsBefore,
      `${(await txnsOfAccount(pool, accountId)).length} 条（基准 ${oTxnsBefore}）`)

    step = 'O:restore'
    const oSnapExisted = cleanup.postingPeriodSnapshot.existed
    await restorePostingPeriod()
    const [oRestored] = await dbQuery(pool, 'SELECT status FROM acct_periods WHERE company_id=1 AND period=?', [EXP_PERIOD])
    log.assert(`★ 当期行已还原（原${oSnapExisted ? '有该行 → 回写原值' : '无该行 → 删本轮新建'}）`,
      oSnapExisted ? Number(oRestored?.status) !== 2 : oRestored == null,
      `status=${oRestored?.status} existed=${oSnapExisted}`)
  } catch (e) {
    console.error(`\n[中止于 step=${step}] ${e.message}`)
    console.error(e.stack)
    // 记一条失败断言：中途抛错必须让汇总与退出码都反映「没跑完」。
    // 只打印、只依赖 log.summary().failed>0 的话，若抛错前所有断言恰好都绿，脚本会以 0 退出——
    // 那就是把「没跑完」当成了「全通过」。
    log.assert(`★ 用例完整跑完（中止于 ${step}）`, false, e.message)
  } finally {
    // 按精确 ID 清理，绝不按名字/编码前缀批量删除（共享夹具自洁原则）
    const safe = async (label, sql, params) => {
      try { await pool.query(sql, params) } catch (e) { console.error(`[清理告警] ${label}: ${e.message}`) }
    }
    if (cleanup.limitedRoleId != null) {
      for (const perm of cleanup.granted) {
        await safe('sys_role_permissions',
          'DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [cleanup.limitedRoleId, perm])
      }
    }
    for (const bid of cleanup.backfillIds) {
      await safe('finance_period_backfills', 'DELETE FROM finance_period_backfills WHERE id=?', [bid])
    }
    // §N 的退款链路数据：退款单 → 销售侧账款（含退款写下的负向流水/往来事件）→ 销售单
    for (const rid of cleanup.refundIds) {
      await safe('refund_orders', 'DELETE FROM refund_orders WHERE id=?', [rid])
    }
    for (const sid of cleanup.saleOrderIds) {
      const saleRecs = await dbQuery(pool, 'SELECT id FROM payment_records WHERE type=2 AND order_id=?', [sid])
      for (const r of saleRecs) {
        await safe('party_ledger_events', 'DELETE FROM party_ledger_events WHERE record_id=?', [r.id])
        await safe('payment_record_events', 'DELETE FROM payment_record_events WHERE payment_record_id=?', [r.id])
        await safe('payment_entries', 'DELETE FROM payment_entries WHERE record_id=?', [r.id])
        await safe('payment_records', 'DELETE FROM payment_records WHERE id=?', [r.id])
      }
      await safe('sale_orders', 'DELETE FROM sale_orders WHERE id=?', [sid])
    }
    for (const accId of cleanup.extraAccountIds) {
      await safe('finance_account_transactions', 'DELETE FROM finance_account_transactions WHERE account_id=?', [accId])
      await safe('finance_accounts', 'DELETE FROM finance_accounts WHERE id=?', [accId])
    }
    // 本套件为跑通凭证链才补进去的会计科目（只删自己插的那些精确 id；
    // 库本来就有的预置科目一个都不动）
    for (const accId of cleanup.insertedAccountIds) {
      await safe('acct_accounts', 'DELETE FROM acct_accounts WHERE id=?', [accId])
    }
    // 隔离期间 199001 是本套件插入的（准备阶段已确认原本不存在），删掉即还原
    await safe('acct_periods', 'DELETE FROM acct_periods WHERE company_id=1 AND period=?', [CLOSED_PERIOD])

    // 本套件在隔离业务日期上落的收付款单（1990-01-15 不可能属于真实数据，等价精确键）
    const strayReceipts = await dbQuery(pool, 'SELECT id FROM payment_receipts WHERE payment_date=?', [CLOSED_DATE])
    const strayIds = strayReceipts.map(r => Number(r.id))
    if (strayIds.length) {
      await safe('payment_entries(receipt)', 'DELETE FROM payment_entries WHERE receipt_id IN (?)', [strayIds])
      await safe('party_ledger_events(receipt)', 'DELETE FROM party_ledger_events WHERE receipt_id IN (?)', [strayIds])
      await safe('payment_receipts', 'DELETE FROM payment_receipts WHERE id IN (?)', [strayIds])
    }
    // 账户是本套件新建的，删掉它的全部流水与账户本身即可（不碰任何既有账户的余额）
    if (cleanup.accountId != null) {
      await safe('finance_account_transactions', 'DELETE FROM finance_account_transactions WHERE account_id=?', [cleanup.accountId])
      await safe('finance_accounts', 'DELETE FROM finance_accounts WHERE id=?', [cleanup.accountId])
    }
    for (const poId of cleanup.poIds) {
      const tasks = await dbQuery(pool, 'SELECT id FROM inbound_tasks WHERE purchase_order_id=?', [poId])
      for (const t of tasks) {
        await safe('inbound_task_events', 'DELETE FROM inbound_task_events WHERE task_id=?', [t.id])
        await safe('inventory_logs', "DELETE FROM inventory_logs WHERE ref_type='inbound_task' AND ref_id=?", [t.id])
        await safe('inventory_containers', 'DELETE FROM inventory_containers WHERE inbound_task_id=?', [t.id])
        await safe('inbound_task_items', 'DELETE FROM inbound_task_items WHERE task_id=?', [t.id])
        await safe('inbound_tasks', 'DELETE FROM inbound_tasks WHERE id=?', [t.id])
      }
      const recs = await dbQuery(pool, 'SELECT id FROM payment_records WHERE type=1 AND order_id=?', [poId])
      for (const r of recs) {
        // 子表必须先删干净：往来账事件与账款事件都按 record_id 引用付款单
        await safe('party_ledger_events', 'DELETE FROM party_ledger_events WHERE record_id=?', [r.id])
        await safe('payment_record_events', 'DELETE FROM payment_record_events WHERE payment_record_id=?', [r.id])
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
    // §O 兜底：正常路径已还原过一次（幂等），这里防「§O 中途抛错、没走到自己的还原」——
    // 当期行停在已结账会让这个库之后所有凭证生成静默停摆，代价比多一次幂等调用大得多。
    // 单独 try/catch：还原失败不能连累 ctx.close()，否则进程会挂着不退。
    try { await restorePostingPeriod() } catch (e) { console.error(`[清理告警] acct_periods(§O 当期行还原): ${e.message}`) }
    clearTimeout(watchdog)
    await ctx.close()
    // 全局单例池（backend/src/config/db）自己收尾：它也是 mysql2 连接，socket 不 unref，
    // app/service 查询过一次就会留住事件循环——断言全绿、退出码已定，进程却吊着不退。
    // smokeTestKit.close() 只管它自建的池；两个池分开关，谁都不会被关两次。
    await require('../backend/src/config/db').pool.end()
    const counts = log.summary()
    // 退出码 = 断言失败数（含 catch 里记的那条「没跑完」），保证 CI 与本地都不会误判
    process.exitCode = counts.failed > 0 ? 1 : 0
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
