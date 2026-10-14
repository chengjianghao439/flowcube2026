'use strict'
// Pure cash projection from immutable original PO line budgets. No DB, current
// product price/cost lookup, stock actions or receipt-state transitions.
const AppError=require('../../utils/AppError')
const cash=require('../../utils/cashMoney')
const {decimalUnits,halfUp}=require('../accounting/voucher-sale-money')
const {createHash}=require('node:crypto')
const POLICY='cash-cents-v1'
function review(reason){throw new AppError(`原采购分位依据需核对：${reason}`,409,'PURCHASE_CASH_BASIS_REQUIRED')}
const positiveId=n=>Number.isSafeInteger(Number(n))&&Number(n)>0
function parseBasis(value){
  let snapshot;try{snapshot=typeof value==='string'?JSON.parse(value):value}catch{review('冻结快照损坏')}
  if(!snapshot||snapshot.version!==1||snapshot.cashPolicy!==POLICY||!positiveId(snapshot.orderId)||!positiveId(snapshot.supplierId)||!positiveId(snapshot.warehouseId)||!Array.isArray(snapshot.items)||!snapshot.items.length)review('缺少准确原采购身份及行预算')
  const gross=cash.storedCashCents(snapshot.gross,'原采购合计'),ids=new Set(),budgets=new Map()
  for(const row of snapshot.items){
    if(!positiveId(row.id)||!positiveId(row.productId)||ids.has(Number(row.id))||typeof row.unit!=='string'||!row.unit)review('原采购行身份不唯一或单位缺失')
    ids.add(Number(row.id));const q=decimalUnits(row.quantity,2),price=decimalUnits(row.unitPrice,8),amount=cash.storedCashCents(row.amount,'原采购行金额')
    if(q<=0n||price<0n||amount<0n)review('原采购量价预算无效')
    budgets.set(Number(row.id),amount)
  }
  if(gross<0n||[...budgets.values()].reduce((n,a)=>n+a,0n)!==gross)review('原行预算与单头不闭合')
  return {snapshot,gross,budgets}
}
function freezeBasis(order,rows){
  const snapshot={version:1,cashPolicy:POLICY,orderId:Number(order.id),supplierId:Number(order.supplier_id),warehouseId:Number(order.warehouse_id),gross:cash.cashText(cash.storedCashCents(order.total_amount,'采购合计')),items:rows.map(r=>({id:Number(r.id),productId:Number(r.product_id),unit:r.unit,quantity:String(r.quantity),unitPrice:String(r.unit_price),amount:cash.cashText(cash.storedCashCents(r.amount,'采购行金额'))}))}
  parseBasis(snapshot);return snapshot
}
function quantityVector(basis,rows){
  const values=new Map(basis.snapshot.items.map(r=>[Number(r.id),0n])),seen=new Set()
  for(const row of rows){const id=Number(row.id);if(!values.has(id)||seen.has(id))review('实收向量来源缺失或重复');seen.add(id);const q=decimalUnits(row.quantity,2);if(q<0n)review('实收数量不能为负');values.set(id,q)}
  return values
}
const quantityText=q=>`${q/100n}.${String(q%100n).padStart(2,'0')}`
function receivedContribution(basis,row,received){
  const original=decimalUnits(row.quantity,2),amount=basis.budgets.get(Number(row.id))
  if(received<=original)return cash.lineContribution(amount,received,original)
  if(amount!==cash.productCents(row.quantity,row.unitPrice))review('超收前原行金额与原量价舍入不一致，不能外推旧预算')
  return cash.fraction(cash.productCents(quantityText(received),row.unitPrice))
}
function contribution(basis,values){return basis.snapshot.items.reduce((n,r)=>cash.addFraction(n,receivedContribution(basis,r,values.get(Number(r.id))||0n)),cash.fraction())}
function cashTarget(snapshot,rows){const b=parseBasis(snapshot),values=quantityVector(b,rows),share=contribution(b,values);return halfUp(share.n,share.d)}
function vectorText(b,values){return b.snapshot.items.map(i=>({id:Number(i.id),quantity:`${(values.get(Number(i.id))||0n)/100n}.${String((values.get(Number(i.id))||0n)%100n).padStart(2,'0')}`}))}
function basisHash(value){
  const b=parseBasis(value),original=b.snapshot
  const canonical={version:1,cashPolicy:POLICY,orderId:Number(original.orderId),supplierId:Number(original.supplierId),warehouseId:Number(original.warehouseId),gross:cash.cashText(b.gross),items:original.items.map(i=>({id:Number(i.id),productId:Number(i.productId),unit:i.unit,quantity:decimalUnits(i.quantity,2).toString(),price:decimalUnits(i.unitPrice,8).toString(),amount:b.budgets.get(Number(i.id)).toString()})).sort((a,c)=>a.id-c.id)}
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
function reserveReturn(snapshot,receivedRows,active,items){
  const b=parseBasis(snapshot),received=quantityVector(b,receivedRows),used=new Map(),seen=new Set()
  let prior=0n
  for(const reservation of active){
    if(!positiveId(reservation.returnId)||seen.has(Number(reservation.returnId)))review('原活动退货保留身份重复')
    const credit=cash.storedCashCents(reservation.credit,'原保留退货金额')
    if(credit<0n||!Array.isArray(reservation.items)||!reservation.items.length)review('原保留退货金额或行缺失')
    seen.add(Number(reservation.returnId));prior+=credit
    for(const i of reservation.items){const id=Number(i.purchaseItemId),q=decimalUnits(i.quantity,2);if(!b.budgets.has(id)||q<0n)review('原保留退货来源无效');used.set(id,(used.get(id)||0n)+q)}
  }
  const currentTarget=cashTarget(snapshot,receivedRows)
  if(prior<0n||prior>currentTarget||b.snapshot.items.some(i=>(used.get(Number(i.id))||0n)>(received.get(Number(i.id))||0n)))review('原活动退货量额超出真实已收分预算')
  const nextUsed=new Map(used),batch=new Map(),resolved=items.map(i=>{
    const id=Number(i.purchaseItemId??i.sourceItemId),source=b.snapshot.items.find(s=>Number(s.id)===id),q=decimalUnits(i.quantity,2)
    if(!source||Number(i.productId)!==Number(source.productId)||q<=0n)review('本次退货来源或数量无效')
    nextUsed.set(id,(nextUsed.get(id)||0n)+q);batch.set(id,(batch.get(id)||0n)+q)
    if(nextUsed.get(id)>(received.get(id)||0n))review('本次退货超过当前原行已收可退量')
    const r=received.get(id)||0n,base=receivedContribution(b,source,r),f=cash.fraction(base.n*q,base.d*r)
    return {...i,purchaseItemId:id,financial:f.n/f.d}
  })
  const share=b.snapshot.items.reduce((n,i)=>{const r=received.get(Number(i.id))||0n;if(!r)return n;const f=receivedContribution(b,i,r);return cash.addFraction(n,cash.fraction(f.n*(batch.get(Number(i.id))||0n),f.d*r))},cash.fraction())
  const positive=i=>receivedContribution(b,i,received.get(Number(i.id))||0n).n>0n
  const final=b.snapshot.items.filter(positive).every(i=>(nextUsed.get(Number(i.id))||0n)===(received.get(Number(i.id))||0n))
  const remaining=currentTarget-prior,raw=share.n/share.d
  const credit=share.n===0n?0n:final?remaining:raw<remaining?raw:remaining
  if(credit<0n||credit+prior>currentTarget)review('本次保留退货分预算超过当前真实已收预算')
  const tail=[...resolved].reverse().find(i=>positive(b.snapshot.items.find(s=>Number(s.id)===i.purchaseItemId)))
  let capacity=credit
  for(const i of resolved){if(i.financial>capacity)i.financial=capacity;capacity-=i.financial}
  if(!tail&&credit!==0n)review('缺少正预算真实退货行承接分尾额')
  if(tail)tail.financial+=capacity
  if(resolved.some(i=>i.financial<0n))review('退货行分预算不能为负')
  return {credit,items:resolved.map(i=>({...i,amount:cash.cashNumber(i.financial)})),proof:{version:1,cashPolicy:POLICY,orderId:Number(b.snapshot.orderId),basisHash:basisHash(snapshot),received:vectorText(b,received),priorReservations:active,credit:cash.cashText(credit)}}
}
function payableProjection(snapshot,auditedRows,executed){
  const b=parseBasis(snapshot),gross=cashTarget(snapshot,auditedRows),ids=new Set();let credit=0n
  for(const r of executed){if(!positiveId(r.returnId)||ids.has(Number(r.returnId))||!Array.isArray(r.items)||!r.items.length)review('已执行退货来源重复或明细缺失');ids.add(Number(r.returnId));const own=cash.storedCashCents(r.credit,'已执行原退货金额');if(own<0n)review('已执行退货金额不能为负');credit+=own;for(const i of r.items){const id=Number(i.purchaseItemId),q=decimalUnits(i.quantity,2);if(!b.budgets.has(id)||q<=0n)review('已执行退货来源无效')}}
  if(credit<0n)review('已执行退货金额不能为负')
  return {version:1,cashPolicy:POLICY,orderId:Number(b.snapshot.orderId),basisHash:basisHash(snapshot),auditedReceived:vectorText(b,quantityVector(b,auditedRows)),gross:cash.cashText(gross),executedCredit:cash.cashText(credit),pendingCredit:cash.cashText(credit>gross?credit-gross:0n),payable:cash.cashText(gross>credit?gross-credit:0n),executedReturns:executed}
}
function parseProof(value){
  try{const p=typeof value==='string'?JSON.parse(value):value;if(p&&p.version===1&&p.cashPolicy===POLICY)return p}catch{}
  review('退货缺少创建时冻结分预算，请取消未执行旧单后重新创建或人工核对历史')
}
function returnItems(rows){return rows.map(i=>({id:Number(i.id),purchaseItemId:Number(i.purchase_item_id),productId:Number(i.product_id),unit:i.unit,quantity:String(i.quantity),unitPrice:String(i.unit_price),amount:cash.cashText(cash.storedCashCents(i.amount,'原采购退货行额'))}))}
function legacyBasis(order,rows){
  for(const i of rows){if(decimalUnits(i.unit_price,8)%100000000n!==0n||cash.storedCashCents(i.amount)!==cash.productCents(i.quantity,i.unit_price))review('旧采购小数价或行预算尚不能证明与分预算任意执行同口径')}
  return freezeBasis(order,rows)
}
function basisForReturn(order,row,original){
  if(order.cash_basis)return order.cash_basis
  const p=row.cash_execution_basis?parseProof(row.cash_execution_basis):null
  const snapshot=legacyBasis(order,original)
  if(p&&(!p.legacyBasis||basisHash(p.legacyBasis)!==basisHash(snapshot)))review('旧采购临时冻结依据与当前原行不一致')
  return snapshot
}
function legacyReturn(snapshot,row,rows){
  const b=parseBasis(snapshot)
  if(Number(row.purchase_order_id)!==Number(b.snapshot.orderId)||Number(row.supplier_id)!==Number(b.snapshot.supplierId)||Number(row.warehouse_id)!==Number(b.snapshot.warehouseId)||!rows.length)review('旧退货准确来源不一致')
  let credit=0n
  const items=rows.map(i=>{const s=b.snapshot.items.find(v=>Number(v.id)===Number(i.purchase_item_id)),q=decimalUnits(i.quantity,2),own=cash.storedCashCents(i.amount,'旧退货行额');if(!s||q<=0n||Number(i.product_id)!==Number(s.productId)||i.unit!==s.unit||decimalUnits(i.unit_price,8)!==decimalUnits(s.unitPrice,8)||own!==cash.productCents(i.quantity,s.unitPrice))review('旧退货原量价或行额不闭合');credit+=own;return{purchaseItemId:Number(i.purchase_item_id),quantity:String(i.quantity)}})
  if(credit!==cash.storedCashCents(row.total_amount,'旧退货合计'))review('旧退货头项不闭合')
  return{returnId:Number(row.id),credit:cash.cashText(credit),items}
}
function freezeReturn(snapshot,row,rows,quote){
  const p={...quote.proof,returnId:Number(row.id),returnNo:row.return_no,supplierId:Number(row.supplier_id),warehouseId:Number(row.warehouse_id),items:returnItems(rows)}
  validateReturn(snapshot,{...row,cash_execution_basis:p},rows)
  return p
}
function validateReturn(snapshot,row,rows,original=null){
  const b=parseBasis(snapshot),p=parseProof(row.cash_execution_basis)
  if(Number(row.purchase_order_id)!==Number(b.snapshot.orderId)||Number(row.supplier_id)!==Number(b.snapshot.supplierId)||Number(row.warehouse_id)!==Number(b.snapshot.warehouseId)
    ||p.orderId!==Number(b.snapshot.orderId)||p.basisHash!==basisHash(snapshot)||p.returnId!==Number(row.id)||p.returnNo!==row.return_no
    ||p.supplierId!==Number(row.supplier_id)||p.warehouseId!==Number(row.warehouse_id)||!Array.isArray(p.items)||!Array.isArray(p.received)||!Array.isArray(p.priorReservations)||!rows.length)review('退货冻结来源身份不一致')
  if(original){
    if(original.length!==b.snapshot.items.length)review('原采购行已变化')
    for(const s of b.snapshot.items){const r=original.find(i=>Number(i.id)===Number(s.id));if(!r||Number(r.order_id)!==Number(b.snapshot.orderId)||Number(r.product_id)!==Number(s.productId)||r.unit!==s.unit||decimalUnits(r.quantity,2)!==decimalUnits(s.quantity,2)||decimalUnits(r.unit_price,8)!==decimalUnits(s.unitPrice,8)||cash.storedCashCents(r.amount,'原采购行额')!==b.budgets.get(Number(s.id)))review('原采购量价或行预算已变化')}
  }
  const actual=returnItems(rows),saved=new Map(p.items.map(i=>[Number(i.id),i])),ids=new Set()
  for(const i of actual){
    const old=saved.get(i.id),s=b.snapshot.items.find(v=>Number(v.id)===i.purchaseItemId)
    if(ids.has(i.id)||!old||!s||Number(old.purchaseItemId)!==i.purchaseItemId||Number(old.productId)!==i.productId||i.productId!==Number(s.productId)||old.unit!==i.unit||i.unit!==s.unit
      ||decimalUnits(old.quantity,2)!==decimalUnits(i.quantity,2)||decimalUnits(old.unitPrice,8)!==decimalUnits(i.unitPrice,8)||decimalUnits(i.unitPrice,8)!==decimalUnits(s.unitPrice,8)||cash.storedCashCents(old.amount)!==cash.storedCashCents(i.amount))review('原退货行量价或冻结金额已变化')
    ids.add(i.id)
  }
  if(saved.size!==actual.length||p.items.length!==actual.length||p.priorReservations.some(r=>Number(r.returnId)>=Number(row.id)))review('原保留顺序或退货行身份不一致')
  const quote=reserveReturn(snapshot,p.received,p.priorReservations,actual)
  if(quote.credit!==cash.storedCashCents(row.total_amount,'原退货合计')||quote.credit!==cash.storedCashCents(p.credit,'原冻结退货合计')
    ||actual.some((i,n)=>cash.storedCashCents(i.amount)!==cash.storedCashCents(quote.items[n].amount)))review('原退货固定分预算不能重建')
  return {returnId:Number(row.id),credit:cash.cashText(quote.credit),items:actual.map(i=>({purchaseItemId:i.purchaseItemId,quantity:i.quantity}))}
}
function validateProjection(snapshot,value,total){
  const p=parseProof(value)
  if(!Array.isArray(p.auditedReceived)||!Array.isArray(p.executedReturns))review('原应付缺少已审/已退投影')
  const expected=payableProjection(snapshot,p.auditedReceived,p.executedReturns)
  for(const key of ['orderId','basisHash','gross','executedCredit','pendingCredit','payable'])if(String(p[key])!==String(expected[key]))review('原应付投影金额或来源不闭合')
  if(cash.storedCashCents(total,'原应付金额')!==cash.storedCashCents(expected.payable))review('原应付金额与原投影不一致')
  return expected
}
function appendReturn(snapshot,projection,total,fact){
  const p=validateProjection(snapshot,projection,total)
  if(p.executedReturns.some(r=>Number(r.returnId)===Number(fact.returnId)))review('退货已计入原应付，不能重复冲减')
  const next=payableProjection(snapshot,p.auditedReceived,p.executedReturns.concat(fact))
  // Existing AP execution must retain the original negative-total gate. A pending
  // credit can arise on later receipt recomputation, never by clamping this debit.
  if(cash.storedCashCents(total)-cash.storedCashCents(fact.credit)<0n)review('本次退货超过现有应付总额')
  return next
}
module.exports={POLICY,parseBasis,freezeBasis,quantityVector,vectorText,receivedContribution,contribution,cashTarget,basisHash,reserveReturn,payableProjection,parseProof,legacyBasis,basisForReturn,legacyReturn,freezeReturn,validateReturn,validateProjection,appendReturn,review}
