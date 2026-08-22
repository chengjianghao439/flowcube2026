const svc = require('./stockcheck.service')
const cycle = require('./stockcheck.cycle')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')
const list    = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,scopeWarehouseIds:req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const detail  = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id,req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const create  = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create({...req.body,operator:op,scopeWarehouseIds:req.user?.warehouseIds??null}),'创建成功',201)}catch(e){next(e)} }
const update  = async(req,res,next)=>{ try{await svc.updateItems(+req.params.id,req.body.items,req.user?.warehouseIds??null);return successResponse(res,null,'保存成功')}catch(e){next(e)} }
const submit  = async(req,res,next)=>{ try{await svc.submit(+req.params.id,getOperatorFromRequest(req),req.user?.warehouseIds??null,extractRequestKey(req));return successResponse(res,null,'盘点已提交，库存已同步调整')}catch(e){next(e)} }
const cancel  = async(req,res,next)=>{ try{await svc.cancel(+req.params.id,req.user?.warehouseIds??null);return successResponse(res,null,'已取消')}catch(e){next(e)} }
const refreshItem = async(req,res,next)=>{ try{const data=await svc.refreshItem(+req.params.id,+req.params.itemId,req.user?.warehouseIds??null);return successResponse(res,data,'账面数已刷新，请重新盘点该商品')}catch(e){next(e)} }
const recomputeAbc = async(req,res,next)=>{ try{return successResponse(res,await cycle.recomputeAbc({ warehouseId:+req.body.warehouseId, metricType:req.body.metricType||'sold_value', windowDays:+req.body.windowDays||90 }),'ABC 已重算')}catch(e){next(e)} }
const listAbc = async(req,res,next)=>{ try{return successResponse(res,await cycle.listAbc({ warehouseId:req.query.warehouseId?+req.query.warehouseId:null, abcClass:req.query.abcClass||null, scopeWarehouseIds:req.user?.warehouseIds??null }),'查询成功')}catch(e){next(e)} }
const cycleCandidates = async(req,res,next)=>{ try{return successResponse(res,await cycle.getCycleCandidates({ warehouseId:+req.query.warehouseId, scopeType:req.query.scopeType||'abc', scopeValue:req.query.scopeValue||'A' }),'查询成功')}catch(e){next(e)} }
const cycleRules = async(req,res,next)=>{ try{return successResponse(res,await cycle.getCycleRules({ warehouseId:req.query.warehouseId?+req.query.warehouseId:0 }),'查询成功')}catch(e){next(e)} }
const saveCycleRules = async(req,res,next)=>{ try{return successResponse(res,await cycle.saveCycleRules({ warehouseId:req.body.warehouseId?+req.body.warehouseId:0, rules:req.body.rules }),'规则已保存')}catch(e){next(e)} }
const coverage = async(req,res,next)=>{ try{return successResponse(res,await cycle.getCoverage({ warehouseId:req.query.warehouseId?+req.query.warehouseId:null, scopeWarehouseIds:req.user?.warehouseIds??null }),'查询成功')}catch(e){next(e)} }
const pendingScanChecks = async(req,res,next)=>{ try{return successResponse(res,await svc.listPendingScanChecks(req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const scanItems = async(req,res,next)=>{ try{return successResponse(res,await svc.getScanItems(+req.params.id,req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const saveItemScans = async(req,res,next)=>{ try{const data=await svc.saveItemContainerScans(+req.params.id,+req.params.itemId,req.body.scans,getOperatorFromRequest(req),req.user?.warehouseIds??null);return successResponse(res,data,`已记录 ${data.scannedContainers} 个条码`)}catch(e){next(e)} }
module.exports = { list, detail, create, update, submit, refreshItem, cancel, recomputeAbc, listAbc, cycleCandidates, cycleRules, saveCycleRules, coverage, pendingScanChecks, scanItems, saveItemScans }
