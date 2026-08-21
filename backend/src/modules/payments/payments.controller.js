const svc = require('./payments.service')
const receiptSvc = require('./payment-receipts.service')
const stmtSvc = require('./reconciliation-statements.service')
const agingSvc = require('./payment-aging.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await svc.createManual(req.body,operator,extractRequestKey(req)),'创建成功',201)}catch(e){next(e)} }
const pay = async(req,res,next)=>{ try{const id=+req.params.id;const operator=getOperatorFromRequest(req);return successResponse(res,await svc.recordPayment(id,req.body,operator,extractRequestKey(req)),'登记成功')}catch(e){next(e)} }
const entries = async(req,res,next)=>{ try{return successResponse(res,await svc.findEntries(+req.params.id),'查询成功')}catch(e){next(e)} }
const confirm = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await svc.confirmRecord(+req.params.id,operator),'应付结算已确认，可登记付款')}catch(e){next(e)} }
const settlementDetail = async(req,res,next)=>{ try{return successResponse(res,await svc.settlementDetail(+req.params.id),'查询成功')}catch(e){next(e)} }

// 应收/应付账龄分析（as-of 今天，跨结算方式汇总全量敞口）
const aging = async(req,res,next)=>{ try{const topLimit=req.query.topLimit?+req.query.topLimit:8;return successResponse(res,await agingSvc.aging({topLimit}),'查询成功')}catch(e){next(e)} }

// ── 收付款单与核销 ────────────────────────────────────────────────────────────
const receiptList = async(req,res,next)=>{ try{return successResponse(res,await receiptSvc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const receiptDetail = async(req,res,next)=>{ try{return successResponse(res,await receiptSvc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const receiptCreate = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);const data=await receiptSvc.create(req.body,operator,extractRequestKey(req));return successResponse(res,data,'登记成功',201)}catch(e){next(e)} }
const receiptSettle = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);const data=await receiptSvc.settle(+req.params.id,req.body,operator,extractRequestKey(req));return successResponse(res,data,'核销成功')}catch(e){next(e)} }

// ── 汇总对账单 ────────────────────────────────────────────────────────────────
const statementList = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const statementCandidates = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.listCandidates(req.query),'查询成功')}catch(e){next(e)} }
const statementDetail = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const statementCreate = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await stmtSvc.create(req.body,operator),'对账单已生成',201)}catch(e){next(e)} }
const statementConfirm = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await stmtSvc.confirm(+req.params.id,operator),'对账单已确认，可导出发对方核对')}catch(e){next(e)} }
const statementUnlock = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.unlock(+req.params.id),'已解锁为草稿，可继续调整明细')}catch(e){next(e)} }
const statementRemoveItem = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.removeItem(+req.params.id,+req.params.recordId),'已移出对账单')}catch(e){next(e)} }

module.exports = {
  list, create, pay, entries, confirm, settlementDetail, aging,
  receiptList, receiptDetail, receiptCreate, receiptSettle,
  statementList, statementCandidates, statementDetail, statementCreate,
  statementConfirm, statementUnlock, statementRemoveItem,
}
