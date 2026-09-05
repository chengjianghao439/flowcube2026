'use strict'

const assert = require('node:assert/strict')
const { prepareSmokeContext, login, createLogger, PERMISSIONS } = require('./helpers/smokeTestKit')
const log = createLogger()

async function main() {
  const ctx = await prepareSmokeContext()
  const q = ctx.pool.query.bind(ctx.pool)
  const suffix = `${Date.now()}`
  const exports = require('../backend/src/modules/export/export.service')
  const [[user]] = await q("SELECT id,role_id FROM sys_users WHERE username='smoke_limited'")
  for (const permission of [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_CONTAINER_SPLIT, PERMISSIONS.PURCHASE_ORDER_VIEW]) {
    await q('INSERT IGNORE INTO sys_role_permissions(role_id,permission) VALUES(?,?)', [user.role_id, permission])
  }
  await q('DELETE FROM user_warehouse_scope WHERE user_id=?', [user.id])
  await q('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES(?,?)', [user.id, ctx.warehouse.id])
  require('../backend/src/utils/warehouseScope').clearScopeCache(user.id)
  const limited = await login(ctx.http, 'smoke_limited', 'SmokeLimited123!')
  const admin = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
  const [wh] = await q('INSERT INTO inventory_warehouses(code,name) VALUES(?,?)', [`FIX-W-${suffix}`, '修复范围外仓'])
  const box = { productId: ctx.product.id, warehouseId: wh.insertId }
  const badCreate = await ctx.http.post('/api/plastic-boxes', { token: limited.token, json: box })
  log.assert('塑料盒创建拒绝范围外仓库', badCreate.status === 403, badCreate.status)
  const created = await ctx.http.post('/api/plastic-boxes', { token: admin.token, json: box })
  assert.equal(created.status, 201)
  const id = created.data.data.id
  for (const tail of ['', '/movements']) {
    const r = await ctx.http.get(`/api/plastic-boxes/${id}${tail}`, { token: limited.token })
    log.assert(`塑料盒${tail || '详情'}拒绝范围外仓库`, r.status === 403, r.status)
  }
  const list = await ctx.http.get('/api/plastic-boxes', { token: limited.token })
  log.assert('塑料盒列表不含外仓', !list.data.data.list.some(b => b.id === id))
  const removed = await ctx.http.delete(`/api/plastic-boxes/${id}`, { token: limited.token })
  log.assert('塑料盒删除拒绝外仓', removed.status === 403, removed.status)
  const badLocation = await ctx.http.post('/api/plastic-boxes', { token: admin.token, json: { ...box, locationId: ctx.location.id } })
  log.assert('拒绝不属于目标仓库的库位', badLocation.status === 400, badLocation.status)
  const invalidProduct = await ctx.http.post('/api/plastic-boxes', { token: admin.token, json: { ...box, productId: 99999999 } })
  log.assert('拒绝不存在的商品', invalidProduct.status === 400, invalidProduct.status)
  await q('INSERT INTO purchase_orders(order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,status,total_amount,operator_id,operator_name) VALUES(?,?,?,?,?,2,100,?,?)', [`FIX-PO-${suffix}`, ctx.supplier.id, ctx.supplier.name, wh.insertId, '外仓', user.id, '测试'])
  const portal = await ctx.http.get(`/api/portal/purchase-status?supplierId=${ctx.supplier.id}`, { token: limited.token })
  log.assert('门户采购不含外仓订单', !portal.data.data.list.some(o => o.orderNo === `FIX-PO-${suffix}`))

  const [customer] = await q('INSERT INTO sale_customers(code,name) VALUES(?,?)', [`FIX-C-${suffix}`, `甲${suffix}`])
  const [other] = await q('INSERT INTO sale_customers(code,name) VALUES(?,?)', [`FIX-C2-${suffix}`, `甲${suffix}乙`])
  const statementIds = []
  for (const [customerId, name] of [[customer.insertId, `甲${suffix}`], [other.insertId, `甲${suffix}乙`]]) {
    const [order] = await q('INSERT INTO sale_orders(order_no,customer_id,customer_name,warehouse_id,warehouse_name,operator_id,operator_name) VALUES(?,?,?,?,?,?,?)', [`FIX-SO-${customerId}`, customerId, name, ctx.warehouse.id, ctx.warehouse.name, user.id, '测试'])
    const [record] = await q('INSERT INTO payment_records(type,order_id,order_no,party_name,total_amount,balance) VALUES(2,?,?,?,100,100)', [order.insertId, `FIX-SO-${customerId}`, name])
    const [statement] = await q('INSERT INTO reconciliation_statements(statement_no,type,party_name) VALUES(?,2,?)', [`FIX-ST-${customerId}`, name])
    await q('INSERT INTO reconciliation_statement_items(statement_id,record_id,order_no,total_amount) VALUES(?,?,?,100)', [statement.insertId, record.insertId, `FIX-SO-${customerId}`])
    statementIds.push(statement.insertId)
  }
  const statements = require('../backend/src/modules/portal/portal.service')
  let selected = await statements.listStatements({ customerId: customer.insertId })
  log.assert('门户按客户身份准确筛选', selected.list.length === 1 && selected.list[0].id === statementIds[0])
  await q('UPDATE sale_customers SET name=? WHERE id=?', ['客户已改名', customer.insertId])
  selected = await statements.listStatements({ customerId: customer.insertId })
  log.assert('客户改名仍保留原有对账单身份', selected.list.some(s => s.id === statementIds[0]))

  for (let start = 0; start < 503; start += 100) {
    const rows = Array.from({ length: Math.min(100, 503 - start) }, (_, i) => [`EXP-${suffix}-${start + i}`, `导出${start + i}`])
    await q('INSERT INTO sale_customers(code,name) VALUES ?', [rows])
  }
  const [[count]] = await q('SELECT COUNT(*) AS n FROM sale_customers WHERE deleted_at IS NULL')
  const payload = await exports.getCustomersExportPayload()
  log.assert('客户导出完整读取超过500条', payload.rows.length === Number(count.n), `${payload.rows.length}/${count.n}`)
  const boxes = await exports.getPlasticBoxesExportPayload({ scopeWarehouseIds: [ctx.warehouse.id] })
  log.assert('塑料盒导出执行仓库范围', boxes.rows.every(b => b.warehouse_name !== '修复范围外仓'))
  const [bin] = await q('INSERT INTO sorting_bins(code,warehouse_id,status) VALUES(?,?,2)', [`FIX-B-${suffix}`, ctx.warehouse.id])
  const bins = await exports.getSortingBinsExportPayload({ scopeWarehouseIds: [ctx.warehouse.id] })
  log.assert('分拣格占用状态正确', bins.rows.find(b => b.code === `FIX-B-${suffix}`)?.is_active === '占用')
  await q('UPDATE sorting_bins SET status=1 WHERE id=?', [bin.insertId])
  log.assert('分拣格空闲状态正确', (await exports.getSortingBinsExportPayload({ scopeWarehouseIds: [ctx.warehouse.id] })).rows.find(b => b.code === `FIX-B-${suffix}`)?.is_active === '空闲')
  const binsSvc = require('../backend/src/modules/sorting-bins/sorting-bins.service')
  const original = binsSvc.findAllWarehouses
  let bounded = false
  binsSvc.findAllWarehouses = async options => { bounded = options.exportLimit === 10001; return original(options) }
  try { await exports.getSortingBinsExportPayload() } finally { binsSvc.findAllWarehouses = original }
  log.assert('分拣格导出请求有界读取', bounded)
  // 真实 HTTP 二进制导出：头部账套必须优先于伪造的 query companyId。
  const company = await require('../backend/src/modules/accounting/companies.service').createCompany({ code: `FX${suffix}`, name: '导出第二账套' })
  const marker = `第二账套资产${suffix}`
  await q("INSERT INTO fixed_assets(company_id,asset_no,asset_name,acquire_date,original_cost,useful_months,status) VALUES(?,?,?,'2026-09-01',100,12,2)", [company.id, `FA${suffix}`, marker])
  await require('../backend/src/modules/accounting/accounting.tax.service').upsertAdjustment({ companyId: company.id, period: '202609', taxType: 1, adjustItem: marker, amount: 23 }, user.id)
  const period = require('../backend/src/utils/backendTime').beijingTodayYmd().slice(0,7).replace('-', '')
  await q('INSERT INTO acct_periods(company_id,period,status,closed_by_name) VALUES(?,?,2,?)', [company.id, period, marker])
  const ExcelJS = require('../backend/node_modules/exceljs')
  for (const route of ['fixed-assets', 'accounting-periods', 'tax-adjustments']) {
    const response = await ctx.http.get(`/api/export/${route}?companyId=1`, { token: admin.token, headers: { 'X-Company-Id': String(company.id) }, expectBinary: true })
    assert.equal(response.status, 200, response.data.toString())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(response.data)
    const values = JSON.stringify(workbook.worksheets[0].getSheetValues())
    log.assert(`${route} HTTP Excel 使用请求头账套`, values.includes(marker))
    if (route === 'fixed-assets') log.assert('资产 Excel 日期与已提足状态正确', values.includes('2026-09-01') && values.includes('已提足'))
  }
  for (const [table, rowId, field] of [['product_items', ctx.product.id, 'is_active'], ['inventory_warehouses', wh.insertId, 'is_active'], ['warehouse_locations', ctx.location.id, 'status']]) {
    const [[row]] = await q(`SELECT ${field} AS v FROM ${table} WHERE id=?`, [rowId])
    try {
      await q(`UPDATE ${table} SET ${field}=0 WHERE id=?`, [rowId])
      const r = await ctx.http.post('/api/plastic-boxes', { token: admin.token, json: { ...box, ...(table === 'warehouse_locations' ? { warehouseId: ctx.warehouse.id, locationId: ctx.location.id } : {}) } })
      log.assert(`拒绝停用 ${table}`, r.status === 400, r.status)
    } finally { await q(`UPDATE ${table} SET ${field}=? WHERE id=?`, [row.v, rowId]) }
  }
  await q('UPDATE sale_customers SET name=? WHERE id=?', ['客户已改名', other.insertId])
  selected = await statements.listStatements({ customerId: customer.insertId })
  log.assert('两个客户同名仍按 ID 隔离', selected.list.length === 1 && selected.list[0].id === statementIds[0])
  const [empty] = await q('INSERT INTO reconciliation_statements(statement_no,type,party_name) VALUES(?,2,?)', [`EMPTY${suffix}`, '客户已改名'])
  await q('UPDATE reconciliation_statement_items SET statement_id=? WHERE statement_id=?', [statementIds[0], statementIds[1]])
  selected = await statements.listStatements({ customerId: customer.insertId })
  log.assert('混合客户及无法归属的历史单不误投门户', !selected.list.some(r => [empty.insertId, statementIds[0]].includes(r.id)))
  const [[retained]] = await q('SELECT COUNT(*) AS n FROM reconciliation_statements WHERE id IN (?,?)', [empty.insertId, statementIds[0]])
  log.assert('无法归属的历史单据仍保留', Number(retained.n) === 2)
  const conn = await ctx.pool.getConnection()
  let pending
  try {
    await conn.beginTransaction()
    await conn.query('SELECT id FROM inventory_containers WHERE id=? FOR UPDATE', [id])
    pending = ctx.http.delete(`/api/plastic-boxes/${id}`, { token: admin.token })
    await new Promise(resolve => setTimeout(resolve, 75))
    await conn.query('UPDATE inventory_containers SET remaining_qty=1 WHERE id=?', [id])
    await conn.commit()
    log.assert('删除等待容器锁后重新检查库存', (await pending).status === 400)
  } finally { await conn.rollback(); conn.release(); if (pending) await pending }
  // 三个财务导出曾以 pageSize=10000 绕过公共分页限制，实际仍只有500。
  for (const [servicePath, exportMethod] of [
    ['payments', 'getPaymentsExportPayload'],
    ['payment-receipts', 'getPaymentReceiptsExportPayload'],
    ['reconciliation-statements', 'getStatementsExportPayload'],
  ]) {
    const service = require(`../backend/src/modules/payments/${servicePath}.service`)
    const findAll = service.findAll
    let readTotal = 503
    service.findAll = async ({ page = 1, pageSize = 20, keyword }) => {
      assert.equal(keyword, '保留筛选')
      const size = Math.min(500, pageSize)
      return { list: Array.from({ length: Math.max(0, Math.min(size, readTotal - (page - 1) * size)) }, (_, n) => ({ id: (page - 1) * size + n, statementNo: 'ST', startDate: '2026-01-01', endDate: '2026-02-01' })), pagination: { total: readTotal } }
    }
    try {
      log.assert(`${servicePath} 导出503条完整`, (await exports[exportMethod]({ keyword: '保留筛选' })).rows.length === 503)
      readTotal = 10001
      await assert.rejects(exports[exportMethod]({ keyword: '保留筛选' }), { code: 'EXPORT_ROW_LIMIT_EXCEEDED' })
      log.assert(`${servicePath} 超限明确拒绝`, true)
    } finally { service.findAll = findAll }
  }
  await ctx.close()
  await require('../backend/src/config/db').pool.end()
  const counts = log.summary()
  process.exitCode = counts.failed ? 1 : 0
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => process.exit(process.exitCode || 0))
