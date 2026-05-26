const svc = require('./oplogs.service')
const { successResponse } = require('../../utils/response')

const list = async(req,res,next)=>{ try{const{page=1,pageSize=30,keyword='',module:mod=''}=req.query;return successResponse(res,await svc.findAll({page:+page,pageSize:+pageSize,keyword,module:mod}),'查询成功')}catch(e){next(e)} }
const clear = async(req,res,next)=>{ try{await svc.clearOld();return successResponse(res,null,'已清理 30 天前的操作日志')}catch(e){next(e)} }

module.exports = { list, clear }
