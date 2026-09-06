const AppError = require('../../utils/AppError')
const { PERMISSIONS: P } = require('../../constants/permissions')
const definitions = {
  sale: [P.SALE_ORDER_VIEW, '../sale/sale.service', 'findById'],
  purchase: [P.PURCHASE_ORDER_VIEW, '../purchase/purchase.service', 'findById'],
  inbound: [P.INBOUND_ORDER_VIEW, '../inbound-tasks/inbound-tasks.service', 'findById'],
  'purchase-return': [P.RETURN_ORDER_VIEW, '../returns/returns-purchase.service', 'findByIdPR'],
  'sale-return': [P.RETURN_ORDER_VIEW, '../returns/returns-sale.service', 'findByIdSR'],
  transfer: [P.TRANSFER_ORDER_VIEW, '../transfer/transfer.service', 'findById'],
  stockcheck: [P.STOCKCHECK_VIEW, '../stockcheck/stockcheck.service', 'findById'],
  disposal: [P.INVENTORY_DISPOSAL_VIEW, '../disposal/disposal.service', 'findById'],
  requisition: [P.PURCHASE_REQUISITION_VIEW, '../purchase-requisitions/purchase-requisitions.service', 'findById'],
  refund: [P.REFUND_ORDER_VIEW, '../refunds/refund-orders.service', 'findById'],
  expense: [P.FINANCE_EXPENSE_VIEW, '../finance/expense-claims.service', 'findById'],
  credit: [P.SALE_CREDIT_OVERRIDE_VIEW, '../credit-overrides/credit-overrides.service', 'findById'],
  price: [P.PRODUCT_VIEW, '../price-change/price-change.service', 'findById'],
  plan: [P.PROCUREMENT_PLAN_VIEW, '../procurement/procurement.service', 'getPlan'],
  wave: [P.PICKING_WAVE_VIEW, '../picking-waves/picking-waves.service', 'findById'],
  logistics: [P.LOGISTICS_VIEW, '../logistics/logistics.service', 'getWaybillById'],
}
function getDefinition(type) { return Object.hasOwn(definitions, type) ? definitions[type] : null }
async function loadDocument(type, id, user) {
  const [, modulePath, method] = getDefinition(type)
  const scope = user.warehouseIds ?? null
  let options = scope
  if (type === 'expense') {
    const allowAll = Number(user.roleId) === 1 || (user.permissions || []).includes(P.FINANCE_EXPENSE_VIEW_ALL)
    options = { allowAll, applicantId: allowAll ? null : user.userId }
  }
  if (type === 'logistics') options = { warehouseIds: scope }
  const doc = await require(modulePath)[method](id, options, type === 'wave' ? { refreshProgress: false } : undefined)
  if (type === 'plan' && Array.isArray(scope) && !doc.items?.length) throw new AppError('无权查看该采购计划的操作记录', 403, 'WAREHOUSE_SCOPE_DENIED')
  return doc
}
module.exports = { getDefinition, loadDocument }
