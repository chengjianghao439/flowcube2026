const svc = require('./returns.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

// 采购退货
const listPR = async(req,res,next)=>{ try{return successResponse(res,await svc.findAllPR({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null}),'查询成功')}catch(e){next(e)} }
const loadPRSourceOrder = async(req,res,next)=>{ try{return successResponse(res,await svc.loadPurchaseSourceOrderByNo(req.query.orderNo),'查询成功')}catch(e){next(e)} }
const detailPR = async(req,res,next)=>{ try{return successResponse(res,await svc.findByIdPR(req.params.id),'查询成功')}catch(e){next(e)} }
const createPR = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.createPR({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)} }
const confirmPR = async(req,res,next)=>{ try{await svc.confirmPR(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'已确认')}catch(e){next(e)} }
const executePR = async(req,res,next)=>{ try{await svc.executePR(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'退货执行成功，库存已扣减')}catch(e){next(e)} }
const cancelPR = async(req,res,next)=>{ try{await svc.cancelPR(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'已取消')}catch(e){next(e)} }

// 销售退货
const listSR = async(req,res,next)=>{ try{return successResponse(res,await svc.findAllSR({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null}),'查询成功')}catch(e){next(e)} }
const loadSRSsourceOrder = async(req,res,next)=>{ try{return successResponse(res,await svc.loadSaleSourceOrderByNo(req.query.orderNo),'查询成功')}catch(e){next(e)} }
const detailSR = async(req,res,next)=>{ try{return successResponse(res,await svc.findByIdSR(req.params.id),'查询成功')}catch(e){next(e)} }
const createSR = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.createSR({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)} }
const confirmSR = async(req,res,next)=>{ try{await svc.confirmSR(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'已确认')}catch(e){next(e)} }
const executeSR = async(req,res,next)=>{ try{await svc.executeSR(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'退货入库成功，库存已增加')}catch(e){next(e)} }
const cancelSR = async(req,res,next)=>{ try{await svc.cancelSR(req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'已取消')}catch(e){next(e)} }

module.exports = { listPR, loadPRSourceOrder, detailPR, createPR, confirmPR, executePR, cancelPR, listSR, loadSRSsourceOrder, detailSR, createSR, confirmSR, executeSR, cancelSR }
