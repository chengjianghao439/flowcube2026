const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../backend/src')
const pureDependencies = new Set(['utils/AppError.js', 'utils/route.js', 'utils/response.js', 'utils/unitConversion.js', 'utils/qtyPrecision.js', 'constants/permissions.js', 'modules/inventory/reservation.snapshots.js'].map(relative => path.join(root, relative)))
function load(relative, replacements = {}) {
  const filename = path.join(root, relative)
  const context = { module: { exports: {} }, Buffer, require: name => {
    if (name === 'node:crypto') return require(name)
    if (Object.hasOwn(replacements, name)) return replacements[name]
    const dependency = path.resolve(path.dirname(filename), `${name}.js`)
    if (!pureDependencies.has(dependency)) throw new Error(`Unstubbed offline dependency ${relative}: ${name}`)
    return load(path.relative(root, dependency))
  } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  return context.module.exports
}
function fixture({ inventoryView = true, saleView = true, purchaseView = true, scope = null, fail = false, sources, bindingRows, activeRows } = {}) {
  const calls = [], events = []
  let invalidateSale = false, invalidatePurchase = false
  const conn = {
    async query(sql, params = []) {
      calls.push({ sql, params: JSON.parse(JSON.stringify(params)) })
      sql = sql.replace(/\/\*\+ MAX_EXECUTION_TIME\(8000\) \*\/ /g, '')
      if (fail && sql.includes('inventory_stock')) throw new Error('snapshot failed')
      if (/^SET |^START /.test(sql)) return [[]]
      if (sql.includes('sys_role_permissions')) return [[...(inventoryView ? [{ permission: 'inventory.view' }] : []), ...(saleView ? [{ permission: 'sale.order.view' }] : []), ...(purchaseView ? [{ permission: 'purchase.order.view' }] : [])]]
      if (sql.includes('snapshot_sale_scope')) return [invalidateSale ? [] : params[0].map(id => ({ id }))]
      if (sql.includes('snapshot_purchase_scope')) return [invalidatePurchase ? [] : params[0].map(id => ({ id }))]
      if (sql.includes('SELECT remaining_qty')) return [activeRows ? Array.from({length:activeRows},()=>({remaining_qty:15})) : [{ remaining_qty: 15 }, { remaining_qty: 15 }]]
      if (sql.includes('FROM inventory_stock') && !sql.includes('pickable')) return [[{ quantity: 32, reserved: 50 }]]
      if (sql.includes('AS pickable')) return [[{ cache_on_hand: 32, pickable: 12 }]]
      if (sql.includes('poi.quantity AS ordered_qty')) return [[{ product_id: 7, warehouse_id: 8, purchase_order_id: 201, purchase_item_id: 301, ordered_qty: 40 }]]
      if (sql.includes('SELECT iti.purchase_item_id,iti.putaway_qty')) return [[{ purchase_item_id: 301, putaway_qty: 15 }]]
      if (sql.includes('SELECT purchase_item_id,qty')) return [[{ purchase_item_id: 301, qty: 25 }]]
      if (sql.includes('reservation_summary')) return [[{ total_qty: 40, visible_qty: saleView ? 20 : 0, orphan_qty: 6, unknown_qty: 2 }]]
      if (sql.includes('binding_summary')) return [[{ total_qty: 33, visible_qty: saleView ? 28 : 0, orphan_qty: 0 }]]
      if (sql.includes('visible_source_count')) return [[{ total: saleView ? (sources?.length ?? 21) : 0 }]]
      if (sql.includes('visible_source_page')) return [saleView ? (sources ?? [{ id: 11, order_no: 'SO11', customer_name: '可见客户', status: 2, reservation_qty: 20, binding_qty: 28, created_at: '2026-10-04 10:00:00' }]) : []]
      if (sql.includes('binding_details')) return [bindingRows ?? [
        { id: 1, sale_order_id: 11, sale_order_item_id: 41, qty: 25, sale_item_valid: 1, purchase_valid: 1, purchase_visible: purchaseView ? 1 : 0, purchase_order_id: 201, purchase_item_id: 301, order_no: 'PO201', purchase_status: 2, ordered_qty: 40 },
        { id: 2, sale_order_id: 11, sale_order_item_id: 99, qty: 3, sale_item_valid: 0, purchase_valid: 0, purchase_visible: 0, purchase_order_id: 202, purchase_item_id: 302, order_no: '异常采购身份' },
      ]]
      if (sql.includes('binding_supply_totals')) return [[{ purchase_item_id: 301, qty: 15, kind: 'putaway' }, { purchase_item_id: 301, qty: 25, kind: 'binding' }]]
      throw new Error(`Unexpected SQL: ${sql}`)
    },
    async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') },
  }
  const pool = { async getConnection() { events.push('connect'); return conn }, query() { throw new Error('不得离开快照连接') } }
  const expected = load('utils/expectedStock.js')
  const engine = load('engine/containerEngine.js', { '../utils/logger': {}, '../utils/codeGenerator': {}, '../utils/expectedStock': expected, '../utils/qtyPrecision': {} })
  const warehouse = load('utils/warehouseScope.js', { '../config/db': { pool } })
  const service = load('modules/inventory/inventory.reservations.js', { '../../config/db': { pool }, '../../engine/containerEngine': engine, '../../utils/expectedStock': expected, '../../utils/warehouseScope': warehouse })
  return { calls, events, service, user: { userId: 9, roleId: 5, warehouseIds: scope, familyId: 'fixture-session', tokenVersion: 0 },
    revokeInventory() { inventoryView = false }, revokeSaleScope() { invalidateSale = true }, revokePurchaseScope() { invalidatePurchase = true } }
}
test('同一显式RR只读快照读取摘要/授权count/page/绑定；ATP不再扣绑定，已占满采购仍能追溯', async () => {
  const f = fixture({ scope: [8] })
  const data = await f.service.listReservations({ productId: '7', warehouseId: '8', page: '2', pageSize: '20' }, f.user)
  assert.deepEqual(JSON.parse(JSON.stringify(data.summary)), { activeQuantity: 30, cacheOnHand: 32, reserved: 50, available: 0, expected: 25, atp: 5, pickableQuantity: 12, reservationQuantity: 40, expectedBindingQuantity: 33, expectedPoolBindingQuantity: 25, cacheDifference: 2, reservationDifference: 10, bindingPoolDifference: 8, visibleReservationQuantity: 20, hiddenReservationQuantity: 12, orphanReservationQuantity: 6, unknownReservationQuantity: 2, visibleBindingQuantity: 28, hiddenBindingQuantity: 5, orphanBindingQuantity: 0 })
  assert.equal(data.pagination.total, 21); assert.equal(data.pagination.page, 2)
  assert.equal(data.list[0].saleOrderId, 11); assert.equal(data.list[0].saleOrderItemId, undefined, '预占不能猜销售行')
  assert.equal(data.list[0].bindings[0].saleOrderItemId, 41)
  assert.equal(data.list[0].bindings[0].purchase.orderNo, 'PO201')
  assert.equal(data.list[0].bindings[0].purchase.openQuantity, 25)
  assert.equal(data.list[0].bindings[0].purchase.boundQuantity, 25)
  assert.equal(data.list[0].orphanBindingQuantity, 3)
  assert.match(f.calls[0].sql, /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/)
  assert.match(f.calls[1].sql, /START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY/)
  assert.deepEqual(f.events, ['connect', 'commit', 'release'])
  assert.ok(f.calls.every(c => !/FOR UPDATE|FOR SHARE|INSERT|UPDATE |DELETE /i.test(c.sql)))
  assert.ok(f.calls.filter(c => c.sql.includes('sale_order_expected_bindings')).every(c => c.sql.includes('released_at IS NULL')), '已释放绑定不能进入任何批次')
  assert.ok(f.calls.filter(c => c.sql.includes('stock_reservations')).every(c => c.sql.includes('status=1')), '仅有效预占')
  const count = f.calls.find(c => c.sql.includes('visible_source_count'))
  const page = f.calls.find(c => c.sql.includes('visible_source_page'))
  assert.ok(count.sql.includes('NOT EXISTS') && page.sql.includes('NOT EXISTS'), '完整销售单仓库范围在计数与分页前')
  assert.match(page.sql, /ORDER BY so.id ASC LIMIT \? OFFSET \?/); assert.deepEqual(page.params.slice(-2), [20, 20])
  assert.ok(f.calls.length <= 15, '批次读不能逐单查询')
})
test('缺少原单权限只返回占用汇总；采购不可见不返回任何采购身份', async () => {
  const hidden = fixture({ saleView: false })
  const allHidden = await hidden.service.listReservations({ productId: 7, warehouseId: 8 }, hidden.user)
  assert.equal(allHidden.pagination.total, 0); assert.equal(allHidden.list.length, 0)
  assert.equal(allHidden.summary.hiddenReservationQuantity, 32)
  assert.ok(!JSON.stringify(allHidden).includes('SO11') && !JSON.stringify(allHidden).includes('可见客户'))
  const noPurchase = fixture({ purchaseView: false })
  const data = await noPurchase.service.listReservations({ productId: 7, warehouseId: 8 }, noPurchase.user)
  assert.equal(data.list[0].hiddenBindingQuantity, 25); assert.equal(data.list[0].bindings.length, 0)
  assert.ok(!JSON.stringify(data).includes('PO201') && !JSON.stringify(data).includes('purchaseOrderId'))
  assert.ok(noPurchase.calls.find(c => c.sql.includes('sys_role_permissions')).params.includes(5))
})
test('空范围和范围外请求先拒绝，未知/孤儿预占只留数量，不造链接', async () => {
  for (const scope of [[], [10]]) {
    const f = fixture({ scope })
    await assert.rejects(f.service.listReservations({ productId: 7, warehouseId: 8 }, f.user), e => e.statusCode === 403)
    assert.equal(f.events.length, 0)
  }
  const f = fixture()
  const data = await f.service.listReservations({ productId: 7, warehouseId: 8 }, f.user)
  assert.equal(data.summary.unknownReservationQuantity, 2); assert.equal(data.summary.orphanReservationQuantity, 6)
  assert.ok(!JSON.stringify(data).includes('refNo'))
})
test('严格单值安全正整数和有界页码；失败回滚并释放快照连接', async () => {
  for (const bad of ['', '0', '1e2', '1.0', ' 7', ['7', '8'], { id: '7' }, '9007199254740992']) {
    const f = fixture()
    await assert.rejects(f.service.listReservations({ productId: bad, warehouseId: 8 }, f.user), e => e.statusCode === 400)
    assert.equal(f.events.length, 0)
  }
  for (const params of [{ page: Infinity }, { page: '100001' }, { pageSize: '101' }, { warehouseId: ['8'] }]) {
    const f = fixture()
    await assert.rejects(f.service.listReservations({ productId: 7, warehouseId: 8, ...params }, f.user), e => e.statusCode === 400)
  }
  const f = fixture({ fail: true })
  await assert.rejects(f.service.listReservations({ productId: 7, warehouseId: 8 }, f.user), /snapshot failed/)
  assert.deepEqual(f.events, ['connect', 'rollback', 'release'])
})
test('controller不强转query，完整委派认证上下文并返回标准信封', async () => {
  let received
  const controller = load('modules/inventory/inventory.controller.js', { './inventory.service': {}, './inventory.aging': {}, './inventory.procurement': {}, './inventory.reservations': { listReservations: async (...args) => { received = args; return { list: [] } } }, '../../utils/operator': {}, '../../utils/requestKey': {} })
  const req = { query: { productId: ['7', '8'], warehouseId: '8' }, user: { userId: 9, roleId: 5, warehouseIds: [] } }
  let output, error
  const res = { status() { return this }, json: value => { output = value } }
  await controller.reservations(req, res, e => { error = e })
  assert.equal(error, undefined); assert.deepEqual(received, [req.query, req.user]); assert.equal(output.success, true)
})
test('实际角色缺库存查看权时忽略前端自报权限，路由也要求INVENTORY_VIEW', async () => {
  const f = fixture({ inventoryView: false })
  await assert.rejects(f.service.listReservations({ productId: 7, warehouseId: 8 }, { ...f.user, permissions: ['*'] }), e => e.statusCode === 403)
  assert.deepEqual(f.events, ['connect', 'rollback', 'release'])
  assert.equal(f.calls.length, 3, '数量读取前拒绝')
  const registered = []
  const router = Object.fromEntries(['use', 'get', 'post', 'put'].map(method => [method, (...args) => registered.push({ method, args })]))
  load('modules/inventory/inventory.routes.js', { express: { Router: () => router }, zod: require('../backend/node_modules/zod'), './inventory.controller': { reservations: 'reservation-handler' }, '../../middleware/pdaSession': { pdaSessionOptional: () => 'pda-optional' }, '../../middleware/auth': { authMiddleware: 'authenticated', requirePermission: permission => ({ permission }) } })
  const route = registered.find(r => r.method === 'get' && r.args[0] === '/reservations')
  assert.equal(route.args[1].permission, 'inventory.view'); assert.equal(route.args[2], 'reservation-handler')
})

function snapshotSources(n=101) { return Array.from({length:n},(_,i)=>({id:11+i,order_no:'SO-'+i,customer_name:'合成客户',status:2,reservation_qty:1,binding_qty:i?0:28,created_at:'2026-10-04 10:00:00'})) }
test('snapshot续批不重算数量或来源，扁平绑定与源行同token且有界', async()=>{
  const sources=snapshotSources(),f=fixture({sources,scope:[8]})
  const first=await f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user)
  assert.equal(first.rows.length,100);assert.equal(first.snapshot.totalRows,102)
  assert.equal(first.snapshot.totalSources,101);assert.equal(first.snapshot.nextOffset,100)
  assert.equal(first.rows[1].kind,'binding')
  sources[100].order_no='SO-并发变化'
  const before=f.calls.length
  const next=await f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot',snapshotId:first.snapshot.snapshotId,offset:100},f.user)
  assert.equal(next.rows.length,2);assert.equal(next.rows[1].source.orderNo,'SO-100')
  assert.equal(next.summary.reserved,50);assert.equal(next.snapshot.snapshotId,first.snapshot.snapshotId)
  assert.equal(next.snapshot.readAt,first.snapshot.readAt);assert.equal(next.snapshot.nextOffset,null)
  assert(!f.calls.slice(before).some(c=>/reservation_summary|visible_source_page|binding_details/.test(c.sql)))
  assert(f.calls.slice(before).some(c=>c.sql.includes('snapshot_sale_scope')))
})
test('snapshot当前库存权限及账号/仓范围上下文变化在缓存返回前拒绝',async()=>{
  for(const changed of ['permission','actor','scope','keyword','session']){
    const f=fixture({sources:snapshotSources(),scope:[8]})
    const first=await f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user)
    let user=f.user,keyword
    if(changed==='permission')f.revokeInventory()
    if(changed==='actor')user={...user,userId:10}
    if(changed==='scope')user={...user,warehouseIds:[8,9]}
    if(changed==='keyword')keyword='other'
    if(changed==='session')user={...user,familyId:'another-session'}
    await assert.rejects(f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot',snapshotId:first.snapshot.snapshotId,offset:100,keyword},user),
      e=>e.statusCode===(changed==='permission'?403:409))
  }
})
test('snapshot每批复核销售和采购当前可见范围，不泄露缓存原单',async()=>{
  for(const which of ['sale','purchase']){
    const f=fixture({sources:snapshotSources(),scope:[8]})
    const first=await f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user)
    if(which==='sale')f.revokeSaleScope();else f.revokePurchaseScope()
    await assert.rejects(f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot',snapshotId:first.snapshot.snapshotId,offset:0},f.user),e=>e.code==='INVENTORY_RESERVATION_SNAPSHOT_RESTART')
  }
})
test('snapshot超量在来源/绑定全量构建之前拒绝，不把上限作为完整结果',async()=>{
  const f=fixture({sources:snapshotSources(10001)})
  await assert.rejects(f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user),e=>e.statusCode===413)
  assert(!f.calls.some(c=>c.sql.includes('visible_source_page')))
  const binding=fixture({sources:snapshotSources(1),bindingRows:Array.from({length:20001},()=>({}))})
  await assert.rejects(binding.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},binding.user),e=>e.statusCode===413)
})
test('snapshot参数拒绝混合页码、数组游标、未知模式与越界偏移',async()=>{
  for(const extra of [{readMode:'other'},{readMode:'snapshot',page:2},{readMode:'snapshot',snapshotId:['x']},{readMode:'snapshot',offset:1},{readMode:'snapshot',keyword:['x']}]){
    const f=fixture({sources:snapshotSources(1)})
    await assert.rejects(f.service.listReservations({productId:7,warehouseId:8,...extra},f.user),e=>e.statusCode===400)
    assert.equal(f.calls.length,0)
  }
})

