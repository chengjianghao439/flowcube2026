'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { PERMISSIONS: P } = require('../backend/src/constants/permissions')
const { makeInboundEditRuntimeFixture, must } = require('./helpers/inboundEditRuntimeFixture')
const ctx = makeInboundEditRuntimeFixture()
before(async () => { await ctx.setup() })
after(async () => { await ctx.close() })
const list = value => Array.isArray(value) ? value : value?.list
const invalidHighFreight = [999999999999.9803, 999999999999.9802, 100000000000.01003]
const maximumFreight = 999999999999.99
function reject(response, statuses, code) {
  assert.ok((Array.isArray(statuses) ? statuses : [statuses]).includes(response.status), `预期拒绝${statuses}，实际HTTP ${response.status}: ${response.data?.message || ''}`)
  assert.equal(response.data.success, false)
  if (code) assert.equal(response.data.code, code)
}
async function unchanged(id, context, body, options) {
  const before = await ctx.taskFacts(id), key = options?.key || randomUUID()
  const response = await ctx.edit(id, body || ctx.body(context), { ...options, key })
  reject(response, [400, 409])
  assert.equal(response.data.data?.inboundEditNotExecuted, true, '确定未执行业务拒绝必须能安全清除本次请求')
  assert.deepEqual(await ctx.taskFacts(id), before, '拒绝必须整体回滚头、行、事件')
  assert.equal((await ctx.receipt(key)).length, 0, '拒绝不得留成功回执')
  return response
}

test('真实HTTP权限、仓库范围和当前权限前置', async () => {
  const po = await ctx.purchase(), draft = await ctx.draft(po), context = await ctx.context(draft.taskId)
  for (const user of ['viewer', 'denied']) {
    reject(await ctx.request('GET', `/inbound-tasks/${draft.taskId}/edit-context`, undefined, { user }), 403)
    reject(await ctx.edit(draft.taskId, ctx.body(context), { user }), 403)
  }
  must(await ctx.request('GET', `/inbound-tasks/${draft.taskId}`, undefined, { user: 'viewer' }))
  reject(await ctx.edit(draft.taskId, ctx.body(context), { user: 'scoped' }), 403, 'WAREHOUSE_SCOPE_DENIED')
  reject(await ctx.request('GET', `/inbound-tasks/${draft.taskId}/edit-purchase-items`, undefined, { user: 'scoped' }), 403, 'WAREHOUSE_SCOPE_DENIED')
  reject(await ctx.edit(draft.taskId, ctx.body(context), { key: null }), 400)
  const key = randomUUID(), body = ctx.body(context, undefined, { remark: '合成权限回执' })
  const ack = must(await ctx.edit(draft.taskId, body, { key }))
  const action = `inbound.update.${draft.taskId}`
  const receipt = await ctx.ok('GET', `/system/request-status/${key}?action=${action}`)
  assert.equal(receipt.status, 'success'); assert.deepEqual(receipt.data, ack)
  await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [ctx.users.editor.roleId, P.INBOUND_ORDER_UPDATE])
  try {
    reject(await ctx.edit(draft.taskId, body, { key }), 403, 'PERMISSION_DENIED')
    // Minimal own receipt recovery keeps its original ACK without granting a new write capability.
    assert.deepEqual((await ctx.ok('GET', `/system/request-status/${key}?action=${action}`)).data, ack)
  } finally { await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [ctx.users.editor.roleId, P.INBOUND_ORDER_UPDATE]) }
  // Existing same-user session retains actual current scope lookup. Revoke only this synthetic identity.
  await ctx.pool.query('DELETE FROM user_warehouse_scope WHERE user_id=? AND warehouse_id=?', [ctx.users.editor.id, ctx.warehouse.id])
  try {
    reject(await ctx.edit(draft.taskId, body, { key }), 403, 'WAREHOUSE_SCOPE_DENIED')
    reject(await ctx.request('GET', `/system/request-status/${key}?action=${action}`), 403, 'WAREHOUSE_SCOPE_DENIED')
  } finally { await ctx.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [ctx.users.editor.id, ctx.warehouse.id]) }
})

