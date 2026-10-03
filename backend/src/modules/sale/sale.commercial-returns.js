'use strict'
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertQtyPrecision } = require('../../utils/qtyPrecision')
const { roundQty, round8 } = require('../../utils/unitConversion')
const { projectCommercialRefund } = require('./sale.commercial-money.math')
const { refundEstimateUpperBound } = require('./sale.commercial-refund-budget')
const { invalid } = require('./sale.commercial-money')
const {financialRefundDelta,financialRefundEstimate}=require('./sale.commercial-financial')
function sourceLabels(row) {
  return {
    kind:row.kind,kitCode:row.kit_code ?? null,kitName:row.kit_name ?? null,
    groupId:Number(row.groupId),lineKey:row.line_key,
    taskId:Number(row.task_id),taskNo:row.task_no || null,confirmedAt:row.confirmed_at ?? null,
    warehouseId:Number(row.warehouse_id),warehouseName:row.warehouse_name || null,
    // Current product policy is only an entry hint, never part of the frozen source budget.
    allowDecimalQty:row.qty_policy_product_id == null ? null : row.allow_decimal_qty == null || Number(row.allow_decimal_qty)===1,
  }
}
async function savedSources(conn,returnId) {
  // SR viewing is scoped to its own warehouse. All source identities must close
  // here; do not obtain labels by opening the whole SO or trusting one source ID.
  const [rows]=await conn.query(`SELECT sri.id AS returnItemId,g.kind,g.kit_code,g.kit_name,g.id AS groupId,g.line_key,
    d.task_id,d.confirmed_at,wt.task_no,g.warehouse_id,wt.warehouse_name,p.id AS qty_policy_product_id,p.allow_decimal_qty
    FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id
    JOIN sale_dispatch_component_money m ON m.id=sri.dispatch_component_id AND m.component_id=sri.commercial_component_id
    JOIN sale_commercial_components c ON c.id=m.component_id AND c.sale_item_id=sri.sale_item_id AND c.product_id=sri.product_id
    JOIN sale_commercial_groups g ON g.id=c.group_id AND g.order_id=sr.sale_order_id AND g.warehouse_id=sr.warehouse_id
    JOIN sale_dispatch_groups d ON d.id=m.dispatch_group_id AND d.group_id=g.id AND d.order_id=sr.sale_order_id
    JOIN warehouse_tasks wt ON wt.id=d.task_id AND wt.sale_order_id=sr.sale_order_id AND wt.warehouse_id=sr.warehouse_id AND wt.task_type='sale_out'
    JOIN sale_order_items soi ON soi.id=c.sale_item_id AND soi.order_id=sr.sale_order_id AND soi.product_id=sri.product_id AND soi.warehouse_id=sr.warehouse_id
    LEFT JOIN product_items p ON p.id=c.product_id
    WHERE sri.return_id=? AND wt.status=7 AND d.confirmed_at IS NOT NULL ORDER BY sri.id`,[returnId])
  return new Map(rows.map(row=>[Number(row.returnItemId),sourceLabels(row)]))
}
async function sources(conn,orderId) {
  // The money row is immutable and doubles as the refund serialization mutex only in writes.
  const [rows]=await conn.query(`SELECT m.id AS dispatchComponentId,m.component_id AS commercialComponentId,m.source_qty AS sourceQuantity,m.confirmed_amount AS sourceBudgetAmount,
    d.order_gross_basis,d.discount_basis,d.basis_origin,g.order_id,g.warehouse_id,g.id AS groupId,g.line_key,g.kind,g.kit_code,g.kit_name,d.task_id,d.confirmed_at,wt.task_no,wt.warehouse_name,p.id AS qty_policy_product_id,p.allow_decimal_qty,
    c.sale_item_id,c.product_id,c.product_code,c.product_name,c.unit,c.article_number,c.spec,c.color
    FROM sale_dispatch_component_money m JOIN sale_dispatch_groups d ON d.id=m.dispatch_group_id
    JOIN warehouse_tasks wt ON wt.id=d.task_id JOIN sale_commercial_components c ON c.id=m.component_id JOIN sale_commercial_groups g ON g.id=c.group_id
    LEFT JOIN product_items p ON p.id=c.product_id
    WHERE g.order_id=? AND wt.status=7 AND wt.deleted_at IS NULL AND d.confirmed_at IS NOT NULL ORDER BY m.id`,[orderId])
  if(rows.some(r=>!['real_confirmation','legacy_verified'].includes(r.basis_origin)))invalid('原出库批次的折扣依据尚未核对')
  return rows.map(r=>({...r,...sourceLabels(r),dispatchComponentId:Number(r.dispatchComponentId),commercialComponentId:Number(r.commercialComponentId),sourceItemId:Number(r.sale_item_id),productId:Number(r.product_id),warehouseId:Number(r.warehouse_id),sourceQuantity:Number(r.sourceQuantity),sourceBudgetAmount:Number(r.sourceBudgetAmount),financialBasis:{orderGross:Number(r.order_gross_basis),discount:Number(r.discount_basis)}}))
}
async function loadView(conn,order,scope) {
  const rows=await sources(conn,order.id)
  const [requested]=await conn.query(`SELECT sri.dispatch_component_id,sri.sale_item_id,sri.quantity FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id WHERE sr.sale_order_id=? AND sr.status<>4 AND sr.deleted_at IS NULL`,[order.id])
  const sourceUsed=new Map(),physicalUsed=new Map()
  for(const r of requested){sourceUsed.set(Number(r.dispatch_component_id),roundQty((sourceUsed.get(Number(r.dispatch_component_id))||0)+Number(r.quantity)));physicalUsed.set(Number(r.sale_item_id),roundQty((physicalUsed.get(Number(r.sale_item_id))||0)+Number(r.quantity)))}
  const [receipts]=await conn.query('SELECT dispatch_component_id,qualified_qty,refund_amount,financial_amount FROM sale_commercial_refund_receipts WHERE order_id=?',[order.id])
  const refunded=new Map();for(const r of receipts){const old=refunded.get(Number(r.dispatch_component_id))||{qty:0,amount:0,financial:0};old.financial+=Number(r.financial_amount);old.qty=roundQty(old.qty+Number(r.qualified_qty));old.amount+=Number(r.refund_amount);refunded.set(Number(r.dispatch_component_id),old)}
  return rows.map(r=>{
    assertInScope(scope,r.warehouseId,'销售退货来源')
    const actual=refunded.get(r.dispatchComponentId)||{qty:0,amount:0,financial:0}
    return {...r,productCode:r.product_code,productName:r.product_name,unit:r.unit,articleNumber:r.article_number,spec:r.spec,color:r.color,shippedQty:r.sourceQuantity,returnedQty:sourceUsed.get(r.dispatchComponentId)||0,remainingQty:Math.max(0,roundQty(r.sourceQuantity-(sourceUsed.get(r.dispatchComponentId)||0))),unitPrice:round8(r.sourceBudgetAmount/r.sourceQuantity),refundBudget:r.sourceBudgetAmount,actualQualifiedQty:actual.qty,actualRefundGross:actual.amount,actualRefundAmount:actual.financial,sourceFinancialEstimate:financialRefundEstimate(r.financialBasis,r.sourceBudgetAmount),amountBasis:'immutable_confirmed_source_component_budget'}
  })
}
async function validate(conn,order,warehouseId,items,scope) {
  const ids=[...new Set(items.map(i=>Number(i.dispatchComponentId)))].sort((a,b)=>a-b)
  if(!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw new AppError('请选择原出库批次的配件退货',400,'SALE_RETURN_SOURCE_INVALID')
  // The kit SO mutex serializes both quota dimensions. Only budget identities
  // are locked here; immutable metadata joins must not lock WT/group rows.
  const [budgets]=await conn.query('SELECT id FROM sale_dispatch_component_money WHERE id IN (?) ORDER BY id FOR UPDATE',[ids])
  if(budgets.length!==ids.length)throw new AppError('所选原出库批次不存在',400,'SALE_RETURN_SOURCE_INVALID')
  const rows=await sources(conn,order.id), byId=new Map(rows.map(r=>[r.dispatchComponentId,r]))
  // Under the source mutex: current reads see all noncancelled requests, including a winner just committed.
  const [existing]=await conn.query(`SELECT sri.id,sri.dispatch_component_id,sri.sale_item_id,sri.quantity FROM sale_return_items sri JOIN sale_returns sr ON sr.id=sri.return_id
    WHERE sr.sale_order_id=? AND sr.status<>4 AND sr.deleted_at IS NULL ORDER BY sri.id FOR SHARE`,[order.id])
  const [physical]=await conn.query('SELECT id,shipped_qty FROM sale_order_items WHERE order_id=? ORDER BY id FOR SHARE',[order.id])
  const physicalLimit=new Map(physical.map(p=>[Number(p.id),Number(p.shipped_qty)])),usedSource=new Map(),usedPhysical=new Map(),pairs=new Map()
  for(const r of existing){usedSource.set(Number(r.dispatch_component_id),roundQty((usedSource.get(Number(r.dispatch_component_id))||0)+Number(r.quantity)));usedPhysical.set(Number(r.sale_item_id),roundQty((usedPhysical.get(Number(r.sale_item_id))||0)+Number(r.quantity)))}
  const resolved=items.map(i=>{
    const source=byId.get(Number(i.dispatchComponentId)); if(!source || Number(i.commercialComponentId)!==source.commercialComponentId || Number(i.sourceItemId)!==source.sourceItemId || Number(i.productId)!==source.productId) throw new AppError('所选退货配件与原出库批次不一致',400,'SALE_RETURN_SOURCE_INVALID')
    assertInScope(scope,source.warehouseId,'销售退货来源')
    if(Number(warehouseId)!==source.warehouseId) throw new AppError('退货仓库须为原实际发货仓库',400,'SALE_RETURN_SOURCE_WAREHOUSE')
    const pair=`${source.productId}:${source.warehouseId}`, key=`${source.commercialComponentId}:${source.dispatchComponentId}`
    if(pairs.has(pair)&&pairs.get(pair)!==key) throw new AppError('同一退货单同款商品仅允许一个原出库批次，跨批次请分单退货',400,'SALE_RETURN_SAME_SKU_SOURCE_SPLIT_REQUIRED')
    pairs.set(pair,key)
    const qty=Number(i.quantity); if(!(qty>0)) throw new AppError('退货数量必须大于零',400)
    usedSource.set(source.dispatchComponentId,roundQty((usedSource.get(source.dispatchComponentId)||0)+qty));usedPhysical.set(source.sourceItemId,roundQty((usedPhysical.get(source.sourceItemId)||0)+qty))
    if(usedSource.get(source.dispatchComponentId)>source.sourceQuantity || usedPhysical.get(source.sourceItemId)>(physicalLimit.get(source.sourceItemId)||0)) throw new AppError('退货数量超过原出库批次或配件已发余量',409,'SALE_RETURN_QUOTA_EXCEEDED')
    // Draft estimate only; exact actual qualified money is frozen at completion.
    const estimate=refundEstimateUpperBound({sourceAmount:source.sourceBudgetAmount,sourceQty:source.sourceQuantity,quantity:qty})
    return {...i,unit:source.unit,entryUnit:source.unit,entryQty:qty,conversionRate:1,unitPrice:round8(source.sourceBudgetAmount/source.sourceQuantity),amount:financialRefundEstimate(source.financialBasis,estimate),productCode:source.product_code,productName:source.product_name,articleNumber:source.article_number,spec:source.spec,color:source.color}
  })
  await assertQtyPrecision(conn,resolved.map(i=>({productId:i.productId,qty:i.quantity,label:'退货数量'})))
  return resolved
}
async function lockExecution(conn,taskId) {
  // Discover immutable identities without taking a task/stock lock first. Lock sources in stable order.
  const [refs]=await conn.query(`SELECT DISTINCT sri.dispatch_component_id,rt.return_id FROM return_tasks rt JOIN return_task_items rti ON rti.task_id=rt.id JOIN sale_return_items sri ON sri.id=rti.return_item_id WHERE rt.id=? AND sri.dispatch_component_id IS NOT NULL ORDER BY sri.dispatch_component_id`,[taskId])
  if(!refs.length)return false
  await conn.query('SELECT id FROM sale_dispatch_component_money WHERE id IN (?) ORDER BY id FOR UPDATE',[refs.map(r=>r.dispatch_component_id)])
  await conn.query('SELECT id FROM sale_returns WHERE id=? FOR UPDATE',[refs[0].return_id])
  return true
}
async function complete(conn,returnId,taskId) {
  const [qa]=await conn.query('SELECT id,return_item_id,checked_qty,rejected_qty,putaway_qty FROM return_task_items WHERE task_id=? ORDER BY id FOR UPDATE',[taskId])
  const [sourceItems]=await conn.query(`SELECT sri.id,sri.dispatch_component_id,m.source_qty,m.confirmed_amount,g.order_id FROM sale_return_items sri
    JOIN sale_dispatch_component_money m ON m.id=sri.dispatch_component_id JOIN sale_commercial_components c ON c.id=m.component_id JOIN sale_commercial_groups g ON g.id=c.group_id
    WHERE sri.return_id=? ORDER BY sri.dispatch_component_id,sri.id`,[returnId])
  const qaByItem=new Map(qa.map(q=>[Number(q.return_item_id),q]))
  const items=sourceItems.map(i=>{const q=qaByItem.get(Number(i.id));if(!q)invalid('退货明细缺少真实QA行');return {...i,taskItemId:q.id,checked_qty:q.checked_qty,rejected_qty:q.rejected_qty,putaway_qty:q.putaway_qty}})
  if(!items.length)invalid('退货明细缺少原出库批次')
  await conn.query('SELECT id FROM payment_records WHERE type=2 AND order_id=? FOR UPDATE',[items[0].order_id])
  const [allReceipts]=await conn.query('SELECT refund_amount FROM sale_commercial_refund_receipts WHERE order_id=? ORDER BY id FOR SHARE',[items[0].order_id])
  let financialGrossBefore=allReceipts.reduce((n,r)=>n+Math.round(Number(r.refund_amount)*100),0)/100
  const [[basisRow]]=await conn.query('SELECT order_gross_basis,discount_basis FROM sale_dispatch_groups WHERE order_id=? AND confirmed_at IS NOT NULL ORDER BY id LIMIT 1',[items[0].order_id])
  const financialBasis={orderGross:Number(basisRow?.order_gross_basis),discount:Number(basisRow?.discount_basis)}
  const ids=[...new Set(items.map(i=>Number(i.dispatch_component_id)))]
  const [previous]=await conn.query('SELECT dispatch_component_id,return_task_item_id,qualified_qty,refund_amount FROM sale_commercial_refund_receipts WHERE dispatch_component_id IN (?) ORDER BY id FOR SHARE',[ids])
  // Only completed immutable execution proof is inspected, never another SR or
  // an in-progress task. This current read also works after waiting in RR.
  if(previous.length){
    const [proof]=await conn.query('SELECT id,checked_qty,rejected_qty,putaway_qty FROM return_task_items WHERE id IN (?) ORDER BY id FOR SHARE',[previous.map(r=>r.return_task_item_id)])
    const byId=new Map(proof.map(p=>[Number(p.id),p]))
    for(const r of previous){const p=byId.get(Number(r.return_task_item_id));if(!p||roundQty(Number(p.checked_qty)-Number(p.rejected_qty))!==Number(r.qualified_qty)||Number(p.putaway_qty)!==Number(r.qualified_qty))invalid('既有退款回执与已完成真实合格入仓量不符')}
  }
  const used=new Map();for(const r of previous)used.set(Number(r.dispatch_component_id),roundQty((used.get(Number(r.dispatch_component_id))||0)+Number(r.qualified_qty)))
  let totalFinancialUnits=0
  const rows=items.map(i=>{
    const qty=roundQty(Number(i.checked_qty)-Number(i.rejected_qty))
    if(qty!==Number(i.putaway_qty))invalid('合格量尚未全部真实入仓')
    const before=used.get(Number(i.dispatch_component_id))||0,after=roundQty(before+qty)
    const projection=projectCommercialRefund({sourceAmount:i.confirmed_amount,sourceQty:i.source_qty,beforeQualifiedQty:before,afterQualifiedQty:after})
    used.set(Number(i.dispatch_component_id),after)
    const financialAfter=Math.round((financialGrossBefore+projection.refundAmount)*100)/100
    const financial=financialRefundDelta(financialBasis,financialGrossBefore,financialAfter)
    financialGrossBefore=financialAfter;totalFinancialUnits+=Math.round(financial*10000)
    return [i.order_id,i.dispatch_component_id,i.id,i.taskItemId,qty,before,after,projection.refundAmount,financial]
  })
  if(rows.length)await conn.query('INSERT INTO sale_commercial_refund_receipts (order_id,dispatch_component_id,return_item_id,return_task_item_id,qualified_qty,before_qualified_qty,after_qualified_qty,refund_amount,financial_amount) VALUES ?',[rows])
  const cases=rows.map(()=>'WHEN ? THEN ?').join(' ')
  await conn.query(`UPDATE sale_return_items SET amount=CASE id ${cases} ELSE amount END WHERE return_id=?`,[...rows.flatMap(r=>[r[2],r[8]]),returnId])
  await conn.query('UPDATE sale_returns SET total_amount=? WHERE id=?',[totalFinancialUnits/10000,returnId])
  return totalFinancialUnits/10000
}
module.exports={sources,savedSources,loadView,validate,lockExecution,complete}
