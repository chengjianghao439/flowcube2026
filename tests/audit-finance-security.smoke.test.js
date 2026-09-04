#!/usr/bin/env node
'use strict'

// F06–F10：真实 MySQL 服务回归。只允许显式指定的本机独立 test 库；不加载 .env。
const assert = require('node:assert/strict')
const { configureTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const bcrypt = require('../backend/node_modules/bcryptjs')
const ledger = require('../backend/src/modules/accounting/accounting.ledger.service')
const vouchers = require('../backend/src/modules/accounting/accounting.voucher.service')
const companies = require('../backend/src/modules/accounting/companies.service')
const users = require('../backend/src/modules/users/users.service')
const usersController = require('../backend/src/modules/users/users.controller')
const price = require('../backend/src/modules/price-change/price-change.service')
const ce = require('../backend/src/engine/containerEngine')
const { recomputePurchasePayable } = require('../backend/src/modules/inbound-tasks/inbound-tasks.settle')
const { voidReceipt } = require('../backend/src/modules/inbound-tasks/inbound-tasks.void')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')
const periodSvc = require('../backend/src/modules/accounting/accounting.period.service')
const engine = require('../backend/src/modules/accounting/voucher-engine')
const { exportVouchers } = require('../backend/src/modules/accounting/accounting.export')
const ExcelJS = require('../backend/node_modules/exceljs')

const prefix = `AF${Date.now().toString(36)}`
let seq = 0
const unique = () => `${prefix}${++seq}`
const ids = { companies: [], users: [], products: [], purchases: [], tasks: [], flows: [], requests: [], warehouses: [] }
const insert = async (sql, args = []) => Number((await pool.query(sql, args))[0].insertId)
const row = async (sql, args = []) => (await pool.query(sql, args))[0][0]
const purchaseNet = async (companyId, purchaseId) => Number((await row(
  `SELECT COALESCE(SUM(IF(e.direction=2,e.amount,-e.amount)),0) n
     FROM acct_vouchers v JOIN acct_voucher_entries e ON e.voucher_id=v.id
    WHERE v.company_id=? AND e.account_code='2202'
      AND v.source_no=(SELECT order_no FROM purchase_orders WHERE id=?)`, [companyId, purchaseId],
)).n)
async function exportedNet(companyId, period, format, accountCode, voucherNos = null) {
  const { buffer } = await exportVouchers({ period, companyId, format })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  let net = 0
  wb.worksheets[0].eachRow((r, n) => {
    if (n === 1) return
    if (format === 'generic') {
      if (r.getCell(4).value !== accountCode || (voucherNos && !voucherNos.has(r.getCell(2).value))) return
      net += Number(r.getCell(7).value || 0) - Number(r.getCell(6).value || 0)
    } else {
      if (r.getCell(6).value !== accountCode) return
      net += (r.getCell(9).value === '贷' ? 1 : -1) * Number(r.getCell(10).value || 0)
    }
  })
  return net
}
const counts = { passed: 0, failed: 0 }
async function check(name, fn) {
  try { await fn(); counts.passed++; console.log(`[PASS] ${name}`) }
  catch (error) { counts.failed++; console.error(`[FAIL] ${name}: ${error.message}`) }
}
const rejectsCode = (fn, code) => assert.rejects(fn, error => error.code === code)
async function company() {
  const c = await companies.createCompany({ code: unique(), name: '审计回归独立账套' })
  ids.companies.push(c.id)
  return c.id
}
async function user(roleId) {
  const id = await insert('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)',
    [unique(), await bcrypt.hash('Test-only-before-2026!', 4), '审计回归账号', roleId, '测试角色'])
  ids.users.push(id)
  return { userId: id, roleId, realName: '审计回归账号' }
}
async function manual(companyId, date, amount) {
  const accounts = (await pool.query("SELECT id,code FROM acct_accounts WHERE company_id=? AND code IN ('1001','2202')", [companyId]))[0]
  return vouchers.createManualVoucher({ companyId, voucherDate: date, summary: '已知金额回归', entries: [
    { accountId: accounts.find(a => a.code === '1001').id, direction: 1, amount },
    { accountId: accounts.find(a => a.code === '2202').id, direction: 2, amount },
  ] }, null)
}
async function product() {
  const id = await insert("INSERT INTO product_items (code,name,unit,cost_price,sale_price) VALUES (?,'审计回归商品','个',10,10)", [unique()])
  ids.products.push(id)
  return id
}
async function purchaseFixture(operator) {
  const productId = await product()
  const warehouseId = await insert("INSERT INTO inventory_warehouses (code,name) VALUES (?,'审计回归仓库')", [unique()])
  ids.warehouses.push(warehouseId)
  const poId = await insert(`INSERT INTO purchase_orders
    (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,operator_id,operator_name)
    VALUES (?,1,'审计供应商',?,'审计回归仓库',2,?,'审计')`, [unique(), warehouseId, operator.userId])
  ids.purchases.push(poId)
  const itemId = await insert(`INSERT INTO purchase_order_items
    (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount)
    VALUES (?,?,?,'审计回归商品','个',10,10,100)`, [poId, productId, unique()])
  const taskId = await insert(`INSERT INTO inbound_tasks
    (task_no,purchase_order_id,purchase_order_no,warehouse_id,warehouse_name,status,audit_status,submitted_at)
    VALUES (?,?,'审计',?,'审计回归仓库',4,1,NOW())`, [unique(), poId, warehouseId])
  ids.tasks.push(taskId)
  const inboundItemId = await insert(`INSERT INTO inbound_task_items
    (task_id,purchase_order_id,purchase_item_id,product_id,product_code,product_name,unit,ordered_qty,received_qty,putaway_qty)
    VALUES (?,?,?,?,?,'审计回归商品','个',10,10,10)`, [taskId, poId, itemId, productId, unique()])
  async function restore(qty = 10) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      // 夹具从已完成上架这一中间状态起步；建容器和应付均调用实际引擎。
      await conn.query('UPDATE inbound_tasks SET status=4,audit_status=1 WHERE id=?', [taskId])
      await conn.query('UPDATE inbound_task_items SET received_qty=?,putaway_qty=? WHERE id=?', [qty, qty, inboundItemId])
      const c = await ce.createContainer(conn, { productId, warehouseId, initialQty: qty, unit: '个',
        sourceType: ce.SOURCE_TYPE.INBOUND_TASK, sourceRefId: poId, sourceRefType: 'purchase_order',
        barcode: unique(), containerStatus: ce.CONTAINER_STATUS.PENDING_PUTAWAY })
      await conn.query('UPDATE inventory_containers SET inbound_task_id=?,inbound_task_item_id=? WHERE id=?', [taskId, inboundItemId, c.containerId])
      await ce.promotePendingContainerToActive(conn, c.containerId, productId, warehouseId)
      await recomputePurchasePayable(conn, poId)
      await conn.commit()
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  }
  await restore()
  return { poId, taskId, productId, restore }
}

