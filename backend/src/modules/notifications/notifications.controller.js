const svc = require('./notifications.service')
const { successResponse } = require('../../utils/response')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.buildNotifications(),'查询成功')}catch(e){next(e)} }

module.exports = { list }
