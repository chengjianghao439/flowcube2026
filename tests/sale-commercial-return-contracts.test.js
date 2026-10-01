'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {saleReturnSchema}=require('../backend/src/modules/returns/returns.contracts')
test('source return DTO preserves kit source identity and rejects unknown marker before ordinary stripping',()=>{
 const body={customerId:1,customerName:'C',warehouseId:1,warehouseName:'W',saleOrderId:1,commercialModel:'kit-v1',expectedRevision:1,items:[{sourceItemId:1,commercialComponentId:2,dispatchComponentId:3,productId:1,productCode:'P',productName:'P',unit:'个',quantity:1,unitPrice:80}]}
 assert.equal(saleReturnSchema.parse(body).items[0].dispatchComponentId,3)
 assert.equal(saleReturnSchema.safeParse({...body,commercialModel:'future'}).success,false)
 assert.equal(saleReturnSchema.safeParse({...body,items:[{...body.items[0],dispatchComponentId:undefined}]}).success,false)
})
