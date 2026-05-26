const { pool } = require('../../config/db')
const svc = require('./return-tasks.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const pdaList = async(req,res,next)=>{ try{const tasks=await svc.findPdaTasks(req.pda.warehouseId);return successResponse(res,tasks)}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{const task=await svc.findById(+req.params.id);return successResponse(res,task)}catch(e){next(e)} }
const submit = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);const task=await svc.submit(+req.params.id,op);return successResponse(res,task,'已提交到 PDA')}catch(e){next(e)} }
const receive = async(req,res,next)=>{
  const conn=await pool.getConnection()
  try{await conn.beginTransaction();const{productId,packages}=req.body;const result=await svc.receive(conn,+req.params.id,{productId,packages,requestKey:req.headers['x-request-key'],userId:req.user?.id});await conn.commit();return successResponse(res,result)}catch(e){await conn.rollback();next(e)}finally{conn.release()}
}
const check = async(req,res,next)=>{
  const conn=await pool.getConnection()
  try{await conn.beginTransaction();const{productId,passedQty}=req.body;const result=await svc.check(conn,+req.params.id,{productId,passedQty,requestKey:req.headers['x-request-key'],userId:req.user?.id});await conn.commit();return successResponse(res,result)}catch(e){await conn.rollback();next(e)}finally{conn.release()}
}
const putaway = async(req,res,next)=>{
  const conn=await pool.getConnection()
  try{await conn.beginTransaction();const{containerId,locationId}=req.body;const result=await svc.putaway(conn,+req.params.id,{containerId,locationId,requestKey:req.headers['x-request-key'],userId:req.user?.id});await conn.commit();return successResponse(res,result)}catch(e){await conn.rollback();next(e)}finally{conn.release()}
}
const cancel = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);await svc.cancel(+req.params.id,op);return successResponse(res,null,'已取消')}catch(e){next(e)} }

module.exports = { pdaList, detail, submit, receive, check, putaway, cancel }
