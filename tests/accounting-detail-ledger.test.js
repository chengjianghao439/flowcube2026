'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { createRequire } = require('node:module')
function load(relative, overrides = {}, mutate = s => s) {
  const filename = path.join(__dirname, '../backend/src/', relative), module = { exports: {} }, real = createRequire(filename)
  vm.runInNewContext(mutate(fs.readFileSync(filename, 'utf8')), { module, require: n => Object.hasOwn(overrides,n) ? overrides[n] : real(n), console })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
function accounting() {
  const records = new Map([[1,{id:1,company_id:1,code:'1001',name:'主账套',category:1,level:1,is_leaf:1}], [2,{id:2,company_id:2,code:'1001',name:'第二账套',category:1,level:1,is_leaf:1}]])
  const calls = [], transactions = []
  const query = async (origin,sql,p=[]) => {
    calls.push({origin,sql,p})
    if (sql.includes('SELECT id, code, name')) { const r=records.get(p[1]);return [[r?.company_id===p[0]?r:undefined].filter(Boolean)] }
    if (sql.startsWith('UPDATE acct_accounts SET is_leaf')) return [{affectedRows:1}]
    if (/INSERT INTO acct_accounts/.test(sql)) { records.set(3,{id:3,company_id:p[0],code:p[1],name:p[2],category:p[3],parent_id:p[5],level:p[6],is_leaf:1,is_preset:0});return [{insertId:3}] }
    if (sql.includes('AS childCount')) return [[{childCount:0}]]
    if (sql.includes('AS entryCount')) return [[{entryCount:0}]]
    if (sql.includes('AS remain')) return [[{remain:0}]]
    if (sql.startsWith('DELETE FROM acct_accounts')) { assert.equal(records.get(p[0]).company_id,p[1]); records.delete(p[0]);return [{affectedRows:1}] }
    throw Error('Unexpected SQL: '+sql)
  }
  const conn = {query:(s,p)=>query('transaction',s,p),beginTransaction:async()=>transactions.push('begin'),commit:async()=>transactions.push('commit'),rollback:async()=>transactions.push('rollback'),release:()=>transactions.push('release')}
  const pool = {query:(s,p)=>query('pool',s,p),getConnection:async()=>conn}
  const service=load('modules/accounting/accounting.service.js',{'../../config/db':{pool},'../../utils/logger':{info(){}}})
  const controller=load('modules/accounting/accounting.controller.js',Object.fromEntries(['./accounting.service','./accounting.voucher.service','./accounting.ledger.service','./accounting.invoice.service','./accounting.period.service','./accounting.export','./companies.service','./consolidation.service','./accounting.tax.service'].map(n=>[n,n==='./accounting.service'?service:{}])),s=>process.env.B10_FIN_MUTANT==='account_connection'?s.replace('getById(+req.params.id, undefined, companyOf(req))','getById(+req.params.id, companyOf(req))'):s)
  return {service,controller,calls,transactions,records}
}
test('FIN14 actual accountDetail uses pool and company scope, defaults to company1, and returns cross-company404', async()=>{
  const {controller,calls}=accounting()
  async function invoke(id,companyId) { let body,error;const res={status:()=>res,json:value=>{body=value;return value}};await controller.accountDetail({params:{id:String(id)},companyId},res,e=>{error=e});return {body,error} }
  for(const companyId of [1,2]) { const r=await invoke(companyId,companyId);assert.equal(r.error,undefined);assert.equal(r.body.data.id,companyId) }
  assert.equal((await invoke(1,undefined)).body.data.name,'主账套')
  assert.equal((await invoke(1,2)).error.statusCode,404)
  assert.ok(calls.every(x=>x.origin==='pool'))
})
test('FIN14 internal create/remove retain caller transaction connection and exact company', async()=>{
  const {service,calls,transactions,records}=accounting()
  assert.equal((await service.create({code:'1001.1',name:'子科目',category:1,parentId:2,companyId:2},1)).id,3)
  await service.remove(3,1,2)
  assert.equal(records.has(3),false)
  assert.ok(calls.every(x=>x.origin==='transaction'))
  assert.deepEqual(plain(calls.filter(x=>x.sql.includes('SELECT id, code, name')).map(x=>x.p)),[[2,2],[2,3]])
  assert.deepEqual(transactions,['begin','commit','release','begin','commit','release'])
})
test('FIN15 actual supplier ledger labels refund while retaining direction, balance, identifiers and payment label', async()=>{
  const service=load('modules/payments/party-ledger.service.js',{},s=>process.env.B10_FIN_MUTANT==='supplier_label'?s.replace("  SUPPLIER_REFUND_IN: '供应商退款',",''):s)
  const reads=[]
  const conn={query:async(sql,p)=>{
    reads.push(sql);assert.match(sql,/^\s*(SELECT|WITH)/)
    if(sql.includes('FROM supply_suppliers'))return [[{id:7,code:'S7',name:'合成供应商'}]]
    if(sql.includes('FROM party_ledger_meta'))return [[{startedAt:'2026-01-01 00:00:00'}]]
    if(sql.includes('MAX(id)'))return [[{id:12}]]
    if(sql.includes('openingBalance'))return [[{openingBalance:0,increase:'0.33',decrease:'50.00',closingBalance:'-49.67',total:2}]]
    if(sql.startsWith('WITH balances'))return [[{id:11,event_type:'PAYMENT',document_no:'OUT11',delta:'-50.00',balance_after:'-50.00',record_id:8},{id:12,event_type:'SUPPLIER_REFUND_IN',document_no:'RF12',delta:'0.33',balance_after:'-49.67',record_id:8,order_id:9}]]
    if(sql.includes('COUNT(*) count'))return [[{count:sql.includes('party_id IS NULL')?0:2}]]
    throw Error('Unexpected SQL '+sql+' '+p)
  }}
  const result=await service.findLedger({type:1,partyId:7},conn)
  assert.equal(result.list[0].eventName,'供应商付款')
  assert.deepEqual(plain(result.list[1]),{id:12,eventType:'SUPPLIER_REFUND_IN',eventName:'供应商退款',documentNo:'RF12',orderId:9,recordId:8,receiptId:null,increase:0.33,decrease:0,balanceAfter:-49.67})
  assert.deepEqual(plain(result.summary),{openingBalance:0,increase:0.33,decrease:50,closingBalance:-49.67})
  assert.equal(reads.length,7)
})
