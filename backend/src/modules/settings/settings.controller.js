const svc = require('./settings.service')
const { successResponse } = require('../../utils/response')

const getAll = async(req,res,next)=>{ try{return successResponse(res,await svc.getAll(),'查询成功')}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{await svc.updateMany(req.body);return successResponse(res,null,'保存成功')}catch(e){next(e)} }

module.exports = { getAll, update }
