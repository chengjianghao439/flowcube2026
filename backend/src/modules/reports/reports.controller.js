const svc = require('./reports.service')
const { successResponse } = require('../../utils/response')

const parseQuery = (q) => ({ startDate: q.startDate || null, endDate: q.endDate || null })
const parseReconciliationQuery = (q) => ({
  type: q.type || '1',
  startDate: q.startDate || null,
  endDate: q.endDate || null,
  keyword: q.keyword || '',
  orderNo: q.orderNo || '',
  partyName: q.partyName || '',
  status: q.status || null,
  // 对账页固定只看月结往来方；非法值会在 fetchReconciliationRows 里被丢掉
  settlementTypes: q.settlementTypes || null,
  minAmount: q.minAmount || '',
  maxAmount: q.maxAmount || '',
  dueStart: q.dueStart || '',
  dueEnd: q.dueEnd || '',
})

const purchase = async(req,res,next)=>{ try{return successResponse(res,await svc.purchaseStats({...parseQuery(req.query), scopeWarehouseIds: req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const sale = async(req,res,next)=>{ try{return successResponse(res,await svc.saleStats({...parseQuery(req.query), scopeWarehouseIds: req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const inventory = async(req,res,next)=>{ try{return successResponse(res,await svc.inventoryStats({...parseQuery(req.query), scopeWarehouseIds: req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const pdaPerformance = async(req,res,next)=>{ try{return successResponse(res,await svc.pdaPerformance(req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const wavePerformance = async(req,res,next)=>{ try{return successResponse(res,await svc.wavePerformance({...parseQuery(req.query), scopeWarehouseIds: req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const warehouseOps = async(req,res,next)=>{ try{return successResponse(res,await svc.warehouseOps(req.user?.warehouseIds??null),'查询成功')}catch(e){next(e)} }
const roleWorkbench = async(req,res,next)=>{ try{return successResponse(res,await svc.roleWorkbench(req.user?.warehouseIds??null,req.query),'查询成功')}catch(e){next(e)} }
const reconciliation = async(req,res,next)=>{ try{return successResponse(res,await svc.reconciliationReport(parseReconciliationQuery(req.query)),'查询成功')}catch(e){next(e)} }
const avgCostReconciliation = async(req,res,next)=>{ try{return successResponse(res,await svc.avgCostReconciliation({ scopeWarehouseIds: req.user?.warehouseIds??null }),'查询成功')}catch(e){next(e)} }
const profitAnalysis = async(req,res,next)=>{ try{return successResponse(res,await svc.profitAnalysis({...parseQuery(req.query), scopeWarehouseIds: req.user?.warehouseIds??null}),'查询成功')}catch(e){next(e)} }
const kpi = async(req,res,next)=>{ try{return successResponse(res,await svc.kpiMetrics({ period: req.query.period || null, offsetPeriods: req.query.offset ? Number(req.query.offset) : -1, scopeWarehouseIds: req.user?.warehouseIds??null }),'查询成功')}catch(e){next(e)} }
const purchasePriceTrend = async(req,res,next)=>{ try{return successResponse(res,await svc.purchasePriceTrend({ productId: req.query.productId || null, ...parseQuery(req.query), scopeWarehouseIds: req.user?.warehouseIds??null }),'查询成功')}catch(e){next(e)} }

module.exports = { purchase, sale, inventory, pdaPerformance, wavePerformance, warehouseOps, roleWorkbench, reconciliation, profitAnalysis, kpi, avgCostReconciliation, purchasePriceTrend }
