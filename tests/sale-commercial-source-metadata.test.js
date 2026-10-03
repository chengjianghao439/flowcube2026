'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
function api(){
  const file=path.resolve(__dirname,'../backend/src/modules/sale/sale.commercial-returns.js'),real=createRequire(file),module={exports:{}}
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>name==='../../utils/warehouseScope'?{assertInScope:()=>{}}:name==='./sale.commercial-money'?{invalid:reason=>{throw new Error(reason)}}:real(name)},{filename:file})
  return module.exports
}
const base={dispatchComponentId:'1',commercialComponentId:'2',sale_item_id:'3',product_id:'4',warehouse_id:'5',groupId:'6',kind:'kit',kit_code:'K',kit_name:'套',line_key:'L',task_id:'7',task_no:'WT-A',confirmed_at:'2026-10-01 12:00:00',warehouse_name:'原仓',qty_policy_product_id:4,allow_decimal_qty:0,sourceQuantity:'1.00',sourceBudgetAmount:'80.00',order_gross_basis:'100.00',discount_basis:'0.00',basis_origin:'real_confirmation'}
for(const [name,extra,expected]of [['integer',{},false],['decimal',{allow_decimal_qty:1},true],['existing NULL flag',{allow_decimal_qty:null},true],['missing product',{qty_policy_product_id:null,allow_decimal_qty:null},null]]){
  test(`source metadata policy ${name} uses current product convention without changing budget`,async()=>{
    const calls=[],conn={query:async sql=>{calls.push(sql);return [[{...base,...extra}]]}}
    const rows=await api().sources(conn,1)
    assert.equal(rows.length,1);assert.equal(rows[0].allowDecimalQty,expected)
    assert.equal(rows[0].taskId,7);assert.equal(rows[0].taskNo,'WT-A');assert.equal(rows[0].confirmedAt,base.confirmed_at);assert.equal(rows[0].warehouseName,'原仓');assert.equal(rows[0].sourceBudgetAmount,80);assert.equal(rows[0].sourceQuantity,1)
    assert.equal(calls.length,1);assert.doesNotMatch(calls[0],/FOR UPDATE|FOR SHARE|p\.deleted_at|p\.is_active/)
  })
}
test('same SKU in distinct original batches preserves each task and confirmation metadata',async()=>{
  const rows=await api().sources({query:async()=>[[base,{...base,dispatchComponentId:8,task_id:9,task_no:'WT-B',confirmed_at:'2026-10-02 13:00:00',warehouse_name:null}]]},1)
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r=>[r.taskId,r.taskNo,r.confirmedAt,r.warehouseName]))),[[7,'WT-A',base.confirmed_at,'原仓'],[9,'WT-B','2026-10-02 13:00:00',null]])
})
test('saved labels are one batch with absent identity represented by no source, missing labels stay null',async()=>{
  const calls=[],conn={query:async(sql,params)=>{calls.push([sql,params]);return [[{...base,returnItemId:11,task_no:null,warehouse_name:null,qty_policy_product_id:null}]]}}
  const rows=await api().savedSources(conn,12),source=rows.get(11)
  assert.equal(source.taskId,7);assert.equal(source.taskNo,null);assert.equal(source.warehouseName,null);assert.equal(source.allowDecimalQty,null);assert.equal(source.kitName,'套');assert.equal(rows.get(99),undefined);assert.equal(calls.length,1);assert.doesNotMatch(calls[0][0],/FOR UPDATE|FOR SHARE/)
  assert.equal((await api().savedSources({query:async()=>[[]]},12)).size,0)
})