test('完整context释放自身占量；候选分页有界且按精确采购行ID返回', async () => {
  const product = await ctx.product(), po = await ctx.purchase({ quantity: 100, product }), own = await ctx.draft(po, 10)
  await ctx.draft(po, 30)
  const context = await ctx.context(own.taskId)
  assert.equal(context.supplierId, ctx.supplier.id)
  assert.match(context.expectedEditFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(context.task.items[0].purchaseItemId, po.itemId)
  const candidates = list(context.candidates)
  assert.ok(Array.isArray(candidates))
  const current = candidates.find(c => c.purchaseItemId === po.itemId)
  assert.ok(current); assert.equal(current.remainingQty, 70); assert.equal(current.assignedQty, 30)
  const exact = await ctx.ok('GET', `/inbound-tasks/${own.taskId}/edit-purchase-items?purchaseItemIds=${po.itemId}`)
  assert.deepEqual(list(exact).map(c => c.purchaseItemId), [po.itemId])
  const products = Array.from({ length: 800 }, (_, i) => ({ code: `${ctx.mark}B${i}`, name: `${ctx.mark}B${i}` }))
  await ctx.pool.query("INSERT INTO product_items(code,name,unit,cost_price,avg_cost,allow_decimal_qty) VALUES ?", [products.map(p => [p.code, p.name, '个', 10, 10, 1])])
  const rows = await ctx.rows('SELECT id,code,name FROM product_items WHERE code LIKE ? ORDER BY id', [ctx.mark + 'B%'])
  ctx.owned.products.push(...rows.map(r => Number(r.id)))
  const bulk = await ctx.purchase({ lines: rows.map(p => ({ productId: Number(p.id), productCode: p.code, productName: p.name, unit: '个', quantity: 1, unitPrice: 10 })) })
  const bulkDraft = await ctx.ok('POST', '/inbound-tasks', ctx.createBody(bulk.items.map(i => ({ purchaseItemId: Number(i.id), qty: 1 }))))
  ctx.owned.tasks.push(bulkDraft.taskId)
  const full = await ctx.context(bulkDraft.taskId)
  assert.equal(full.task.items.length, 800); assert.equal(list(full.candidates).length, 800)
  const originalIds = full.task.items.map(i => [i.purchaseItemId, i.id])
  must(await ctx.edit(bulkDraft.taskId, ctx.body(full, full.task.items.map(i => ({ purchaseItemId: i.purchaseItemId, qty: 0.5 })), { freightType: 1, freightAmount: 0 })))
  const complete = await ctx.context(bulkDraft.taskId)
  assert.equal(complete.task.items.length, 800)
  assert.deepEqual(complete.task.items.map(i => [i.purchaseItemId, i.id]), originalIds, '800行含末行ID必须完整稳定')
  assert.ok(complete.task.items.every(i => i.orderedQty === 0.5))
  const medium = await ctx.purchase({ lines: rows.slice(0,201).map(p => ({ productId: Number(p.id), productCode: p.code, productName: p.name, unit: '个', quantity: 1, unitPrice: 10 })) })
  const mediumDraft = await ctx.ok('POST', '/inbound-tasks', ctx.createBody(medium.items.map(i => ({ purchaseItemId: Number(i.id), qty: 1 }))))
  ctx.owned.tasks.push(mediumDraft.taskId)
  const mediumContext = await ctx.context(mediumDraft.taskId)
  assert.equal(mediumContext.task.items.length, 201)
  must(await ctx.edit(mediumDraft.taskId, ctx.body(mediumContext, undefined, { remark: '合成201行完整草稿' })))
  assert.deepEqual((await ctx.context(mediumDraft.taskId)).task.items.map(i => i.id), mediumContext.task.items.map(i => i.id))
  const page = await ctx.ok('GET', `/inbound-tasks/${own.taskId}/edit-purchase-items?bounded=1&page=1&pageSize=9999`)
  assert.ok(list(page).length <= 200, '查询不得无限取候选')
  assert.ok(page.pagination.total >= 201); assert.ok(page.pagination.pageSize <= 200)
  const other = await ctx.purchase({ supplier: ctx.otherSupplier })
  const foreign = await ctx.ok('GET', `/inbound-tasks/${own.taskId}/edit-purchase-items?purchaseItemIds=${other.itemId},${po.itemId}&supplierId=${ctx.otherSupplier.id}&warehouseId=${ctx.otherWarehouse.id}`)
  assert.deepEqual(list(foreign).map(c => c.purchaseItemId), [po.itemId], 'client参数不得替换可信供应商/仓库')
})

test('创建运费空值、零和两位正数持久，非法类型金额拒绝且无库存财务成本打印副作用', async () => {
  const po = await ctx.purchase({ quantity: 100 }), compatibilityPo = await ctx.purchase({ quantity: 1 }), before = await ctx.sideEffects()
  for (const freight of [{ freightType: null, freightAmount: null }, { freightType: 1, freightAmount: 0 }, { freightType: 2, freightAmount: 12.34 }, { freightType: 3, freightAmount: 0 }, { freightType: 2, freightAmount: maximumFreight }]) {
    const draft = await ctx.draft(po, 2, freight), read = await ctx.ok('GET', `/inbound-tasks/${draft.taskId}`)
    assert.equal(read.freightType, freight.freightType); assert.equal(read.freightAmount, freight.freightAmount)
    const persisted = await ctx.one('SELECT freight_type,freight_amount FROM inbound_tasks WHERE id=?', [draft.taskId])
    assert.equal(persisted.freight_type, freight.freightType); assert.equal(persisted.freight_amount == null ? null : Number(persisted.freight_amount), freight.freightAmount)
    if (freight.freightAmount === maximumFreight) assert.equal(String(persisted.freight_amount), '999999999999.99', 'DECIMAL(14,2)合法上界必须精确记录')
  }
  const compatibility = await ctx.ok('POST', '/inbound-tasks', { poId: compatibilityPo.id, freightType: 1, freightAmount: 0 })
  ctx.owned.tasks.push(compatibility.taskId)
  const compatibilityRead = await ctx.ok('GET', `/inbound-tasks/${compatibility.taskId}`)
  assert.equal(compatibilityRead.freightType, 1); assert.equal(compatibilityRead.freightAmount, 0)
  for (const freight of [{ freightType: 0 }, { freightType: 4 }, { freightAmount: -1 }, { freightAmount: 0.001 }, { freightAmount: 1.005 }, ...invalidHighFreight.map(freightAmount => ({ freightAmount }))]) {
    const key = randomUUID()
    const tasks = await ctx.rows('SELECT id FROM inbound_tasks ORDER BY id')
    reject(await ctx.request('POST', '/inbound-tasks', ctx.createBody([{ purchaseItemId: po.itemId, qty: 1 }], freight), { key }), 400)
    assert.deepEqual(await ctx.rows('SELECT id FROM inbound_tasks ORDER BY id'), tasks)
    assert.equal((await ctx.receipt(key)).length, 0, '创建非法高值运费不得留成功回执')
  }
  assert.deepEqual(await ctx.sideEffects(), before)
})

test('编辑整单备注、运费、数量和来源增删，保留仍在的原行ID与原PO成本', async () => {
  const product = await ctx.product(), a = await ctx.purchase({ product }), b = await ctx.purchase({ product }), c = await ctx.purchase()
  const draft = await ctx.draft(a, 5), first = await ctx.context(draft.taskId), oldId = first.task.items[0].id
  const before = await ctx.sideEffects()
  const key = randomUUID(), body = ctx.body(first, [{ purchaseItemId: a.itemId, qty: 4.25 }, { purchaseItemId: b.itemId, qty: 3 }, { purchaseItemId: c.itemId, qty: 1 }], { remark: '合成整单编辑', freightType: 3, freightAmount: 12.34 })
  const ack = must(await ctx.edit(draft.taskId, body, { key }))
  assert.equal(ack.taskId, draft.taskId); assert.equal(ack.taskNo, draft.taskNo); assert.ok(ack.expectedEditFingerprint)
  const read = await ctx.ok('GET', `/inbound-tasks/${draft.taskId}`)
  assert.equal(read.remark, body.remark); assert.equal(read.freightAmount, 12.34); assert.equal(read.freightType, 3)
  assert.deepEqual(read.items.map(i => [i.purchaseItemId, i.orderedQty]).sort((a,b) => a[0]-b[0]), [[a.itemId,4.25],[b.itemId,3],[c.itemId,1]])
  assert.equal(read.items.find(i => i.purchaseItemId === a.itemId).id, oldId)
  assert.deepEqual(must(await ctx.edit(draft.taskId, body, { key })), ack)
  const originalFacts = await ctx.taskFacts(draft.taskId)
  const conflict = await ctx.edit(draft.taskId, { ...body, remark: '同键不同载荷' }, { key })
  reject(conflict, 409, 'INBOUND_EDIT_REQUEST_CONFLICT')
  assert.notEqual(conflict.data.data?.inboundEditNotExecuted, true)
  assert.deepEqual(await ctx.taskFacts(draft.taskId), originalFacts)
  const current = await ctx.context(draft.taskId)
  assert.notEqual(current.expectedEditFingerprint, first.expectedEditFingerprint)
  must(await ctx.edit(draft.taskId, ctx.body(current, [{ purchaseItemId: a.itemId, qty: 2 }], { freightType: null, freightAmount: null })))
  const final = await ctx.ok('GET', `/inbound-tasks/${draft.taskId}`)
  assert.equal(final.items.length, 1); assert.equal(final.items[0].id, oldId)
  assert.equal(final.freightType, null); assert.equal(final.freightAmount, null)
  const precisionContext = await ctx.context(draft.taskId), precisionFacts = await ctx.taskFacts(draft.taskId)
  for (const freightAmount of invalidHighFreight) {
    const invalidKey = randomUUID()
    reject(await ctx.edit(draft.taskId, ctx.body(precisionContext, undefined, { freightType: 2, freightAmount }), { key: invalidKey }), 400)
    assert.deepEqual(await ctx.taskFacts(draft.taskId), precisionFacts, '非法高值精度不得改头、原行或事件')
    assert.equal((await ctx.receipt(invalidKey)).length, 0, '非法高值精度不得留成功回执')
  }
  must(await ctx.edit(draft.taskId, ctx.body(precisionContext, undefined, { freightType: 2, freightAmount: maximumFreight })))
  const maximum = await ctx.ok('GET', `/inbound-tasks/${draft.taskId}`)
  assert.equal(maximum.freightType, 2); assert.equal(maximum.freightAmount, maximumFreight)
  assert.equal(maximum.items[0].id, oldId)
  assert.equal(String((await ctx.one('SELECT freight_amount FROM inbound_tasks WHERE id=?', [draft.taskId])).freight_amount), '999999999999.99')
  assert.deepEqual(await ctx.sideEffects(), before)
})

test('拒绝重复来源、失效来源、换供应商或仓、超量、精度与整数商品', async () => {
  const po = await ctx.purchase({ quantity: 10 }), draft = await ctx.draft(po, 3), context = await ctx.context(draft.taskId)
  const wrongSupplier = await ctx.purchase({ supplier: ctx.otherSupplier }), wrongWarehouse = await ctx.purchase({ warehouse: ctx.otherWarehouse })
  const unsubmitted = await ctx.purchase({ confirmed: false }), integer = await ctx.purchase({ product: await ctx.product({ decimal: false }) })
  const invalid = [
    [{ purchaseItemId: po.itemId, qty: 1 }, { purchaseItemId: po.itemId, qty: 1 }],
    [{ purchaseItemId: unsubmitted.itemId, qty: 1 }], [{ purchaseItemId: wrongSupplier.itemId, qty: 1 }], [{ purchaseItemId: wrongWarehouse.itemId, qty: 1 }],
    [{ purchaseItemId: po.itemId, qty: 11 }], [{ purchaseItemId: po.itemId, qty: 1.001 }], [{ purchaseItemId: integer.itemId, qty: 1.5 }],
    [{ purchaseItemId: 999999999, qty: 1 }],
  ]
  for (const items of invalid) await unchanged(draft.taskId, context, ctx.body(context, items))
  for (const extra of [{ freightType: 4 }, { freightAmount: -1 }, { freightAmount: 1.001 }, { supplierId: ctx.otherSupplier.id }, { warehouseId: ctx.otherWarehouse.id }]) {
    const response = await ctx.edit(draft.taskId, ctx.body(context, undefined, extra)); reject(response, 400)
  }
})

test('两份相同秒草稿不能覆盖，回执在提交后仍返回原ACK', async () => {
  const po = await ctx.purchase(), draft = await ctx.draft(po), a = await ctx.context(draft.taskId), b = await ctx.context(draft.taskId)
  assert.equal(a.expectedEditFingerprint, b.expectedEditFingerprint)
  const originalSecond = (await ctx.taskFacts(draft.taskId)).task.updated_at
  const key = randomUUID(), body = ctx.body(a, undefined, { remark: '先完成的合成编辑', freightAmount: 0, freightType: 2 })
  const ack = must(await ctx.edit(draft.taskId, body, { key }))
  // Reproduce the exact same persisted second independently of runtime speed: the real edit changes lock_version,
  // while this owned synthetic fixture resets only its timestamp to the saved original second.
  const prior = originalSecond
  await ctx.pool.query('UPDATE inbound_tasks SET updated_at=? WHERE id=?', [prior, draft.taskId])
  const current = await ctx.context(draft.taskId)
  assert.equal(current.task.updatedAt, b.task.updatedAt)
  assert.notEqual(current.expectedEditFingerprint, b.expectedEditFingerprint)
  await unchanged(draft.taskId, b, ctx.body(b, undefined, { remark: '过时草稿' }))
  await ctx.ok('POST', `/inbound-tasks/${draft.taskId}/submit`, {})
  assert.deepEqual(must(await ctx.edit(draft.taskId, body, { key })), ack, '提交后仍须重放原ACK')
  reject(await ctx.request('GET', `/system/request-status/${key}?action=inbound.update`), [400,409], 'INBOUND_EDIT_RECEIPT_INVALID')
  const receipt = await ctx.ok('GET', `/system/request-status/${key}?action=inbound.update.${draft.taskId}`)
  assert.equal(receipt.status, 'success'); assert.deepEqual(receipt.data, ack)
  reject(await ctx.edit(draft.taskId, ctx.body(current, undefined, { remark: '提交后新编辑' })), 409)
})

test('逐行执行量和任何未删除容器包括legacy均禁止编辑', async () => {
  for (const column of ['received_qty', 'putaway_qty']) {
    const po = await ctx.purchase(), draft = await ctx.draft(po), context = await ctx.context(draft.taskId)
    await ctx.pool.query(`UPDATE inbound_task_items SET ${column}=1 WHERE task_id=?`, [draft.taskId])
    await unchanged(draft.taskId, context)
    reject(await ctx.request('GET', `/inbound-tasks/${draft.taskId}/edit-context`), 409)
  }
  for (const legacy of [0, 1]) {
    const po = await ctx.purchase(), draft = await ctx.draft(po), context = await ctx.context(draft.taskId)
    await ctx.pool.query('INSERT INTO inventory_containers(barcode,product_id,warehouse_id,inbound_task_id,status,remaining_qty,is_legacy) VALUES (?,?,?,?,5,0,?)', [`${ctx.mark}C${legacy}`, po.product.id, ctx.warehouse.id, draft.taskId, legacy])
    await unchanged(draft.taskId, context)
  }
})

test('真实两连接：提交先赢同一任务锁，编辑回滚且无成功回执', async () => {
  const po = await ctx.purchase(), draft = await ctx.draft(po), context = await ctx.context(draft.taskId), key = randomUUID()
  const beforeItems = (await ctx.taskFacts(draft.taskId)).items
  const [submitted, edited] = await ctx.withBlocked('task', draft.taskId, [
    () => ctx.request('POST', `/inbound-tasks/${draft.taskId}/submit`, {}),
    () => ctx.edit(draft.taskId, ctx.body(context, undefined, { remark: '并发过时编辑' }), { key }),
  ])
  must(submitted); reject(edited, 409)
  assert.deepEqual((await ctx.taskFacts(draft.taskId)).items, beforeItems)
  assert.equal((await ctx.receipt(key)).length, 0)
  const events = await ctx.rows('SELECT event_type FROM inbound_task_events WHERE task_id=? ORDER BY id', [draft.taskId])
  assert.deepEqual(events.map(e => e.event_type), ['created', 'submitted_to_pda'])
})

test('真实两连接：编辑先赢同一任务锁，提交等待后读取已保存完整来源与数量', async () => {
  const a = await ctx.purchase(), b = await ctx.purchase(), draft = await ctx.draft(a, 5)
  const context = await ctx.context(draft.taskId), key = randomUUID(), originalId = context.task.items[0].id
  const body = ctx.body(context, [{ purchaseItemId: a.itemId, qty: 2 }, { purchaseItemId: b.itemId, qty: 3 }], { remark: '合成编辑先赢', freightType: 2, freightAmount: 0 })
  const beforeSideEffects = await ctx.sideEffects()
  const [edited, submitted] = await ctx.withBlocked('task', draft.taskId, [
    () => ctx.edit(draft.taskId, body, { key }),
    () => ctx.request('POST', `/inbound-tasks/${draft.taskId}/submit`, {}),
  ])
  const ack = must(edited), submission = must(submitted)
  const saved = await ctx.ok('GET', `/inbound-tasks/${draft.taskId}`)
  const expected = [[a.itemId, 2], [b.itemId, 3]].sort((x,y) => x[0]-y[0])
  const identities = task => task.items.map(i => [i.purchaseItemId, i.orderedQty]).sort((x,y) => x[0]-y[0])
  assert.deepEqual(identities(submission), expected, '等待的submit必须读取编辑已提交的完整来源/数量')
  assert.deepEqual(identities(saved), expected)
  assert.equal(saved.items.find(i => i.purchaseItemId === a.itemId).id, originalId)
  assert.equal(saved.remark, body.remark); assert.equal(saved.freightType, 2); assert.equal(saved.freightAmount, 0)
  assert.equal(saved.status, 1); assert.ok(saved.submittedAt); assert.equal(saved.submittedBy, ctx.users.editor.id)
  const facts = await ctx.taskFacts(draft.taskId)
  assert.deepEqual(facts.events.map(e => e.event_type), ['created', 'draft_updated', 'submitted_to_pda'])
  assert.equal(facts.items.length, 2)
  assert.ok(facts.items.every(i => Number(i.received_qty) === 0 && Number(i.putaway_qty) === 0))
  const receipts = await ctx.receipt(key)
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].action, `inbound.update.${draft.taskId}`)
  assert.equal(Number(receipts[0].status), 1)
  assert.deepEqual(must(await ctx.edit(draft.taskId, body, { key })), ack, '提交后的重放仍返回编辑原ACK')
  assert.equal((await ctx.receipt(key)).length, 1)
  assert.deepEqual(await ctx.sideEffects(), beforeSideEffects, '编辑与提交不得成为收货/库存/费用/打印执行')
})

