const svc = require('./warehouse-tasks.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const { getOperatorFromRequest } = require('../../utils/operator')

const list = async(req,res,next)=>{ try{const{page=1,pageSize=20,keyword='',status,warehouseId}=req.query;const data=await svc.findAll({page:+page,pageSize:+pageSize,keyword,status:status?+status:null,warehouseId:warehouseId?+warehouseId:null,scopeWarehouseIds:req.user?.warehouseIds??null});return successResponse(res,data,'查询成功')}catch(e){next(e)} }
const myTasks = async(req,res,next)=>{ try{return successResponse(res,await svc.findMyTasks(),'查询成功')}catch(e){next(e)} }
const myTaskSkuSummary = async(req,res,next)=>{ try{return successResponse(res,await svc.findMyTaskSkuSummary(),'查询成功')}catch(e){next(e)} }
const stats = async(req,res,next)=>{ try{return successResponse(res,await svc.getTaskStats(),'查询成功')}catch(e){next(e)} }
const pickSuggestions = async(req,res,next)=>{ try{return successResponse(res,await svc.getPickSuggestions(+req.params.id))}catch(e){next(e)} }
const pickRoute = async(req,res,next)=>{ try{return successResponse(res,await svc.getPickRoute(+req.params.id))}catch(e){next(e)} }
const pendingCancelReturns = async(req,res,next)=>{ try{const{warehouseId}=req.query;return successResponse(res,await svc.listPendingCancelReturns(warehouseId?+warehouseId:null),'查询成功')}catch(e){next(e)} }
const cancelReturnDetail = async(req,res,next)=>{ try{return successResponse(res,await svc.getCancelReturnDetail(+req.params.id),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const assign = async(req,res,next)=>{ try{await svc.assign(+req.params.id,req.body);return successResponse(res,null,'已分配')}catch(e){next(e)} }
const startPicking = async(req,res,next)=>{ try{await svc.startPicking(+req.params.id);return successResponse(res,null,'备货已开始')}catch(e){next(e)} }
const pickedQtyDeprecated = (req,res)=>res.status(410).json({success:false,code:'WAREHOUSE_TASK_PICKED_QTY_GONE',message:'该接口已废弃，请使用 PDA 拣货扫码路径 POST /api/scan-logs',data:null})
const readyToShip = async(req,res,next)=>{ try{const data=await svc.readyToShip(+req.params.id,{requestKey:extractRequestKey(req),userId:req.user?.userId??null});return successResponse(res,data,'已标记为待分拣')}catch(e){next(e)} }
const findEvents = async(req,res,next)=>{ try{return successResponse(res,await svc.findEvents(+req.params.id),'ok')}catch(e){next(e)} }
const debugSnapshot = async(req,res,next)=>{ try{return successResponse(res,await svc.getDebugSnapshot(+req.params.id),'任务数据快照')}catch(e){next(e)} }
const sortDone = async(req,res,next)=>{ try{const sortedItems=req.body?.items??null;const result=await svc.sortTask(+req.params.id,sortedItems,{requestKey:extractRequestKey(req),userId:req.user?.userId??null});const msg=result.allSorted?'分拣完成，已进入待复核':`分拣进度 ${result.progress}，继续操作`;return successResponse(res,result,msg)}catch(e){next(e)} }
const checkDone = async(req,res,next)=>{ try{await svc.checkDone(+req.params.id);return successResponse(res,null,'已标记为待打包')}catch(e){next(e)} }
const packDone = async(req,res,next)=>{ try{const data=await svc.packDone(+req.params.id,{requestKey:extractRequestKey(req),userId:req.user?.userId??null});return successResponse(res,data,'已标记为待出库')}catch(e){next(e)} }
const ship = async(req,res,next)=>{ try{const taskId=+req.params.id;const data=await svc.ship(taskId,getOperatorFromRequest(req),await svc.getShipContext(taskId),{requestKey:extractRequestKey(req)});return successResponse(res,data,'出库成功')}catch(e){next(e)} }
const manualCheckDeprecated = (req,res)=>res.status(410).json({success:false,code:'WAREHOUSE_TASK_MANUAL_CHECK_GONE',message:'该接口已废弃，请使用 PDA 复核扫码路径 POST /api/scan-logs/check',data:null})
const cancel = async(req,res,next)=>{ try{await svc.cancel(+req.params.id,{operator:getOperatorFromRequest(req)});return successResponse(res,null,'任务已取消')}catch(e){next(e)} }
const updatePriority = async(req,res,next)=>{ try{await svc.updatePriority(+req.params.id,req.body.priority);return successResponse(res,null,'优先级已更新')}catch(e){next(e)} }
const pendingAdjustments = async(req,res,next)=>{ try{const{warehouseId}=req.query;return successResponse(res,await svc.listPendingAdjustments(warehouseId?+warehouseId:null),'查询成功')}catch(e){next(e)} }
const adjustmentDetail = async(req,res,next)=>{ try{return successResponse(res,await svc.getAdjustmentDetail(+req.params.id),'查询成功')}catch(e){next(e)} }
const confirmAdjustmentPackageVoid = async(req,res,next)=>{ try{const result=await svc.confirmPackageVoid(+req.params.voidId,{operator:getOperatorFromRequest(req)});return successResponse(res,result,result.finalized?'改单已全部确认完成':'已确认拆箱')}catch(e){next(e)} }
const confirmAdjustmentContainerReturn = async(req,res,next)=>{ try{const targetLocationId=req.body?.targetLocationId?+req.body.targetLocationId:null;const result=await svc.confirmContainerReturn(+req.params.returnId,{targetLocationId,operator:getOperatorFromRequest(req)});return successResponse(res,result,result.finalized?'改单已全部确认完成':'已确认归还')}catch(e){next(e)} }
const reportShortage = async(req,res,next)=>{ try{const data=await svc.reportShortage(+req.params.id,req.body,getOperatorFromRequest(req));return successResponse(res,data,'缺货已上报，等待 ERP 端处理')}catch(e){next(e)} }
const taskShortages = async(req,res,next)=>{ try{return successResponse(res,await svc.listShortagesByTask(+req.params.id),'查询成功')}catch(e){next(e)} }
const pendingShortages = async(req,res,next)=>{ try{const{page=1,pageSize=20}=req.query;return successResponse(res,await svc.listPendingShortages({page:+page,pageSize:+pageSize}),'查询成功')}catch(e){next(e)} }
const resolveShortage = async(req,res,next)=>{ try{const data=await svc.resolveShortage(+req.params.shortageId,req.body,getOperatorFromRequest(req));return successResponse(res,data,data.action==='adjustToPicked'?'已按实拣改单并关闭上报':'已驳回上报，现场可继续拣货')}catch(e){next(e)} }

module.exports = { list, myTasks, myTaskSkuSummary, stats, pickSuggestions, pickRoute, pendingCancelReturns, cancelReturnDetail, detail, assign, startPicking, pickedQtyDeprecated, readyToShip, findEvents, debugSnapshot, sortDone, checkDone, packDone, ship, manualCheckDeprecated, cancel, updatePriority, pendingAdjustments, adjustmentDetail, confirmAdjustmentPackageVoid, confirmAdjustmentContainerReturn, reportShortage, taskShortages, pendingShortages, resolveShortage }
