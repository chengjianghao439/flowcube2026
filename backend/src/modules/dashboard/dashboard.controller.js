const svc = require('./dashboard.service')
const { successResponse } = require('../../utils/response')

const summary = async(req,res,next)=>{ try{return successResponse(res,await svc.getSummary(),'查询成功')}catch(e){next(e)} }
const lowStock = async(req,res,next)=>{ try{return successResponse(res,await svc.getLowStock(+req.query.threshold||10),'查询成功')}catch(e){next(e)} }
const trend = async(req,res,next)=>{ try{return successResponse(res,await svc.getRecentTrend(+req.query.days||7),'查询成功')}catch(e){next(e)} }
const topStock = async(req,res,next)=>{ try{return successResponse(res,await svc.getTopStockByValue(10),'查询成功')}catch(e){next(e)} }

module.exports = { summary, lowStock, trend, topStock }
