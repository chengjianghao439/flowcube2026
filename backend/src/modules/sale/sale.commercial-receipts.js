'use strict'
const {assertInScope}=require('../../utils/warehouseScope')
const AppError=require('../../utils/AppError')
const createName=action=>typeof action==='string'&&/^sale\.create(?:\.|$)/.test(action)
const createAction=action=>typeof action==='string'&&/^sale\.create(?:\.[a-f0-9]{16})?$/.test(action)
const invalidCreate=()=>{throw new AppError('原创建结果与销售单不一致，请保留原请求并人工核对',409,'SALE_CREATE_RECEIPT_INVALID')}
async function assertReceiptScope(conn,receipt,scope,context={}) {
  const create=createName(context.requestedAction)||createName(context.matchedAction)
  if(create&&receipt.status!=='success')return
  if(create){
    if(!createAction(context.requestedAction)||!createAction(context.matchedAction)||(context.requestedAction!=='sale.create'&&context.requestedAction!==context.matchedAction))invalidCreate()
    if(receipt.resourceType!=='sale_order'||!Number.isSafeInteger(receipt.resourceId)||receipt.resourceId<=0||receipt.data?.id!==receipt.resourceId)invalidCreate()
  }
  if(!receipt.resourceId)return
  let rows=[]
  if(receipt.resourceType==='sale_order'){
    ;[rows]=await conn.query('SELECT s.id,s.commercial_model,s.warehouse_id AS head_warehouse_id,i.warehouse_id FROM sale_orders s LEFT JOIN sale_order_items i ON i.order_id=s.id WHERE s.id=?',[receipt.resourceId])
  }else if(receipt.resourceType==='sale_return'){
    ;[rows]=await conn.query('SELECT s.commercial_model,r.warehouse_id,s.warehouse_id AS head_warehouse_id FROM sale_returns r JOIN sale_orders s ON s.id=r.sale_order_id WHERE r.id=?',[receipt.resourceId])
  }else if(receipt.resourceType==='warehouse_task'){
    ;[rows]=await conn.query('SELECT s.commercial_model,t.task_type,t.warehouse_id,s.warehouse_id AS head_warehouse_id FROM warehouse_tasks t JOIN sale_orders s ON s.id=t.sale_order_id WHERE t.id=?',[receipt.resourceId])
  }else if(receipt.resourceType==='return_task'){
    ;[rows]=await conn.query('SELECT s.commercial_model,t.warehouse_id,s.warehouse_id AS head_warehouse_id FROM return_tasks t JOIN sale_returns r ON r.id=t.return_id AND t.return_type=\'sale\' JOIN sale_orders s ON s.id=r.sale_order_id WHERE t.id=?',[receipt.resourceId])
  }
  if(create){
    if(!rows.length||rows.some(r=>Number(r.id)!==receipt.resourceId))invalidCreate()
    for(const r of rows)if(r.commercial_model!=='kit-v1'){
      assertInScope(scope,r.head_warehouse_id,'销售创建回执')
      assertInScope(scope,r.warehouse_id??r.head_warehouse_id,'销售创建回执')
    }
  }
  const isReturnAction = action => action === 'scan-log.cancel-return' || action === `scan-log.cancel-return.${Number(receipt.resourceId)}`
  const taskReturnReceipt = receipt.resourceType === 'warehouse_task' && isReturnAction(context.matchedAction) && isReturnAction(context.requestedAction)
  for(const r of rows)if(r.commercial_model==='kit-v1'){
    if(!taskReturnReceipt || r.task_type!=='sale_out')assertInScope(scope,r.head_warehouse_id,'套单操作回执')
    assertInScope(scope,r.warehouse_id ?? r.head_warehouse_id,'套单操作回执')
  }
}
module.exports={assertReceiptScope}
