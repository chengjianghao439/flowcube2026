const ledgerSvc = require('./party-ledger.service')
const ledger = async (req,res,next) => { try { return successResponse(res, await ledgerSvc.findLedger(req.query), '查询成功') } catch (e) { next(e) } }
const svc = require('./payments.service')
const receiptSvc = require('./payment-receipts.service')
const stmtSvc = require('./reconciliation-statements.service')
const agingSvc = require('./payment-aging.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')
const { resolveBackfillRequest } = require('../accounting/finance-period.guard')

// 跨期补录**申请**（2026-09-26 一致性审查 · 任务 7）：把请求意图解析成 service 的 backfill 入参
// （权限与原因长度在这里校验，未申请则为 null）。「期间是否真的已结账」不在这里判断——那要对
// 具体业务日期查库，而业务日期取自哪个字段只有 service 知道。
// 出纳点了提交、期间已结账时，service 返回 backfillApplication：业务数据一行未写，只落了一张
// 待审批申请单。此时必须回 **202** 而不是 200/201——这不是「登记成功」，是「已提交待审批」，
// 前端据此提示「批准前这笔钱不会记账」。
const backfillOf = (req) => {
  const r = resolveBackfillRequest(req)
  return r ? { mode: 'apply', ...r } : null
}
const BACKFILL_APPLIED_MSG = '已提交跨期补录申请，审批通过后才会记账'

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await svc.createManual(req.body,operator,extractRequestKey(req)),'创建成功',201)}catch(e){next(e)} }
const pay = async(req,res,next)=>{ try{const id=+req.params.id;const operator=getOperatorFromRequest(req);const data=await svc.recordPayment(id,req.body,operator,extractRequestKey(req),{backfill:backfillOf(req)});return data?.backfillApplication?successResponse(res,data.backfillApplication,BACKFILL_APPLIED_MSG,202):successResponse(res,data,'登记成功')}catch(e){next(e)} }
const entries = async(req,res,next)=>{ try{return successResponse(res,await svc.findEntries(+req.params.id),'查询成功')}catch(e){next(e)} }
const confirm = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await svc.confirmRecord(+req.params.id,operator),'应付结算已确认，可登记付款')}catch(e){next(e)} }
const settlementDetail = async(req,res,next)=>{ try{return successResponse(res,await svc.settlementDetail(+req.params.id),'查询成功')}catch(e){next(e)} }
// 手工应付可选的借方科目（任务 3b）：财务逐笔挑选，系统不预置默认值
const debitAccountOptions = async(req,res,next)=>{ try{return successResponse(res,await svc.listDebitAccountOptions(),'查询成功')}catch(e){next(e)} }

// 应收/应付账龄分析（as-of 今天，跨结算方式汇总全量敞口）
const aging = async(req,res,next)=>{ try{const topLimit=req.query.topLimit?+req.query.topLimit:8;return successResponse(res,await agingSvc.aging({topLimit}),'查询成功')}catch(e){next(e)} }

// ── 收付款单与核销 ────────────────────────────────────────────────────────────
const receiptList = async(req,res,next)=>{ try{return successResponse(res,await receiptSvc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const receiptDetail = async(req,res,next)=>{ try{return successResponse(res,await receiptSvc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const receiptCreate = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);const data=await receiptSvc.create(req.body,operator,extractRequestKey(req),{backfill:backfillOf(req)});return data?.backfillApplication?successResponse(res,data.backfillApplication,BACKFILL_APPLIED_MSG,202):successResponse(res,data,'登记成功',201)}catch(e){next(e)} }
const receiptSettle = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);const data=await receiptSvc.settle(+req.params.id,req.body,operator,extractRequestKey(req),{backfill:backfillOf(req)});return data?.backfillApplication?successResponse(res,data.backfillApplication,BACKFILL_APPLIED_MSG,202):successResponse(res,data,'核销成功')}catch(e){next(e)} }

// ── 汇总对账单 ────────────────────────────────────────────────────────────────
const statementList = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const statementCandidates = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.listCandidates(req.query),'查询成功')}catch(e){next(e)} }
const statementDetail = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const statementCreate = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await stmtSvc.create(req.body,operator),'对账单已生成',201)}catch(e){next(e)} }
const statementConfirm = async(req,res,next)=>{ try{const operator=getOperatorFromRequest(req);return successResponse(res,await stmtSvc.confirm(+req.params.id,operator),'对账单已确认，可导出发对方核对')}catch(e){next(e)} }
const statementUnlock = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.unlock(+req.params.id),'已解锁为草稿，可继续调整明细')}catch(e){next(e)} }
const statementRemoveItem = async(req,res,next)=>{ try{return successResponse(res,await stmtSvc.removeItem(+req.params.id,+req.params.recordId),'已移出对账单')}catch(e){next(e)} }

module.exports = {
  ledger, list, create, pay, entries, confirm, settlementDetail, aging, debitAccountOptions,
  receiptList, receiptDetail, receiptCreate, receiptSettle,
  statementList, statementCandidates, statementDetail, statementCreate,
  statementConfirm, statementUnlock, statementRemoveItem,
}