test('真实两连接：来源锁串行不同草稿改量，已提交分配不得超额', async () => {
  const po = await ctx.purchase({ quantity: 10 }), a = await ctx.draft(po, 3), b = await ctx.draft(po, 3)
  const ca = await ctx.context(a.taskId), cb = await ctx.context(b.taskId), keyA = randomUUID(), keyB = randomUUID()
  const beforeB = await ctx.taskFacts(b.taskId)
  const [ra, rb] = await ctx.withBlocked('purchase', po.id, [
    () => ctx.edit(a.taskId, ctx.body(ca, [{ purchaseItemId: po.itemId, qty: 6 }]), { key: keyA }),
    () => ctx.edit(b.taskId, ctx.body(cb, [{ purchaseItemId: po.itemId, qty: 6 }]), { key: keyB }),
  ])
  must(ra); reject(rb, 400)
  assert.deepEqual(await ctx.taskFacts(b.taskId), beforeB)
  assert.equal((await ctx.receipt(keyA)).length, 1); assert.equal((await ctx.receipt(keyB)).length, 0)
  const allocated = await ctx.one('SELECT SUM(i.ordered_qty) AS qty FROM inbound_task_items i JOIN inbound_tasks t ON t.id=i.task_id WHERE i.purchase_item_id=? AND t.deleted_at IS NULL AND t.status<>5', [po.itemId])
  assert.equal(Number(allocated.qty), 9)
})

