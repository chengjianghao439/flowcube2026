const svc = require('./purchase.service')
const { successResponse } = require('../../utils/response')
const { pool } = require('../../config/db')

async function getOperator(userId) {
  const [[u]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?',[userId])
  return { userId, realName: u?.real_name||'未知' }
}

const list   = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null}),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=await getOperator(req.user.userId);return successResponse(res,await svc.create({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)} }
const confirm= async(req,res,next)=>{ try{await svc.confirm(+req.params.id,await getOperator(req.user.userId));return successResponse(res,null,'确认成功')}catch(e){next(e)} }
const receive= async(req,res,next)=>{ try{await svc.receive(+req.params.id,await getOperator(req.user.userId));return successResponse(res,null,'收货成功，库存已更新')}catch(e){next(e)} }
const cancel = async(req,res,next)=>{ try{await svc.cancel(+req.params.id);return successResponse(res,null,'已取消')}catch(e){next(e)} }
module.exports = { list, detail, create, confirm, receive, cancel }
