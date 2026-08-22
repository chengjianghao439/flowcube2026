const { pool } = require('../../config/db')
const svc = require('./return-tasks.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

/**
 * 事务包装器（2026-08-22 收敛）：receive/check/putaway 三个 PDA 写接口此前各自
 * getConnection/begin/commit/rollback/release 重复 4 次；统一包装后 controller
 * 只声明 business(conn) 逻辑，事务边界一处管理。
 */
const withTx = (business) => async (req, res, next) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await business(conn, req)
    await conn.commit()
    return successResponse(res, result)
  } catch (e) {
    await conn.rollback()
    next(e)
  } finally {
    conn.release()
  }
}

const pdaList = async(req,res,next)=>{ try{const tasks=await svc.findPdaTasks(req.pda?.warehouseId??null);return successResponse(res,tasks)}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{const task=await svc.findById(+req.params.id, req.user?.warehouseIds??null);return successResponse(res,task)}catch(e){next(e)} }
const submit = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);const task=await svc.submit(+req.params.id,op, req.user?.warehouseIds??null);return successResponse(res,task,'已提交到 PDA')}catch(e){next(e)} }
const receive = withTx(async(conn, req)=>{ const{productId,packages}=req.body;return svc.receive(conn,+req.params.id,{productId,packages,requestKey:req.headers['x-request-key'],userId:req.user?.userId??null,pdaWarehouseId:req.pda?.warehouseId??null}) })
const check = withTx(async(conn, req)=>{ const{productId,passedQty,rejectedQty}=req.body;return svc.check(conn,+req.params.id,{productId,passedQty,rejectedQty,requestKey:req.headers['x-request-key'],userId:req.user?.userId??null,pdaWarehouseId:req.pda?.warehouseId??null}) })
const putaway = withTx(async(conn, req)=>{ const{containerId,locationId}=req.body;return svc.putaway(conn,+req.params.id,{containerId,locationId,requestKey:req.headers['x-request-key'],userId:req.user?.userId??null,pdaWarehouseId:req.pda?.warehouseId??null}) })
const cancel = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);await svc.cancel(+req.params.id,op,{ scopeWarehouseIds: req.user?.warehouseIds??null });return successResponse(res,null,'已取消')}catch(e){next(e)} }

module.exports = { pdaList, detail, submit, receive, check, putaway, cancel }