test('真实两连接：编辑与创建共享采购来源锁，失败创建不留头行事件', async () => {
  const po = await ctx.purchase({ quantity: 10 }), draft = await ctx.draft(po, 3), context = await ctx.context(draft.taskId)
  const beforeTasks = await ctx.rows('SELECT id FROM inbound_tasks ORDER BY id')
  const [edited, created] = await ctx.withBlocked('purchase', po.id, [
    () => ctx.edit(draft.taskId, ctx.body(context, [{ purchaseItemId: po.itemId, qty: 8 }])),
    () => ctx.request('POST', '/inbound-tasks', ctx.createBody([{ purchaseItemId: po.itemId, qty: 3 }])),
  ])
  must(edited); reject(created, 400)
  assert.deepEqual(await ctx.rows('SELECT id FROM inbound_tasks ORDER BY id'), beforeTasks)
  assert.equal(Number((await ctx.one('SELECT SUM(ordered_qty) AS qty FROM inbound_task_items WHERE purchase_item_id=?', [po.itemId])).qty), 8)
})


test('当前原采购来源失效仍完整读取原行，保存失败保留原单', async () => {
  const po = await ctx.purchase(), draft = await ctx.draft(po, 5), context = await ctx.context(draft.taskId)
  // Deliberately represent an unavailable source only inside this owned synthetic instance.
  await ctx.pool.query('UPDATE purchase_orders SET status=5 WHERE id=?', [po.id])
  try {
    const unavailable = await ctx.context(draft.taskId)
    assert.deepEqual(unavailable.task.items, context.task.items)
    assert.equal(list(unavailable.candidates)[0].purchaseItemId, po.itemId)
    assert.equal(list(unavailable.candidates)[0].sourceAvailable, false)
    assert.equal(list(unavailable.candidates)[0].remainingQty, 0)
    const response = await unchanged(draft.taskId, unavailable)
    assert.equal(response.data.code, 'INBOUND_PURCHASE_SOURCE_INVALID')
  } finally { await ctx.pool.query('UPDATE purchase_orders SET status=2 WHERE id=?', [po.id]) }
})

