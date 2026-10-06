'use strict'
const AppError=require('../../utils/AppError')
const {PERMISSIONS:P}=require('../../constants/permissions')
const rules=require('./supplier-refunds.rules')
async function load(conn,userId,current=true) {
  const id=rules.safeId(userId),lock=current?' FOR SHARE':''
  const [[user]]=await conn.query('SELECT id, role_id, real_name, is_active, deleted_at, allow_self_approve FROM sys_users WHERE id=?'+lock,[id])
  if(!user || Number(user.is_active)!==1 || user.deleted_at || Number(user.id)!==id) throw new AppError('当前账号已失效',403,'SUPPLIER_REFUND_AUTH_DENIED')
  const roleId=rules.safeId(user.role_id)
  // sys_roles has no is_active/deleted_at fields. Existence + current permissions are authoritative.
  const [[role]]=await conn.query('SELECT id FROM sys_roles WHERE id=?'+lock,[roleId])
  if(!role || Number(role.id)!==roleId) throw new AppError('当前角色已失效',403,'SUPPLIER_REFUND_AUTH_DENIED')
  const [permissions]=await conn.query('SELECT permission FROM sys_role_permissions WHERE role_id=? ORDER BY permission'+lock,[roleId])
  const [rows]=await conn.query('SELECT warehouse_id FROM user_warehouse_scope WHERE user_id=? ORDER BY warehouse_id'+lock,[id])
  if(!Array.isArray(rows) || !Array.isArray(permissions)) throw new AppError('无法核对当前授权范围',403,'SUPPLIER_REFUND_AUTH_DENIED')
  const warehouseIds=rows.length?rows.map(row=>rules.safeId(row.warehouse_id)):null
  return{userId:id,realName:user.real_name,roleId,allowSelfApprove:Number(user.allow_self_approve)===1,permissions:permissions.map(row=>row.permission),warehouseIds,scopeLoaded:true}
}
function assertScope(actor,warehouseId) {
  const id=rules.safeId(warehouseId)
  if(!actor?.scopeLoaded || !(actor.warehouseIds===null || Array.isArray(actor.warehouseIds)&&actor.warehouseIds.every(v=>Number.isSafeInteger(v)&&v>0))) throw new AppError('当前范围未完整加载',403,'SUPPLIER_REFUND_AUTH_DENIED')
  if(actor.warehouseIds!==null && !actor.warehouseIds.includes(id)) throw new AppError('无权访问其他仓库的供应商退款',403,'WAREHOUSE_SCOPE_DENIED')
}
function authorize(actor,action=null) {
  const permissions=[P.SUPPLIER_REFUND_VIEW,P.PURCHASE_ORDER_VIEW,P.RETURN_ORDER_VIEW,P.PAYMENT_VIEW,...(action?[action]:[])]
  if(actor.roleId!==1 && permissions.some(p=>!p || !actor.permissions.includes(p))) throw new AppError('缺少供应商退款及完整原单查看权限',403,'SUPPLIER_REFUND_AUTH_DENIED')
}
module.exports={load,assertScope,authorize}
