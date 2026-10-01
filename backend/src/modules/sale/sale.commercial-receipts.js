'use strict'
const {assertInScope}=require('../../utils/warehouseScope')
async function assertReceiptScope(conn,receipt,scope) {
  if(!receipt.resourceId)return
  let rows=[]
  if(receipt.resourceType==='sale_order'){
    ;[rows]=await conn.query('SELECT s.commercial_model,s.warehouse_id AS head_warehouse_id,i.warehouse_id FROM sale_orders s LEFT JOIN sale_order_items i ON i.order_id=s.id WHERE s.id=?',[receipt.resourceId])
  }else if(receipt.resourceType==='sale_return'){
    ;[rows]=await conn.query('SELECT s.commercial_model,r.warehouse_id,s.warehouse_id AS head_warehouse_id FROM sale_returns r JOIN sale_orders s ON s.id=r.sale_order_id WHERE r.id=?',[receipt.resourceId])
  }else if(receipt.resourceType==='warehouse_task'){
    ;[rows]=await conn.query('SELECT s.commercial_model,t.warehouse_id,s.warehouse_id AS head_warehouse_id FROM warehouse_tasks t JOIN sale_orders s ON s.id=t.sale_order_id WHERE t.id=?',[receipt.resourceId])
  }else if(receipt.resourceType==='return_task'){
    ;[rows]=await conn.query('SELECT s.commercial_model,t.warehouse_id,s.warehouse_id AS head_warehouse_id FROM return_tasks t JOIN sale_returns r ON r.id=t.return_id AND t.return_type=\'sale\' JOIN sale_orders s ON s.id=r.sale_order_id WHERE t.id=?',[receipt.resourceId])
  }
  for(const r of rows)if(r.commercial_model==='kit-v1'){assertInScope(scope,r.head_warehouse_id,'套单操作回执');assertInScope(scope,r.warehouse_id ?? r.head_warehouse_id,'套单操作回执')}
}
module.exports={assertReceiptScope}
