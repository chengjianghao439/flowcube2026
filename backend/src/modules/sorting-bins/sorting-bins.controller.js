const svc = require('./sorting-bins.service')
const { successResponse } = require('../../utils/response')

const scan = async(req,res,next)=>{ try{const{code}=req.query;if(!code)return res.status(400).json({success:false,message:'条码不能为空',data:null});const data=await svc.scanProduct(String(code));return successResponse(res,data,'查询成功')}catch(e){next(e)} }
const listAllWarehouses = async(req,res,next)=>{ try{const{keyword='',status}=req.query;const data=await svc.findAllWarehouses({keyword,status:status?+status:null});return successResponse(res,data,'查询成功')}catch(e){next(e)} }
const listByWarehouse = async(req,res,next)=>{ try{const data=await svc.findAll(+req.params.warehouseId);return successResponse(res,data,'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const data=await svc.create(req.body);return successResponse(res,data,'分拣格已创建')}catch(e){next(e)} }
const batchCreate = async(req,res,next)=>{ try{const data=await svc.batchCreate(req.body);return successResponse(res,data,`已创建 ${data.length} 个分拣格`)}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{await svc.update(+req.params.id,req.body);return successResponse(res,null,'已更新')}catch(e){next(e)} }
const forceRelease = async(req,res,next)=>{ try{await svc.forceRelease(+req.params.id);return successResponse(res,null,'分拣格已释放')}catch(e){next(e)} }
const remove = async(req,res,next)=>{ try{await svc.remove(+req.params.id);return successResponse(res,null,'已删除')}catch(e){next(e)} }

module.exports = { scan, listAllWarehouses, listByWarehouse, create, batchCreate, update, forceRelease, remove }
