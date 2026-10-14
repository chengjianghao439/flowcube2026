'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { setup } = require('./helpers/changeRecordsRuntimeFixture')

async function main() {
  const c = await setup('change-records-runtime')
  const cases = []
  const test = async (name, fn) => {
    try { const result = await fn(); c.record(name, {}, result, '真实业务提交/回滚/回放合同', 'pass') }
    catch (error) { cases.push(name); c.record(name, {}, { error: error.message }, '真实业务提交/回滚/回放合同', 'fail') }
  }
  const audit = async (type, id) => (await c.rows('SELECT id,payload_json,created_by FROM document_operation_events WHERE document_type=? AND document_id=? AND payload_version=1 ORDER BY id', [type, id])).map(row => ({ ...row, payload: typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json }))
  const item = (p, quantity, unitPrice = 20.0001) => ({ productId: p.id, productCode: p.code, productName: p.name, unit: p.unit, quantity, unitPrice, priceSource: 'manual' })
  const body = items => ({ customerId: c.customer.id, customerName: c.customer.name, warehouseId: c.a.id, warehouseName: c.a.name, items })
  const edit = async (id, items, reason, opts = {}, action = '') => {
    const detail = await c.ok('GET', `/sale/${id}`)
    return c.request('PUT', `/sale/${id}${action}`, { ...body(items), expectedEditFingerprint: detail.editFingerprint, ...(reason === undefined ? {} : { changeReason: reason }) }, opts)
  }
  const success = r => { assert.ok(r.status >= 200 && r.status < 300 && r.data?.success === true, JSON.stringify(r)); return r.data.data }
  const packedSale = async (tag, quantity = 2) => {
    const receipt = await c.receive(tag, quantity)
    await c.pool.query('INSERT INTO sorting_bins (warehouse_id,code) VALUES (?,?)', [c.a.id, crypto.randomBytes(9).toString('hex')])
    const order = await c.ok('POST', '/sale', body([item(receipt.product, quantity)]))
    await c.ok('POST', `/sale/${order.id}/reserve`, {})
    await c.ok('POST', `/sale/${order.id}/ship`, {})
    const taskId = Number((await c.one('SELECT task_id FROM sale_orders WHERE id=?', [order.id])).task_id)
    const taskItem = await c.one('SELECT id FROM warehouse_task_items WHERE task_id=?', [taskId])
    await c.ok('POST', '/scan-logs', { taskId, itemId: taskItem.id, containerId: receipt.containerId, barcode: receipt.barcode, productId: receipt.product.id, qty: quantity, scanMode: '整件' }, { headers: c.a.headers })
    await c.ok('PUT', `/warehouse-tasks/${taskId}/ready`, {}, { headers: c.a.headers })
    await c.ok('PUT', `/warehouse-tasks/${taskId}/sort-done`, {}, { headers: c.a.headers })
    await c.ok('POST', '/scan-logs/check', { taskId, barcode: receipt.barcode }, { headers: c.a.headers })
    const pack = await c.ok('POST', '/packages', { warehouseTaskId: taskId }, { headers: c.a.headers })
    await c.ok('POST', `/packages/${pack.id}/add-item`, { productCode: receipt.product.code, qty: quantity }, { headers: c.a.headers })
    await c.ok('PUT', `/packages/${pack.id}/finish`, {}, { headers: c.a.headers })
    return { ...receipt, orderId: order.id, taskId, packageId: pack.id }
  }
  try {
    await test('跨资源不同新键：双RR事务预读屏障后可独立插入', async () => {
        const auditHelper = c.req('backend/src/modules/document-activity/document-change-audit')
        const operation = c.req('backend/src/utils/operationRequest')
        const connections = await Promise.all([c.apiPool.getConnection(), c.apiPool.getConnection()])
        try {
          const isolations = await Promise.all(connections.map(async conn => (await conn.query('SELECT @@transaction_isolation AS isolation'))[0][0].isolation))
          assert.deepEqual(isolations, ['REPEATABLE-READ', 'REPEATABLE-READ'])
          await Promise.all(connections.map(conn => conn.beginTransaction()))
          const intents = connections.map((_, index) => ({ requestKey: `zz-change-gap-${crypto.randomUUID()}-${index}`, action: `sale.update.${index + 1}`, userId: c.userId, payload: { synthetic: index } }))
          const fingerprints = await Promise.all(connections.map((conn, index) => auditHelper.assertChangeRequest(conn, intents[index])))
          const outcomes = await Promise.allSettled(connections.map((conn, index) => operation.beginOperationRequest(conn, intents[index])))
          assert.deepEqual(outcomes.map(result => result.status === 'fulfilled' ? 'inserted' : result.reason.code || result.reason.message), ['inserted', 'inserted'], '不同新键预读不能相互持gap锁造成死锁')
          await Promise.all(connections.map((conn, index) => auditHelper.bindChangeRequest(conn, outcomes[index].value, fingerprints[index])))
          return { outcomes: outcomes.map(result => result.status), isolations, keys: 'synthetic distinct new keys' }
        } finally {
          await Promise.all(connections.map(conn => conn.rollback()))
          connections.forEach(conn => conn.release())
        }
    })
    if (process.env.FLOWCUBE_CHANGE_GAP_PROBE === '1') {
      assert.deepEqual(cases, [], '真实跨资源预读有失败')
      return
    }
    await test('审计迁移重复执行与未知字段形状拒绝', async () => {
      const fs = require('node:fs'), path = require('node:path')
      const { splitSqlStatements } = c.req('backend/src/database/sqlStatements')
      const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, '../backend/src/database/286_document_change_audit.sql'), 'utf8'))
      const conn = await c.pool.getConnection()
      const apply = async () => { for (const statement of statements) await conn.query(statement) }
      try {
        await apply(); await apply()
        await conn.query('ALTER TABLE document_operation_events MODIFY COLUMN business_event_key VARCHAR(161) DEFAULT NULL')
        try { await assert.rejects(apply, { code: 'ER_NO_SUCH_TABLE' }, 'column-length drift') }
        finally { await conn.query('ALTER TABLE document_operation_events MODIFY COLUMN business_event_key VARCHAR(160) DEFAULT NULL') }
        await apply()
        const indexDriftRejected = []
        for (const [shape, statement] of [
          ['prefix', 'ALTER TABLE document_operation_events DROP INDEX uk_document_business_event, ADD UNIQUE KEY uk_document_business_event (document_type,document_id,business_event_key(8))'],
          ['invisible', 'ALTER TABLE document_operation_events ALTER INDEX uk_document_business_event INVISIBLE'],
        ]) {
          await conn.query(statement)
          const [drift] = await conn.query("SELECT SUB_PART,IS_VISIBLE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND INDEX_NAME='uk_document_business_event'")
          assert.ok(shape === 'prefix' ? drift.some(row => Number(row.SUB_PART) === 8) : drift.every(row => row.IS_VISIBLE === 'NO'), `index-${shape} fixture must actually change shape: ${JSON.stringify(drift)}`)
          try { await assert.rejects(apply, { code: 'ER_NO_SUCH_TABLE' }, `index-${shape} drift`); indexDriftRejected.push(shape) }
          finally {
            await conn.query('ALTER TABLE document_operation_events DROP INDEX uk_document_business_event, ADD UNIQUE KEY uk_document_business_event (document_type,document_id,business_event_key)')
            await conn.query('ALTER TABLE document_operation_events ALTER INDEX uk_document_business_event VISIBLE')
            await apply()
          }
        }
        const [index] = await conn.query("SELECT COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE,SUB_PART,INDEX_TYPE,IS_VISIBLE,COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_operation_events' AND INDEX_NAME='uk_document_business_event' ORDER BY SEQ_IN_INDEX")
        assert.deepEqual(index.map(row => row.COLUMN_NAME), ['document_type', 'document_id', 'business_event_key'])
        assert.ok(index.every(row => Number(row.NON_UNIQUE) === 0))
        assert.ok(index.every(row => row.SUB_PART === null && row.INDEX_TYPE === 'BTREE' && row.IS_VISIBLE === 'YES' && row.COLLATION === 'A'))
        return { repeated: 2, driftRejected: true, indexDriftRejected, restoredLength: 160, index }
      } finally { conn.release() }
    })
    if (process.env.FLOWCUBE_CHANGE_MIGRATION_PROBE === '1') {
      assert.deepEqual(cases, [], '真实审计迁移有失败')
      return
    }
    const a = await c.product('A'), b = await c.product('B'), d = await c.product('D')
    const draft = await c.ok('POST', '/sale', body([item(a, 1, 20.0001), item(b, 2)]))
    c.guiSaleId = draft.id
    c.guiSaleNo = draft.orderNo
    await test('普通删除重建行：数量两位、微小改价四位、增删与认证操作者', async () => {
      const before = await c.ok('GET', `/sale/${draft.id}`)
      c.guiSaleNo = before.orderNo
      const requestBody = { ...body([item(a, 1.25, 20.0002), item(d, 3)]), expectedEditFingerprint: before.editFingerprint, changeReason: '合成核对差额' }
      const key = crypto.randomUUID(), [first, concurrent] = await Promise.all([c.request('PUT', `/sale/${draft.id}`, requestBody, { key }), c.request('PUT', `/sale/${draft.id}`, requestBody, { key })])
      success(first)
      success(concurrent)
      const replay = await c.request('PUT', `/sale/${draft.id}`, requestBody, { key }); success(replay)
      const rows = await audit('sale', draft.id); assert.equal(rows.length, 1)
      const payload = rows[0].payload
      assert.equal(payload.reason, requestBody.changeReason)
      assert.equal(payload.actors.operator.id, c.userId)
      const changed = payload.rows.find(row => row.before?.productId === a.id)
      assert.equal(changed.before.unitPrice, '20.0001'); assert.equal(changed.after.unitPrice, '20.0002')
      assert.equal(changed.before.quantity, '1.00'); assert.equal(changed.after.quantity, '1.25')
      assert.ok(payload.rows.some(row => row.action === 'removed' && row.before.productId === b.id))
      assert.ok(payload.rows.some(row => row.action === 'added' && row.after.productId === d.id))
      const conflict = await c.request('PUT', `/sale/${draft.id}`, { ...requestBody, changeReason: '另一正文' }, { key }); assert.equal(conflict.status, 409)
      const activity = await c.ok('GET', `/document-activity/sale/${draft.id}`)
      assert.equal(activity.events.filter(event => event.payload?.version === 1).length, 1)
      assert.equal(activity.events.filter(event => /编辑订单|修改明细|修改单据/.test(event.title)).length, 1, '回放请求不可被显示为第二次修改，包括旧兼容操作日志')
      return { id: draft.id, firstStatus: first.status, concurrentStatus: concurrent.status, replayStatus: replay.status, conflictStatus: conflict.status, payload }
    })
    await test('无变化不追加有效差异；旧客户端无原因仍可改量', async () => {
      const before = (await audit('sale', draft.id)).length
      success(await edit(draft.id, [item(a, 1.25, 20.0002), item(d, 3)], undefined))
      assert.equal((await audit('sale', draft.id)).length, before)
      success(await edit(draft.id, [item(a, 1.5, 20.0002), item(d, 3)], undefined))
      const rows = await audit('sale', draft.id); assert.equal(rows.length, before + 1); assert.equal(rows.at(-1).payload.reason, null)
      return { id: draft.id, payload: rows.at(-1).payload }
    })
    await test('差异写入失败：真实业务与回执同事务回滚，原键可重试', async () => {
      const detail = await c.ok('GET', `/sale/${draft.id}`), before = await c.rows('SELECT id,quantity,unit_price FROM sale_order_items WHERE order_id=? ORDER BY id', [draft.id])
      const count = (await audit('sale', draft.id)).length, key = crypto.randomUUID()
      const requestBody = { ...body([item(a, 1.75, 20.0003), item(d, 3)]), expectedEditFingerprint: detail.editFingerprint, changeReason: '合成回滚' }
      await c.pool.query(`CREATE TRIGGER change_records_fail BEFORE INSERT ON document_operation_events FOR EACH ROW BEGIN IF NEW.document_type='sale' AND NEW.document_id=${Number(draft.id)} AND NEW.payload_version=1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit rollback'; END IF; END`)
      let failed
      try { failed = await c.request('PUT', `/sale/${draft.id}`, requestBody, { key }); assert.equal(failed.status, 500) }
      finally { await c.pool.query('DROP TRIGGER change_records_fail') }
      assert.deepEqual(await c.rows('SELECT id,quantity,unit_price FROM sale_order_items WHERE order_id=? ORDER BY id', [draft.id]), before)
      assert.equal((await audit('sale', draft.id)).length, count)
      assert.equal(Number((await c.one('SELECT COUNT(*) n FROM operation_requests WHERE request_key=?', [key])).n), 0)
      success(await c.request('PUT', `/sale/${draft.id}`, requestBody, { key }))
      assert.equal((await audit('sale', draft.id)).length, count + 1)
      return { id: draft.id, failedStatus: failed.status, auditCountBefore: count, auditCountAfterRetry: count + 1 }
    })
    await test('商业套件：主行lineKey及物料快照真实前后差异', async () => {
      const kit = await c.ok('POST', '/kits', { name: c.mark + 'kit', referenceUnitPrice: 60, components: [{ productId: a.id, baseQty: 1 }, { productId: b.id, baseQty: 2 }] })
      const groups = quantity => [{ kind: 'kit', lineKey: 'synthetic-kit', kitVersionId: kit.currentVersionId, quantity, unitPrice: 60.0001, priceSource: 'manual' }]
      const order = await c.ok('POST', '/sale', { ...body([]), items: undefined, commercialModel: 'kit-v1', commercialGroups: groups(1) })
      const detail = await c.ok('GET', `/sale/${order.id}`)
      success(await c.request('PUT', `/sale/${order.id}`, { ...body([]), items: undefined, commercialModel: 'kit-v1', expectedRevision: detail.commercialRevision, commercialGroups: groups(2), changeReason: '合成成套增量' }))
      const payload = (await audit('sale', order.id))[0].payload
      const row = payload.rows.find(row => row.before?.kitVersionId === kit.currentVersionId)
      assert.ok(row); assert.equal(row.before.quantity, '1.00'); assert.equal(row.after.quantity, '2.00')
      assert.equal(row.before.unitPrice, '60.0001'); assert.ok(row.before.components.length >= 2)
      return { id: order.id, payload }
    })
    await test('价格表批量真实增删改、四位价格与同键回放', async () => {
      const list = await c.ok('POST', '/price-lists', { name: c.mark + '价格表' })
      await c.ok('PUT', `/price-lists/${list.id}/items`, { items: [{ productId: a.id, salePrice: 20.0001 }, { productId: b.id, salePrice: 21 }] })
      const payload = { items: [{ productId: a.id, salePrice: 20.0002 }, { productId: d.id, salePrice: 22 }], changeReason: '合成批量报价' }, key = crypto.randomUUID()
      await c.ok('PUT', `/price-lists/${list.id}/items`, payload, { key }); await c.ok('PUT', `/price-lists/${list.id}/items`, payload, { key })
      const rows = await audit('price-list', list.id); assert.equal(rows.length, 2)
      const changes = rows.at(-1).payload.rows
      assert.equal(changes.find(row => row.before?.productId === a.id).before.unitPrice, '20.0001')
      assert.equal(changes.find(row => row.after?.productId === a.id).after.unitPrice, '20.0002')
      assert.ok(changes.some(row => row.action === 'removed' && row.before.productId === b.id)); assert.ok(changes.some(row => row.action === 'added' && row.after.productId === d.id))
      const conflict = await c.request('PUT', `/price-lists/${list.id}/items`, { ...payload, changeReason: '异正文' }, { key }); assert.equal(conflict.status, 409)
      return { id: list.id, payload: rows.at(-1).payload, conflictStatus: conflict.status }
    })
    await test('商品价以最终DECIMAL为准；旧价链和权威历史关联', async () => {
      const category = await c.ok('POST', '/categories', { name: c.mark + '价格分类' })
      const base = { name: c.mark + '价格商品', categoryId: category.id, supplierId: c.supplier.id, unit: '个', spec: '合成型号', color: '合成色', costPrice: 10, salePriceA: 1.2345, salePriceB: 2, salePriceC: 3, salePriceD: 4, isActive: true }
      const p = await c.ok('POST', '/products', base)
      const detail = await c.ok('GET', `/products/${p.id}`)
      await c.ok('PUT', `/products/${p.id}`, { ...base, revision: detail.revision, salePriceA: 1.23450001 })
      assert.equal(Number((await c.one('SELECT sale_price_a FROM product_items WHERE id=?', [p.id])).sale_price_a), 1.2345)
      assert.equal(Number((await c.one('SELECT COUNT(*) n FROM product_price_history WHERE product_id=?', [p.id])).n), 0, '落库未变不得写虚假价格历史')
      assert.equal((await audit('product', p.id)).length, 0)
      const current = await c.ok('GET', `/products/${p.id}`), key = crypto.randomUUID()
      const changed = { ...base, revision: current.revision, salePriceA: 1.2346, changeReason: '合成价格核对' }
      await c.ok('PUT', `/products/${p.id}`, changed, { key }); await c.ok('PUT', `/products/${p.id}`, changed, { key })
      const history = await c.rows('SELECT id,old_price,new_price,operator_id FROM product_price_history WHERE product_id=? ORDER BY id', [p.id])
      assert.equal(history.length, 1); assert.equal(history[0].old_price, '1.2345'); assert.equal(history[0].new_price, '1.2346'); assert.equal(Number(history[0].operator_id), c.userId)
      const records = await audit('product', p.id); assert.equal(records.length, 1); assert.deepEqual(records[0].payload.context.priceHistoryIds, [Number(history[0].id)])
      const activity = await c.ok('GET', `/document-activity/product/${p.id}`)
      assert.equal(activity.events.filter(event => event.payload?.version === 1).length, 1)
      return { id: p.id, history, payload: records[0].payload }
    })
    await test('固定单位商业减量：当前数量与原价留存，新辅助单位录入拒绝', async () => {
      const p = await c.product('AUX')
      await c.pool.query("INSERT INTO product_units (product_id,unit_name,conversion_rate) VALUES (?,'箱',10)", [p.id])
      const groups = quantity => [{ kind: 'ordinary', lineKey: 'synthetic-aux', productId: p.id, entryUnit: '个', quantity, unitPrice: 10.0001, priceSource: 'manual' }]
      const invalid = await c.request('POST', '/sale', { ...body([]), items: undefined, commercialModel: 'kit-v1', commercialGroups: [{ ...groups(1)[0], entryUnit: '箱' }] })
      assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'SALE_FIXED_UNIT_REQUIRED')
      const order = await c.ok('POST', '/sale', { ...body([]), items: undefined, commercialModel: 'kit-v1', commercialGroups: groups(10) })
      const detail = await c.ok('GET', `/sale/${order.id}`)
      await c.ok('PUT', `/sale/${order.id}`, { ...body([]), items: undefined, commercialModel: 'kit-v1', expectedRevision: detail.commercialRevision, commercialGroups: groups(5), changeReason: '合成固定单位减量' })
      const payload = (await audit('sale', order.id))[0].payload
      const group = payload.rows.find(row => row.key === 'group:synthetic-aux')
      assert.ok(group); assert.equal(group.before.quantity, '10.00'); assert.equal(group.after.quantity, '5.00')
      assert.equal(group.before.entryQty, '10.00'); assert.equal(group.after.entryQty, '5.00', '当前数量不能沿用旧录入10个')
      assert.equal(group.after.entryUnitPrice, '10.0001')
      assert.ok(group.after.baseUnitPriceExact)
      return { id: order.id, payload }
    })
    await test('批准改价：审批当刻旧价、认证批准人与原申请人分别记录', async () => {
      const bcrypt = c.req('backend/node_modules/bcryptjs'), password = crypto.randomBytes(24).toString('hex'), name = c.mark + '-approver'
      const approverId = await c.insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active,allow_self_approve) VALUES (?,?,?,1,?,1,0)', [name, await bcrypt.hash(password, 10), name, name])
      const approverAuth = await c.ok('POST', '/auth/login', { username: name, password })
      const flowId = await c.insert("INSERT INTO approval_flows(biz_type,name,min_amount,is_active) VALUES ('product_price',?,1,1)", [c.mark + '-flow'])
      await c.pool.query('INSERT INTO approval_flow_steps(flow_id,step_order,approver_type,user_id) VALUES (?,1,3,?)', [flowId, approverId])
      const category = await c.ok('POST', '/categories', { name: c.mark + '-approval-category' })
      const fields = { name: c.mark + '-approval-product', categoryId: category.id, supplierId: c.supplier.id, unit: '个', spec: '合成型号', color: '合成色', costPrice: 10, salePriceA: 1.2345, salePriceB: 2, salePriceC: 3, salePriceD: 4, isActive: true }
      const product = await c.ok('POST', '/products', fields)
      const application = await c.ok('POST', '/price-change', { productId: product.id, priceType: 'a', newPrice: 1.2347, reason: '合成批准价格' })
      await c.ok('POST', `/price-change/${application.id}/submit`, {})
      const detail = await c.ok('GET', `/products/${product.id}`)
      await c.ok('PUT', `/products/${product.id}`, { ...fields, revision: detail.revision, salePriceA: 1.2348 })
      const approved = await c.ok('POST', `/price-change/${application.id}/approve`, {}, { headers: { Authorization: 'Bearer ' + approverAuth.token } }); assert.equal(approved.finished, true)
      await c.pool.query('UPDATE approval_flows SET is_active=0 WHERE id=?', [flowId])
      const history = await c.rows("SELECT id,old_price,new_price,operator_id FROM product_price_history WHERE product_id=? AND change_source='approval'", [product.id])
      assert.equal(history.length, 1); assert.equal(history[0].old_price, '1.2348'); assert.equal(history[0].new_price, '1.2347'); assert.equal(Number(history[0].operator_id), approverId)
      assert.equal(Number((await c.one('SELECT old_price FROM price_change_requests WHERE id=?', [application.id])).old_price), 1.2345, '申请时展示快照仍保持原事实')
      const records = await audit('price', application.id); assert.equal(records.length, 1)
      assert.equal(records[0].payload.actors.applicant.id, c.userId); assert.equal(records[0].payload.actors.approver.id, approverId); assert.equal(records[0].payload.actors.operator.id, approverId)
      assert.deepEqual(records[0].payload.context.priceHistoryIds, [Number(history[0].id)])
      return { productId: product.id, applicationId: application.id, applicantId: c.userId, approverId, history, payload: records[0].payload }
    })
    await test('执行期改单交接：同原因、挂起守卫、先拆箱后归还及真实确认人', async () => {
      const sample = await packedSale('HANDOFF')
      c.guiHandoffSaleId = sample.orderId
      const result = success(await edit(sample.orderId, [item(sample.product, 1)], '合成仓库交接', {}, '/adjust'))
      assert.equal(result.pending, true)
      c.guiAdjustmentId = result.adjustmentId
      const before = await c.ok('GET', `/warehouse-tasks/adjustments/${result.adjustmentId}`)
      assert.equal(before.handoff.reason, '合成仓库交接'); assert.equal(before.handoff.requestedBy.id, c.userId)
      assert.ok(before.handoff.requestedAt); assert.equal(before.handoff.phase, 'pending'); assert.equal(before.handoff.completedAt, null)
      const serialized = JSON.stringify(before)
      assert.ok(!/"(?:unitPrice|unit_price|amount|requestFingerprint|priceHistoryIds)"/.test(serialized), '仓库交接不下发销售价或请求指纹')
      const change = (await audit('sale', sample.orderId)).at(-1).payload
      assert.equal(change.reason, before.handoff.reason); assert.equal(change.context.adjustmentId, result.adjustmentId)
      const task = await c.one('SELECT status,adjustment_requested_at FROM warehouse_tasks WHERE id=?', [sample.taskId])
      assert.equal(Number(task.status), 4); assert.ok(task.adjustment_requested_at)
      assert.equal(Number((await c.one('SELECT status FROM packages WHERE id=?', [sample.packageId])).status), 3)
      const blocked = await c.request('PUT', `/warehouse-tasks/${sample.taskId}/check-done`, {}, { headers: c.a.headers }); assert.equal(blocked.status, 409)
      const row = before.items[0], voidId = row.packageVoids[0].id, returnId = row.containerReturns[0].id
      assert.equal(row.oldRequiredQty, 2); assert.equal(row.newRequiredQty, 1)
      assert.equal(row.packageVoids[0].confirmedBy, null); assert.equal(row.containerReturns[0].confirmedAt, null)
      const wrongWarehouse = await c.request('POST', `/warehouse-tasks/adjustments/package-voids/${voidId}/confirm`, {}, { headers: c.b.headers }); assert.equal(wrongWarehouse.status, 403)
      assert.equal((await c.ok('GET', `/warehouse-tasks/adjustments/${result.adjustmentId}`)).items[0].packageVoids[0].status, 1)
      const first = await c.ok('POST', `/warehouse-tasks/adjustments/package-voids/${voidId}/confirm`, {}, { headers: c.a.headers }); assert.equal(first.finalized, false)
      const pending = await c.ok('GET', `/warehouse-tasks/adjustments/${result.adjustmentId}`)
      assert.equal(pending.handoff.phase, 'pending'); assert.equal(pending.items[0].packageVoids[0].confirmedBy.id, c.userId); assert.ok(pending.items[0].packageVoids[0].confirmedAt)
      const final = await c.ok('POST', `/warehouse-tasks/adjustments/container-returns/${returnId}/confirm`, { targetLocationId: c.a.location }, { headers: c.a.headers }); assert.equal(final.finalized, true)
      const completed = await c.ok('GET', `/warehouse-tasks/adjustments/${result.adjustmentId}`)
      assert.equal(completed.handoff.phase, 'completed'); assert.ok(completed.handoff.completedAt)
      assert.equal(completed.items[0].containerReturns[0].confirmedBy.id, c.userId); assert.ok(completed.items[0].containerReturns[0].confirmedAt)
      assert.equal((await c.one('SELECT adjustment_requested_at FROM warehouse_tasks WHERE id=?', [sample.taskId])).adjustment_requested_at, null)
      assert.equal(Number((await c.one("SELECT SUM(qty) qty FROM stock_reservations WHERE ref_type='sale_order' AND ref_id=? AND status=1", [sample.orderId])).qty), 1)
      const activity = await c.ok('GET', `/document-activity/sale/${sample.orderId}`)
      c.guiHandoffSaleNo = (await c.ok('GET', `/sale/${sample.orderId}`)).orderNo
      const handoffRow = activity.sections.find(section => section.title === '仓库交接')?.rows.find(row => row.reason === '合成仓库交接' && row.phase === '已完成')
      assert.ok(handoffRow)
      assert.equal(Number(handoffRow.adjustmentId), Number(result.adjustmentId))
      assert.ok(handoffRow.adjustmentNo, '销售交接必须显示实际调整编号')
      c.guiAdjustmentNo = handoffRow.adjustmentNo
      const confirmations = activity.sections.find(section => section.title === '仓库确认记录')?.rows
      assert.equal(confirmations?.length, 2)
      assert.ok(confirmations.every(row => Number(row.adjustmentId) === Number(result.adjustmentId) && row.adjustmentNo === handoffRow.adjustmentNo))
      return { saleId: sample.orderId, taskId: sample.taskId, adjustmentId: result.adjustmentId, pendingHandoff: before.handoff, completedHandoff: completed.handoff, confirmations: completed.items[0], blockedStatus: blocked.status, wrongWarehouseStatus: wrongWarehouse.status }
    })
    await test('取消交接：原意图原因复用，拆箱和实物归还才结束', async () => {
      const sample = await packedSale('CANCEL')
      const key = crypto.randomUUID(), requestBody = { changeReason: '合成取消交接' }
      await c.ok('POST', `/sale/${sample.orderId}/cancel`, requestBody, { key })
      await c.ok('POST', `/sale/${sample.orderId}/cancel`, requestBody, { key })
      const detail = await c.ok('GET', `/warehouse-tasks/${sample.taskId}/cancel-return-detail`)
      assert.equal(detail.handoff.reason, requestBody.changeReason); assert.equal(detail.handoff.requestedBy.id, c.userId); assert.equal(detail.handoff.phase, 'pending')
      assert.equal((await audit('sale', sample.orderId)).filter(row => row.payload.context.phase === 'cancellation_requested').length, 1)
      assert.equal(detail.containers.length, 1); assert.equal(detail.packages.length, 1)
      const before = await c.one('SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [sample.containerId]); assert.equal(Number(before.locked_by_task_id), sample.taskId)
      const box = await c.ok('POST', '/scan-logs/cancel-return/box', { taskId: sample.taskId, packageId: sample.packageId, barcode: detail.packages[0].barcode }, { headers: c.a.headers }); assert.equal(box.finalized, false)
      const returnKey = crypto.randomUUID(), returnBody = { taskId: sample.taskId, containerId: sample.containerId, barcode: sample.barcode, locationId: c.a.location }
      const returned = await c.ok('POST', '/scan-logs/cancel-return', returnBody, { headers: c.a.headers, key: returnKey }); assert.equal(returned.finalized, true)
      await c.ok('POST', '/scan-logs/cancel-return', returnBody, { headers: c.a.headers, key: returnKey })
      const completed = await c.ok('GET', `/warehouse-tasks/${sample.taskId}/cancel-return-detail`)
      assert.equal(completed.handoff.phase, 'completed')
      assert.ok(completed.confirmations.some(row => row.kind === 'package_void' && row.confirmedBy?.id === c.userId && row.confirmedAt))
      assert.ok(completed.confirmations.some(row => row.kind === 'container_return' && row.confirmedBy?.id === c.userId && row.confirmedAt))
      assert.equal(Number((await c.one('SELECT status FROM warehouse_tasks WHERE id=?', [sample.taskId])).status), 8)
      assert.equal((await c.one('SELECT locked_by_task_id FROM inventory_containers WHERE id=?', [sample.containerId])).locked_by_task_id, null)
      return { saleId: sample.orderId, taskId: sample.taskId, pendingHandoff: detail.handoff, completedHandoff: completed.handoff, confirmations: completed.confirmations, returnReplay: true }
    })
    await test('历史他仓任务：头仓可读也不授权新增交接资料', async () => {
      const order = await c.ok('POST', '/sale', body([item(a, 1)]))
      // Synthetic persisted history models a cancelled task whose old warehouse
      // item is no longer in the current order; it does not run physical scans.
      const taskId = await c.insert('INSERT INTO warehouse_tasks(task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status) VALUES (?,?,?,?,?,?,?,8)', [c.mark + '-scopeWT', order.id, order.orderNo || c.mark, c.customer.id, c.customer.name, c.b.id, c.b.name])
      const reason = '合成历史他仓交接'
      const payload = { version: 1, kind: 'line_changes', quantityScale: 2, priceScale: 4, reason, actors: { operator: { id: c.userId, name: c.mark } }, rows: [], context: { phase: 'cancellation_requested', warehouseTaskIds: [taskId] } }
      await c.pool.query("INSERT INTO document_operation_events(document_type,document_id,title,created_by,created_by_name,payload_version,payload_json) VALUES ('sale',?,'合成历史取消',?,?,1,?)", [order.id, c.userId, c.mark, JSON.stringify(payload)])
      await c.pool.query('INSERT INTO warehouse_task_events(task_id,task_no,event_type,operator_id,operator_name,detail) VALUES ?', [[[taskId, c.mark + '-scopeWT', 'CANCEL_REQUESTED', c.userId, c.mark, null], [taskId, c.mark + '-scopeWT', 'CANCEL_RETURN_BOX_SCAN', c.userId, c.mark, JSON.stringify({ barcode: c.mark + '-SCOPEBOX' })], [taskId, c.mark + '-scopeWT', 'CANCEL_FINALIZED', c.userId, c.mark, null]]])
      const all = await c.ok('GET', `/document-activity/sale/${order.id}`)
      const handoff = section => section.title === '仓库交接' || section.title === '仓库确认记录'
      assert.ok(all.sections.filter(handoff).some(section => section.rows.some(row => row.reason === reason)))
      const roleId = await c.insert('INSERT INTO sys_roles(code,name) VALUES (?,?)', [c.mark + '-reader', c.mark + '-reader'])
      await c.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [roleId, c.req('backend/src/constants/permissions').PERMISSIONS.SALE_ORDER_VIEW])
      const password = crypto.randomBytes(24).toString('hex'), username = c.mark + '-reader'
      const id = await c.insert('INSERT INTO sys_users(username,password,real_name,role_id,role_name,is_active) VALUES (?,?,?,?,?,1)', [username, await c.req('backend/node_modules/bcryptjs').hash(password, 10), username, roleId, username])
      await c.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [id, c.a.id])
      const auth = await c.ok('POST', '/auth/login', { username, password })
      const scoped = await c.ok('GET', `/document-activity/sale/${order.id}`, undefined, { headers: { Authorization: 'Bearer ' + auth.token } })
      assert.ok(scoped.sections.filter(handoff).every(section => section.rows.length === 0), '原单头可读不能带出旧他仓新增交接人/原因/确认')
      assert.ok(!JSON.stringify(scoped).includes(reason), '他仓原因不得从整条事件正文回流')
      assert.ok(!scoped.events.some(event=>event.id.startsWith('warehouse-')), '他仓仓库事件摘要和人员同样不得回流')
      const helper = c.req('backend/src/modules/warehouse-tasks/warehouse-tasks.handoff')
      assert.deepEqual(await helper.readTaskHandoffs(c.pool, [taskId], [], []), { rows: [], confirmations: [] })
      return { saleId: order.id, historicalTaskId: taskId, historicalWarehouseId: c.b.id, readerWarehouseId: c.a.id, allHandoffRows: all.sections.filter(handoff).flatMap(section => section.rows).length, scopedHandoffRows: 0, fixture: '合成历史落库状态与真实查询/权限；不代表额外实物扫码验收' }
    })
    await require('./helpers/changeRecordsActivityScope').runActivityScopeCases(c, test)
    await require('./helpers/changeRecordsPrint').runPrintCases(c, test, { packedSale })
    if (process.env.FLOWCUBE_CHANGE_GUI === '1') await test('真实Chromium GUI：默认收起、四位差异及既有记录入口', () => require('./helpers/changeRecordsGui').runGui(c, { adjustmentId: c.guiAdjustmentId, handoffSaleId: c.guiHandoffSaleId, barcode: c.guiBarcode }))
  } finally { await c.close() }
  assert.deepEqual(cases, [], '真实合成链路有失败')
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