test('snapshot每个SELECT带服务器执行预算，旧分页契约不改变',async()=>{
  const f=fixture({sources:snapshotSources(1)})
  await f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user)
  assert(f.calls.filter(c=>/^SELECT/.test(c.sql)).every(c=>c.sql.includes('MAX_EXECUTION_TIME(8000)')))
  const old=fixture()
  await old.service.listReservations({productId:7,warehouseId:8},old.user)
  assert(old.calls.every(c=>!c.sql.includes('MAX_EXECUTION_TIME')))
})

test('snapshot解释helper的行读取也有硬上限，超限不能先算部分数量',async()=>{
  const f=fixture({sources:snapshotSources(1),activeRows:50001})
  await assert.rejects(f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user),e=>e.statusCode===413)
  assert(!f.calls.some(c=>c.sql.includes('reservation_summary')))
})

test('服务实例或进程切换后旧token拒绝，不重新算数量冒充续批',async()=>{
  const f=fixture({sources:snapshotSources()}),other=fixture({sources:snapshotSources()})
  const first=await f.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot'},f.user)
  await assert.rejects(other.service.listReservations({productId:7,warehouseId:8,readMode:'snapshot',snapshotId:first.snapshot.snapshotId,offset:100},other.user),e=>e.code==='INVENTORY_RESERVATION_SNAPSHOT_RESTART')
  assert(!other.calls.some(c=>c.sql.includes('reservation_summary')))
})
