const svc = require('./pda.apk.service')
const { successResponse } = require('../../utils/response')

const getVersion = async(req,res,next)=>{
  try{
    svc.setNoStoreHeaders(res)
    const data = await svc.getApkVersion(req)
    return successResponse(res, data)
  }catch(e){next(e)}
}

const download = async(req,res,next)=>{
  try{
    svc.setNoStoreHeaders(res)
    await svc.downloadApk(req, res)
  }catch(e){next(e)}
}

module.exports = { getVersion, download }
