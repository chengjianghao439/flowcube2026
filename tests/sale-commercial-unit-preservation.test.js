'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
const file=path.resolve(__dirname,'../backend/src/modules/sale/sale.commercial-store.js'),real=createRequire(file),module_={exports:{}}
// save is exercised directly; its unused view dependency must not load app DB config.
vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:module_,require:name=>name==='./sale.commercial-resolver'?{snapshot:()=>{}}:real(name)},{filename:file})
const { save }=module_.exports
const original = { id:7,product_id:11,warehouse_id:2,unit:'件',entry_unit:'包',quantity:'6.00',entry_qty:'0.50',conversion_rate:'12.0000',unit_price:'1.23456667',amount:'7.40',allow_decimal_qty_snapshot:null }
function fixture({ old=original, retained=true, history=false, unit='件', quantity=6, amount=7.4 }={}) {
 const calls=[],writes=[],record={...old}
 const conn={async query(sql,args){
  calls.push({sql,args});if(/^\s*(INSERT|UPDATE)/.test(sql))writes.push({sql,args})
  if(sql.startsWith('INSERT INTO sale_order_items')) {
   // Apply the declared duplicate-row SQL columns, so omitting unit assignments
   // reproduces the old persistence mismatch rather than checking payload only.
   const columns=sql.match(/sale_order_items \(([^)]+)\)/)[1].split(',')
   const updates=sql.split('ON DUPLICATE KEY UPDATE')[1]
   for(const match of updates.matchAll(/(\w+)=VALUES\((\w+)\)/g))record[match[1]]=args[0][0][columns.indexOf(match[2])]
  }
  if(sql.startsWith('SELECT * FROM sale_order_items'))return [[old]]
  if(sql.includes('SELECT i.id FROM sale_order_items'))return [history?[{id:7}]:[]]
  if(sql.startsWith('SELECT id,product_id'))return [[{id:7,product_id:11,warehouse_id:2}]]
  if(sql.startsWith('SELECT id,line_key'))return [[{id:31,line_key:'line'}]]
  return [{affectedRows:1}]
 }}
 const groups=[{id:31,lineKey:'line',kind:'ordinary',warehouseId:2,retained,targetQty:quantity,metadata:{},components:[{productId:11}]}]
 const items=[{productId:11,warehouseId:2,unit,entryUnit:unit,quantity,entryQty:quantity,conversionRate:1,unitPrice:1.23333333,amount,allowDecimalQtySnapshot:0}]
 return {conn,calls,writes,record,resolved:{groups,items,total:amount}}
}
test('unchanged retained commercial row preserves original entry, precision and NULL audit facts',async()=>{
 const f=fixture();await save(f.conn,1,2,f.resolved)
 const row=f.writes.find(c=>c.sql.startsWith('INSERT INTO sale_order_items')).args[0][0]
 assert.deepEqual(Array.from(row.slice(7,9)),['件','包']);assert.deepEqual(Array.from(row.slice(13,18)),['0.50','12.0000','1.23456667','7.40',null])
})
test('newly recorded unfulfilled draft uses its new fixed unit while retaining its physical identity',async()=>{
 const f=fixture({retained:false,unit:'组',quantity:1,amount:10});await save(f.conn,1,2,f.resolved)
 const row=f.writes.find(c=>c.sql.startsWith('INSERT INTO sale_order_items')).args[0][0]
 assert.equal(row[0],7);assert.deepEqual(Array.from(row.slice(7,9)),['组','组']);assert.equal(row[14],1);assert.equal(f.record.unit,'组');assert.equal(f.record.entry_unit,'组')
 assert.equal(f.calls.filter(c=>c.sql.includes('SELECT i.id FROM sale_order_items')).length,1)
})
test('historical physical unit replacement is rejected before any write',async()=>{
 const f=fixture({retained:false,history:true,unit:'组',quantity:1,amount:10})
 await assert.rejects(save(f.conn,1,2,f.resolved),{code:'SALE_FIXED_UNIT_CHANGED'});assert.equal(f.writes.length,0)
})
test('historical entry-unit replacement is protected even when the basic unit is unchanged',async()=>{
 const f=fixture({retained:false,history:true});await assert.rejects(save(f.conn,1,2,f.resolved),{code:'SALE_FIXED_UNIT_CHANGED'});assert.equal(f.writes.length,0)
})
test('newly recorded draft does not inherit old auxiliary entry conversion facts',async()=>{
 const f=fixture({retained:false});await save(f.conn,1,2,f.resolved)
 const row=f.writes.find(c=>c.sql.startsWith('INSERT INTO sale_order_items')).args[0][0];assert.equal(row[8],'件');assert.equal(row[13],6);assert.equal(row[14],1)
})

test('the draft unit contract detects removal of the actual duplicate-row unit assignments',async()=>{
 const broken=fs.readFileSync(file,'utf8').replace('unit=VALUES(unit),entry_unit=VALUES(entry_unit),','')
 const m={exports:{}};vm.runInNewContext(broken,{module:m,require:name=>name==='./sale.commercial-resolver'?{snapshot:()=>{}}:real(name)},{filename:file})
 const f=fixture({retained:false,unit:'组',quantity:1,amount:10});await m.exports.save(f.conn,1,2,f.resolved)
 assert.throws(()=>assert.equal(f.record.unit,'组'),{code:'ERR_ASSERTION'});assert.equal(f.record.unit,'件')
})
