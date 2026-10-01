'use strict'
const {quantity,deliveryEstimate}=require('../fulfillment/fulfillment.rules')
function allocateCommercialDelivery(groups,shipped,items,today) {
  // These are the allocations already computed by saleDelivery, not a second
  // stock/ATP query. Consume shared SKU supply once in saved commercial order.
  const budgets=new Map(items.map(i=>[i.id,{...i,physical:i.physical,sources:i.sources.map(s=>({...s,remaining:s.quantity}))}]))
  return groups.map(g=>{
    const remainingQty=quantity(g.targetQty-(shipped.get(g.id)||0))
    const components=g.components.map(c=>{
      const budget=budgets.get(c.saleItemId),requiredQty=quantity(g.kind==='kit'?c.baseQty*remainingQty:remainingQty)
      if(!budget)return {saleItemId:c.saleItemId,requiredQty,physical:0,sources:[],shortage:requiredQty,allDate:null}
      const physical=Math.min(requiredQty,budget.physical);budget.physical=quantity(budget.physical-physical)
      let need=quantity(requiredQty-physical);const sources=[]
      for(const s of budget.sources){const take=Math.min(need,s.remaining);if(take){sources.push({...s,quantity:take});s.remaining=quantity(s.remaining-take);need=quantity(need-take)}}
      return {saleItemId:c.saleItemId,requiredQty,physical,sources,...deliveryEstimate({remaining:requiredQty,physical,sources,processingDays:budget.processingDays,today})}
    })
    const readyDate=remainingQty&&components.every(c=>c.allDate)?components.map(c=>c.allDate).sort().at(-1):null
    return {groupId:g.id,lineKey:g.lineKey,kind:g.kind,remainingQty,readyDate,readyDateExplanation:!remainingQty?'当前商业目标已执行完毕':readyDate?'按同一物理履约分配取全部组件最晚日期；仍须完整实物可拣':components.some(c=>c.shortage>0)?'组件供应未全部覆盖，齐套日期未知':'分配来源日期或处理天数未知，齐套日期未知',components}
  })
}
module.exports={allocateCommercialDelivery}
