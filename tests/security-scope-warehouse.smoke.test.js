'use strict'
// 合成权限与塑料盒夹具：证明 HTTP/SQL 授权及本段库存守恒，不代表完整库存/资金或PDA真机验收。
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
    const perms = [P.DASHBOARD_VIEW, P.PRODUCT_VIEW, P.INVENTORY_CONTAINER_SPLIT, P.SALE_ORDER_VIEW, P.PURCHASE_ORDER_VIEW, P.RETURN_ORDER_VIEW, P.RETURN_ORDER_EXECUTE, P.WAREHOUSE_TASK_VIEW, P.WAREHOUSE_TASK_PACK, P.STOCKCHECK_VIEW, P.STOCKCHECK_UPDATE, P.FINANCE_EXPENSE_VIEW, P.APPROVAL_TASK_VIEW, P.INVOICE_VIEW, P.REPORT_VIEW]
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

    // 塑料盒新增作业的真实 HTTP/SQL 闭环：只使用本轮独占商品/仓/容器，不复用历史库名。
    const boxResponse = await req('POST', '/api/plastic-boxes', scoped, { productId: product, warehouseId: a })
    assert.equal(boxResponse.status, 201, JSON.stringify(boxResponse.body))
    const boxId = Number(boxResponse.body.data.id)
    assert.ok(boxId > 0)
    const sourceId = await insert(
      'INSERT INTO inventory_containers (barcode,container_type,product_id,warehouse_id,initial_qty,remaining_qty,status,unit) VALUES (?,1,?,?,10,10,1,?)',
      ['I'+ref,product,a,'个'],
    )
    // 夹具也走唯一合法库存缓存入口；不直接 UPDATE inventory_stock.quantity。
    const { lockStockDimension, syncStockFromContainers } = require('../backend/src/engine/containerEngine')
    const seed = await pool.getConnection()
    try {
      await seed.beginTransaction(); await lockStockDimension(seed, product, a)
      await syncStockFromContainers(seed, product, a); await seed.commit()
    } catch (error) { await seed.rollback(); throw error } finally { seed.release() }
    async function plasticFacts() {
      const [containers] = await pool.query('SELECT id,remaining_qty,status FROM inventory_containers WHERE product_id=? ORDER BY id', [product])
      const [[stock]] = await pool.query('SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?', [product,a])
      const [[logs]] = await pool.query('SELECT COUNT(*) AS total FROM inventory_logs WHERE product_id=?', [product])
      const [[prints]] = await pool.query('SELECT COUNT(*) AS total FROM print_jobs WHERE created_by=?', [scoped.id])
      const [[receipts]] = await pool.query('SELECT COUNT(*) AS total FROM operation_requests WHERE user_id=? AND action IN (?,?)', [scoped.id,`plastic_box.fill.${boxId}`,`plastic_box.repack.${boxId}`])
      return { containers, stock, logs, prints, receipts }
    }
    async function plasticDenied(path, body, pda, requestKey, code) {
      const before = await plasticFacts()
      const response = await req('POST', path, scoped, body, pda, { 'X-Request-Key': requestKey })
      assert.equal(response.status, 403, JSON.stringify(response.body))
      if (code) assert.equal(response.body.code, code)
      assert.deepEqual(await plasticFacts(), before, '拒绝不得改变库存/流水/打印或幂等回执')
    }
    async function plasticStatus(requestKey, action, pda, extra = {}) {
      return req('GET', `/api/system/request-status/${encodeURIComponent(requestKey)}?action=${encodeURIComponent(action)}`, scoped, undefined, pda, extra)
    }
    async function plasticStatusDenied(requestKey, action, pda, code, extra = {}) {
      const before = await plasticFacts()
      const response = await plasticStatus(requestKey, action, pda, extra)
      assert.equal(response.status,403,JSON.stringify(response.body)); assert.equal(response.body.code,code)
      assert.deepEqual(await plasticFacts(),before,'本人回执GET不得改业务事实或补打')
    }
    const fillPath = `/api/plastic-boxes/${boxId}/fill`, fillBody = { sourceContainerId: sourceId, expectedSourceQty: 10 }, fillKey = ref+'fill'
    await plasticDenied(fillPath, fillBody, unbound, fillKey, 'PDA_WAREHOUSE_REQUIRED')
    await plasticDenied(fillPath, fillBody, scopedB, fillKey, 'PDA_WAREHOUSE_MISMATCH')
    const fill = await req('POST', fillPath, scoped, fillBody, scopedA, { 'X-Request-Key': fillKey })
    assert.equal(fill.status, 200, JSON.stringify(fill.body))
    const filledFacts = await plasticFacts()
    assert.equal(Number(filledFacts.containers.find(row => row.id === sourceId).remaining_qty), 0)
    assert.equal(Number(filledFacts.containers.find(row => row.id === boxId).remaining_qty), 10)
    assert.equal(Number(filledFacts.stock.quantity), 10)
    const fillReplay = await req('POST', fillPath, scoped, fillBody, scopedA, { 'X-Request-Key': fillKey })
    assert.equal(fillReplay.status, 200); assert.deepEqual(fillReplay.body.data, fill.body.data)
    assert.deepEqual(await plasticFacts(), filledFacts)
    await plasticDenied(fillPath, fillBody, unbound, fillKey, 'PDA_WAREHOUSE_REQUIRED')
    await plasticDenied(fillPath, fillBody, scopedB, fillKey, 'PDA_WAREHOUSE_MISMATCH')
    const repackPath = `/api/plastic-boxes/${boxId}/repack`, repackBody = { items: [2,3] }, repackKey = ref+'repack'
    await plasticDenied(repackPath, repackBody, unbound, repackKey, 'PDA_WAREHOUSE_REQUIRED')
    await plasticDenied(repackPath, repackBody, scopedB, repackKey, 'PDA_WAREHOUSE_MISMATCH')
    const repack = await req('POST', repackPath, scoped, repackBody, scopedA, { 'X-Request-Key': repackKey })
    assert.equal(repack.status, 200, JSON.stringify(repack.body)); assert.equal(repack.body.data.created.length,2)
    assert.equal(Number(repack.body.data.boxRemainingAfter),5)
    const repackedFacts = await plasticFacts()
    assert.equal(Number(repackedFacts.containers.find(row => row.id === boxId).remaining_qty),5)
    assert.equal(Number(repackedFacts.stock.quantity),10)
    assert.equal(repackedFacts.containers.filter(row => ![sourceId,boxId].includes(row.id)).length,2)
    const repackReplay = await req('POST', repackPath, scoped, repackBody, scopedA, { 'X-Request-Key': repackKey })
    assert.equal(repackReplay.status,200); assert.deepEqual(repackReplay.body.data,repack.body.data)
    assert.deepEqual(await plasticFacts(),repackedFacts)
    await plasticDenied(repackPath,repackBody,unbound,repackKey,'PDA_WAREHOUSE_REQUIRED')
    await plasticDenied(repackPath,repackBody,scopedB,repackKey,'PDA_WAREHOUSE_MISMATCH')
    // 查询保留本人auth-only；撤执行权不妨碍核对，已知领域仍核票据与原流水仓。
    await pool.query('DELETE FROM sys_role_permissions WHERE role_id=(SELECT role_id FROM sys_users WHERE id=?) AND permission=?', [scoped.id,P.INVENTORY_CONTAINER_SPLIT])
    for (const [kind,key,result] of [['fill',fillKey,fill.body.data],['repack',repackKey,repack.body.data]]) {
      for (const action of [`plastic_box.${kind}.${boxId}`,`plastic_box.${kind}`,'plastic_box']) {
        const before = await plasticFacts()
        for (const pda of [undefined,scopedA]) {
          const status = await plasticStatus(key,action,pda)
          assert.equal(status.status,200,JSON.stringify(status.body)); assert.equal(status.body.data.status,'success')
          assert.deepEqual(status.body.data.data,result)
        }
        assert.deepEqual(await plasticFacts(),before)
        await plasticStatusDenied(key,action,undefined,'PDA_SESSION_REQUIRED',{'X-Client':'pda'})
        await plasticStatusDenied(key,action,unbound,'PDA_WAREHOUSE_REQUIRED')
        await plasticStatusDenied(key,action,scopedB,'PDA_WAREHOUSE_MISMATCH')
      }
    }
    await pool.query('INSERT INTO sys_role_permissions (role_id,permission) SELECT role_id,? FROM sys_users WHERE id=?', [P.INVENTORY_CONTAINER_SPLIT,scoped.id])
    await pool.query('UPDATE user_warehouse_scope SET warehouse_id=? WHERE user_id=? AND warehouse_id=?', [b,scoped.id,a])
    await plasticDenied(fillPath,fillBody,scopedA,fillKey,'WAREHOUSE_SCOPE_DENIED')
    await plasticDenied(repackPath,repackBody,scopedA,repackKey,'WAREHOUSE_SCOPE_DENIED')
    for (const [kind,key] of [['fill',fillKey],['repack',repackKey]]) {
      for (const action of [`plastic_box.${kind}.${boxId}`,'plastic_box']) {
        await plasticStatusDenied(key,action,undefined,'WAREHOUSE_SCOPE_DENIED')
        await plasticStatusDenied(key,action,scopedA,'WAREHOUSE_SCOPE_DENIED')
      }
    }
    await pool.query('UPDATE user_warehouse_scope SET warehouse_id=? WHERE user_id=? AND warehouse_id=?', [a,scoped.id,b])
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
