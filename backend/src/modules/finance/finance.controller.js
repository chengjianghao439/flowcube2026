const svc = require('./finance-accounts.service')
const expenseSvc = require('./expense-claims.service')
const dashboardSvc = require('./finance-dashboard.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')

const list = async(req,res,next)=>{ try{return successResponse(res,await svc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const active = async(req,res,next)=>{ try{return successResponse(res,await svc.findActive(),'查询成功')}catch(e){next(e)} }
const detail = async(req,res,next)=>{ try{return successResponse(res,await svc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const create = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.create(req.body,op),'账户已创建',201)}catch(e){next(e)} }
const update = async(req,res,next)=>{ try{return successResponse(res,await svc.update(+req.params.id,req.body),'保存成功')}catch(e){next(e)} }
const remove = async(req,res,next)=>{ try{return successResponse(res,await svc.softDelete(+req.params.id),'删除成功')}catch(e){next(e)} }
const adjust = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await svc.adjust(+req.params.id,req.body,op),'余额已调整')}catch(e){next(e)} }
const transactions = async(req,res,next)=>{ try{return successResponse(res,await svc.findTransactions({...req.query,accountId:req.params.id?+req.params.id:req.query.accountId}),'查询成功')}catch(e){next(e)} }
const consistency = async(req,res,next)=>{ try{return successResponse(res,await svc.checkConsistency(),'检查完成')}catch(e){next(e)} }

// ── 费用报销 ──────────────────────────────────────────────────────────────────
const expenseList = async(req,res,next)=>{ try{return successResponse(res,await expenseSvc.findAll(req.query),'查询成功')}catch(e){next(e)} }
const expenseDetail = async(req,res,next)=>{ try{return successResponse(res,await expenseSvc.findById(+req.params.id),'查询成功')}catch(e){next(e)} }
const expenseCreate = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.create(req.body,op),'报销单已创建',201)}catch(e){next(e)} }
const expenseUpdate = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.update(+req.params.id,req.body,op),'保存成功')}catch(e){next(e)} }
const expenseSubmit = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.submit(+req.params.id,op),'已提交审批')}catch(e){next(e)} }
const expenseWithdraw = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.withdraw(+req.params.id,op),'已撤回为草稿')}catch(e){next(e)} }
const expenseApprove = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.approve(+req.params.id,op),'已批准，可付款')}catch(e){next(e)} }
const expenseReject = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.reject(+req.params.id,req.body,op),'已驳回')}catch(e){next(e)} }
const expensePay = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.pay(+req.params.id,req.body,op),'付款完成，已记入账户流水')}catch(e){next(e)} }
const expenseCancel = async(req,res,next)=>{ try{const op=getOperatorFromRequest(req);return successResponse(res,await expenseSvc.cancel(+req.params.id,op),'已取消')}catch(e){next(e)} }

const categoryList = async(req,res,next)=>{ try{return successResponse(res,await expenseSvc.listCategories({activeOnly:req.query.activeOnly==='1'}),'查询成功')}catch(e){next(e)} }
const categoryCreate = async(req,res,next)=>{ try{return successResponse(res,await expenseSvc.createCategory(req.body),'类别已创建',201)}catch(e){next(e)} }
const categoryUpdate = async(req,res,next)=>{ try{return successResponse(res,await expenseSvc.updateCategory(+req.params.id,req.body),'保存成功')}catch(e){next(e)} }
const categoryDelete = async(req,res,next)=>{ try{return successResponse(res,await expenseSvc.deleteCategory(+req.params.id),'删除成功')}catch(e){next(e)} }

const dashboard = async(req,res,next)=>{ try{return successResponse(res,await dashboardSvc.overview(req.query),'查询成功')}catch(e){next(e)} }

module.exports = {
  dashboard,
  list, active, detail, create, update, remove, adjust, transactions, consistency,
  expenseList, expenseDetail, expenseCreate, expenseUpdate, expenseSubmit, expenseWithdraw,
  expenseApprove, expenseReject, expensePay, expenseCancel,
  categoryList, categoryCreate, categoryUpdate, categoryDelete,
}
