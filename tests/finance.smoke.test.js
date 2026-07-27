#!/usr/bin/env node
'use strict'

/**
 * 财务模块回归测试（收款核销 / 汇总对账单 / 资金账户 / 费用报销）
 *
 * v0.4.33 一次性上了四条新链路，它们都直接改钱：账款余额、账户余额、报销出账。
 * 这类错误和库存的「静默出错」同性质——界面一切正常，钱悄悄对不上，靠点测发现不了。
 * 本测试锁死的是几条**违反即事故**的口径：
 *
 *   1. 账户余额是流水的投影（refreshBalance 全量重算），绝不是「读余额→加减→写回」。
 *      测试直接把 current_balance 篡改成错值，再走一笔真实业务，验证它被重算回来。
 *   2. 对账单 settled_amount 同理，是下属账款核销额的汇总投影。
 *   3. 账款余额是核销的唯一事实源；对账单核销最终必须落到 payment_records 上。
 *   4. 报销**不进 payment_records**——那是往来账款，报销是内部费用，两者只在
 *      finance_account_transactions 层汇合。
 *   5. 核销接 X-Request-Key 幂等：连点两次/断网重试不能重复扣钱。
 *   6. 不能审批自己提交的报销单（一级审批唯一的内控点）。
 *   7. payment_records.settlement_type 是快照，改往来方主数据不追溯改写老账。
 *
 * 运行：node tests/finance.smoke.test.js
 */

const path = require('path')
const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const APPROVER_USER = 'smoke_finance_approver'
const APPROVER_PW = 'SmokeFinance123!'

const today = () => new Date().toISOString().slice(0, 10)
const money = n => Number(Number(n).toFixed(2))

