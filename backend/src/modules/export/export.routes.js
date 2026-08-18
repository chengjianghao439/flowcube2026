const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./export.controller')

const router = Router()

router.use(authMiddleware)

router.get('/purchase', requirePermission(PERMISSIONS.PURCHASE_ORDER_VIEW), controller.exportPurchase)
router.get('/sale', requirePermission(PERMISSIONS.SALE_ORDER_VIEW), controller.exportSale)
router.get('/reconciliation', requirePermission(PERMISSIONS.REPORT_VIEW), controller.exportReconciliation)
router.get('/inbound-tasks', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), controller.exportInboundTasks)
router.get('/stock', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.exportStock)
router.get('/inventory-logs', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.exportInventoryLogs)
router.get('/transfer', requirePermission(PERMISSIONS.TRANSFER_ORDER_VIEW), controller.exportTransfer)
router.get('/purchase-returns', requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), controller.exportPurchaseReturns)
router.get('/sale-returns', requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), controller.exportSaleReturns)

// 账款 / 核销 / 对账单。对账单明细是发给往来方核对的正式单据格式（带抬头与签章栏）。
router.get('/payments', requirePermission(PERMISSIONS.PAYMENT_VIEW), controller.exportPayments)
router.get('/payment-receipts', requirePermission(PERMISSIONS.PAYMENT_VIEW), controller.exportPaymentReceipts)
router.get('/statements', requirePermission(PERMISSIONS.PAYMENT_VIEW), controller.exportStatements)
router.get('/statements/:id', requirePermission(PERMISSIONS.PAYMENT_VIEW), controller.exportStatementDetail)

// ── 后加实体导出（v0.4.79 批量补齐）───────────────────────────────────────────
router.get('/waybills', requirePermission(PERMISSIONS.LOGISTICS_VIEW), controller.exportWaybills)
router.get('/fixed-assets', requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), controller.exportFixedAssets)
router.get('/expense-claims', requirePermission(PERMISSIONS.FINANCE_EXPENSE_VIEW), controller.exportExpenseClaims)
router.get('/finance-accounts', requirePermission(PERMISSIONS.FINANCE_ACCOUNT_VIEW), controller.exportFinanceAccounts)
router.get('/disposals', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), controller.exportDisposals)
router.get('/abc', requirePermission(PERMISSIONS.STOCKCHECK_ABC_VIEW), controller.exportAbc)
router.get('/credit-overrides', requirePermission(PERMISSIONS.SALE_CREDIT_OVERRIDE_VIEW), controller.exportCreditOverrides)
router.get('/picking-waves', requirePermission(PERMISSIONS.PICKING_WAVE_VIEW), controller.exportPickingWaves)
router.get('/users', requirePermission(PERMISSIONS.USER_VIEW), controller.exportUsers)
router.get('/oplogs', requirePermission(PERMISSIONS.AUDIT_LOG_VIEW), controller.exportOplogs)
router.get('/carriers', requirePermission(PERMISSIONS.CARRIER_VIEW), controller.exportCarriers)
router.get('/plastic-boxes', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.exportPlasticBoxes)
router.get('/locations', requirePermission(PERMISSIONS.LOCATION_VIEW), controller.exportLocations)
router.get('/racks', requirePermission(PERMISSIONS.RACK_VIEW), controller.exportRacks)
router.get('/sorting-bins', requirePermission(PERMISSIONS.SORTING_BIN_VIEW), controller.exportSortingBins)
router.get('/suppliers', requirePermission(PERMISSIONS.SUPPLIER_VIEW), controller.exportSuppliers)
router.get('/customers', requirePermission(PERMISSIONS.CUSTOMER_VIEW), controller.exportCustomers)
router.get('/accounting-periods', requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), controller.exportAccountingPeriods)
router.get('/tax-adjustments', requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), controller.exportTaxAdjustments)
router.get('/companies', requirePermission(PERMISSIONS.ACCOUNTING_LEDGER_VIEW), controller.exportCompanies)

module.exports = router
