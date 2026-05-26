const svc = require('./app-update.service')
const { successResponse } = require('../../utils/response')

const getLatest = async(req,res,next)=>{
  try{
    const data = await svc.getLatestVersion(req)
    if (!data) return res.status(404).json({ success: false, message: '暂无发布版本', data: null })
    return successResponse(res, data, 'ok')
  }catch(e){next(e)}
}

module.exports = { getLatest }