async function main() {
  const admin = await user(1), operator = await user(2), normal = await user(3)
  const a = await company(), b = await company()
  await manual(a, '2099-08-31', 25)
  await manual(a, '2099-09-30', 100)
  await manual(a, '2099-10-01', 40)
  await manual(b, '2099-09-15', 999)
  await check('F06 试算精确区分期初、本期、期末及其他账套', async () => {
    const t = await ledger.getTrialBalance({ period: '209909', companyId: a })
    assert.equal(t.totals.openingDebit, 25)
    assert.equal(t.totals.periodDebit, 100)
    assert.equal(t.totals.closingDebit, 125)
    assert.equal(t.totals.closingCredit, 125)
    assert.equal((await ledger.getTrialBalance({ period: '209909', companyId: b })).totals.periodDebit, 999)
  })
  await check('F06 资产负债表取已知非零金额且不计未来/其他账套', async () => {
    const t = await ledger.getBalanceSheet({ period: '209909', companyId: a })
    assert.equal(t.assetTotal, 125); assert.equal(t.liabTotal, 125)
    assert.equal((await ledger.getBalanceSheet({ period: '209910', companyId: a })).assetTotal, 165)
    assert.equal((await ledger.getBalanceSheet({ period: '209909', companyId: b })).assetTotal, 999)
  })
  await check('F07 非超管不能重置超管密码，不能信任调用者陈旧 roleId', async () => {
    const before = await row('SELECT password,token_version FROM sys_users WHERE id=?', [admin.userId])
    await rejectsCode(() => users.resetPassword(admin.userId, 'Test-only-after-2026!', { ...operator, roleId: 1 }), 'USER_ADMIN_PROTECTED')
    assert.deepEqual(await row('SELECT password,token_version FROM sys_users WHERE id=?', [admin.userId]), before)
  })
  await check('F07 HTTP controller 将实际操作人传入重置服务', async () => {
    let err = null
    const req = { params: { id: String(admin.userId) }, body: { newPassword: 'Test-only-after-2026!' }, user: operator }
    const res = { status() { return this }, json() { return this } }
    await usersController.resetPassword(req, res, e => { err = e })
    assert.equal(err?.code, 'USER_ADMIN_PROTECTED')
  })
  await check('F07 非超管不能删除、禁用、降级现有超管', async () => {
    await rejectsCode(() => users.softDelete(admin.userId, operator), 'USER_ADMIN_PROTECTED')
    await rejectsCode(() => users.update(admin.userId, { realName: '审计', isActive: false }, operator), 'USER_ADMIN_PROTECTED')
    await rejectsCode(() => users.update(admin.userId, { realName: '审计', isActive: true, roleId: 3 }, operator), 'USER_ADMIN_PROTECTED')
  })
  await check('F07 正常管理员重置普通账号/超管自助重置与令牌失效保持可用', async () => {
    const old = await row('SELECT token_version FROM sys_users WHERE id=?', [normal.userId])
    await users.resetPassword(normal.userId, 'Test-only-after-2026!', operator)
    const changed = await row('SELECT password,token_version FROM sys_users WHERE id=?', [normal.userId])
    assert(await bcrypt.compare('Test-only-after-2026!', changed.password))
    assert.equal(Number(changed.token_version), Number(old.token_version || 0) + 1)
    // 前面红灯用例可能改动了账号，仅本夹具恢复其活跃状态。
    await pool.query('UPDATE sys_users SET deleted_at=NULL,is_active=1,role_id=1 WHERE id=?', [admin.userId])
    await users.resetPassword(admin.userId, 'Test-only-self-2026!', admin)
    await users.update(normal.userId, { realName: '正常编辑', roleId: 3, isActive: true }, operator)
  })
  await check('F07 并发晋升目标角色时重置等待角色事务后拒绝', async () => {
    const target = await user(3)
    const conn = await pool.getConnection()
    let reset
    try {
      await conn.beginTransaction()
      await conn.query('UPDATE sys_users SET role_id=1 WHERE id=?', [target.userId])
      reset = users.resetPassword(target.userId, 'Test-only-race-2026!', operator).then(() => null, e => e)
      // 两条真实连接：目标角色变更保持未提交，重置必须从锁等待后的当前读取角色。
      await new Promise(resolve => setTimeout(resolve, 100))
      await conn.commit()
      assert.equal((await reset)?.code, 'USER_ADMIN_PROTECTED')
    } finally { await conn.rollback(); conn.release(); if (reset) await reset }
  })
  await check('F09 红字与已冲销原凭证不能普通删除，普通手工凭证仍可删除', async () => {
    const c = await company(), v = await manual(c, '2099-09-01', 100)
    const reverse = await vouchers.reverseVoucher(v.id, admin.userId, c)
    await rejectsCode(() => vouchers.removeVoucher(reverse.id, admin.userId, c), 'ACCT_VOUCHER_REVERSAL_PROTECTED')
    await rejectsCode(() => vouchers.removeVoucher(v.id, admin.userId, c), 'ACCT_VOUCHER_REVERSAL_PROTECTED')
    // 历史状态异常也要依靠反向关联保护，不能只看 status=3。
    await pool.query('UPDATE acct_vouchers SET status=1 WHERE id=?', [v.id])
    await rejectsCode(() => vouchers.removeVoucher(v.id, admin.userId, c), 'ACCT_VOUCHER_REVERSAL_PROTECTED')
    await pool.query('UPDATE acct_vouchers SET status=3 WHERE id=?', [v.id])
    assert.equal((await ledger.getBalanceSheet({ period: '209909', companyId: c })).assetTotal, 0)
    const plain = await manual(c, '2099-09-02', 50)
    await vouchers.removeVoucher(plain.id, admin.userId, c)
    assert.equal(await row('SELECT id FROM acct_vouchers WHERE id=?', [plain.id]), undefined)
  })
  await check('F10 无匹配、停用、金额不匹配审批流给出业务错误且不改价', async () => {
    const pid = await product()
    const f = await insert("INSERT INTO approval_flows (biz_type,name,min_amount,is_active) VALUES ('product_price',?,100,0)", [unique()])
    ids.flows.push(f)
    for (const active of [0, 1]) {
      await pool.query('UPDATE approval_flows SET is_active=? WHERE id=?', [active, f])
      const request = await price.create({ productId: pid, priceType: 'sale', newPrice: 20 }, normal)
      ids.requests.push(request.id)
      await rejectsCode(() => price.submit(request.id, normal), 'PRICE_CHANGE_APPROVAL_FLOW_REQUIRED')
      const state = await row('SELECT status,approval_id FROM price_change_requests WHERE id=?', [request.id])
      assert.equal(state.status, 1); assert.equal(state.approval_id, null)
      assert.equal(Number((await row('SELECT sale_price FROM product_items WHERE id=?', [pid])).sale_price), 10)
    }
    await pool.query('UPDATE approval_flows SET min_amount=0,is_active=1 WHERE id=?', [f])
    await insert('INSERT INTO approval_flow_steps (flow_id,step_order,approver_type,user_id) VALUES (?,1,3,?)', [f, admin.userId])
    const request = await price.create({ productId: pid, priceType: 'sale', newPrice: 20 }, normal)
    ids.requests.push(request.id)
    assert((await price.submit(request.id, normal)).approvalId > 0)
  })
  await check('F09 通用/金蝶实际导出保留完整冲销对，已冲销金额净额为零', async () => {
    const c = await company(), original = await manual(c, '2099-09-01', 100)
    await vouchers.reverseVoucher(original.id, admin.userId, c)
    for (const format of ['generic', 'kingdee']) assert.equal(await exportedNet(c, '209909', format, '2202'), 0)
  })
  await check('F08 采购来源100→0→恢复→再次归零保留原分录、冲销链及幂等', async () => {
    const c = await company(), f = await purchaseFixture(admin)
    const period = beijingTodayYmd().replace(/-/g, '').slice(0, 6)
    const generate = () => vouchers.generatePeriodVouchers({ period, companyId: c, userId: admin.userId })
    const net = () => purchaseNet(c, f.poId)
    await generate()
    const root = await row("SELECT * FROM acct_vouchers WHERE company_id=? AND source_type='purchase_settle' AND source_id=?", [c, f.poId])
    const originals = (await pool.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=? ORDER BY id', [root.id]))[0]
    await pool.query('UPDATE acct_vouchers SET status=2 WHERE id=?', [root.id])
    assert.equal(await net(), 100)
    await voidReceipt(f.taskId, admin)
    assert.equal(Number((await row('SELECT total_amount FROM payment_records WHERE type=1 AND order_id=?', [f.poId])).total_amount), 0)
    await generate()
    assert.equal(await net(), 0)
    assert.deepEqual((await pool.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=? ORDER BY id', [root.id]))[0], originals)
    const before = Number((await row('SELECT COUNT(*) n FROM acct_vouchers WHERE company_id=?', [c])).n)
    await generate()
    assert.equal(Number((await row('SELECT COUNT(*) n FROM acct_vouchers WHERE company_id=?', [c])).n), before)
    await f.restore(6)
    await generate(); assert.equal(await net(), 60)
    await voidReceipt(f.taskId, admin)
    await generate(); assert.equal(await net(), 0)
    await f.restore(4)
    await generate(); assert.equal(await net(), 40)
    const current = await row('SELECT * FROM acct_vouchers WHERE company_id=? AND source_root_id=? AND is_reversal=0 ORDER BY id DESC LIMIT 1', [c, root.id])
    await vouchers.reverseVoucher(current.id, admin.userId, c)
    await generate(); assert.equal(await net(), 0, '人工冲销后不得自动恢复')
    await rejectsCode(() => vouchers.removeVoucher(current.id, admin.userId, c), 'ACCT_VOUCHER_NOT_MANUAL')
    await voidReceipt(f.taskId, admin)
    await generate(); assert.equal(await net(), 0)
  })
  await check('F08 已结账来源归零保留锁定账面，反结账后才反冲', async () => {
    const c = await company(), f = await purchaseFixture(admin)
    const period = beijingTodayYmd().replace(/-/g, '').slice(0, 6)
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    await pool.query('INSERT INTO acct_periods (company_id,period,status) VALUES (?,?,2)', [c, period])
    await voidReceipt(f.taskId, admin)
    await rejectsCode(() => vouchers.generatePeriodVouchers({ period, companyId: c }), 'ACCT_PERIOD_CLOSED')
    assert((await vouchers.generatePeriodVouchers({ companyId: c })).skippedClosed > 0)
    await pool.query('UPDATE acct_periods SET status=1 WHERE company_id=? AND period=?', [c, period])
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    assert.equal(await purchaseNet(c, f.poId), 0)
  })
  await check('F08 已过账非零来源变化追加两个版本，原分录与头金额保持不变', async () => {
    const c = await company(), f = await purchaseFixture(admin)
    const period = beijingTodayYmd().replace(/-/g, '').slice(0, 6)
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    const original = await row("SELECT id FROM acct_vouchers WHERE company_id=? AND source_type='purchase_settle' AND source_id=?", [c, f.poId])
    await pool.query('UPDATE acct_vouchers SET status=2 WHERE id=?', [original.id])
    const entries = (await pool.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=? ORDER BY id', [original.id]))[0]
    await pool.query('UPDATE purchase_order_items SET unit_price=12,amount=120 WHERE order_id=?', [f.poId])
    const conn = await pool.getConnection()
    try { await conn.beginTransaction(); await recomputePurchasePayable(conn, f.poId); await conn.commit() }
    catch (e) { await conn.rollback(); throw e } finally { conn.release() }
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    assert.equal(await purchaseNet(c, f.poId), 120)
    assert.equal(Number((await row('SELECT total_credit FROM acct_vouchers WHERE id=?', [original.id])).total_credit), 100)
    assert.deepEqual((await pool.query('SELECT * FROM acct_voucher_entries WHERE voucher_id=? ORDER BY id', [original.id]))[0], entries)
    assert.equal(Number((await row('SELECT COUNT(*) n FROM acct_vouchers WHERE source_root_id=?', [original.id])).n), 2)
    const nos = new Set((await pool.query('SELECT voucher_no FROM acct_vouchers WHERE id=? OR source_root_id=?', [original.id, original.id]))[0].map(v => v.voucher_no))
    assert.equal(await exportedNet(c, period, 'generic', '2202', nos), 120)
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    assert.equal(Number((await row('SELECT COUNT(*) n FROM acct_vouchers WHERE source_root_id=?', [original.id])).n), 2)
    await voidReceipt(f.taskId, admin)
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    assert.equal(await purchaseNet(c, f.poId), 0)
  })
  await check('F08 来源消失也反冲；来源恢复不覆盖原始凭证', async () => {
    const c = await company(), f = await purchaseFixture(admin)
    const period = beijingTodayYmd().replace(/-/g, '').slice(0, 6)
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    const original = await row("SELECT * FROM acct_vouchers WHERE company_id=? AND source_type='purchase_settle' AND source_id=?", [c, f.poId])
    await pool.query('DELETE FROM payment_records WHERE type=1 AND order_id=?', [f.poId])
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    assert.equal(await purchaseNet(c, f.poId), 0)
    const conn = await pool.getConnection()
    try { await conn.beginTransaction(); await recomputePurchasePayable(conn, f.poId); await conn.commit() }
    catch (e) { await conn.rollback(); throw e } finally { conn.release() }
    await vouchers.generatePeriodVouchers({ period, companyId: c })
    assert.equal(await purchaseNet(c, f.poId), 100)
    assert.equal(Number((await row('SELECT total_credit FROM acct_vouchers WHERE id=?', [original.id])).total_credit), 100)
    await voidReceipt(f.taskId, admin)
  })
  await check('F08 生成等待并发结账事务，结账提交后拒绝写凭证', async () => {
    const c = await company()
    await pool.query("INSERT INTO acct_periods (company_id,period,status) VALUES (?,'209909',1)", [c])
    const conn = await pool.getConnection()
    let generating
    try {
      await conn.beginTransaction()
      await periodSvc.assertPeriodOpen(conn, '209909', c)
      await conn.query("UPDATE acct_periods SET status=2 WHERE company_id=? AND period='209909'", [c])
      generating = manual(c, '2099-09-01', 100).then(() => null, e => e)
      await new Promise(resolve => setTimeout(resolve, 100))
      await conn.commit()
      assert.equal((await generating)?.code, 'ACCT_PERIOD_CLOSED')
      assert.equal(Number((await row('SELECT COUNT(*) n FROM acct_vouchers WHERE company_id=?', [c])).n), 0)
    } finally { await conn.rollback(); conn.release(); if (generating) await generating }
  })
  await check('F08 直接凭证引擎调用同样拒绝已结账期间，覆盖工资/固定资产消费者', async () => {
    const c = await company()
    await pool.query("INSERT INTO acct_periods (company_id,period,status) VALUES (?,'209909',2)", [c])
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const accounts = await engine.loadAccountMap(conn, c)
      const allocator = await engine.makeSeqAllocator(conn, c)
      await rejectsCode(() => engine.upsertVoucher(conn, {
        sourceType: 'expense_pay', sourceId: 987654321, voucherDate: '2099-09-01',
        legs: [{ code: '6602', direction: 1, amount: 100 }, { code: '1001', direction: 2, amount: 100 }],
      }, accounts, allocator, admin.userId, c), 'ACCT_PERIOD_CLOSED')
    } finally { await conn.rollback(); conn.release() }
  })
  await check('F08 旧事务快照后并发生成凭证，号段读取最新已提交序列', async () => {
    const c = await company()
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const accounts = await engine.loadAccountMap(conn, c) // 故意先建立 REPEATABLE READ 快照。
      const allocator = await engine.makeSeqAllocator(conn, c)
      await manual(c, '2099-09-01', 100)
      const next = await engine.upsertVoucher(conn, {
        sourceType: 'expense_pay', sourceId: 987654321, voucherDate: '2099-09-01',
        legs: [{ code: '6602', direction: 1, amount: 20 }, { code: '1001', direction: 2, amount: 20 }],
      }, accounts, allocator, admin.userId, c)
      assert.equal(next.created, true)
      const [[created]] = await conn.query('SELECT voucher_no FROM acct_vouchers WHERE id=?', [next.id])
      assert.equal(created.voucher_no, '记-209909-0002')
    } finally { await conn.rollback(); conn.release() }
  })
}

async function cleanup() {
  for (const c of ids.companies) {
    await pool.query('DELETE FROM acct_voucher_entries WHERE voucher_id IN (SELECT id FROM acct_vouchers WHERE company_id=?)', [c])
    await pool.query('DELETE FROM acct_vouchers WHERE company_id=?', [c])
    await pool.query('DELETE FROM acct_periods WHERE company_id=?', [c])
    await pool.query('DELETE FROM acct_accounts WHERE company_id=?', [c])
    await pool.query('DELETE FROM acct_companies WHERE id=?', [c])
  }
  for (const id of ids.requests) {
    await pool.query("DELETE FROM approval_instance_task_approvers WHERE instance_id IN (SELECT id FROM approval_instances WHERE biz_type='product_price' AND biz_id=?)", [id])
    await pool.query("DELETE FROM approval_instance_tasks WHERE instance_id IN (SELECT id FROM approval_instances WHERE biz_type='product_price' AND biz_id=?)", [id])
    await pool.query("DELETE FROM approval_instances WHERE biz_type='product_price' AND biz_id=?", [id])
    await pool.query('DELETE FROM price_change_requests WHERE id=?', [id])
  }
  for (const id of ids.flows) { await pool.query('DELETE FROM approval_flow_steps WHERE flow_id=?', [id]); await pool.query('DELETE FROM approval_flows WHERE id=?', [id]) }
  for (const id of ids.tasks) {
    await pool.query('DELETE FROM inbound_task_events WHERE task_id=?', [id])
    await pool.query('DELETE FROM inbound_task_items WHERE task_id=?', [id])
    await pool.query('DELETE FROM inbound_tasks WHERE id=?', [id])
  }
  for (const id of ids.purchases) {
    await pool.query('DELETE FROM payment_records WHERE type=1 AND order_id=?', [id])
    await pool.query('DELETE FROM purchase_order_items WHERE order_id=?', [id])
    await pool.query('DELETE FROM purchase_orders WHERE id=?', [id])
  }
  for (const id of ids.products) {
    await pool.query('DELETE FROM inventory_containers WHERE product_id=?', [id])
    await pool.query('DELETE FROM inventory_logs WHERE product_id=?', [id])
    await pool.query('DELETE FROM inventory_stock WHERE product_id=?', [id])
    await pool.query('DELETE FROM product_items WHERE id=?', [id])
  }
  for (const id of ids.warehouses) await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [id])
  for (const id of ids.users) await pool.query('DELETE FROM sys_users WHERE id=?', [id])
}

main().catch(e => { counts.failed++; console.error(e) }).finally(async () => {
  try { await cleanup() } catch (e) { counts.failed++; console.error('夹具清理失败:', e.message) }
  await pool.end()
  console.log(`${counts.passed} passed / ${counts.failed} failed`)
  process.exit(counts.failed ? 1 : 0)
})