test('新迁移的两列真实形状准确且重复执行幂等', async () => {
  const columns = await ctx.rows("SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inbound_tasks' AND COLUMN_NAME IN ('freight_type','freight_amount') ORDER BY COLUMN_NAME")
  assert.equal(columns.length, 2)
  assert.deepEqual(columns.map(c => [c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT]), [['freight_amount','decimal','YES',null],['freight_type','tinyint','YES',null]])
  assert.equal(columns[0].COLUMN_TYPE, 'decimal(14,2)'); assert.equal(Number(columns[0].NUMERIC_SCALE), 2)
  const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
  const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, '../backend/src/database/284_inbound_freight_record.sql'), 'utf8'))
  const conn = await ctx.pool.getConnection()
  try { for (const sql of statements) await conn.query(sql) } finally { conn.release() }
  assert.deepEqual(await ctx.rows("SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inbound_tasks' AND COLUMN_NAME IN ('freight_type','freight_amount') ORDER BY COLUMN_NAME"), columns)
})


test('原来源供应商、数量、单价或单位变更均拒绝旧context，恢复后新context可保存', async () => {
  for (const fact of ['supplier', 'quantity', 'price', 'unit']) {
    const po = await ctx.purchase(), draft = await ctx.draft(po), context = await ctx.context(draft.taskId)
    const change = fact === 'supplier'
      ? { sql: 'UPDATE purchase_orders SET supplier_id=? WHERE id=?', id: po.id, old: ctx.supplier.id, next: ctx.otherSupplier.id }
      : fact === 'quantity'
        ? { sql: 'UPDATE purchase_order_items SET quantity=? WHERE id=?', id: po.itemId, old: 100, next: 101 }
        : fact === 'price'
          ? { sql: 'UPDATE purchase_order_items SET unit_price=? WHERE id=?', id: po.itemId, old: 10, next: 11 }
          : { sql: 'UPDATE purchase_order_items SET unit=? WHERE id=?', id: po.itemId, old: '个', next: '件' }
    await ctx.pool.query(change.sql, [change.next, change.id])
    try {
      const response = await unchanged(draft.taskId, context)
      assert.equal(response.data.code, 'INBOUND_EDIT_CONFLICT', `${fact}漂移不得被旧context覆盖`)
    } finally { await ctx.pool.query(change.sql, [change.old, change.id]) }
    const current = await ctx.context(draft.taskId)
    must(await ctx.edit(draft.taskId, ctx.body(current, undefined, { remark: `合成${fact}恢复后新context` })))
  }
})


