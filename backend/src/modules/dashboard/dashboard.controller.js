const svc = require('./dashboard.service')
const { successResponse } = require('../../utils/response')

const summary = async(req,res,next)=>{ try{return successResponse(res,await svc.getSummary(req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const lowStock = async(req,res,next)=>{ try{return successResponse(res,await svc.getLowStock(Number.isFinite(Number(req.query.threshold)) ? Number(req.query.threshold) : 10, req.user?.warehouseIds??null, req.query.page ? {page:req.query.page,pageSize:req.query.pageSize} : null),'查询成功')}catch(e){next(e)} }
const trend = async(req,res,next)=>{ try{return successResponse(res,await svc.getRecentTrend(+req.query.days||7, req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const topStock = async(req,res,next)=>{ try{return successResponse(res,await svc.getTopStockByValue(10, req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const incomingPurchases = async(req,res,next)=>{ try{return successResponse(res,await svc.getIncomingPurchases(req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const creditWarning = async(req,res,next)=>{ try{return successResponse(res,await svc.getCreditWarning(req.query.page ? {page:req.query.page,pageSize:req.query.pageSize} : null),'查询成功')}catch(e){next(e)} }
const layout = async(req,res,next)=>{ try{return successResponse(res,await svc.getLayout(req.user.userId),'查询成功')}catch(e){next(e)} }
const saveLayout = async(req,res,next)=>{ try{return successResponse(res,await svc.saveLayout(req.user.userId, req.body),'保存成功')}catch(e){next(e)} }

module.exports = { summary, lowStock, trend, topStock, incomingPurchases, creditWarning, layout, saveLayout }
