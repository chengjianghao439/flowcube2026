'use strict'
// 合成权限夹具：仅证明 HTTP/SQL 授权，不代表库存、资金、PDA真机或物理打包流程验收。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
const { pool } = require('../backend/src/config/db')
const app = require('../backend/src/app')
const bcrypt = require('../backend/node_modules/bcryptjs')
const { PERMISSIONS: P } = require('../backend/src/constants/permissions')
const { hashToken, DEFAULT_PDA_SCOPES } = require('../backend/src/modules/pda/pda.sessions.service')
const { getReconciliationExportPayload } = require('../backend/src/modules/export/export.service')

test('security scope uses real HTTP authentication and real scoped SQL with owned synthetic records', { timeout: 60000 }, async () => {
  validateTestEnvironment()
  const [[db]] = await pool.query('SELECT DATABASE() AS db')
  assert.equal(db.db, process.env.DB_NAME)
  const ref = 'SS' + crypto.randomBytes(5).toString('hex')
  const owned = { users: [], roles: [], devices: [], warehouses: [], companies: [] }
  let server
  async function insert(sql, params) { const [r] = await pool.query(sql, params); return Number(r.insertId) }
  try {
    const a = await insert('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [ref+'A', ref+'仓A'])
    const b = await insert('INSERT INTO inventory_warehouses (code,name) VALUES (?,?)', [ref+'B', ref+'仓B'])
    owned.warehouses.push(a, b)
    const password = crypto.randomBytes(20).toString('hex')
    const passwordHash = await bcrypt.hash(password, 4)
    async function user(suffix, permissions, warehouseIds) {
      const roleId = await insert('INSERT INTO sys_roles (code,name) VALUES (?,?)', [ref+suffix, ref+suffix]); owned.roles.push(roleId)
      await pool.query('INSERT INTO sys_role_permissions (role_id,permission) VALUES ?', [permissions.map(p => [roleId, p])])
      const id = await insert('INSERT INTO sys_users (username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)', [ref+suffix, passwordHash, ref+suffix, roleId, ref+suffix]); owned.users.push(id)
      await pool.query('INSERT INTO user_warehouse_scope (user_id,warehouse_id) VALUES ?', [warehouseIds.map(w => [id, w])])
      return { id, username: ref+suffix }
    }
    const perms = [P.DASHBOARD_VIEW, P.PRODUCT_VIEW, P.SALE_ORDER_VIEW, P.PURCHASE_ORDER_VIEW, P.RETURN_ORDER_VIEW, P.RETURN_ORDER_EXECUTE, P.WAREHOUSE_TASK_VIEW, P.WAREHOUSE_TASK_PACK, P.STOCKCHECK_VIEW, P.STOCKCHECK_UPDATE, P.FINANCE_EXPENSE_VIEW, P.APPROVAL_TASK_VIEW, P.INVOICE_VIEW, P.REPORT_VIEW]
    const scoped = await user('S', perms, [a])
    const multi = await user('M', perms, [a,b])
    const dashboard = await user('D', [P.DASHBOARD_VIEW], [a])
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
    const base = `http://127.0.0.1:${server.address().port}`
    async function req(method, url, u, body, pda, extra = {}) {
      const response = await fetch(base+url, { method, headers: { 'Content-Type': 'application/json', ...(u?.token ? { Authorization: `Bearer ${u.token}` } : {}), ...(pda ? { 'X-Client': 'pda', 'X-PDA-Session': pda } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
      return { status: response.status, body: await response.json() }
    }
    for (const u of [scoped,multi,dashboard]) {
      const login = await req('POST', '/api/auth/login', null, { username: u.username, password })
      assert.equal(login.status, 200); assert.ok(login.body.data.token); u.token = login.body.data.token
    }
    async function device(u, warehouseId, suffix) {
      const token = crypto.randomBytes(32).toString('hex')
      const id = await insert('INSERT INTO pda_devices (device_code,secret_hash,warehouse_id,status) VALUES (?,?,?,?)', [ref+suffix, passwordHash, warehouseId, 'active']); owned.devices.push(id)
      await pool.query('INSERT INTO pda_device_sessions (device_id,user_id,session_token_hash,scopes,warehouse_id,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 1 HOUR))', [id,u.id,hashToken(token),JSON.stringify(DEFAULT_PDA_SCOPES),warehouseId])
      return token
    }
    const scopedA = await device(scoped,a,'SA'), scopedB = await device(scoped,b,'SB'), unbound = await device(scoped,null,'SU'), multiA = await device(multi,a,'MA')
    const product = await insert("INSERT INTO product_items (code,name,unit) VALUES (?,?,'个')", [ref,ref+'商品'])
    const customer = await insert('INSERT INTO sale_customers (code,name) VALUES (?,?)', [ref,ref+'客户'])
    const supplier = await insert('INSERT INTO supply_suppliers (code,name) VALUES (?,?)', [ref,ref+'供应商'])
    async function sale(warehouseId,suffix) {
      return insert('INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES (?,?,?,?,?,?,?)', [ref+suffix,customer,ref,warehouseId,ref,scoped.id,ref])
    }
    const saleA = await sale(a,'SA'), saleB = await sale(b,'SB')
    const purchaseA = await insert('INSERT INTO purchase_orders (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES (?,?,?,?,?,?,?)', [ref+'PA',supplier,ref,a,ref,scoped.id,ref])
    const purchaseB = await insert('INSERT INTO purchase_orders (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES (?,?,?,?,?,?,?)', [ref+'PB',supplier,ref,b,ref,scoped.id,ref])
    async function task(warehouseId,suffix) { return insert('INSERT INTO warehouse_tasks (task_no,customer_name,warehouse_id,warehouse_name,status) VALUES (?,?,?,?,5)', [ref+suffix,ref,warehouseId,ref]) }
    const taskA = await task(a,'TA'), taskB = await task(b,'TB')
    await pool.query('INSERT INTO packages (barcode,warehouse_task_id) VALUES (?,?),(?,?)', [ref+'LA',taskA,ref+'LB',taskB])
    assert.equal((await req('GET', `/api/packages?taskId=${taskA}`, scoped)).status, 200)
    assert.equal((await req('GET', `/api/packages?taskId=${taskB}`, scoped)).status, 403)
    assert.equal((await req('GET', `/api/packages/barcode/${ref}LB`, scoped)).status, 403)
    assert.equal((await req('POST', '/api/packages', multi, { warehouseTaskId: taskB }, multiA)).status, 403)
    const returnB = await insert('INSERT INTO return_tasks (task_no,return_type,return_id,return_no,warehouse_id,status,submitted_at) VALUES (?,?,?,?,?,3,NOW())', [ref+'RT','sale',0,ref,b])
    assert.equal((await req('GET', '/api/return-tasks/pda', scoped, undefined, scopedB)).status, 403)
    assert.equal((await req('GET', '/api/return-tasks/pda', scoped, undefined, unbound)).status, 403)
    assert.equal((await req('POST', `/api/return-tasks/${returnB}/receive`, scoped, { productId: product, packages: [{ qty: 1 }] }, scopedB)).status, 403)
    assert.equal((await req('POST', `/api/return-tasks/${returnB}/check`, scoped, { productId: product, passedQty: 1 }, scopedB)).status, 403)
    const checkB = await insert('INSERT INTO inventory_checks (check_no,warehouse_id,warehouse_name,operator_id,operator_name) VALUES (?,?,?,?,?)', [ref+'IC',b,ref,scoped.id,ref])
    assert.equal((await req('POST', `/api/stockcheck/${checkB}/items/1/scan`, multi, { scans: [] }, multiA, { 'X-Request-Key': ref+'scan' })).status, 403)
    const ownExpense = await insert('INSERT INTO expense_claims (claim_no,applicant_id,applicant_name,title) VALUES (?,?,?,?)', [ref+'E1',scoped.id,ref,ref])
    const otherExpense = await insert('INSERT INTO expense_claims (claim_no,applicant_id,applicant_name,title) VALUES (?,?,?,?)', [ref+'E2',multi.id,ref,ref])
    assert.equal((await req('GET', `/api/approvals/biz/expense_claim/${ownExpense}`, scoped)).status, 200)
    assert.equal((await req('GET', `/api/approvals/biz/expense_claim/${otherExpense}`, scoped)).status, 403)
    for (const suffix of ['C1','C2']) owned.companies.push(await insert('INSERT INTO acct_companies (code,name) VALUES (?,?)', [ref+suffix,ref+suffix]))
    const invoices = []
    for (let i=0;i<2;i++) invoices.push(await insert('INSERT INTO fin_invoices (invoice_type,invoice_no,party_name,invoice_date,company_id) VALUES (2,?,?,CURDATE(),?)', [ref+'I'+i,ref,owned.companies[i]]))
    const searchDash = await req('GET', `/api/search?q=${ref}`, dashboard)
    assert.equal(searchDash.status, 200); assert.equal(searchDash.body.data.length, 0)
    const searchExpense = await req('GET', `/api/search?q=${ref}&type=expense`, scoped)
    assert.deepEqual(searchExpense.body.data.map(r=>r.id), [ownExpense])
    const searchInvoice = await req('GET', `/api/search?q=${ref}&type=invoice`, scoped, undefined, undefined, { 'X-Company-Id': String(owned.companies[0]) })
    assert.deepEqual(searchInvoice.body.data.map(r=>r.id), [invoices[0]])
    const searchSale = await req('GET', `/api/search?q=${ref}&type=sale`, scoped)
    assert.deepEqual(searchSale.body.data.map(r=>r.id), [saleA])
    const payments = []
    for (const [type,orderId,suffix,amount] of [[1,purchaseA,'PA',10],[1,purchaseB,'PB',20],[2,saleA,'SA',30],[2,saleB,'SB',40],[2,null,'MAN',50]]) {
      payments.push(await insert('INSERT INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,settlement_type) VALUES (?,?,?,?,?,?,2)', [type,orderId,ref+suffix,ref,amount,amount]))
    }
    for (const [type,id,amount] of [[1,payments[0],10],[2,payments[2],30]]) {
      const report = await req('GET', `/api/reports/reconciliation?type=${type}&keyword=${ref}`, scoped)
      assert.equal(report.status, 200)
      assert.deepEqual(report.body.data.list.map(r=>r.id),[id]); assert.equal(report.body.data.pagination.total,1); assert.equal(report.body.data.summary.totalAmount,amount)
      const exported = await getReconciliationExportPayload({ type, keyword: ref, scopeWarehouseIds: [a] })
      assert.equal(exported.rows.length,1); assert.equal(exported.rows[0].totalAmount,amount)
    }
    const empty = await getReconciliationExportPayload({ type: 2, keyword: ref, scopeWarehouseIds: [] })
    assert.equal(empty.rows.length,0)
    // 拒绝的PDA写没有创造包裹、盘点扫码或退货容器。
    const [[counts]] = await pool.query('SELECT (SELECT COUNT(*) FROM packages WHERE warehouse_task_id=?) AS packages, (SELECT COUNT(*) FROM inventory_containers WHERE source_ref_type=? AND source_ref_id=?) AS containers', [taskB,'sale_return',returnB])
    assert.equal(Number(counts.packages),1); assert.equal(Number(counts.containers),0)
  } finally {
    if (server) await new Promise((resolve,reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections() })
    // 精确自有资源收尾；交易/授权夹具保留作审计，不清理共享表。
    try {
      if (owned.devices.length) { await pool.query('DELETE FROM pda_device_sessions WHERE device_id IN (?)', [owned.devices]); await pool.query("UPDATE pda_devices SET status='disabled' WHERE id IN (?)", [owned.devices]) }
      if (owned.users.length) await pool.query('UPDATE sys_users SET is_active=0 WHERE id IN (?)', [owned.users])
      if (owned.roles.length) await pool.query('DELETE FROM sys_role_permissions WHERE role_id IN (?)', [owned.roles])
    } finally { await pool.end() }
  }
})