/** 审批人：报销的内控要求「审批人 ≠ 申请人」，因此必须有第二个账号 */
async function ensureApprover(pool) {
  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'Smoke财务审批', 1, '管理员', 1)
     ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=1, role_name='管理员',
       is_active=1, deleted_at=NULL`,
    [APPROVER_USER, bcrypt.hashSync(APPROVER_PW, 10)],
  )
  const [u] = await dbQuery(pool, 'SELECT id FROM sys_users WHERE username=? LIMIT 1', [APPROVER_USER])
  return Number(u.id)
}

/** 建一笔账款。settlementType 1=现结（账款页）2=月结（对账页）；手工建单默认已确认 */
async function seedRecord(http, token, pool, { type, partyName, amount, settlementType = 1, confirmStatus = 1 }) {
  const res = await http.post('/api/payments', {
    token,
    json: {
      type,
      orderNo: randomRef(type === 1 ? 'AP' : 'AR'),
      partyName,
      totalAmount: amount,
      remark: 'finance smoke',
    },
  })
  const id = Number(res.data?.data?.id)
  // settlement_type / confirm_status 走建表默认值(2 月结 / 1 已确认)，
  // 测试要覆盖现结与「未确认应付」两种场景，直接落库改——这是造数据，不是绕业务规则
  await pool.query('UPDATE payment_records SET settlement_type=?, confirm_status=? WHERE id=?',
    [settlementType, confirmStatus, id])
  return id
}

async function getRecord(pool, id) {
  const [r] = await dbQuery(pool, 'SELECT * FROM payment_records WHERE id=?', [id])
  return r
}

async function getAccount(pool, id) {
  const [r] = await dbQuery(pool, 'SELECT * FROM finance_accounts WHERE id=?', [id])
  return r
}

// ── 1. 资金账户与流水投影 ─────────────────────────────────────────────────────

async function scenarioAccountProjection(ctx, log, token) {
  log.section('资金账户：余额是流水的投影')
  const { http, pool } = ctx

  const created = await http.post('/api/finance/accounts', {
    token,
    json: { name: randomRef('账户').slice(0, 30), type: 2, openingBalance: 1000 },
  })
  log.assert('建资金账户成功', created.ok, `status=${created.status} ${JSON.stringify(created.data?.message || '')}`)
  const accountId = Number(created.data?.data?.id)
  const acc0 = await getAccount(pool, accountId)
  log.assert('期初余额即当前余额', money(acc0.current_balance) === 1000, `current=${acc0.current_balance}`)

  // 一笔收款（应收方向=钱进来）
  const party = randomRef('客户')
  const receipt = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: { type: 2, partyName: party, amount: 300, paymentDate: today(), accountId, allocations: [] },
  })
  log.assert('收款单登记成功', receipt.ok, `status=${receipt.status} ${JSON.stringify(receipt.data?.message || '')}`)

  const acc1 = await getAccount(pool, accountId)
  log.assert('★ 收款后账户余额 = 期初 + 收入', money(acc1.current_balance) === 1300, `current=${acc1.current_balance}`)

  const txns = await dbQuery(pool,
    'SELECT * FROM finance_account_transactions WHERE account_id=? ORDER BY id DESC LIMIT 1', [accountId])
  log.assert('流水方向为收入(1)且金额一致',
    txns.length === 1 && Number(txns[0].direction) === 1 && money(txns[0].amount) === 300,
    JSON.stringify(txns[0] || null))
  log.assert('流水 balance_after 与账户余额一致',
    money(txns[0].balance_after) === 1300, `balance_after=${txns[0]?.balance_after}`)

  const consistency = await http.get('/api/finance/accounts/consistency', { token })
  log.assert('账户一致性检查无差异',
    consistency.ok && Number(consistency.data?.data?.mismatchCount) === 0,
    JSON.stringify(consistency.data?.data || null))

  // ★ 投影的硬证明：把缓存列篡改成错值，再走一笔真实业务，余额必须被全量重算回来。
  // 若实现是「读余额→加减→写回」，错值会被继承下去（1300→9999→10299）。
  await pool.query('UPDATE finance_accounts SET current_balance=9999 WHERE id=?', [accountId])
  const tampered = await http.get('/api/finance/accounts/consistency', { token })
  log.assert('篡改余额后一致性检查能报出差异',
    Number(tampered.data?.data?.mismatchCount) >= 1,
    JSON.stringify(tampered.data?.data?.mismatches || null))

  await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: { type: 2, partyName: party, amount: 200, paymentDate: today(), accountId, allocations: [] },
  })
  const acc2 = await getAccount(pool, accountId)
  log.assert('★ 余额被全量重算回正确值（而非在错值上累加）',
    money(acc2.current_balance) === 1500,
    `current=${acc2.current_balance}（累加实现会得到 10199）`)

  // 余额调整：补差额流水，不直接改余额
  const adjusted = await http.post(`/api/finance/accounts/${accountId}/adjust`, {
    token, json: { targetBalance: 1600, remark: 'smoke 调整' },
  })
  log.assert('余额调整成功', adjusted.ok, `status=${adjusted.status}`)
  const adjTxn = await dbQuery(pool,
    'SELECT * FROM finance_account_transactions WHERE account_id=? AND biz_type=4 ORDER BY id DESC LIMIT 1', [accountId])
  log.assert('★ 调整走的是差额流水（biz_type=4，金额=差额100）',
    adjTxn.length === 1 && money(adjTxn[0].amount) === 100 && Number(adjTxn[0].direction) === 1,
    JSON.stringify(adjTxn[0] || null))
  const acc3 = await getAccount(pool, accountId)
  log.assert('调整后余额等于目标值', money(acc3.current_balance) === 1600, `current=${acc3.current_balance}`)

  // 有流水后的两道保护
  const reopen = await http.put(`/api/finance/accounts/${accountId}`, {
    token,
    json: { name: acc3.name, type: 2, openingBalance: 5000, isActive: true },
  })
  log.assert('★ 有流水后不允许改期初余额', reopen.status === 409, `status=${reopen.status}`)
  const removed = await http.delete(`/api/finance/accounts/${accountId}`, { token })
  log.assert('★ 有流水的账户不允许删除', removed.status === 409, `status=${removed.status}`)

  return { accountId }
}

// ── 2. 收款核销：一笔汇款冲多单 / 部分核销 / 预收款 ───────────────────────────

async function scenarioReceiptAllocation(ctx, log, token, accountId) {
  log.section('收款核销：一笔汇款冲多单、部分核销、预收款')
  const { http, pool } = ctx
  const party = randomRef('客户')

  const r1 = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 100 })
  const r2 = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 200 })
  const r3 = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 500 })

  // 汇款 400：r1 全额 100 + r2 全额 200 + r3 部分 50，剩 50 挂在单上（预收款）
  const res = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 400, paymentDate: today(), accountId,
      allocations: [
        { recordId: r1, amount: 100 },
        { recordId: r2, amount: 200 },
        { recordId: r3, amount: 50 },
      ],
    },
  })
  log.assert('一笔汇款核销三单成功', res.ok, `status=${res.status} ${JSON.stringify(res.data?.message || '')}`)
  const receiptId = Number(res.data?.data?.id)

  const [a, b, c] = [await getRecord(pool, r1), await getRecord(pool, r2), await getRecord(pool, r3)]
  log.assert('★ 全额核销的两单已收清(status=3)、余额为 0',
    Number(a.status) === 3 && money(a.balance) === 0 && Number(b.status) === 3 && money(b.balance) === 0,
    `r1=${a.status}/${a.balance} r2=${b.status}/${b.balance}`)
  log.assert('★ 部分核销的单为部分收(status=2)、余额 450',
    Number(c.status) === 2 && money(c.balance) === 450 && money(c.paid_amount) === 50,
    `r3 status=${c.status} paid=${c.paid_amount} balance=${c.balance}`)

  const [rec] = await dbQuery(pool, 'SELECT * FROM payment_receipts WHERE id=?', [receiptId])
  log.assert('★ 汇款单为部分核销(status=2)、余额 50（即预收款）',
    Number(rec.status) === 2 && money(rec.settled_amount) === 350 && money(rec.balance) === 50,
    `status=${rec.status} settled=${rec.settled_amount} balance=${rec.balance}`)

  const entries = await dbQuery(pool, 'SELECT * FROM payment_entries WHERE receipt_id=?', [receiptId])
  log.assert('三条核销明细各自落到对应账款', entries.length === 3, `entries=${entries.length}`)

  // 预收款余额继续核销
  const settled = await http.post(`/api/payments/receipts/${receiptId}/settle`, {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: { allocations: [{ recordId: r3, amount: 50 }] },
  })
  log.assert('用预收余额继续核销成功', settled.ok, `status=${settled.status} ${JSON.stringify(settled.data?.message || '')}`)
  const [rec2] = await dbQuery(pool, 'SELECT * FROM payment_receipts WHERE id=?', [receiptId])
  log.assert('★ 汇款单核销完毕(status=3)、余额归零',
    Number(rec2.status) === 3 && money(rec2.balance) === 0,
    `status=${rec2.status} balance=${rec2.balance}`)
  const c2 = await getRecord(pool, r3)
  log.assert('账款累计已收 100、仍为部分收', money(c2.paid_amount) === 100 && Number(c2.status) === 2,
    `paid=${c2.paid_amount} status=${c2.status}`)

  // 核销完的单不能再核销
  const over = await http.post(`/api/payments/receipts/${receiptId}/settle`, {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: { allocations: [{ recordId: r3, amount: 10 }] },
  })
  log.assert('★ 已核销完的汇款单不能再核销', over.status === 400, `status=${over.status}`)

  return { party, openRecordId: r3 }
}

async function scenarioAllocationGuards(ctx, log, token, accountId) {
  log.section('核销的四道闸门：超额 / 往来方 / 类型 / 未确认应付')
  const { http, pool } = ctx
  const party = randomRef('客户')
  const other = randomRef('别家')

  const rec = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 100 })
  const otherRec = await seedRecord(http, token, pool, { type: 2, partyName: other, amount: 100 })
  const payable = await seedRecord(http, token, pool, { type: 1, partyName: party, amount: 100, confirmStatus: 0 })

  const overAmount = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 500, paymentDate: today(), accountId,
      allocations: [{ recordId: rec, amount: 300 }],
    },
  })
  log.assert('★ 核销额超出账款余额被拒', overAmount.status === 400,
    `status=${overAmount.status} ${JSON.stringify(overAmount.data?.message || '')}`)

  const wrongParty = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 100, paymentDate: today(), accountId,
      allocations: [{ recordId: otherRec, amount: 100 }],
    },
  })
  log.assert('★ 核销到别家往来方的账款被拒', wrongParty.status === 400,
    `status=${wrongParty.status} ${JSON.stringify(wrongParty.data?.message || '')}`)

  const wrongType = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 100, paymentDate: today(), accountId,
      allocations: [{ recordId: payable, amount: 100 }],
    },
  })
  log.assert('★ 收款单核销到应付账款被拒（类型不符）', wrongType.status === 400,
    `status=${wrongType.status} ${JSON.stringify(wrongType.data?.message || '')}`)

  const unconfirmed = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 1, partyName: party, amount: 100, paymentDate: today(), accountId,
      allocations: [{ recordId: payable, amount: 100 }],
    },
  })
  log.assert('★ 未经财务确认的应付不允许出款核销', unconfirmed.status === 409,
    `status=${unconfirmed.status} ${JSON.stringify(unconfirmed.data?.message || '')}`)

  // 闸门拒绝后不应留下任何副作用（整个事务回滚）
  const after = await getRecord(pool, rec)
  log.assert('被拒的核销没有留下痕迹（账款未动）',
    money(after.paid_amount) === 0 && Number(after.status) === 1,
    `paid=${after.paid_amount} status=${after.status}`)
}

// ── 3. 幂等重放 ───────────────────────────────────────────────────────────────

async function scenarioIdempotency(ctx, log, token, accountId) {
  log.section('幂等：连点两次 / 断网重试不重复扣钱')
  const { http, pool } = ctx
  const party = randomRef('客户')
  const recordId = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 300 })
  const balanceBefore = money((await getAccount(pool, accountId)).current_balance)

  const key = randomRef('KEY')
  // 汇款 150 只核销 100，故意留 50 预收余额——下面 settle 的重放要用它。
  // 汇款单核销满后 settle 会被「已核销完的汇款单不能再核销」拦成 400（见场景 2），
  // 那是另一条规则，会把这里要验的幂等盖掉。
  const body = {
    type: 2, partyName: party, amount: 150, paymentDate: today(), accountId,
    allocations: [{ recordId, amount: 100 }],
  }
  const first = await http.post('/api/payments/receipts', { token, headers: { 'X-Request-Key': key }, json: body })
  const replay = await http.post('/api/payments/receipts', { token, headers: { 'X-Request-Key': key }, json: body })

  log.assert('首次登记成功', first.ok, `status=${first.status}`)
  log.assert('重放请求同样返回成功（返回原响应）', replay.ok, `status=${replay.status}`)
  log.assert('★ 重放返回的是同一张汇款单',
    Number(first.data?.data?.id) === Number(replay.data?.data?.id),
    `first=${first.data?.data?.id} replay=${replay.data?.data?.id}`)

  const rec = await getRecord(pool, recordId)
  log.assert('★ 账款只被核销了一次（paid=100 而非 200）',
    money(rec.paid_amount) === 100 && money(rec.balance) === 200,
    `paid=${rec.paid_amount} balance=${rec.balance}`)

  const receipts = await dbQuery(pool,
    'SELECT COUNT(*) AS n FROM payment_receipts WHERE party_name=?', [party])
  log.assert('★ 只落了一张汇款单', Number(receipts[0].n) === 1, `count=${receipts[0].n}`)

  const entries = await dbQuery(pool,
    'SELECT COUNT(*) AS n FROM payment_entries WHERE record_id=?', [recordId])
  log.assert('★ 只落了一条核销明细', Number(entries[0].n) === 1, `count=${entries[0].n}`)

  const balanceAfter = money((await getAccount(pool, accountId)).current_balance)
  log.assert('★ 账户只入账一次（余额只 +150）',
    balanceAfter === money(balanceBefore + 150),
    `before=${balanceBefore} after=${balanceAfter}`)

  // settle 的重放
  const receiptId = Number(first.data?.data?.id)
  const r2 = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 300 })
  const settleKey = randomRef('KEY')
  const settleBody = { allocations: [{ recordId: r2, amount: 50 }] }
  await http.post(`/api/payments/receipts/${receiptId}/settle`, {
    token, headers: { 'X-Request-Key': settleKey }, json: settleBody,
  })
  const settleReplay = await http.post(`/api/payments/receipts/${receiptId}/settle`, {
    token, headers: { 'X-Request-Key': settleKey }, json: settleBody,
  })
  log.assert('核销重放返回成功', settleReplay.ok, `status=${settleReplay.status}`)
  const rec2 = await getRecord(pool, r2)
  log.assert('★ 核销重放没有重复扣（paid=50）', money(rec2.paid_amount) === 50, `paid=${rec2.paid_amount}`)
}

// ── 4. 汇总对账单 ─────────────────────────────────────────────────────────────

async function scenarioStatement(ctx, log, token, accountId) {
  log.section('汇总对账单：确认闸门 / 解锁闸门 / 核销投影')
  const { http, pool } = ctx
  const party = randomRef('月结客户')

  const m1 = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 300, settlementType: 2 })
  const m2 = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 700, settlementType: 2 })
  const cashRec = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 100, settlementType: 1 })

  const cand = await http.get(`/api/payments/statements/candidates?type=2&partyName=${encodeURIComponent(party)}`, { token })
  const candIds = (cand.data?.data || []).map(x => Number(x.id))
  log.assert('★ 待对账候选只含月结账款，不含现结',
    candIds.includes(m1) && candIds.includes(m2) && !candIds.includes(cashRec),
    `候选=${JSON.stringify(candIds)} 现结=${cashRec}`)

  const cashOnly = await http.post('/api/payments/statements', {
    token, json: { type: 2, partyName: party, recordIds: [cashRec] },
  })
  log.assert('★ 现结账款不允许进对账单', cashOnly.status === 400,
    `status=${cashOnly.status} ${JSON.stringify(cashOnly.data?.message || '')}`)

  const created = await http.post('/api/payments/statements', {
    token, json: { type: 2, partyName: party, recordIds: [m1, m2] },
  })
  log.assert('生成对账单成功', created.ok, `status=${created.status} ${JSON.stringify(created.data?.message || '')}`)
  const stId = Number(created.data?.data?.id)
  const [st0] = await dbQuery(pool, 'SELECT * FROM reconciliation_statements WHERE id=?', [stId])
  log.assert('对账单合计 = 下属账款合计、状态为草稿',
    money(st0.total_amount) === 1000 && Number(st0.status) === 1,
    `total=${st0.total_amount} status=${st0.status}`)

  const dup = await http.post('/api/payments/statements', {
    token, json: { type: 2, partyName: party, recordIds: [m1] },
  })
  log.assert('★ 同一笔账款不能进两张对账单', dup.status === 409,
    `status=${dup.status} ${JSON.stringify(dup.data?.message || '')}`)

  // 草稿单不能核销：明细还能改，此时收钱会对不上账
  const draftSettle = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 100, paymentDate: today(), accountId,
      allocations: [{ statementId: stId, amount: 100 }],
    },
  })
  log.assert('★ 草稿态对账单不允许核销', draftSettle.status === 409,
    `status=${draftSettle.status} ${JSON.stringify(draftSettle.data?.message || '')}`)

  const confirmed = await http.post(`/api/payments/statements/${stId}/confirm`, { token })
  log.assert('确认对账单成功', confirmed.ok, `status=${confirmed.status}`)

  const removeLocked = await http.delete(`/api/payments/statements/${stId}/items/${m1}`, { token })
  log.assert('★ 已确认的对账单不能改明细', removeLocked.status === 409, `status=${removeLocked.status}`)

  const unlocked = await http.post(`/api/payments/statements/${stId}/unlock`, { token })
  log.assert('未核销时可以解锁回草稿', unlocked.ok, `status=${unlocked.status}`)
  await http.post(`/api/payments/statements/${stId}/confirm`, { token })

  // 部分核销 400：按账款创建时间从早到晚填满，m1(300) 全清 + m2 补 100
  const part = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 400, paymentDate: today(), accountId,
      allocations: [{ statementId: stId, amount: 400 }],
    },
  })
  log.assert('对账单部分核销成功', part.ok, `status=${part.status} ${JSON.stringify(part.data?.message || '')}`)

  const [rm1, rm2] = [await getRecord(pool, m1), await getRecord(pool, m2)]
  log.assert('★ 对账单核销最终落到账款上（先清老账）',
    Number(rm1.status) === 3 && money(rm1.paid_amount) === 300 && money(rm2.paid_amount) === 100,
    `m1 paid=${rm1.paid_amount}/${rm1.status} m2 paid=${rm2.paid_amount}`)

  const [st1] = await dbQuery(pool, 'SELECT * FROM reconciliation_statements WHERE id=?', [stId])
  log.assert('★ 对账单已核销额是下属账款的汇总投影',
    money(st1.settled_amount) === 400 && money(st1.balance) === 600 && Number(st1.status) === 2,
    `settled=${st1.settled_amount} balance=${st1.balance} status=${st1.status}`)

  const unlockAfter = await http.post(`/api/payments/statements/${stId}/unlock`, { token })
  log.assert('★ 已有核销记录的对账单不允许解锁', unlockAfter.status === 409,
    `status=${unlockAfter.status} ${JSON.stringify(unlockAfter.data?.message || '')}`)

  // 核销剩余 600 → 对账单进入已核销
  const rest = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 600, paymentDate: today(), accountId,
      allocations: [{ statementId: stId, amount: 600 }],
    },
  })
  log.assert('核销剩余额成功', rest.ok, `status=${rest.status} ${JSON.stringify(rest.data?.message || '')}`)
  const [st2] = await dbQuery(pool, 'SELECT * FROM reconciliation_statements WHERE id=?', [stId])
  log.assert('★ 全部核销后对账单进入已核销(status=3)、余额为 0',
    Number(st2.status) === 3 && money(st2.balance) === 0,
    `status=${st2.status} balance=${st2.balance}`)

  const overSettle = await http.post('/api/payments/receipts', {
    token,
    headers: { 'X-Request-Key': randomRef('KEY') },
    json: {
      type: 2, partyName: party, amount: 100, paymentDate: today(), accountId,
      allocations: [{ statementId: stId, amount: 100 }],
    },
  })
  log.assert('★ 已核销完的对账单不能再核销', overSettle.status === 400,
    `status=${overSettle.status} ${JSON.stringify(overSettle.data?.message || '')}`)
}

// ── 5. 结算方式快照 ───────────────────────────────────────────────────────────

async function scenarioSettlementSnapshot(ctx, log, token) {
  log.section('结算方式是账款上的快照，不回溯往来方主数据')
  const { http, pool } = ctx
  const party = randomRef('切换客户')

  const [cust] = await dbQuery(pool,
    'SELECT id FROM sale_customers WHERE name=? AND deleted_at IS NULL LIMIT 1', [party])
  if (!cust) {
    await pool.query('INSERT INTO sale_customers (code, name, settlement_type) VALUES (?,?,1)',
      [randomRef('CUS').slice(0, 30), party])
  }
  const oldRecord = await seedRecord(http, token, pool, { type: 2, partyName: party, amount: 100, settlementType: 1 })

  // 把客户主数据从现结改成月结——老账款不能跟着搬家
  await pool.query('UPDATE sale_customers SET settlement_type=2 WHERE name=?', [party])

  const after = await getRecord(pool, oldRecord)
  log.assert('★ 改客户结算方式后，老账款的快照列不变',
    Number(after.settlement_type) === 1, `settlement_type=${after.settlement_type}`)

  const cashPage = await http.get(`/api/payments?type=2&settlementTypes=1&partyName=${encodeURIComponent(party)}`, { token })
  const cashIds = (cashPage.data?.data?.list || []).map(x => Number(x.id))
  log.assert('★ 老账款仍留在账款页（现结）分流下，未整批换页',
    cashIds.includes(oldRecord), `列表=${JSON.stringify(cashIds)}`)

  const monthlyPage = await http.get(`/api/payments?type=2&settlementTypes=2&partyName=${encodeURIComponent(party)}`, { token })
  const monthlyIds = (monthlyPage.data?.data?.list || []).map(x => Number(x.id))
  log.assert('老账款不会出现在对账页（月结）分流下',
    !monthlyIds.includes(oldRecord), `列表=${JSON.stringify(monthlyIds)}`)
}

// ── 6. 费用报销 ───────────────────────────────────────────────────────────────

async function scenarioExpenseClaim(ctx, log, token, approverToken, accountId, applicantId) {
  log.section('费用报销：状态机 / 内控 / 与往来账款隔离')
  const { http, pool } = ctx

  const cats = await http.get('/api/finance/expense-categories', { token })
  let categoryId = Number((cats.data?.data || [])[0]?.id)
  if (!categoryId) {
    const made = await http.post('/api/finance/expense-categories', { token, json: { name: 'Smoke差旅' } })
    categoryId = Number(made.data?.data?.id)
  }
  log.assert('取到费用类别', categoryId > 0, `categoryId=${categoryId}`)

  const created = await http.post('/api/finance/expense-claims', {
    token,
    json: {
      title: 'Smoke 报销单',
      items: [
        { categoryId, amount: 120.5, happenedAt: today(), description: '高铁' },
        { categoryId, amount: 79.5, happenedAt: today(), description: '住宿' },
      ],
    },
  })
  log.assert('建报销单成功', created.ok, `status=${created.status} ${JSON.stringify(created.data?.message || '')}`)
  const claimId = Number(created.data?.data?.id)
  const [claim0] = await dbQuery(pool, 'SELECT * FROM expense_claims WHERE id=?', [claimId])
  log.assert('单头金额 = 明细合计', money(claim0.total_amount) === 200, `total=${claim0.total_amount}`)
  log.assert('新建为草稿(status=1)', Number(claim0.status) === 1, `status=${claim0.status}`)

  const earlyPay = await http.post(`/api/finance/expense-claims/${claimId}/pay`, {
    token, json: { accountId },
  })
  log.assert('★ 草稿单不能直接付款', earlyPay.status === 409 || earlyPay.status === 400, `status=${earlyPay.status}`)

  const earlyApprove = await http.post(`/api/finance/expense-claims/${claimId}/approve`, { token: approverToken })
  log.assert('★ 未提交的单不能审批', earlyApprove.status === 409 || earlyApprove.status === 400, `status=${earlyApprove.status}`)

  const submitted = await http.post(`/api/finance/expense-claims/${claimId}/submit`, { token })
  log.assert('提交审批成功', submitted.ok, `status=${submitted.status}`)

  const editAfterSubmit = await http.put(`/api/finance/expense-claims/${claimId}`, {
    token, json: { title: '改一下', items: [{ categoryId, amount: 999, happenedAt: today() }] },
  })
  log.assert('★ 已提交的单不能改明细', editAfterSubmit.status === 409 || editAfterSubmit.status === 400,
    `status=${editAfterSubmit.status}`)

  // ★ 内控：申请人不能审批自己的单
  const selfApprove = await http.post(`/api/finance/expense-claims/${claimId}/approve`, { token })
  log.assert('★ 不能审批自己提交的报销单', selfApprove.status === 403,
    `status=${selfApprove.status} ${JSON.stringify(selfApprove.data?.message || '')}`)
  const selfReject = await http.post(`/api/finance/expense-claims/${claimId}/reject`, {
    token, json: { reason: '自己驳回自己' },
  })
  log.assert('★ 也不能驳回自己提交的报销单', selfReject.status === 403, `status=${selfReject.status}`)

  const [stillPending] = await dbQuery(pool, 'SELECT status FROM expense_claims WHERE id=?', [claimId])
  log.assert('被内控拦下后单据仍是待审批', Number(stillPending.status) === 2, `status=${stillPending.status}`)

  const approved = await http.post(`/api/finance/expense-claims/${claimId}/approve`, { token: approverToken })
  log.assert('他人审批通过', approved.ok, `status=${approved.status} ${JSON.stringify(approved.data?.message || '')}`)

  const cancelApproved = await http.post(`/api/finance/expense-claims/${claimId}/cancel`, { token })
  log.assert('★ 已批准的单不能直接取消（需先驳回）', cancelApproved.status === 409 || cancelApproved.status === 400,
    `status=${cancelApproved.status}`)

  const payableBefore = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM payment_records')
  const balanceBefore = money((await getAccount(pool, accountId)).current_balance)

  const paid = await http.post(`/api/finance/expense-claims/${claimId}/pay`, {
    token: approverToken, json: { accountId, remark: 'smoke 付款' },
  })
  log.assert('付款成功', paid.ok, `status=${paid.status} ${JSON.stringify(paid.data?.message || '')}`)

  const [claim1] = await dbQuery(pool, 'SELECT * FROM expense_claims WHERE id=?', [claimId])
  log.assert('单据进入已付款(status=4)并记下付款账户',
    Number(claim1.status) === 4 && Number(claim1.paid_account_id) === Number(accountId),
    `status=${claim1.status} account=${claim1.paid_account_id}`)

  const balanceAfter = money((await getAccount(pool, accountId)).current_balance)
  log.assert('★ 报销付款从账户扣钱（余额 -200）',
    balanceAfter === money(balanceBefore - 200), `before=${balanceBefore} after=${balanceAfter}`)

  const expTxn = await dbQuery(pool,
    'SELECT * FROM finance_account_transactions WHERE biz_type=3 AND biz_id=? ORDER BY id DESC LIMIT 1', [claimId])
  log.assert('账户流水记为费用报销支出(biz_type=3, direction=2)',
    expTxn.length === 1 && Number(expTxn[0].direction) === 2 && money(expTxn[0].amount) === 200,
    JSON.stringify(expTxn[0] || null))

  const payableAfter = await dbQuery(pool, 'SELECT COUNT(*) AS n FROM payment_records')
  log.assert('★ 报销不写进 payment_records（不污染应付应收口径）',
    Number(payableAfter[0].n) === Number(payableBefore[0].n),
    `before=${payableBefore[0].n} after=${payableAfter[0].n}`)

  const payAgain = await http.post(`/api/finance/expense-claims/${claimId}/pay`, {
    token: approverToken, json: { accountId },
  })
  log.assert('★ 已付款的单不能重复付款', payAgain.status === 409 || payAgain.status === 400, `status=${payAgain.status}`)
  const balanceFinal = money((await getAccount(pool, accountId)).current_balance)
  log.assert('重复付款被拒后余额未变', balanceFinal === balanceAfter, `balance=${balanceFinal}`)

  // 撤回与驳回两条支线
  const c2 = await http.post('/api/finance/expense-claims', {
    token, json: { items: [{ categoryId, amount: 50, happenedAt: today() }] },
  })
  const claim2 = Number(c2.data?.data?.id)
  await http.post(`/api/finance/expense-claims/${claim2}/submit`, { token })
  const withdrawn = await http.post(`/api/finance/expense-claims/${claim2}/withdraw`, { token })
  log.assert('待审批单可由本人撤回', withdrawn.ok, `status=${withdrawn.status}`)
  const [c2row] = await dbQuery(pool, 'SELECT status FROM expense_claims WHERE id=?', [claim2])
  log.assert('撤回后回到草稿', Number(c2row.status) === 1, `status=${c2row.status}`)

  await http.post(`/api/finance/expense-claims/${claim2}/submit`, { token })
  const noReason = await http.post(`/api/finance/expense-claims/${claim2}/reject`, {
    token: approverToken, json: { reason: '' },
  })
  log.assert('驳回必须填原因', noReason.status === 400, `status=${noReason.status}`)
  const rejected = await http.post(`/api/finance/expense-claims/${claim2}/reject`, {
    token: approverToken, json: { reason: '发票缺失' },
  })
  log.assert('他人驳回成功', rejected.ok, `status=${rejected.status}`)
  const [c2row2] = await dbQuery(pool, 'SELECT status, reject_reason FROM expense_claims WHERE id=?', [claim2])
  log.assert('驳回后状态=已驳回并记下原因',
    Number(c2row2.status) === 5 && c2row2.reject_reason === '发票缺失',
    `status=${c2row2.status} reason=${c2row2.reject_reason}`)
  const cancelled = await http.post(`/api/finance/expense-claims/${claim2}/cancel`, { token })
  log.assert('已驳回的单可以取消', cancelled.ok, `status=${cancelled.status}`)

  // 申请人字段确实记的是提交人（内控判定的依据）
  log.assert('报销单申请人 = 建单人', Number(claim0.applicant_id) === Number(applicantId),
    `applicant=${claim0.applicant_id} expected=${applicantId}`)
}

// ── 7. 账户一致性收尾 ─────────────────────────────────────────────────────────

async function scenarioFinalConsistency(ctx, log, token) {
  log.section('收尾：全部账户余额与流水一致')
  const { http } = ctx
  const res = await http.get('/api/finance/accounts/consistency', { token })
  log.assert('★ 跑完全部财务动作后账户无一漂移',
    res.ok && Number(res.data?.data?.mismatchCount) === 0,
    JSON.stringify(res.data?.data?.mismatches || null))
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token, user } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('管理员登录失败')

    await ensureApprover(ctx.pool)
    const { token: approverToken } = await login(ctx.http, APPROVER_USER, APPROVER_PW)
    if (!approverToken) throw new Error('审批人登录失败')

    const { accountId } = await scenarioAccountProjection(ctx, log, token)
    await scenarioReceiptAllocation(ctx, log, token, accountId)
    await scenarioAllocationGuards(ctx, log, token, accountId)
    await scenarioIdempotency(ctx, log, token, accountId)
    await scenarioStatement(ctx, log, token, accountId)
    await scenarioSettlementSnapshot(ctx, log, token)
    await scenarioExpenseClaim(ctx, log, token, approverToken, accountId, Number(user?.id))
    await scenarioFinalConsistency(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[FINANCE] 未捕获异常：', e)
  process.exit(1)
})
