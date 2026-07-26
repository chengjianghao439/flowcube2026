const svcPR = require('./returns-purchase.service')
const svcSR = require('./returns-sale.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

// 采购退货
const listPR = async(req,res,next)=>{ try{return successResponse(res,await svcPR.findAllPR({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null,supplierId:req.query.supplierId?+req.query.supplierId:null,warehouseId:req.query.warehouseId?+req.query.warehouseId:null,operatorId:req.query.operatorId?+req.query.operatorId:null,startDate:req.query.startDate||null,endDate:req.query.endDate||null,remark:req.query.remark||null,scopeWarehouseIds:req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const loadPRSourceOrder = async(req,res,next)=>{ try{return successResponse(res,await svcPR.loadPurchaseSourceOrderByNo(req.query.orderNo),'查询成功')}catch(e){next(e)} }
const detailPR = async(req,res,next)=>{ try{return successResponse(res,await svcPR.findByIdPR(req.params.id,req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const createPR = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svcPR.createPR({...req.body,operator:op,requestKey:extractRequestKey(req),scopeWarehouseIds:req.user?.warehouseIds??null}),'创建成功',201)}catch(e){next(e)} }
const confirmPR = async(req,res,next)=>{ try{await svcPR.confirmPR(req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已确认')}catch(e){next(e)} }
const cancelPR = async(req,res,next)=>{ try{await svcPR.cancelPR(req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已取消')}catch(e){next(e)} }

// 销售退货
const listSR = async(req,res,next)=>{ try{return successResponse(res,await svcSR.findAllSR({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null,customerId:req.query.customerId?+req.query.customerId:null,warehouseId:req.query.warehouseId?+req.query.warehouseId:null,operatorId:req.query.operatorId?+req.query.operatorId:null,startDate:req.query.startDate||null,endDate:req.query.endDate||null,remark:req.query.remark||null,scopeWarehouseIds:req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const loadSRSsourceOrder = async(req,res,next)=>{ try{return successResponse(res,await svcSR.loadSaleSourceOrderByNo(req.query.orderNo),'查询成功')}catch(e){next(e)} }
const detailSR = async(req,res,next)=>{ try{return successResponse(res,await svcSR.findByIdSR(req.params.id,req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const createSR = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svcSR.createSR({...req.body,operator:op,requestKey:extractRequestKey(req),scopeWarehouseIds:req.user?.warehouseIds??null}),'创建成功',201)}catch(e){next(e)} }
const confirmSR = async(req,res,next)=>{ try{await svcSR.confirmSR(req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已确认')}catch(e){next(e)} }
const cancelSR = async(req,res,next)=>{ try{await svcSR.cancelSR(req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,null,'已取消')}catch(e){next(e)} }

module.exports = { listPR, loadPRSourceOrder, detailPR, createPR, confirmPR, cancelPR, listSR, loadSRSsourceOrder, detailSR, createSR, confirmSR, cancelSR }
