const svc = require('./warehouse-tasks.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const { getOperatorFromRequest } = require('../../utils/operator')

const list = async(req,res,next)=>{ try{const{page=1,pageSize=20,keyword='',status,warehouseId}=req.query;const data=await svc.findAll({page:+page,pageSize:+pageSize,keyword,status:status?+status:null,warehouseId:warehouseId?+warehouseId:null});return successResponse(res,data,'查询成功')}catch(e){next(e)} }
const myTasks = async(req,res,next)=>{ try{return successResponse(res,await svc.findMyTasks(),'查询成功')}catch(e){next(e)} }
const myTaskSkuSummary = async(req,res,next)=>{ try{return successResponse(res,await svc.findMyTaskSkuSummary(),'查询成功')}catch(e){next(e)} }
const stats = async(req,res,next)=>{ try{return successResponse(res,await svc.getTaskStats(),'查询成功')}catch(e){next(e)} }
const pickSuggestions = async(req,res,next)=>{ try{return successResponse(res,await svc.getPickSuggestions(+req.params.id))}catch(e){next(e)} }
const pickRoute = async(req,res,next)=>{ try{return successResponse(res,await svc.getPickRoute(+req.params.id))}catch(e){next(e)} }
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

module.exports = { list, myTasks, myTaskSkuSummary, stats, pickSuggestions, pickRoute, detail, assign, startPicking, pickedQtyDeprecated, readyToShip, findEvents, debugSnapshot, sortDone, checkDone, packDone, ship, manualCheckDeprecated, cancel, updatePriority }
