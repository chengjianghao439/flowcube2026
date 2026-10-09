'use strict'
const assert=require('node:assert/strict'),{test}=require('node:test')
const {createSaleSchema,shipSaleSchema}=require('../backend/src/modules/sale/sale.contracts')
const {preview}=require('../backend/src/modules/kits/kits.contracts')
const legacy={customerId:1,customerName:'C',warehouseId:1,warehouseName:'W',items:[{productId:1,productCode:'P',productName:'P',unit:'个',quantity:1,unitPrice:1}]}
test('an unknown commercial marker must never be stripped into an ordinary write',()=>assert.equal(createSaleSchema.safeParse({...legacy,commercialModel:'future'}).success,false))
test('commercial dispatch must never accept a physical-only payload',()=>assert.equal(shipSaleSchema.safeParse({commercialModel:'kit-v1',expectedRevision:1,items:[{id:1,qty:1}]}).success,false))
test('ordinary and kit commercial line remarks share the existing 200 character limit',()=>{
  for(const group of [{kind:'kit',kitVersionId:7,priceSource:'kit_default'},{kind:'ordinary',productId:1,priceSource:'default'}]){
    const body={customerId:1,warehouseId:1,commercialModel:'kit-v1',commercialGroups:[{...group,lineKey:'one',quantity:1,remark:'备注'.repeat(100)}]}
    assert.equal(createSaleSchema.parse(body).commercialGroups[0].remark.length,200)
    assert.equal(createSaleSchema.safeParse({...body,commercialGroups:[{...body.commercialGroups[0],remark:'字'.repeat(201)}]}).success,false)
    const quote={customerId:1,warehouseId:1,groups:body.commercialGroups}
    assert.equal(preview.parse(quote).groups[0].remark.length,200)
    assert.equal(preview.safeParse({...quote,groups:[{...quote.groups[0],remark:'字'.repeat(201)}]}).success,false)
  }
})

const { assertModel, assertRevision } = require('../backend/src/modules/sale/sale.edit-baseline')
const { editFingerprint, assertEditBaseline } = require('../backend/src/modules/sale/sale.edit-baseline')
const { commercialPreviewSchema, commercialActionSchema } = require('../backend/src/modules/sale/sale.contracts')
test('legacy edit uses a bound baseline and revision zero only on edit entry', async () => {
  const head={id:41,status:1,customer_id:1,warehouse_id:1,total_amount:'21.00',commercial_model:null}
  const items=[{id:5,product_id:11,warehouse_id:1,quantity:'1.00',unit_price:'21.00000000',amount:'21.00'}]
  const fingerprint=editFingerprint(head,items)
  const input={commercialModel:'kit-v1',expectedRevision:0,expectedEditFingerprint:fingerprint}
  assert.doesNotThrow(()=>assertModel(head,input,{allowEdit:true}))
  assert.throws(()=>assertModel(head,input),{code:'SALE_COMMERCIAL_MODEL_MISMATCH'})
  assert.throws(()=>assertModel(head,{...input,expectedEditFingerprint:undefined},{allowEdit:true}),{code:'SALE_COMMERCIAL_MODEL_MISMATCH'})
  const conn={query:async sql=> sql.includes('FROM sale_orders')?[[head]]:[items]}
  await assertEditBaseline(conn,head,input)
  await assert.rejects(assertEditBaseline(conn,head,{...input,expectedEditFingerprint:'f'.repeat(64)}),{code:'SALE_EDIT_BASELINE_CONFLICT'})
  assert.notEqual(editFingerprint(head,items),editFingerprint({...head,remark:'changed'},items))
  assert.notEqual(editFingerprint(head,items),editFingerprint(head,[{...items[0],reserved_qty:'1.00'}]))
  assert.notEqual(editFingerprint(head,items),editFingerprint({...head,id:42},items))
  const saved={...head,commercial_model:'kit-v1',commercial_revision:1}
  // Original transition can reach the replay gate; a new write with zero cannot pass revision checking.
  assert.doesNotThrow(()=>assertModel(saved,input,{allowEdit:true}))
  await assert.rejects(assertEditBaseline(conn,saved,input),{code:'SALE_COMMERCIAL_REVISION_CONFLICT'})
  assert.throws(()=>assertRevision(saved,input),{code:'SALE_COMMERCIAL_REVISION_CONFLICT'})
  assert.equal(commercialActionSchema.safeParse(input).success,false)
  assert.equal(commercialPreviewSchema.safeParse({...input,customerId:1,warehouseId:1,commercialGroups:[{kind:'ordinary',lineKey:'one',productId:11,quantity:1,priceSource:'manual',unitPrice:21}]}).success,true)
})
