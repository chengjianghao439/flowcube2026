const svc = require('./payments.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await svc.createManual(req.body,operator),'创建成功',201)}catch(e){next(e)} }
const pay = async(req,res,next)=>{ try{const id=+req.params.id;const operator=getOperatorFromRequest(req);return successResponse(res,await svc.recordPayment(id,req.body,operator),'登记成功')}catch(e){next(e)} }
const entries = async(req,res,next)=>{ try{return successResponse(res,await svc.findEntries(+req.params.id),'查询成功')}catch(e){next(e)} }

module.exports = { list, create, pay, entries }
