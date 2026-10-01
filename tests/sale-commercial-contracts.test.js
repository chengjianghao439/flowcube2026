'use strict'
const assert=require('node:assert/strict'),{test}=require('node:test')
const {createSaleSchema,shipSaleSchema}=require('../backend/src/modules/sale/sale.contracts')
const legacy={customerId:1,customerName:'C',warehouseId:1,warehouseName:'W',items:[{productId:1,productCode:'P',productName:'P',unit:'个',quantity:1,unitPrice:1}]}
test('an unknown commercial marker must never be stripped into an ordinary write',()=>assert.equal(createSaleSchema.safeParse({...legacy,commercialModel:'future'}).success,false))
test('commercial dispatch must never accept a physical-only payload',()=>assert.equal(shipSaleSchema.safeParse({commercialModel:'kit-v1',expectedRevision:1,items:[{id:1,qty:1}]}).success,false))
