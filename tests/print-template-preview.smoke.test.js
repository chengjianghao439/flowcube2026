'use strict'

// smokeTestKit validates NODE_ENV=test and an explicit loopback *_test database.
const assert = require('node:assert/strict')
const { prepareSmokeContext, login, randomRef, PERMISSIONS: P } = require('./helpers/smokeTestKit')
const labels = require('../backend/src/modules/print-jobs/print-jobs.label-command')
const { pool: appPool } = require('../backend/src/config/db')
const { clearRolePermissionsCache } = require('../backend/src/middleware/loadRolePermissions')
const { clearScopeCache } = require('../backend/src/utils/warehouseScope')

async function main() {
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx
  const inserted = []
  let passed = 0
  const insert = async (table, data) => {
    const [r] = await pool.query(`INSERT INTO ${table} SET ?`, [data])
    inserted.push([table, r.insertId])
    return r.insertId
  }
  const code = randomRef('PREVIEW')
  const sourcePermissions = [P.SALE_ORDER_VIEW, P.PURCHASE_ORDER_VIEW, P.RETURN_ORDER_VIEW, P.WAREHOUSE_TASK_VIEW, P.RACK_VIEW, P.INVENTORY_VIEW, P.WAREHOUSE_TASK_VIEW, P.PRODUCT_VIEW, P.INVENTORY_VIEW, P.LOCATION_VIEW]
  try {
    const { token: admin } = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const get = (type, token = admin) => http.get(`/api/print-templates/preview-data?type=${type}`, { token })
    const read = async (type, token = admin) => {
      const r = await get(type, token)
      assert.equal(r.status, 200, `type ${type}: ${JSON.stringify(r.data)}`)
      return r.data.data
    }
    assert.equal((await http.get('/api/print-templates/preview-data?type=1')).status, 401)
    assert.equal(await read(1), null)
    console.log('[PASS] 缺省无销售单返回 null'); passed++
    for (const type of ['', '0', '11', '1.5', 'abc', '1&type=2']) assert.equal((await get(type)).status, 400)
    console.log('[PASS] 非法与重复 type 返回400'); passed++

    const w = await insert('inventory_warehouses', { name: '预览可访问仓', code })
    const other = await insert('inventory_warehouses', { name: '预览无权仓', code: `${code}-X` })
    const role = await insert('sys_roles', { name: code, code, is_system: 0 })
    const [[adminUser]] = await pool.query("SELECT password FROM sys_users WHERE username='smoke_admin'")
    const uid = await insert('sys_users', { username: code, password: adminUser.password, real_name: code, role_id: role, role_name: code, is_active: 1 })
    await pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [uid, w])
    const { token: limited } = await login(http, code, 'SmokeAdmin123!')
    const setPermissions = async permissions => {
      await pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [role])
      for (const permission of new Set(permissions)) await pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [role, permission])
      clearRolePermissionsCache(role)
    }
    await setPermissions(sourcePermissions)
    assert.equal((await get(1, limited)).status, 403)
    await setPermissions([P.PRINT_TEMPLATE_VIEW])
    for (let type = 1; type <= 10; type++) assert.equal((await get(type, limited)).status, 403)
    console.log('[PASS] 模板和10类来源权限分别强制校验'); passed++
    for (let type = 1; type <= 10; type++) {
      await setPermissions([P.PRINT_TEMPLATE_VIEW, sourcePermissions[type - 1]])
      assert.equal((await get(type, limited)).status, 200, `类型${type}使用对应来源查看权限`)
    }
    console.log('[PASS] 每类来源独立权限可读，未登录返回401'); passed++
    await setPermissions([P.PRINT_TEMPLATE_VIEW, ...sourcePermissions])
    for (const type of [1, 2, 3, 4, 5, 6, 7, 9, 10]) assert.equal(await read(type, limited), null)
    const [productRows] = await pool.query('SELECT id FROM product_items WHERE deleted_at IS NULL')
    try {
      await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE deleted_at IS NULL')
      assert.equal(await read(8, limited), null)
    } finally {
      if (productRows.length) await pool.query('UPDATE product_items SET deleted_at=NULL WHERE id IN (?)', [productRows.map(r => r.id)])
    }
    console.log('[PASS] 10类无可访问数据返回 null'); passed++

    const product = await insert('product_items', { code, name: '真实商品', spec: '规格A', article_number: 'SUP-123', color: '蓝色', unit: '件', sale_price: 12.3 })
    const item = { product_id: product, product_code: code, product_name: '真实商品', unit: '件', quantity: 2.5, unit_price: 12.3, amount: 30.75 }
    const fixture = async (warehouse, suffix, deleted = false) => {
      const base = { warehouse_id: warehouse, warehouse_name: suffix, operator_id: uid, operator_name: code, ...(deleted ? { deleted_at: new Date() } : {}) }
      const sale = await insert('sale_orders', { ...base, order_no: `${code}-S${suffix}`, customer_id: ctx.customer.id, customer_name: '真实客户', freight_type: 2 })
      await insert('sale_order_items', { ...item, order_id: sale, warehouse_id: warehouse, warehouse_name: suffix })
      const purchase = await insert('purchase_orders', { ...base, order_no: `${code}-P${suffix}`, supplier_id: ctx.supplier.id, supplier_name: '真实供应商' })
      await insert('purchase_order_items', { ...item, order_id: purchase })
      const ret = await insert('sale_returns', { ...base, return_no: `${code}-R${suffix}`, customer_id: ctx.customer.id, customer_name: '真实退货客户' })
      await insert('sale_return_items', { ...item, return_id: ret })
      const task = await insert('warehouse_tasks', { warehouse_id: warehouse, warehouse_name: suffix, task_no: `${code}-T${suffix}`, sale_order_id: sale, sale_order_no: `${code}-S${suffix}`, customer_id: ctx.customer.id, customer_name: '真实客户', ...(deleted ? { deleted_at: new Date() } : {}) })
      await insert('warehouse_task_items', { task_id: task, product_id: product, product_code: code, product_name: '真实商品', unit: '件', required_qty: 2.5 })
      const rack = await insert('warehouse_racks', { warehouse_id: warehouse, code: suffix, barcode: `RCK${suffix}`, name: '真实货架', zone: 'A', max_levels: 7, max_positions: 12, remark: '货架备注', ...(deleted ? { deleted_at: new Date() } : {}) })
      const location = await insert('warehouse_locations', { warehouse_id: warehouse, code: suffix, barcode: `R${suffix}`, zone: 'A', name: '真实库位', aisle: '01', rack: '02', level: '03', position: '04', remark: '库位备注', ...(deleted ? { deleted_at: new Date() } : {}) })
      const containers = []
      for (const prefix of ['I', 'B']) containers.push(await insert('inventory_containers', { warehouse_id: warehouse, product_id: product, location_id: location, barcode: `${prefix}${code}${suffix}`, initial_qty: 8, remaining_qty: 2.5, batch_no: 'BATCH-123', mfg_date: '2026-01-02', exp_date: '2027-01-02', ...(deleted ? { deleted_at: new Date() } : {}) }))
      const box = await insert('packages', { barcode: `BOX${suffix}${product}`, warehouse_task_id: task, remark: '箱子备注' })
      await insert('package_items', { package_id: box, product_id: product, product_code: code, product_name: '历史名称', unit: '件', qty: 2.5 })
      return { sale, purchase, ret, task, rack, box, location, containers }
    }
    await fixture(w, 'OLD')
    const expected = await fixture(w, 'NEW')
    await fixture(other, 'OTHER')
    await fixture(w, 'DELETED', true)
    const multi = await insert('sale_orders', { warehouse_id: w, warehouse_name: '可访问头', order_no: `${code}-MULTI`, customer_id: ctx.customer.id, customer_name: '禁止泄露混仓客户', operator_id: uid, operator_name: code })
    await insert('sale_order_items', { ...item, order_id: multi, warehouse_id: other })
    await insert('product_items', { code: `${code}-DEL`, name: '删除商品', unit: '件', deleted_at: new Date() })
    const tables = [...new Set(inserted.map(([table]) => table)), 'print_jobs', 'inventory_stock', 'inventory_logs', 'stock_reservations']
    const snapshot = async () => {
      const out = {}
      for (const table of tables) out[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0]
      return JSON.stringify(out)
    }
    const before = await snapshot()
    const expectedLabels = {}
    for (let type = 1; type <= 10; type++) {
      const r = await read(type, limited)
      assert.equal(r.type, type)
      assert.ok(r.sourceLabel)
      if (type <= 4) {
        assert.equal(r.kind, ['sale', 'purchase', 'return', 'warehouse-task'][type - 1])
        assert.equal(r.record.id, [expected.sale, expected.purchase, expected.ret, expected.task][type - 1])
        assert.equal(r.record.items.length, 1)
        if (type === 3) assert.equal(r.record.type, 'sale')
      } else {
        assert.equal(r.kind, 'label')
        const vars = {
          5: { rack_barcode: 'RCKNEW', rack_code: 'NEW', zone: 'A', name: '真实货架' },
          6: { container_code: `I${code}NEW`, product_name: '真实商品', qty: '2.5000' },
          7: { box_code: `BOXNEW${product}`, task_no: `${code}-TNEW`, customer_name: '真实客户', carrier_name: '', freight_type_name: '到付', piece_count: '2.5 件', item_list: '真实商品×2.5000', summary: '1 行 / 2.5 件' },
          8: { product_code: code, product_name: '真实商品', spec: '规格A', unit: '件', price: '12.30' },
          9: { container_code: `B${code}NEW`, product_name: '真实商品', qty: '2.5000' },
          10: { location_barcode: 'RNEW', location_code: 'NEW', zone: 'A', name: '真实库位' },
        }
        const whVars = { warehouse_name: '预览可访问仓', warehouse_code: code }
        const extras = {
          5: { ...whVars, max_levels: 7, max_positions: 12, remark: '货架备注' },
          6: { ...whVars, product_code: code, article_number: 'SUP-123', spec: '规格A', color: '蓝色', unit: '件', location_code: 'NEW', batch_no: 'BATCH-123', mfg_date: '2026-01-02', exp_date: '2027-01-02' },
          7: { ...whVars, sale_order_no: `${code}-SNEW`, remark: '箱子备注' },
          8: { article_number: 'SUP-123', color: '蓝色' },
          10: { ...whVars, aisle: '01', rack: '02', level: '03', position: '04', remark: '库位备注' },
        }
        extras[9] = extras[6]
        expectedLabels[type] = { ...vars[type], ...extras[type] }
        assert.deepEqual(r.data, expectedLabels[type])
      }
      console.log(`[PASS] 类型${type}真实字段、最新可访问与删除/跨仓过滤`); passed++
    }
    assert.equal(await snapshot(), before, '预览请求不得修改业务数据或入队打印')
    console.log('[PASS] 10类预览前后业务/库存/打印数据完全一致'); passed++
    // Virtual printer only: queued jobs are inspected and deleted without dispatch.
    const printer = await insert('printers', { name: '字段测试虚拟机', code: `${code}-LABEL`, type: 1, warehouse_id: w, status: 1 })
    for (const printType of ['rack_label', 'location_label', 'container_label', 'package_label', 'product_label']) {
      await insert('printer_bindings', { warehouse_id: w, print_type: printType, printer_id: printer, printer_code: `${code}-LABEL` })
    }
    const [oldDefaults] = await pool.query('SELECT id,is_default FROM print_templates WHERE type BETWEEN 5 AND 10')
    const jobIds = []
    const enqueue = {
      5: () => labels.enqueueRackLabelJob({ rackId: expected.rack }),
      6: () => labels.enqueueContainerLabelJob({ warehouseId: w, containerId: expected.containers[0], data: { container_code: `I${code}NEW`, product_name: '真实商品', qty: '2.5000' } }),
      7: () => labels.enqueuePackageLabelJob({ packageId: expected.box }),
      8: () => labels.enqueueProductLabelJob({ productId: product }),
      9: () => labels.enqueueContainerLabelJob({ warehouseId: w, containerId: expected.containers[1], data: { container_code: `B${code}NEW`, product_name: '真实商品', qty: '2.5000' } }),
      10: () => labels.enqueueLocationLabelJob({ locationId: expected.location }),
    }
    try {
      await pool.query('UPDATE print_templates SET is_default=0 WHERE type BETWEEN 5 AND 10')
      for (let type = 5; type <= 10; type++) {
        const vars = expectedLabels[type]
        const body = '^XA' + Object.keys(vars).map(key => `^FD${key}={{${key}}}^FS`).join('') + '^XZ'
        await insert('print_templates', { name: `${code}-${type}`, type, is_default: 1, paper_size: 'thermal80', layout_json: JSON.stringify({ format: 'zpl', body }) })
        const job = await enqueue[type]()
        assert.ok(job?.id, `类型${type}应入队`); jobIds.push(job.id)
        const [[saved]] = await pool.query('SELECT content FROM print_jobs WHERE id=?', [job.id])
        assert.equal(saved.content, '^XA' + Object.entries(vars).map(([key, value]) => `^FD${key}=${value}^FS`).join('') + '^XZ')
        console.log(`[PASS] 类型${type}自定义模板真实ZPL包含全部可选字段并与预览一致`); passed++
      }
      const conn = await pool.getConnection()
      let uncommittedJob
      try {
        await conn.beginTransaction()
        const [result] = await conn.query('INSERT INTO inventory_containers SET ?', [{ warehouse_id: w, product_id: product, location_id: expected.location, barcode: `I${code}TX`, initial_qty: 4, remaining_qty: 4, unit: '箱', batch_no: 'TX-BATCH', mfg_date: '2026-03-04', exp_date: '2028-03-04' }])
        const job = await labels.enqueueContainerLabelJob({ conn, warehouseId: w, containerId: result.insertId, data: { container_code: 'I-PASSED-CORE', product_name: '传入名称', qty: 1.25 } })
        uncommittedJob = job.id
        const [[saved]] = await conn.query('SELECT content FROM print_jobs WHERE id=?', [job.id])
        for (const part of ['container_code=I-PASSED-CORE', 'product_name=传入名称', 'qty=1.25', 'product_code=' + code, 'unit=箱', 'location_code=NEW', 'batch_no=TX-BATCH', 'mfg_date=2026-03-04', 'exp_date=2028-03-04']) assert.ok(saved.content.includes(`^FD${part}^FS`), part)
        assert.equal((await pool.query('SELECT id FROM print_jobs WHERE id=?', [job.id]))[0].length, 0)
      } finally { await conn.rollback(); conn.release() }
      assert.equal((await pool.query('SELECT id FROM print_jobs WHERE id=?', [uncommittedJob]))[0].length, 0)
      console.log('[PASS] 未提交容器通过调用事务丰富字段，保留传入核心值，回滚无残留任务'); passed++
      const packConn = await pool.getConnection()
      let packJobId
      try {
        await packConn.beginTransaction()
        const [pack] = await packConn.query('INSERT INTO packages SET ?', [{ barcode: `BOXTX${product}`, warehouse_task_id: expected.task, remark: '未提交箱备注' }])
        await packConn.query('INSERT INTO package_items SET ?', [{ package_id: pack.insertId, product_id: product, product_code: code, product_name: '历史名称', unit: '件', qty: 1.75 }])
        const job = await labels.enqueuePackageLabelJob({ conn: packConn, packageId: pack.insertId })
        packJobId = job.id
        const [[saved]] = await packConn.query('SELECT content FROM print_jobs WHERE id=?', [job.id])
        for (const part of ['remark=未提交箱备注', `sale_order_no=${code}-SNEW`, 'item_list=真实商品×1.7500', 'piece_count=1.75 件', 'warehouse_name=预览可访问仓']) assert.ok(saved.content.includes(`^FD${part}^FS`), part)
        assert.equal((await pool.query('SELECT id FROM print_jobs WHERE id=?', [job.id]))[0].length, 0)
      } finally { await packConn.rollback(); packConn.release() }
      assert.equal((await pool.query('SELECT id FROM print_jobs WHERE id=?', [packJobId]))[0].length, 0)
      console.log('[PASS] 未提交包裹及箱内商品使用调用事务，新增备注和订单字段一致'); passed++
      for (const containerId of [undefined, Number.MAX_SAFE_INTEGER]) {
        const job = await labels.enqueueContainerLabelJob({ warehouseId: w, containerId, data: { container_code: 'I-CORE-ONLY', product_name: '核心名称', qty: 3 } })
        jobIds.push(job.id)
        const [[saved]] = await pool.query('SELECT content FROM print_jobs WHERE id=?', [job.id])
        assert.ok(saved.content.includes('^FDcontainer_code=I-CORE-ONLY^FS'))
        assert.ok(saved.content.includes('^FDproduct_name=核心名称^FS'))
        assert.ok(saved.content.includes('^FDqty=3^FS'))
        assert.ok(saved.content.includes('^FDmfg_date=^FS'))
        assert.ok(!/undefined|null|\{\{/.test(saved.content))
      }
      console.log('[PASS] 缺ID或记录仍打印传入核心字段，新增缺失字段留空'); passed++
      await pool.query('UPDATE product_items SET article_number=NULL,color=NULL WHERE id=?', [product])
      const missing = await read(8, limited)
      assert.equal(missing.data.article_number, '')
      assert.equal(missing.data.color, '')
      console.log('[PASS] 商品缺失可选信息预览留空'); passed++
    } finally {
      if (jobIds.length) await pool.query('DELETE FROM print_jobs WHERE id IN (?)', [jobIds])
      for (const old of oldDefaults) await pool.query('UPDATE print_templates SET is_default=? WHERE id=?', [old.is_default, old.id])
    }
    const purchaseReturn = await insert('purchase_returns', { warehouse_id: w, warehouse_name: 'NEW', return_no: `${code}-PR`, supplier_id: ctx.supplier.id, supplier_name: '真实供应商', operator_id: uid, operator_name: code, created_at: new Date(Date.now() + 60000) })
    await insert('purchase_return_items', { ...item, return_id: purchaseReturn })
    const pr = await read(3, limited)
    assert.equal(pr.record.type, 'purchase')
    assert.equal(pr.record.id, purchaseReturn)
    console.log('[PASS] 类型3支持最新采购退货及销售退货契约'); passed++
    console.log(`${passed} passed, 0 failed`)
  } finally {
    for (const [table, id] of inserted.reverse()) {
      if (table === 'sys_users') await pool.query('DELETE FROM user_warehouse_scope WHERE user_id=?', [id])
      if (table === 'sys_roles') await pool.query('DELETE FROM sys_role_permissions WHERE role_id=?', [id])
      await pool.query(`DELETE FROM ${table} WHERE id=?`, [id])
    }
    clearRolePermissionsCache(); clearScopeCache()
    await ctx.close()
    await appPool.end()
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1) })
