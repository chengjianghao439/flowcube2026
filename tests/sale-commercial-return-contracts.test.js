'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {saleReturnSchema}=require('../backend/src/modules/returns/returns.contracts')
test('source return DTO preserves kit source identity and rejects unknown marker before ordinary stripping',()=>{
 const body={customerId:1,customerName:'C',warehouseId:1,warehouseName:'W',saleOrderId:1,commercialModel:'kit-v1',expectedRevision:1,items:[{sourceItemId:1,commercialComponentId:2,dispatchComponentId:3,productId:1,productCode:'P',productName:'P',unit:'个',quantity:1,unitPrice:80}]}
 assert.equal(saleReturnSchema.parse(body).items[0].dispatchComponentId,3)
 assert.equal(saleReturnSchema.safeParse({...body,commercialModel:'future'}).success,false)
 assert.equal(saleReturnSchema.safeParse({...body,items:[{...body.items[0],dispatchComponentId:undefined}]}).success,false)
})

test('sale return list marks only saved commercial-source rows without extra per-row queries',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),calls=[]
 const file=path.resolve(__dirname,'../backend/src/modules/returns/returns-sale.service.js'),module={exports:{}}
 const pool={query:async(sql,params)=>{calls.push([sql,params]);assert.match(sql,/^SELECT /);return calls.length===1?[[{id:1,status:3,total_amount:'0.0050',has_commercial_source:1},{id:2,status:3,total_amount:'0.0050',has_commercial_source:0}]]:[[{total:2}]]}}
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>name==='../../config/db'?{pool}:name==='../../utils/pagination'?{normalizePagination:()=>({pageSize:20,offset:0})}:name==='../../utils/warehouseScope'?{scopeFilter:()=>({sql:' AND warehouse_id IN (?)',params:[17]})}:{}},{filename:file})
 const result=await module.exports.findAllSR({scopeWarehouseIds:[17]})
 assert.equal(result.list[0].commercialModel,'kit-v1');assert.equal(result.list[0].totalAmount,0.005)
 assert.equal(Object.hasOwn(result.list[1],'commercialModel'),false);assert.equal(result.list[1].totalAmount,0.005)
 assert.equal(calls.length,2)
 assert.match(calls[0][0],/EXISTS\s*\(SELECT 1 FROM sale_return_items/)
 assert.match(calls[0][0],/return_id\s*=\s*sale_returns.id/)
 assert.match(calls[0][0],/dispatch_component_id IS NOT NULL/)
 assert.match(calls[0][0],/deleted_at IS NULL/)
 assert.deepEqual(Array.from(calls[0][1]),['%%','%%',17,20,0])
})
