const svc = require('./printer-bindings.service')
const { successResponse } = require('../../utils/response')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll(),'查询成功')}catch(e){next(e)} }
const bind = async(req,res,next)=>{ try{const{type}=req.params;const{printerId,warehouseId}=req.body;const data=await svc.bind(type,printerId,warehouseId);return successResponse(res,data,'绑定成功')}catch(e){next(e)} }
const unbind = async(req,res,next)=>{ try{const{type}=req.params;await svc.unbind(type,req.query.warehouseId);return successResponse(res,null,'已解除绑定')}catch(e){next(e)} }

module.exports = { list, bind, unbind }
