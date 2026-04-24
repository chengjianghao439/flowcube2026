const svc = require('./purchase.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const list   = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null}),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)} }
const confirm= async(req,res,next)=>{ try{await svc.confirm(+req.params.id,getOperatorFromRequest(req));return successResponse(res,null,'提交成功')}catch(e){next(e)} }
const cancel = async(req,res,next)=>{ try{await svc.cancel(+req.params.id, getOperatorFromRequest(req));return successResponse(res,null,'已取消')}catch(e){next(e)} }
module.exports = { list, detail, create, confirm, cancel }
