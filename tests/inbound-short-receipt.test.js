// Actual domain guards and system handler with explicit read-only SQL boundaries.
// These fixtures do not claim authentication, MySQL locking or PDA verification.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../backend/src')
const AppError = require('../backend/src/utils/AppError')
function load(file, deps, transform = x => x) {
  const filename = path.join(root, file), module = { exports: {} }
  vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')), { module, require(name) {
    if (Object.hasOwn(deps, name)) return deps[name]
    throw Error(`Unstubbed dependency ${file}: ${name}`)
  } }, { filename })
  return module.exports
}
const scope = load('utils/warehouseScope.js', { '../config/db': {}, './AppError': AppError })
const cost = require('../backend/src/modules/inbound-tasks/inbound-tasks.cost')
const deps = { '../../utils/AppError': AppError, '../../utils/warehouseScope': scope, './inbound-tasks.cost': cost }
const short = load('modules/inbound-tasks/inbound-tasks.short-receipt.js', deps)
const purchase = load('modules/purchase/purchase.close-receipt.js', deps)
function reopen(rows) {
  const sql = []
  return { sql, conn: { async query(q, args) { sql.push(q); assert.deepEqual(Array.from(args), [21,21]); return [rows] } } }
}
test('short batch uses real received quantity; deleted/cancelled batches remain filtered by callers', () => {
  assert.match(short.EFFECTIVE_ASSIGNED_QTY_SQL, /closed_reason = 'short_close' THEN iti.received_qty ELSE iti.ordered_qty/)
  const query = fs.readFileSync(path.join(root, 'modules/inbound-tasks/inbound-tasks.query.js'), 'utf8')
  assert.equal(query.split('${EFFECTIVE_ASSIGNED_QTY_SQL}').length - 1, 2)
  assert.match(query, /it.status = 5/)
  const command = fs.readFileSync(path.join(root, 'modules/inbound-tasks/inbound-tasks.command.js'), 'utf8')
  assert.match(command, /it.closed_reason IS NULL OR it.closed_reason <> 'short_close'/)
})
test('reopen retains original plan only if current other allocation still fits, with two-decimal quantities', async () => {
  for (const other_assigned_qty of ['0.00','20.00']) {
    const f = reopen([{ ordered_qty: '80.00', purchase_qty: '100.00', other_assigned_qty, purchase_status:2 }])
    await short.assertShortReceiptCanReopen(f.conn, { id:21,closed_reason:'short_close' })
    assert.ok(f.sql.every(q => !/FOR UPDATE|FOR SHARE/.test(q)))
  }
  for (const row of [{ ordered_qty:'100.00',purchase_qty:'100.00',other_assigned_qty:'80.00' },{ ordered_qty:'0.11',purchase_qty:'0.30',other_assigned_qty:'0.20' }]) {
    await assert.rejects(short.assertShortReceiptCanReopen(reopen([row]).conn,{ id:21,closed_reason:'short_close' }),e => e.code === 'INBOUND_SHORT_RECEIPT_FOLLOWUP_EXISTS')
  }
  await short.assertShortReceiptCanReopen(reopen([{ ordered_qty:100,purchase_qty:100,other_assigned_qty:80 }]).conn,{id:21,closed_reason:null})
})
test('explicit PO remainder cancellation forbids reopen for both short and normally completed receipt', async () => {
  for (const closed_reason of [null,'short_close']) await assert.rejects(short.assertShortReceiptCanReopen(reopen([{purchase_status:3,purchase_closed_reason:'short_close'}]).conn,{id:21,closed_reason}),e => e.code === 'PURCHASE_REMAINDER_CLOSED')
})
const domains = [
  { action:'purchase.closeRemaining', helper:purchase.assertPurchaseCloseReceipt, type:'purchase_order', field:'purchaseOrderId', status:3, extra:{closedReason:'short_close'}, table:'purchase_orders' },
  { action:'inbound.closeReceiving', helper:short.assertCloseReceivingReceipt, type:'inbound_task', field:'taskId', status:4, extra:{}, table:'inbound_tasks' },
]
function receipt(d) { return {status:'success',resourceType:d.type,resourceId:21,data:{[d.field]:21,status:d.status,...d.extra}} }
function db(d, warehouse=8) { const queries=[];return {queries,async query(sql,args){queries.push(sql);assert.match(sql,new RegExp(`FROM ${d.table} WHERE id=\\?`));assert.deepEqual(Array.from(args),[21]);return [[{id:21,warehouse_id:warehouse}]]}} }
for (const d of domains) {
  test(`${d.action}: success and unknown exact keys use current original scope, including broad matches and legacy base`, async () => {
    for (const context of [{requestedAction:d.action+'.21'},{requestedAction:d.action.split('.')[0],matchedAction:d.action+'.21'},{matchedAction:d.action}]) {
      await d.helper(db(d),receipt(d),[8],context)
      await assert.rejects(d.helper(db(d),receipt(d),[9],context),e=>e.statusCode===403)
    }
    for (const status of ['pending','not_found','failed']) {
      await d.helper(db(d),{status},[8],{requestedAction:d.action+'.21'})
      await assert.rejects(d.helper(db(d),{status},[],{requestedAction:d.action+'.21'}),e=>e.statusCode===403)
    }
    for(const bad of [{...receipt(d),resourceId:22},{...receipt(d),resourceType:'other'},{...receipt(d),data:{...receipt(d).data,[d.field]:22}}]) await assert.rejects(d.helper(db(d),bad,null,{requestedAction:d.action+'.21'}),e=>e.statusCode===409)
    await assert.rejects(d.helper(db(d),{status:'not_found'},null,{requestedAction:d.action}),e=>e.statusCode===409)
    const unrelated=db(d);await d.helper(unrelated,receipt(d),[],{requestedAction:'other.action'});assert.equal(unrelated.queries.length,0)
  })
  test(`${d.action}: actual system requestStatus guards requested/matched, never sends original DTO after scope revoked`, async () => {
    for(const [requested,matched,status] of [[d.action+'.21',undefined,'not_found'],[d.action+'.21',d.action+'.21','pending'],[d.action.split('.')[0],d.action+'.21','success'],[d.action,d.action,'success']]) for(const ids of [[8],[9]]) {
      const sent=[],boundary=db(d), data=status==='success'?receipt(d):{status}
      const controller=load('modules/system/system.controller.js',{
        '../../utils/response':{successResponse(_r,p){sent.push(p)}},'../../utils/logger':{},'../packages/packages.receipt-guard':{assertPrintLabelReceiptConsistent(){}},
        '../../utils/operationRequest':{async getScopedOperationRequestStatus(input){assert.equal(input.userId,7);input.receiptContext.matchedAction=matched;return data}},
        '../../config/db':{pool:boundary},'../purchase/purchase.close-receipt':purchase,'../inbound-tasks/inbound-tasks.short-receipt':short,
        '../inbound-tasks/inbound-tasks.create-receipt':{async ensureInboundCreateReceiptView(){},async assertInboundCreateReceipt(){}},
        '../inbound-tasks/inbound-tasks.edit-receipt':{async ensureInboundEditReceiptView(){},async assertInboundEditReceipt(){}},
        '../print-jobs/print-jobs.reprint-intent':{async ensureReprintReceiptPermission(){},async assertReprintReceiptScope(){}},
        './system.split-device':{async ensureSplitReceiptDevice(){}},'../inventory/inventory.split-receipt':{async assertSplitReceipt(){}},'../sale/sale.commercial-receipts':{async assertReceiptScope(){}},
      })
      let error;await controller.requestStatus({params:{key:'original'},query:{action:requested},user:{userId:7,warehouseIds:ids}},{},e=>{error=e})
      if(ids[0]===8){assert.equal(error,undefined);assert.equal(sent[0],data)}else{assert.equal(error?.statusCode,403);assert.equal(sent.length,0)}
      assert.equal(boundary.queries.length,1)
    }
  })
}
test('reverse guard: removing effective short allocation or original scope makes existing assertions fail', async () => {
  const mutant=load('modules/inbound-tasks/inbound-tasks.short-receipt.js',deps,s=>s.replace("THEN iti.received_qty ELSE", "THEN iti.ordered_qty ELSE"))
  assert.throws(()=>assert.match(mutant.EFFECTIVE_ASSIGNED_QTY_SQL,/THEN iti.received_qty ELSE/),{code:'ERR_ASSERTION'})
  for(const d of domains) {
    const file=d.type==='purchase_order'?'modules/purchase/purchase.close-receipt.js':'modules/inbound-tasks/inbound-tasks.short-receipt.js'
    const mutant=load(file,deps,s=>{const lines=s.split('\n'),found=lines.filter(x=>x.includes("require('../../utils/warehouseScope').assertInScope("));assert.equal(found.length,1);return lines.filter(x=>!found.includes(x)).join('\n')})
    const fn=d.type==='purchase_order'?mutant.assertPurchaseCloseReceipt:mutant.assertCloseReceivingReceipt
    await assert.rejects(async()=>assert.rejects(fn(db(d),receipt(d),[9],{requestedAction:d.action+'.21'}),e=>e.statusCode===403),e=>e.code==='ERR_ASSERTION')
  }
})
test('reverse guard: removing followup capacity or explicit remainder closure breaks expected reopen rejection', async () => {
  const file='modules/inbound-tasks/inbound-tasks.short-receipt.js'
  for(const [needle,row,code] of [
    ["if (rows.some(row => qtyUnits(row.ordered_qty) + qtyUnits(row.other_assigned_qty) > qtyUnits(row.purchase_qty)))",{ordered_qty:100,other_assigned_qty:80,purchase_qty:100},'INBOUND_SHORT_RECEIPT_FOLLOWUP_EXISTS'],
    ["if (rows.some(row => Number(row.purchase_status) === 3 && row.purchase_closed_reason === 'short_close'))",{purchase_status:3,purchase_closed_reason:'short_close',ordered_qty:100,other_assigned_qty:0,purchase_qty:100},'PURCHASE_REMAINDER_CLOSED'],
  ]) {
    const mutant=load(file,deps,s=>{assert.equal(s.split(needle).length,2);return s.replace(needle,'if (false)')})
    await assert.rejects(async()=>assert.rejects(mutant.assertShortReceiptCanReopen(reopen([row]).conn,{id:21,closed_reason:'short_close'}),e=>e.code===code),e=>e.code==='ERR_ASSERTION'&&/Missing expected rejection/.test(e.message))
  }
})
