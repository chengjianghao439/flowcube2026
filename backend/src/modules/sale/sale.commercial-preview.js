'use strict'
const {resolve}=require('./sale.commercial-resolver')
const {view}=require('./sale.commercial-store')
const {getStockProjections}=require('../../engine/containerEngine')
async function resolvePreview(conn,input,saved=[],options={}) {
  const resolved=await resolve(conn,input,saved,{...options,readOnly:true,formal:false})
  const stocks=await getStockProjections(conn,resolved.items)
  const physicalItems=resolved.items.map(p=>{
    const stock=stocks.get(`${p.productId}:${p.warehouseId}`)||{quantity:0,reserved:0,available:0}
    return {...p,inventory:{...stock,required:p.quantity,shortage:Math.max(0,Math.round((p.quantity-stock.available)*100)/100)}}
  })
  return {commercialGroups:resolved.groups.map(g=>({...view(g),referenceSnapshotAt:g.metadata.referenceSnapshotAt,versionCreatedAt:g.metadata.versionCreatedAt,referenceBasisExplanation:g.metadata.referenceBasisExplanation})),physicalItems,amount:resolved.total,customerId:input.customerId,warehouseId:input.warehouseId,canFulfillEntireVector:physicalItems.every(p=>p.inventory.shortage===0),inventoryBasis:'current_physical_available',inventoryExplanation:'当前现货可用来自 ACTIVE 容器余量减现有预占；按整个物理向量核对。不能据此保证可拣或占库成功',expected:null,readyDate:null,readyDateExplanation:'报价预览未分配预计供货；保存后履约视图提供同一物理需求分配的成套日期'}
}
module.exports={resolvePreview}
