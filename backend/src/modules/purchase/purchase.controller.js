const svc = require('./purchase.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

const list   = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null,supplierId:req.query.supplierId?+req.query.supplierId:null,warehouseId:req.query.warehouseId?+req.query.warehouseId:null,startDate:req.query.startDate||null,endDate:req.query.endDate||null,remark:req.query.remark||null,operatorId:req.query.operatorId?+req.query.operatorId:null,overdueOnly:req.query.overdueOnly==='true',scopeWarehouseIds:req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id,req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create({...req.body,operator:op,requestKey:extractRequestKey(req)}),'创建成功',201)}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.update(+req.params.id,{...req.body,operator:op,scopeWarehouseIds:req.user?.warehouseIds??null}),'保存成功')}catch(e){next(e)} }
const confirm= async(req,res,next)=>{ try{const r=await svc.confirm(+req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,r,r.needApproval?'已提交，等待审批':'提交成功')}catch(e){next(e)} }
const withdrawConfirm = async(req,res,next)=>{ try{await svc.withdrawConfirm(+req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已撤回确认，恢复为草稿')}catch(e){next(e)} }
const approve = async(req,res,next)=>{ try{const r=await svc.approve(+req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,r,'审批通过，可创建收货订单')}catch(e){next(e)} }
const reject = async(req,res,next)=>{ try{const r=await svc.reject(+req.params.id,req.body||{},getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,r,'已驳回，采购单退回草稿')}catch(e){next(e)} }
const cancel = async(req,res,next)=>{ try{await svc.cancel(+req.params.id, getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已取消')}catch(e){next(e)} }
const close  = async(req,res,next)=>{ try{await svc.closeRemaining(+req.params.id, getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已关闭剩余并结案')}catch(e){next(e)} }
module.exports = { list, detail, create, update, confirm, withdrawConfirm, approve, reject, cancel, close }
