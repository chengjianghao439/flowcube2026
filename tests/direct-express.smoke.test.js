'use strict'
const assert = require('node:assert/strict')
const { configureTestEnvironment, validateTestEnvironment } = require('./helpers/testEnvironment')
configureTestEnvironment()
validateTestEnvironment()
const { pool } = require('../backend/src/config/db')
require('../backend/src/modules/print-jobs/print-jobs.dispatch').startPrintJobSweeper = () => {}
const carriers = require('../backend/src/modules/carriers/carriers.service')
const binding = require('../backend/src/modules/carriers/carriers.binding').createBindingService({ pool })
const sales = require('../backend/src/modules/sale/sale.service')
const logistics = require('../backend/src/modules/logistics/logistics.service')
const { updateShipment } = require('../backend/src/modules/logistics/logistics.shipment')
const { createDirectWaybillsForTaskTx } = require('../backend/src/modules/logistics/logistics.direct-create')
const { createDirectWorker, json } = require('../backend/src/modules/logistics/logistics.direct')
const prefix = `EXP${Date.now().toString(36)}`
let seq = 0
const code = () => `${prefix}${++seq}`
const ids = {}
const insert = async (sql, args) => Number((await pool.query(sql, args))[0].insertId)
async function queueTask(taskId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('SELECT id FROM warehouse_tasks WHERE id = ? FOR UPDATE', [taskId])
    await createDirectWaybillsForTaskTx(conn, taskId, ids.user)
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}
async function main() {
  try {
    ids.user = await insert("INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES(?,'!','快递专项测试',1,'管理员',1)", [code()])
    ids.bindingCarrier = (await carriers.create({ name: '绑定专项承运商' })).id
    let bindingView = await binding.get(ids.bindingCarrier, 'deppon')
    const bindingInput = { platformCode: 'deppon', monthlyAccount: 'BINDING_TEST', shippingProduct: 'DJBK', shippingDeliveryType: '3', enabled: false, revision: bindingView.revision }
    bindingView = await binding.save(ids.bindingCarrier, bindingInput)
    assert.equal(bindingView.monthlyAccount, 'BINDING_TEST'); assert.equal(bindingView.enabled, false)
    assert.equal((await carriers.findById(ids.bindingCarrier)).credentialRef, 'deppon_main')
    await assert.rejects(binding.save(ids.bindingCarrier, { ...bindingInput, revision: bindingView.revision, enabled: true }), /尚未准备好/)
    const writes = await Promise.allSettled(['DJTK', 'DJTH'].map(shippingProduct => binding.save(ids.bindingCarrier, { ...bindingInput, revision: bindingView.revision, shippingProduct })))
    assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1, '同一旧页面的并发不同修改仅一个成功')
    assert.equal(writes.find(r => r.status === 'rejected').reason.statusCode, 409)
    await pool.query('UPDATE carriers SET monthly_account=?,shipping_product=?,waybill_enabled=1 WHERE id=?', ['L'.repeat(40), 'OLD_SERVICE', ids.bindingCarrier])
    bindingView = await binding.get(ids.bindingCarrier)
    bindingView = await binding.save(ids.bindingCarrier, { action: 'pause', revision: bindingView.revision })
    assert.equal(bindingView.enabled, false); assert.equal(bindingView.monthlyAccount.length, 40); assert.equal(bindingView.shippingProduct, 'OLD_SERVICE')
    await assert.rejects(carriers.remove(ids.bindingCarrier), /解绑/)
    bindingView = await binding.save(ids.bindingCarrier, { action: 'unbind', revision: bindingView.revision })
    assert.equal(bindingView.monthlyAccount, ''); assert.equal(bindingView.shippingProduct, '')
    await carriers.remove(ids.bindingCarrier)
    await assert.rejects(carriers.findById(ids.bindingCarrier), e => e.statusCode === 404)
    const newAccount = { name: '新增测试顺丰', platformCode: 'sf', monthlyAccount: '00123' }
    const newContext = { requestKey: code(), userId: ids.user }
    ids.newAccount = (await binding.create(newAccount, newContext)).id
    const concurrentCreates = await Promise.all([binding.create(newAccount, newContext), binding.create(newAccount, newContext)])
    assert.ok(concurrentCreates.every(r => r.id === ids.newAccount), '重试不得重复建立承运商')
    assert.equal((await carriers.findById(ids.newAccount)).waybillEnabled, false)
    console.log('PASS 快捷新增重放、解绑清空、绑定删除保护及空记录软删除')
    console.log('PASS 月结绑定 MySQL：默认凭据引用、资料保存、未验收禁启用、并发行锁防覆盖、旧资料纯暂停')
    ids.warehouse = await insert("INSERT INTO inventory_warehouses(code,name,manager,phone,address) VALUES(?,'快递专项测试仓','测试寄件人','13800000000','广东省深圳市南山区测试路1号')", [code()])
    ids.customer = await insert("INSERT INTO sale_customers(code,name) VALUES(?,'快递专项客户')", [code()])
    ids.product = await insert("INSERT INTO product_items(code,name,unit) VALUES(?,'快递专项商品','件')", [code()])
    const carrier = { name: '快递专项德邦', platformCode: 'deppon', credentialRef: 'express_test', monthlyAccount: 'TEST', shippingProduct: 'DJBK', shippingDeliveryType: '3', waybillEnabled: true }
    ids.carrier = (await carriers.create(carrier)).id
    assert.equal((await carriers.findById(ids.carrier)).shippingProduct, 'DJBK')
    const active = (await carriers.findAllActive()).find(c => Number(c.id) === ids.carrier)
    assert.equal(active.platformCode, 'deppon'); assert.equal(active.credentialRef, undefined)
    const order = { customerId: ids.customer, warehouseId: ids.warehouse, carrierId: ids.carrier, freightType: 1, receiverName: '测试收件人', receiverPhone: '13900000000', receiverAddress: '上海市青浦区测试路2号', items: [{ productId: ids.product, quantity: 31, unitPrice: 1 }], operator: { userId: ids.user, realName: '快递专项测试' }, requestKey: code() }
    const created = await sales.create(order); ids.sale = created.id
    let [[sale]] = await pool.query('SELECT shipping_product FROM sale_orders WHERE id=?', [ids.sale])
    assert.equal(sale.shipping_product, 'DJBK', '创建快照继承默认产品')
    await sales.update(ids.sale, { ...order, shippingProduct: 'DJTK' })
    ;[[sale]] = await pool.query('SELECT shipping_product FROM sale_orders WHERE id=?', [ids.sale])
    assert.equal(sale.shipping_product, 'DJTK', '草稿编辑保存本单产品')
    await assert.rejects(sales.update(ids.sale, { ...order, shippingProduct: '2' }), /不匹配/)
    ids.task = await insert("INSERT INTO warehouse_tasks(task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status) VALUES(?,?,?,?,'快递专项客户',?,'快递专项测试仓',6)", [code(), ids.sale, created.orderNo, ids.customer, ids.warehouse])
    for (let i = 0; i < 31; i++) await insert('INSERT INTO packages(barcode,warehouse_task_id,status) VALUES(?,?,2)', [code(), ids.task])
    await insert('INSERT INTO packages(barcode,warehouse_task_id,status) VALUES(?,?,3)', [code(), ids.task])
    await queueTask(ids.task); await queueTask(ids.task)
    let [rows] = await pool.query('SELECT * FROM logistics_waybills WHERE warehouse_task_id=? ORDER BY id', [ids.task])
    assert.equal(rows.length, 2, '重复打包入队不会重复创建')
    assert.deepEqual(rows.map(r => json(r.shipment_json).packages.length), [30, 1])
    assert.equal(json(rows[0].shipment_json).productCode, 'DJTK')
    const guardedBinding = await binding.get(ids.carrier)
    const paused = await binding.save(ids.carrier, { action: 'pause', revision: guardedBinding.revision })
    await assert.rejects(binding.save(ids.carrier, { action: 'unbind', revision: paused.revision }), /待处理/)
    // 以下仅调整测试夹具，以单独验证历史引用删除保护。
    await pool.query('UPDATE carriers SET monthly_account=NULL WHERE id=?', [ids.carrier])
    await assert.rejects(carriers.remove(ids.carrier), /已有订单/)
    await pool.query('UPDATE carriers SET monthly_account=?,waybill_enabled=1 WHERE id=?', ['TEST', ids.carrier])
    const first = rows[0].id, second = rows[1].id
    // 31→30→31：自动缩批不能永久吞掉后续恢复的第二批。
    await pool.query('UPDATE packages SET status=3 WHERE id=?', [json(rows[1].shipment_json).packages[0].id])
    await queueTask(ids.task)
    assert.equal((await logistics.getWaybillById(second)).status, 5)
    await insert('INSERT INTO packages(barcode,warehouse_task_id,status) VALUES(?,?,2)', [code(), ids.task])
    await queueTask(ids.task)
    assert.equal((await logistics.getWaybillById(second)).status, 1, '新增第31箱必须恢复系统自动移除的批次')
    assert.equal((await logistics.getWaybillById(second)).shipment.packages.length, 1)
    await logistics.voidWaybill(second, { reason: '测试人工作废' })
    await queueTask(ids.task)
    assert.equal((await logistics.getWaybillById(second)).status, 5, '人工作废不能被打包入队自动恢复')
    // 以下恢复仅是独立测试夹具重置，继续验证另一条未知回执恢复分支。
    await pool.query('UPDATE logistics_waybills SET status=1,error_message=NULL WHERE id=?', [second])
    const shipment = { ...json(rows[0].shipment_json), freightType: 1 }
    delete shipment.packages
    await assert.rejects(updateShipment(first, shipment, { warehouseIds: [] }), e => e.statusCode === 403)
    const edited = await updateShipment(first, { ...shipment, cargoName: '测试配件' }, { warehouseIds: [ids.warehouse] })
    assert.equal(edited.shipment.packages.length, 30)
    assert.equal(edited.shipment.cargoName, '测试配件')
    assert.equal(edited.shipment.weight, undefined)
    // 实际 MySQL 并发领取；外部适配器只替换网络端，第二连接能看到已提交的快照。
    let creates = 0, queries = 0
    const worker = createDirectWorker({ pool, getCredential: () => ({ appId: 'TEST', appKey: 'NOT_FOR_DATABASE', mode: 'sandbox' }), getAdapter: () => ({
      prepareOrder(p) { return { count: p.waybill.packageCount } },
      async createOrder(p) {
        creates++
        const [[visible]] = await pool.query('SELECT status,direct_request FROM logistics_waybills WHERE id=?', [first])
        assert.equal(visible.status, 2); assert.ok(visible.direct_request, '网络前已提交')
        assert.doesNotMatch(JSON.stringify(visible.direct_request), /NOT_FOR_DATABASE/)
        const trackingNos = Array.from({ length: p.waybill.packageCount }, (_, i) => `DPK_TEST_${first}_${i}`)
        return { trackingNo: trackingNos[0], trackingNos }
      },
      async lookupOrder() { queries++; return { trackingNo: 'DPK_TEST_QUERY', trackingNos: ['DPK_TEST_QUERY'] } },
    }) })
    await Promise.all([worker.process(first), worker.process(first)])
    assert.equal(creates, 1, (await logistics.getWaybillById(first)).errorMessage || '创建次数')
    assert.equal((await logistics.getWaybillById(first)).trackingNumbers.length, 30)
    for (const operation of [() => updateShipment(first, shipment), () => logistics.manualSetTracking(first, { trackingNo: 'MANUAL' }), () => logistics.voidWaybill(first)]) await assert.rejects(operation(), e => e.statusCode === 409)
    const failedWorker = createDirectWorker({ pool, getCredential: () => ({ appId: 'TEST', appKey: 'NOT_FOR_DATABASE', mode: 'sandbox' }), getAdapter: () => ({ prepareOrder: () => ({}), createOrder: async () => { throw Object.assign(new Error('超时'), { uncertain: true }) }, lookupOrder: async () => { throw new Error('not used') } }) })
    await failedWorker.process(second)
    assert.equal((await logistics.getWaybillById(second)).status, 6)
    await logistics.retryFetch(second)
    await worker.process(second)
    assert.equal(queries, 1); assert.equal(creates, 1, '恢复只查询，没有再次创建')
    assert.equal((await logistics.getWaybillById(second)).status, 3)
    // 已发送箱子变化必须阻止悄悄重新下单。
    await pool.query('UPDATE packages SET status=3 WHERE id=?', [json(rows[0].shipment_json).packages[0].id])
    await assert.rejects(queueTask(ids.task), /核实/)
    console.log('PASS 快递 MySQL：承运商配置、销售产品快照、31箱拆批、重复入队、仓库范围、免重量、事务外并发单次创建、未知结果只查、原单保护')
  } finally {
    // 只清理本次明确创建的测试行，任何环境都不全表清空。
    if (ids.task) {
      await pool.query('DELETE FROM logistics_waybills WHERE warehouse_task_id=?', [ids.task])
      await pool.query('DELETE FROM packages WHERE warehouse_task_id=?', [ids.task])
      await pool.query('DELETE FROM warehouse_tasks WHERE id=?', [ids.task])
    }
    if (ids.sale) {
      await pool.query('DELETE FROM sale_order_events WHERE sale_order_id=?', [ids.sale])
      await pool.query('DELETE FROM sale_order_items WHERE order_id=?', [ids.sale])
      await pool.query('DELETE FROM sale_orders WHERE id=?', [ids.sale])
    }
    if (ids.newAccount) await pool.query('DELETE FROM carriers WHERE id=?', [ids.newAccount])
    if (ids.user) await pool.query("DELETE FROM operation_requests WHERE user_id=? AND action='carrier.createAccount'", [ids.user])
    if (ids.bindingCarrier) await pool.query('DELETE FROM carriers WHERE id=?', [ids.bindingCarrier])
    if (ids.carrier) await pool.query('DELETE FROM carriers WHERE id=?', [ids.carrier])
    if (ids.product) await pool.query('DELETE FROM product_items WHERE id=?', [ids.product])
    if (ids.customer) await pool.query('DELETE FROM sale_customers WHERE id=?', [ids.customer])
    if (ids.warehouse) await pool.query('DELETE FROM inventory_warehouses WHERE id=?', [ids.warehouse])
    if (ids.user) await pool.query('DELETE FROM sys_users WHERE id=?', [ids.user])
    await pool.end()
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
