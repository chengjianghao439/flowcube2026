const svc = require('./transfer.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null,warehouseId:req.query.warehouseId?+req.query.warehouseId:null,operatorId:req.query.operatorId?+req.query.operatorId:null,startDate:req.query.startDate||null,endDate:req.query.endDate||null,remark:req.query.remark||null,scopeWarehouseIds:req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(req.params.id,req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create({...req.body,operator:op,scopeWarehouseIds:req.user?.warehouseIds??null}),'创建成功',201)}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.update(req.params.id,{...req.body,operator:op,scopeWarehouseIds:req.user?.warehouseIds??null}),'保存成功')}catch(e){next(e)} }
const confirm = async(req,res,next)=>{ try{await svc.confirm(req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已确认并派发到 PDA')}catch(e){next(e)} }
const scanOut = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.scanOut(req.params.id,req.body,op,extractRequestKey(req),req.user?.warehouseIds??null,req.pda?.warehouseId??null),'出库成功')}catch(e){next(e)} }
const scanIn  = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.scanIn(req.params.id,req.body,op,extractRequestKey(req),req.user?.warehouseIds??null,req.pda?.warehouseId??null),'入库成功')}catch(e){next(e)} }
const cancel = async(req,res,next)=>{ try{await svc.cancel(req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已取消')}catch(e){next(e)} }
const forceCloseInTransit = async(req,res,next)=>{ try{await svc.forceCloseInTransit(req.params.id,getOperatorFromRequest(req),{reason:req.body?.reason},req.user?.warehouseIds??null);return successResponse(res,null,'已异常了结')}catch(e){next(e)} }

module.exports = { list, detail, create, update, confirm, scanOut, scanIn, cancel, forceCloseInTransit }