test('本人回执恢复始终要求当前VIEW：撤UPDATE仍可查，撤VIEW拒绝全部状态', async () => {
  const po = await ctx.purchase(), draft = await ctx.draft(po), context = await ctx.context(draft.taskId)
  const key = randomUUID(), pendingKey = randomUUID(), absentKey = randomUUID(), action = `inbound.update.${draft.taskId}`
  const body = ctx.body(context, undefined, { remark: '合成本人VIEW边界' })
  const ack = must(await ctx.edit(draft.taskId, body, { key }))
  const route = requestKey => `/system/request-status/${requestKey}?action=${action}`
  const roleId = ctx.users.editor.roleId, userId = ctx.users.editor.id
  let pendingId
  await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [roleId, P.INBOUND_ORDER_UPDATE])
  try {
    assert.deepEqual((await ctx.ok('GET', route(key))).data, ack, '保留VIEW的本人可恢复原ACK')
    reject(await ctx.edit(draft.taskId, body, { key }), 403, 'PERMISSION_DENIED')
    pendingId = await ctx.insert('INSERT INTO operation_requests(request_key,action,user_id,status,resource_type,resource_id) VALUES (?,?,?,0,?,?)', [pendingKey, action, userId, 'inbound_task', draft.taskId])
    assert.equal((await ctx.ok('GET', route(pendingKey))).status, 'pending')
    assert.equal((await ctx.ok('GET', route(absentKey))).status, 'not_found')
    await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?', [roleId, P.INBOUND_ORDER_VIEW])
    try {
      for (const requestKey of [key, pendingKey, absentKey]) {
        const response = await ctx.request('GET', route(requestKey))
        reject(response, 403, 'PERMISSION_DENIED')
        assert.equal(response.data.data?.permission, P.INBOUND_ORDER_VIEW)
        assert.equal(response.data.data?.status, undefined, '无VIEW不得披露回执状态')
      }
    } finally { await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [roleId, P.INBOUND_ORDER_VIEW]) }
    assert.deepEqual((await ctx.ok('GET', route(key))).data, ack)
    await ctx.pool.query('DELETE FROM user_warehouse_scope WHERE user_id=? AND warehouse_id=?', [userId, ctx.warehouse.id])
    try {
      for (const requestKey of [key, pendingKey, absentKey]) {
        reject(await ctx.request('GET', route(requestKey)), 403, 'WAREHOUSE_SCOPE_DENIED')
      }
    } finally { await ctx.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)', [userId, ctx.warehouse.id]) }
  } finally {
    await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)', [roleId, P.INBOUND_ORDER_UPDATE])
    if (pendingId) {
      await ctx.pool.query('DELETE FROM operation_requests WHERE id=? AND request_key=? AND action=? AND user_id=?', [pendingId, pendingKey, action, userId])
      assert.equal((await ctx.receipt(pendingKey)).length, 0, '只清理本测试精确创建的pending记录')
    }
  }
  assert.equal((await ctx.receipt(key)).length, 1, '成功原ACK仍仅一条')
})

