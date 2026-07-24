const svc = require('./sale.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')
const list   = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null,customerId:req.query.customerId?+req.query.customerId:null,warehouseId:req.query.warehouseId?+req.query.warehouseId:null,startDate:req.query.startDate||null,endDate:req.query.endDate||null,remark:req.query.remark||null,operatorId:req.query.operatorId?+req.query.operatorId:null,scopeWarehouseIds:req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create({...req.body,operator:op,requestKey:extractRequestKey(req)}),'创建成功',201)}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);await svc.update(+req.params.id,{...req.body,operator:op});return successResponse(res,null,'保存成功')}catch(e){next(e)} }
const adjust = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);const result=await svc.requestAdjustment(+req.params.id,{...req.body,operator:op,requestKey:extractRequestKey(req)});return successResponse(res,result,result.pending?'改单已提交，等待仓库确认':'修改成功')}catch(e){next(e)} }
const reservePreview = async(req,res,next)=>{ try{return successResponse(res,await svc.getReservePreview(+req.params.id, req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const reserve = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);const items=Array.isArray(req.body?.items)?req.body.items:[];await svc.reserveStock(+req.params.id, op, items);return successResponse(res,null,'预占库存成功')}catch(e){next(e)} }
const release = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);await svc.releaseStock(+req.params.id, op);return successResponse(res,null,'已释放预占库存，订单恢复为草稿')}catch(e){next(e)} }
const ship    = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);const itemIds=Array.isArray(req.body?.itemIds)?req.body.itemIds:null;await svc.ship(+req.params.id, op, { itemIds });return successResponse(res,null,'出库任务已创建，等待仓库操作')}catch(e){next(e)} }
const cancel  = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);await svc.cancel(+req.params.id, op);return successResponse(res,null,'已取消')}catch(e){next(e)} }
const del     = async(req,res,next)=>{ try{await svc.deleteOrder(+req.params.id);return successResponse(res,null,'订单删除成功')}catch(e){next(e)} }
module.exports = { list, detail, create, update, adjust, reservePreview, reserve, release, ship, cancel, del }
