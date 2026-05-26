const svc = require('./reports.service')
const { successResponse } = require('../../utils/response')

const parseQuery = (q) => ({ startDate: q.startDate || null, endDate: q.endDate || null })
const parseReconciliationQuery = (q) => ({
  type: q.type || '1',
  startDate: q.startDate || null,
  endDate: q.endDate || null,
  keyword: q.keyword || '',
  status: q.status || null,
})

const purchase = async(req,res,next)=>{ try{return successResponse(res,await svc.purchaseStats(parseQuery(req.query)),'查询成功')}catch(e){next(e)} }
const sale = async(req,res,next)=>{ try{return successResponse(res,await svc.saleStats(parseQuery(req.query)),'查询成功')}catch(e){next(e)} }
const inventory = async(req,res,next)=>{ try{return successResponse(res,await svc.inventoryStats(parseQuery(req.query)),'查询成功')}catch(e){next(e)} }
const pdaPerformance = async(req,res,next)=>{ try{return successResponse(res,await svc.pdaPerformance(),'查询成功')}catch(e){next(e)} }
const wavePerformance = async(req,res,next)=>{ try{return successResponse(res,await svc.wavePerformance(parseQuery(req.query)),'查询成功')}catch(e){next(e)} }
const warehouseOps = async(req,res,next)=>{ try{return successResponse(res,await svc.warehouseOps(),'查询成功')}catch(e){next(e)} }
const roleWorkbench = async(req,res,next)=>{ try{return successResponse(res,await svc.roleWorkbench(),'查询成功')}catch(e){next(e)} }
const reconciliation = async(req,res,next)=>{ try{return successResponse(res,await svc.reconciliationReport(parseReconciliationQuery(req.query)),'查询成功')}catch(e){next(e)} }
const profitAnalysis = async(req,res,next)=>{ try{return successResponse(res,await svc.profitAnalysis(parseQuery(req.query)),'查询成功')}catch(e){next(e)} }

module.exports = { purchase, sale, inventory, pdaPerformance, wavePerformance, warehouseOps, roleWorkbench, reconciliation, profitAnalysis }