// 创建防重复：专属实例真实HTTP/MySQL，复用同一归属门与合成身份。
const createAction = 'inbound.create'
const createFingerprint = require('../backend/src/modules/inbound-tasks/inbound-tasks.edit-rules').requestFingerprint
const createStatusPath = (key, body, warehouseId = ctx.warehouse.id) => `/system/request-status/${key}?action=${createAction}&warehouseId=${warehouseId}&requestFingerprint=${createFingerprint(body)}`
async function createOnce(po, key, body) {
 const ack = must(await ctx.request('POST','/inbound-tasks',body,{key}));ctx.owned.tasks.push(ack.taskId)
 assert.equal(ack.requestFingerprint,createFingerprint(body));assert.equal(ack.warehouseId,po.warehouse.id);return ack
}
async function assertSingleCreation(po,ack,key,qty) {
 const rows=await ctx.rows('SELECT task_id,ordered_qty FROM inbound_task_items WHERE purchase_item_id=?',[po.itemId])
 assert.equal(rows.length,1);assert.equal(Number(rows[0].task_id),ack.taskId);assert.equal(Number(rows[0].ordered_qty),qty)
 assert.equal((await ctx.taskFacts(ack.taskId)).events.filter(e=>e.event_type==='created').length,1)
 const receipts=await ctx.receipt(key);assert.equal(receipts.length,1);assert.equal(Number(receipts[0].status),1);assert.equal(Number(receipts[0].resource_id),ack.taskId)
}
test('创建真实同键同正文仅一张，同键变正文409；来源余量变化不挡原回放',async()=>{
 const po=await ctx.purchase(),key=randomUUID(),body=ctx.createBody([{purchaseItemId:po.itemId,qty:1.25}],{freightType:2,freightAmount:0,remark:'原正文'}),ack=await createOnce(po,key,body)
 assert.deepEqual(must(await ctx.request('POST','/inbound-tasks',body,{key})),ack)
 reject(await ctx.request('POST','/inbound-tasks',{...body,remark:'另正文'},{key}),409,'INBOUND_CREATE_REQUEST_CONFLICT')
 assert.deepEqual((await ctx.ok('GET',createStatusPath(key,body))).data,ack);await assertSingleCreation(po,ack,key,1.25)
})
test('整PO创建同键原回执，兼容无键入口；不重复来源明细',async()=>{
 const po=await ctx.purchase({quantity:4}),key=randomUUID(),body={poId:po.id,freightType:3,freightAmount:2.34},ack=await createOnce(po,key,body)
 assert.deepEqual(must(await ctx.request('POST','/inbound-tasks',body,{key})),ack);reject(await ctx.request('POST','/inbound-tasks',{...body,freightAmount:3},{key}),409,'INBOUND_CREATE_REQUEST_CONFLICT');await assertSingleCreation(po,ack,key,4)
 const legacy=await ctx.purchase({quantity:2});const old=must(await ctx.request('POST','/inbound-tasks',{poId:legacy.id},{key:null}));ctx.owned.tasks.push(old.taskId);assert.equal(old.requestFingerprint,undefined)
})
test('五个不同真实连接并发同键只建一张，唯一键等锁后回放无升级死锁',async()=>{
 const po=await ctx.purchase(),key=randomUUID(),body=ctx.createBody([{purchaseItemId:po.itemId,qty:2.25}]),blocker=await ctx.pool.getConnection()
 const blockerId=Number((await blocker.query('SELECT CONNECTION_ID() AS id'))[0][0].id)
 let pending=[]
 try {
  await blocker.beginTransaction();await blocker.query('SELECT id FROM purchase_orders WHERE id=? FOR UPDATE',[po.id])
  pending=Array.from({length:5},()=>ctx.request('POST','/inbound-tasks',body,{key}))
  const sources=await ctx.waitForBlocked('purchase_orders',blockerId,1),requests=await ctx.waitForBlocked('operation_requests',blockerId,4)
  ctx.concurrency.push({scenario:'five concurrent create same key',sourceWaiters:sources,requestWaiters:requests})
 } finally {await blocker.rollback();blocker.release()}
 const results=await Promise.all(pending),acks=results.map(r=>must(r));ctx.owned.tasks.push(acks[0].taskId);for(const ack of acks)assert.deepEqual(ack,acks[0]);await assertSingleCreation(po,acks[0],key,2.25)
})
test('真实创建已commit后代理断开丢响应：查原回执与同键重放仍仅一张',async()=>{
 const http=require('node:http'),po=await ctx.purchase(),key=randomUUID(),body=ctx.createBody([{purchaseItemId:po.itemId,qty:0.25}]);let committed=false
 const proxy=http.createServer((req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:ctx.server.address().port,path:req.url,method:req.method,headers:req.headers},response=>{response.resume();response.on('end',()=>{committed=response.statusCode===201;res.destroy()})})
  upstream.on('error',()=>res.destroy());req.pipe(upstream)
 })
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
 try {
  await assert.rejects(fetch(`http://127.0.0.1:${proxy.address().port}/api/inbound-tasks`,{method:'POST',headers:{'Content-Type':'application/json','X-Client-Id':ctx.clientId,'X-Request-Key':key,Authorization:`Bearer ${ctx.users.editor.token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}))
  assert.equal(committed,true)
  const receipt=await ctx.ok('GET',createStatusPath(key,body));assert.equal(receipt.status,'success');ctx.owned.tasks.push(receipt.data.taskId)
  assert.deepEqual(must(await ctx.request('POST','/inbound-tasks',body,{key})),receipt.data);await assertSingleCreation(po,receipt.data,key,0.25)
 } finally {proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve))}
})
test('创建回执当前VIEW与原仓、本人及正文/单据自洽：撤销后不泄漏成功',async()=>{
 const po=await ctx.purchase(),key=randomUUID(),body=ctx.createBody([{purchaseItemId:po.itemId,qty:1}]),ack=await createOnce(po,key,body)
 assert.equal((await ctx.ok('GET',createStatusPath(key,body),undefined,{user:'viewer'})).status,'not_found')
 reject(await ctx.request('POST','/inbound-tasks',body,{key,user:'viewer'}),403)
 reject(await ctx.request('GET',createStatusPath(key,body),undefined,{user:'denied'}),403)
 reject(await ctx.request('GET',createStatusPath(key,{...body,remark:'变'})),409,'INBOUND_CREATE_RECEIPT_INVALID')
 await ctx.pool.query('DELETE FROM sys_role_permissions WHERE role_id=? AND permission=?',[ctx.users.editor.roleId,P.INBOUND_ORDER_CREATE])
 try {assert.deepEqual((await ctx.ok('GET',createStatusPath(key,body))).data,ack);reject(await ctx.request('POST','/inbound-tasks',body,{key}),403)}
 finally {await ctx.pool.query('INSERT INTO sys_role_permissions(role_id,permission) VALUES (?,?)',[ctx.users.editor.roleId,P.INBOUND_ORDER_CREATE])}
 await ctx.pool.query('DELETE FROM user_warehouse_scope WHERE user_id=? AND warehouse_id=?',[ctx.users.editor.id,ctx.warehouse.id])
 try {reject(await ctx.request('GET',createStatusPath(key,body)),403,'WAREHOUSE_SCOPE_DENIED');reject(await ctx.request('POST','/inbound-tasks',body,{key}),403,'WAREHOUSE_SCOPE_DENIED')}
 finally {await ctx.pool.query('INSERT INTO user_warehouse_scope(user_id,warehouse_id) VALUES (?,?)',[ctx.users.editor.id,ctx.warehouse.id])}
 await assertSingleCreation(po,ack,key,1)
})
test('回执写故障整事务回滚：真实not_found后原键原正文重试安全，只记录运费无副作用',async()=>{
 const po=await ctx.purchase(),key=randomUUID(),body=ctx.createBody([{purchaseItemId:po.itemId,qty:2}],{freightType:1,freightAmount:12.34}),before=await ctx.sideEffects()
 // 仅已通过本批归属门的专属库；固定触发器名，由同一测试在finally删除。
 await ctx.pool.query("CREATE TRIGGER inbound_create_receipt_fault BEFORE UPDATE ON operation_requests FOR EACH ROW BEGIN IF NEW.action='inbound.create' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic receipt fault'; END IF; END")
 try {reject(await ctx.request('POST','/inbound-tasks',body,{key}),500);assert.equal((await ctx.rows('SELECT id FROM inbound_task_items WHERE purchase_item_id=?',[po.itemId])).length,0);assert.equal((await ctx.receipt(key)).length,0)}
 finally {await ctx.pool.query('DROP TRIGGER inbound_create_receipt_fault')}
 const receipt=await ctx.ok('GET',createStatusPath(key,body));assert.equal(receipt.status,'not_found');const ack=await createOnce(po,key,body);await assertSingleCreation(po,ack,key,2);assert.deepEqual(await ctx.sideEffects(),before)
})
