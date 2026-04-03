const svc = require('./sale.service')
const { successResponse } = require('../../utils/response')
const { pool } = require('../../config/db')
async function getOperator(userId) { const [[u]] = await pool.query('SELECT real_name FROM sys_users WHERE id=?',[userId]); return { userId, realName:u?.real_name||'未知' } }
const list   = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll({page:+req.query.page||1,pageSize:+req.query.pageSize||20,keyword:req.query.keyword||'',status:req.query.status?+req.query.status:null,productId:req.query.productId?+req.query.productId:null}),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=await getOperator(req.user.userId);return successResponse(res,await svc.create({...req.body,operator:op}),'创建成功',201)}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{await svc.update(+req.params.id,req.body);return successResponse(res,null,'保存成功')}catch(e){next(e)} }
const reserve = async(req,res,next)=>{ try{await svc.reserveStock(+req.params.id);return successResponse(res,null,'库存占用成功')}catch(e){next(e)} }
const release = async(req,res,next)=>{ try{await svc.releaseStock(+req.params.id);return successResponse(res,null,'已取消占库，订单恢复为草稿')}catch(e){next(e)} }
const ship    = async(req,res,next)=>{ try{await svc.ship(+req.params.id);return successResponse(res,null,'出库任务已创建，等待仓库执行')}catch(e){next(e)} }
const cancel  = async(req,res,next)=>{ try{await svc.cancel(+req.params.id);return successResponse(res,null,'已取消')}catch(e){next(e)} }
const del     = async(req,res,next)=>{ try{await svc.deleteOrder(+req.params.id);return successResponse(res,null,'订单删除成功')}catch(e){next(e)} }
module.exports = { list, detail, create, update, reserve, release, ship, cancel, del }
