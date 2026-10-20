const { test } = require('node:test')
const assert = require('node:assert/strict')
const validity = require('../backend/src/modules/credit-overrides/credit-overrides.validity')
const policy = require('../backend/src/modules/credit-overrides/credit-overrides.policy')
const { getCustomerCreditUsedForOrders } = require('../backend/src/utils/creditExposure')
const approved = {id:1,status:3,sale_order_id:11,proof_order_id:11,customer_id:7,credit_limit:1,this_amount:20,over_amount:19,basis_hash:'original',proof_expired:0,approval_completed:1}
const current = {order:{id:11,status:1},customerId:7,creditLimit:1,thisAmount:20,overAmount:19,basisHash:'original'}

test('批准效力按明确原因区分，旧无证明和被替代的批准不得自动恢复',()=>{
  assert.equal(validity.evaluate(approved,current).valid,true)
  for(const [patch,context,why] of [
    [{basis_hash:null},{},'MISSING_PROOF'],
    [{proof_order_id:99},{},'MISSING_PROOF'],
    [{proof_expired:1},{},'EXPIRED'],
    [{superseded_by:2},{},'SUPERSEDED'],
    [{},{order:{id:11,status:7}},'ORDER_UNAVAILABLE'],
    [{},{customerId:8},'CUSTOMER_CHANGED'],
    [{},{basisHash:'new'},'CONTENT_CHANGED'],
    [{},{creditLimit:2},'CREDIT_LIMIT_CHANGED'],
    [{},{thisAmount:21},'AMOUNT_CHANGED'],
    [{},{overAmount:20},'EXPOSURE_EXCEEDED'],
    [{approval_completed:0},{},'APPROVAL_UNCONFIRMED'],
  ]) {
    const result=validity.evaluate({...approved,...patch},{...current,...context})
    assert.equal(result.reasonCode,why);assert.equal(result.valid,false)
    const error=validity.invalidError(approved,result)
    assert.equal(error.code,'CREDIT_APPROVAL_INVALID');assert.match(error.message,/原批准已失效/)
  }
})

test('批量已用额度在扣除本单前保留精确四位金额，不因大数抵消丢掉另单余额',async()=>{
  let calls=0
  const db={query:async(sql,params)=>{
    calls++;assert.match(sql,/pr.type=2 AND pr.status IN \(1,2\)/);assert.match(sql,/so.status IN \(2,3,6\) AND so.deleted_at IS NULL/)
    assert.deepEqual(params,[[7],[7]])
    return [[{customer_id:7,order_id:11,used:'99999999999.9999'},{customer_id:7,order_id:12,used:'0.0001'}]]
  }}
  const result=await getCustomerCreditUsedForOrders(db,[{id:11,customer_id:7},{id:12,customer_id:7}])
  assert.equal(result.get(11),0.0001);assert.equal(result.get(12),99999999999.9999);assert.equal(calls,1)
})

for(const size of [1,100])test(`批准列表${size}行固定4次补充读取，无逐单查询`,async()=>{
  const orders=Array.from({length:size},(_,i)=>({id:i+1,customer_id:7,warehouse_id:1,total_amount:'20.0000',discount_amount:'0.00',status:1,current_credit_limit:1}))
  const items=orders.map(o=>({order_id:o.id,id:o.id,product_id:9,warehouse_id:1,unit:'个',quantity:'2.00',unit_price:'10.0000'}))
  const meta=orders.map((o,i)=>({...approved,id:o.id,sale_order_id:o.id,proof_order_id:o.id,basis_hash:policy.hashOrderBasis(o,[items[i]])}))
  const rows=orders.map(o=>({id:o.id,status:3,statusName:'已批准'})),calls=[]
  const db={query:async(sql,params)=>{
    calls.push({sql,params})
    if(sql.includes('FROM sale_credit_overrides')){assert.deepEqual(params,[orders.map(o=>o.id)]);return[meta]}
    if(sql.includes('SELECT so.*'))return[orders]
    if(sql.includes('FROM sale_order_items'))return[items]
    if(sql.includes('credit_parts GROUP BY'))return[[]]
    throw Error('Unexpected SQL '+sql)
  }}
  const result=await validity.decorate(db,rows)
  assert.equal(calls.length,4);assert.equal(result.length,size)
  assert.ok(result.every(r=>r.approvalValidity==='valid' && r.canReapply===false))
})
