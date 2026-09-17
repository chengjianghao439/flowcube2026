# PC UI 源码覆盖索引

生成命令：`node scripts/pc-ui-inventory.cjs > docs/pc-ui-source-inventory.md`。

范围：frontend/src 下非 PDA 专属的 TSX（排除测试和 PdaLayout），包含公共原语、无可视输出桥接器、登录与官网；这是候选文件清单，不是依赖可达性分析，也不代表每个数据状态已实页验收。界面实现与实页验证记录见 [收口报告](pc-ui-final-audit-2026-09-05.md)。

本次源码扫描：257 个候选 TSX 文件；169 个弹层/CRUD/覆盖层节点；路由注册表 92 个静态或动态定义。节点数量不等于独立弹窗数量，共用及条件实例可能重复。

## 注册路由

| 路由或模式 | 标题 | 组件 |
|---|---|---|
| '/dashboard' | '仪表盘' | 'DashboardPage' |
| '/purchase' | '采购订单' | 'PurchasePage' |
| '/purchase-requisitions' | '采购申请' | 'RequisitionsPage' |
| '/procurement' | '采购建议' | 'ProcurementPlanListPage' |
| '/inbound-tasks' | '收货订单' | 'InboundTasksPage' |
| '/returns/purchase' | '采购退货' | 'ReturnsPage' |
| '/suppliers' | '供应商管理' | 'SuppliersPage' |
| '/sale' | '销售管理' | 'SalePage' |
| '/returns/sale' | '销售退货' | 'ReturnsPage' |
| '/credit-overrides' | '超额放行申请' | 'CreditOverridesPage' |
| '/logistics' | '物流运单' | 'LogisticsPage' |
| '/customers' | '客户管理' | 'CustomersPage' |
| '/portal/statements' | '客户对账门户' | 'PortalStatementsPage' |
| '/portal/purchase-status' | '供应商到货门户' | 'PortalPurchaseStatusPage' |
| '/carriers' | '承运商管理' | 'CarriersPage' |
| '/carrier-accounts' | '快递账号绑定' | 'CarrierAccountsPage' |
| '/inventory' | '库存管理' | 'InventoryPage' |
| '/plastic-boxes' | '塑料盒管理' | 'PlasticBoxesPage' |
| '/inventory/trace' | '批次追溯' | 'InventoryTracePage' |
| '/stockcheck' | '库存盘点' | 'StockcheckPage' |
| '/stockcheck/abc' | '商品分档与分批盘规则' | 'AbcClassPage' |
| '/disposals' | '滞销库存处理' | 'DisposalPage' |
| '/transfer' | '库存调拨' | 'TransferPage' |
| '/products' | '商品管理' | 'ProductPage' |
| '/categories' | '商品分类' | 'CategoryPage' |
| '/price-change' | '商品改价申请' | 'PriceChangePage' |
| '/picking-waves' | '批次拣货' | 'PickingWavesPage' |
| '/warehouses' | '仓库管理' | 'WarehouseStructurePage' |
| '/locations' | '库位管理' | 'WarehouseStructurePage' |
| '/racks' | '货架管理' | 'WarehouseStructurePage' |
| '/sorting-bins' | '分拣格管理' | 'WarehouseStructurePage' |
| '/payments/payable' | '现结供应商账款' | 'PayablePage' |
| '/payments/receivable' | '现结客户账款' | 'ReceivablePage' |
| '/reports/reconciliation/payable' | '月结供应商对账' | 'ReconciliationPayablePage' |
| '/reports/reconciliation/receivable' | '月结客户对账' | 'ReconciliationReceivablePage' |
| '/logistics/freight-reconciliation' | '运费对账' | 'FreightReconciliationPage' |
| '/finance/dashboard' | '资金看板' | 'FinanceDashboardPage' |
| '/finance/accounts' | '账户管理' | 'FinanceAccountsPage' |
| '/finance/transactions' | '资金流水' | 'FinanceTransactionsPage' |
| '/finance/expenses' | '费用报销' | 'ExpenseClaimsPage' |
| '/finance/expense-categories' | '费用类别' | 'ExpenseCategoriesPage' |
| '/accounting/accounts' | '会计科目表' | 'AcctAccountsPage' |
| '/accounting/vouchers' | '记账凭证' | 'AcctVouchersPage' |
| '/accounting/ledger' | '总账 / 试算平衡' | 'AcctLedgerPage' |
| '/accounting/reports' | '会计报表' | 'AcctReportsPage' |
| '/accounting/invoices' | '发票管理' | 'AcctInvoicesPage' |
| '/refunds' | '退货退款单' | 'RefundsPage' |
| '/accounting/periods' | '会计期间 / 期末结转' | 'AcctPeriodsPage' |
| '/accounting/fixed-assets' | '固定资产' | 'FixedAssetsPage' |
| '/accounting/consolidation' | '合并报表 / 账套' | 'AcctConsolidationPage' |
| '/accounting/tax' | '报税数据' | 'AcctTaxPage' |
| '/reports' | '报表中心' | 'ReportsPage' |
| '/reports/profit-analysis' | '报表中心' | 'ProfitAnalysisPage' |
| '/reports/avg-cost-reconciliation' | '成本对账' | 'AvgCostReconciliationPage' |
| '/reports/kpi' | '报表中心' | 'KpiPage' |
| '/reports/replenishment' | '采购建议' | 'ReplenishmentPage' |
| '/reports/inventory-aging' | '存放时长与滞销' | 'InventoryAgingPage' |
| '/reports/warehouse-ops' | '仓库运营' | 'WarehouseOpsPage' |
| '/reports/wave-performance' | '仓库运营' | 'WavePerformancePage' |
| '/reports/pda-anomaly' | '仓库运营' | 'PdaAnomalyPage' |
| '/reports/role-workbench' | '待办中心' | 'RoleWorkbenchPage' |
| '/settings/print-templates' | '打印模板' | 'PrintTemplatesPage' |
| '/settings/printers' | '打印机管理' | 'PrintersPage' |
| '/settings/barcode-print-query' | '条码打印查询' | 'BarcodePrintQueryPage' |
| '/approvals/pending' | '待我审批' | 'ApprovalPendingPage' |
| '/approvals/flows' | '审批流配置' | 'ApprovalFlowsPage' |
| '/departments' | '部门管理' | 'DepartmentsPage' |
| '/users' | '用户管理' | 'UsersPage' |
| '/permissions' | '权限管理' | 'PermissionsPage' |
| '/settings/pda-devices' | 'PDA 设备' | 'PdaDevicesPage' |
| '/settings' | '系统设置' | 'SettingsPage' |
| '/oplogs' | '操作日志' | 'OplogsPage' |
| /^\/logistics\/\d+$/ | (path) => `运单 #${path.split('/').pop()}` | 'LogisticsDetailPage' |
| /^\/products\/new$/ | () => '新增商品' | 'ProductFormPage' |
| /^\/products\/\d+$/ | (path) => `编辑商品 #${path.split('/').pop()}` | 'ProductFormPage' |
| /^\/payments\/ledger\/(customer\|supplier)\/\d+$/ | (path) => `${path.includes('/customer/') ? '客户' : '供应商'}往来明细 #${path.split('/').pop()}` | 'PartyLedgerPage' |
| /^\/sale\/new$/ | () => '新建销售单' | 'SaleFormPage' |
| /^\/sale\/\d+$/ | (path) => `销售单 #${path.split('/').pop()}` | 'SaleFormPage' |
| /^\/purchase\/new$/ | () => '新建采购单' | 'PurchaseFormPage' |
| /^\/purchase\/\d+$/ | (path) => `采购订单 #${path.split('/').pop()}` | 'PurchaseFormPage' |
| /^\/procurement\/\d+$/ | (path) => `采购计划 #${path.split('/').pop()}` | 'ProcurementPlanDetailPage' |
| /^\/purchase-requisitions\/new$/ | () => '新建采购申请单' | 'RequisitionFormPage' |
| /^\/purchase-requisitions\/\d+$/ | (path) => `采购申请单 #${path.split('/').pop()}` | 'RequisitionFormPage' |
| /^\/transfer\/new$/ | () => '新建调拨单' | 'TransferFormPage' |
| /^\/transfer\/\d+$/ | (path) => `调拨单 #${path.split('/').pop()}` | 'TransferFormPage' |
| /^\/returns\/purchase\/new$/ | () => '新建采购退货单' | 'PurchaseReturnFormPage' |
| /^\/returns\/purchase\/\d+$/ | (path) => `采购退货单 #${path.split('/').pop()}` | 'PurchaseReturnFormPage' |
| /^\/returns\/sale\/new$/ | () => '新建销售退货单' | 'SaleReturnFormPage' |
| /^\/returns\/sale\/\d+$/ | (path) => `销售退货单 #${path.split('/').pop()}` | 'SaleReturnFormPage' |
| /^\/inbound-tasks\/new$/ | () => '新建收货订单' | 'InboundTaskCreatePage' |
| /^\/inbound-tasks\/\d+$/ | (path) => `收货订单 #${path.split('/').pop()}` | 'InboundTaskDetailPage' |
| /^\/settings\/print-templates\/(new\|\d+)$/ | (path) => path.endsWith('/new') ? '新建打印模板' : '编辑打印模板' | 'PrintTemplateEditorPage' |

## 文件与弹层入口

未出现弹层节点的文件仍保留，避免漏掉全页表单、图表、原生覆盖层或公共组件。

| 源文件 | 弹层、维护表单或覆盖层入口 |
|---|---|
| [components/GlobalErrorBoundary.tsx](../frontend/src/components/GlobalErrorBoundary.tsx) | — |
| [components/dashboard/DashboardVersionCard.tsx](../frontend/src/components/dashboard/DashboardVersionCard.tsx) | — |
| [components/dashboard/StatTile.tsx](../frontend/src/components/dashboard/StatTile.tsx) | — |
| [components/dashboard/WidgetShell.tsx](../frontend/src/components/dashboard/WidgetShell.tsx) | — |
| [components/dashboard/widgets/ChartWidgets.tsx](../frontend/src/components/dashboard/widgets/ChartWidgets.tsx) | — |
| [components/dashboard/widgets/FunWidgets.tsx](../frontend/src/components/dashboard/widgets/FunWidgets.tsx) | — |
| [components/dashboard/widgets/KpiWidgets.tsx](../frontend/src/components/dashboard/widgets/KpiWidgets.tsx) | — |
| [components/dashboard/widgets/ListWidgets.tsx](../frontend/src/components/dashboard/widgets/ListWidgets.tsx) | — |
| [components/dashboard/widgets/OperationalWidgets.tsx](../frontend/src/components/dashboard/widgets/OperationalWidgets.tsx) | — |
| [components/dashboard/widgets/PrioritySales.tsx](../frontend/src/components/dashboard/widgets/PrioritySales.tsx) | — |
| [components/dashboard/widgets/RiskDetails.tsx](../frontend/src/components/dashboard/widgets/RiskDetails.tsx) | DialogContent:53 |
| [components/desktop/DesktopPrintClientBridge.tsx](../frontend/src/components/desktop/DesktopPrintClientBridge.tsx) | — |
| [components/desktop/DesktopQuitUnloadBridge.tsx](../frontend/src/components/desktop/DesktopQuitUnloadBridge.tsx) | — |
| [components/desktop/DesktopUpdateBridge.tsx](../frontend/src/components/desktop/DesktopUpdateBridge.tsx) | DialogContent:43 |
| [components/erp/ErpDesktopConnectionGate.tsx](../frontend/src/components/erp/ErpDesktopConnectionGate.tsx) | — |
| [components/finder/CategoryFinder.tsx](../frontend/src/components/finder/CategoryFinder.tsx) | AppDialog:135 |
| [components/finder/CustomerFinder.tsx](../frontend/src/components/finder/CustomerFinder.tsx) | — |
| [components/finder/FinderModal.tsx](../frontend/src/components/finder/FinderModal.tsx) | AppDialog:41 |
| [components/finder/FinderSearch.tsx](../frontend/src/components/finder/FinderSearch.tsx) | — |
| [components/finder/FinderTable.tsx](../frontend/src/components/finder/FinderTable.tsx) | — |
| [components/finder/ProductFinder.tsx](../frontend/src/components/finder/ProductFinder.tsx) | — |
| [components/finder/SupplierFinder.tsx](../frontend/src/components/finder/SupplierFinder.tsx) | — |
| [components/layout/KeepAliveOutlet.tsx](../frontend/src/components/layout/KeepAliveOutlet.tsx) | — |
| [components/layout/TopNav.tsx](../frontend/src/components/layout/TopNav.tsx) | — |
| [components/layout/WorkspaceTabs.tsx](../frontend/src/components/layout/WorkspaceTabs.tsx) | — |
| [components/print/BarcodePreview.tsx](../frontend/src/components/print/BarcodePreview.tsx) | — |
| [components/print/LabelRasterPreview.tsx](../frontend/src/components/print/LabelRasterPreview.tsx) | — |
| [components/print/OrderPrintOverlay.tsx](../frontend/src/components/print/OrderPrintOverlay.tsx) | createPortal（独立覆盖层） |
| [components/print/SaleOrderPrintTemplate.tsx](../frontend/src/components/print/SaleOrderPrintTemplate.tsx) | — |
| [components/print/TemplateRenderer.tsx](../frontend/src/components/print/TemplateRenderer.tsx) | — |
| [components/shared/ActionBar.tsx](../frontend/src/components/shared/ActionBar.tsx) | — |
| [components/shared/AppDialog.tsx](../frontend/src/components/shared/AppDialog.tsx) | — |
| [components/shared/AppToast.tsx](../frontend/src/components/shared/AppToast.tsx) | — |
| [components/shared/BaseCrudPage.tsx](../frontend/src/components/shared/BaseCrudPage.tsx) | DialogContent:162；ConfirmDialog:179 |
| [components/shared/BrandLogo.tsx](../frontend/src/components/shared/BrandLogo.tsx) | — |
| [components/shared/CategoryPathDisplay.tsx](../frontend/src/components/shared/CategoryPathDisplay.tsx) | — |
| [components/shared/CategoryTreeSelect.tsx](../frontend/src/components/shared/CategoryTreeSelect.tsx) | — |
| [components/shared/ConfirmDialog.tsx](../frontend/src/components/shared/ConfirmDialog.tsx) | AppDialog:91 |
| [components/shared/ContainerDrawer.tsx](../frontend/src/components/shared/ContainerDrawer.tsx) | SheetContent:41 |
| [components/shared/DataTable.tsx](../frontend/src/components/shared/DataTable.tsx) | — |
| [components/shared/DatePicker.tsx](../frontend/src/components/shared/DatePicker.tsx) | PopoverContent:89 |
| [components/shared/DateRangeQueryBar.tsx](../frontend/src/components/shared/DateRangeQueryBar.tsx) | — |
| [components/shared/DirtyGuardDialog.tsx](../frontend/src/components/shared/DirtyGuardDialog.tsx) | ConfirmDialog:18 |
| [components/shared/DocumentActivityPanel.tsx](../frontend/src/components/shared/DocumentActivityPanel.tsx) | — |
| [components/shared/EmptyState.tsx](../frontend/src/components/shared/EmptyState.tsx) | — |
| [components/shared/FilterCard.tsx](../frontend/src/components/shared/FilterCard.tsx) | — |
| [components/shared/FulfillmentTodos.tsx](../frontend/src/components/shared/FulfillmentTodos.tsx) | — |
| [components/shared/GlobalConfirmDialog.tsx](../frontend/src/components/shared/GlobalConfirmDialog.tsx) | ConfirmDialog:47 |
| [components/shared/GlobalSearch.tsx](../frontend/src/components/shared/GlobalSearch.tsx) | — |
| [components/shared/ImportSteps.tsx](../frontend/src/components/shared/ImportSteps.tsx) | — |
| [components/shared/KeepAliveSection.tsx](../frontend/src/components/shared/KeepAliveSection.tsx) | — |
| [components/shared/LimitedInput.tsx](../frontend/src/components/shared/LimitedInput.tsx) | — |
| [components/shared/LimitedTextarea.tsx](../frontend/src/components/shared/LimitedTextarea.tsx) | — |
| [components/shared/ListSummary.tsx](../frontend/src/components/shared/ListSummary.tsx) | — |
| [components/shared/MergedPage.tsx](../frontend/src/components/shared/MergedPage.tsx) | — |
| [components/shared/NotificationBell.tsx](../frontend/src/components/shared/NotificationBell.tsx) | PopoverContent:83 |
| [components/shared/OperatorSelectField.tsx](../frontend/src/components/shared/OperatorSelectField.tsx) | — |
| [components/shared/OrderActivityDialog.tsx](../frontend/src/components/shared/OrderActivityDialog.tsx) | DialogContent:9 |
| [components/shared/OrderDetailSections.tsx](../frontend/src/components/shared/OrderDetailSections.tsx) | — |
| [components/shared/OrderEntryIssues.tsx](../frontend/src/components/shared/OrderEntryIssues.tsx) | — |
| [components/shared/OrderFulfillmentPanel.tsx](../frontend/src/components/shared/OrderFulfillmentPanel.tsx) | — |
| [components/shared/OrderStatusFilter.tsx](../frontend/src/components/shared/OrderStatusFilter.tsx) | — |
| [components/shared/PageHeader.tsx](../frontend/src/components/shared/PageHeader.tsx) | — |
| [components/shared/PaymentQueryDialog.tsx](../frontend/src/components/shared/PaymentQueryDialog.tsx) | DialogContent:143 |
| [components/shared/PrintPreviewZoomControls.tsx](../frontend/src/components/shared/PrintPreviewZoomControls.tsx) | — |
| [components/shared/ProcurementSupplyDetails.tsx](../frontend/src/components/shared/ProcurementSupplyDetails.tsx) | DialogContent:20 |
| [components/shared/ProcurementSupplyExplanation.tsx](../frontend/src/components/shared/ProcurementSupplyExplanation.tsx) | — |
| [components/shared/ProductFinderModal.tsx](../frontend/src/components/shared/ProductFinderModal.tsx) | AppDialog:63 |
| [components/shared/ProductIdentityCells.tsx](../frontend/src/components/shared/ProductIdentityCells.tsx) | — |
| [components/shared/QueryChips.tsx](../frontend/src/components/shared/QueryChips.tsx) | — |
| [components/shared/QueryErrorState.tsx](../frontend/src/components/shared/QueryErrorState.tsx) | — |
| [components/shared/QueryFormLayout.tsx](../frontend/src/components/shared/QueryFormLayout.tsx) | — |
| [components/shared/QueryPickerField.tsx](../frontend/src/components/shared/QueryPickerField.tsx) | — |
| [components/shared/ReceiptPanel.tsx](../frontend/src/components/shared/ReceiptPanel.tsx) | — |
| [components/shared/RecordIdentity.tsx](../frontend/src/components/shared/RecordIdentity.tsx) | — |
| [components/shared/ReportPanel.tsx](../frontend/src/components/shared/ReportPanel.tsx) | — |
| [components/shared/ReportTable.tsx](../frontend/src/components/shared/ReportTable.tsx) | — |
| [components/shared/SectionCard.tsx](../frontend/src/components/shared/SectionCard.tsx) | — |
| [components/shared/SettlementTypeField.tsx](../frontend/src/components/shared/SettlementTypeField.tsx) | — |
| [components/shared/ShippingProductField.tsx](../frontend/src/components/shared/ShippingProductField.tsx) | — |
| [components/shared/StatementPanel.tsx](../frontend/src/components/shared/StatementPanel.tsx) | — |
| [components/shared/StatusBadge.tsx](../frontend/src/components/shared/StatusBadge.tsx) | — |
| [components/shared/SummaryStrip.tsx](../frontend/src/components/shared/SummaryStrip.tsx) | — |
| [components/shared/SystemBrand.tsx](../frontend/src/components/shared/SystemBrand.tsx) | — |
| [components/shared/TabErrorBoundary.tsx](../frontend/src/components/shared/TabErrorBoundary.tsx) | — |
| [components/shared/TableActionsMenu.tsx](../frontend/src/components/shared/TableActionsMenu.tsx) | — |
| [components/shared/UserMenu.tsx](../frontend/src/components/shared/UserMenu.tsx) | DialogContent:135；DialogContent:174；DialogContent:200 |
| [components/shared/VirtualTableBody.tsx](../frontend/src/components/shared/VirtualTableBody.tsx) | — |
| [components/shared/WarehouseSelect.tsx](../frontend/src/components/shared/WarehouseSelect.tsx) | — |
| [components/shared/payments/CreateStatementDialog.tsx](../frontend/src/components/shared/payments/CreateStatementDialog.tsx) | AppDialog:72 |
| [components/shared/payments/ReceiptDetailDialog.tsx](../frontend/src/components/shared/payments/ReceiptDetailDialog.tsx) | AppDialog:35 |
| [components/shared/payments/RegisterPaymentDialog.tsx](../frontend/src/components/shared/payments/RegisterPaymentDialog.tsx) | AppDialog:87 |
| [components/shared/payments/SettleReceiptDialog.tsx](../frontend/src/components/shared/payments/SettleReceiptDialog.tsx) | AppDialog:177 |
| [components/shared/payments/SettlementConfirmDialog.tsx](../frontend/src/components/shared/payments/SettlementConfirmDialog.tsx) | AppDialog:39 |
| [components/shared/payments/StatementDetailDialog.tsx](../frontend/src/components/shared/payments/StatementDetailDialog.tsx) | AppDialog:53 |
| [components/shared/productIdentityColumns.tsx](../frontend/src/components/shared/productIdentityColumns.tsx) | — |
| [components/shared/usePaymentActions.tsx](../frontend/src/components/shared/usePaymentActions.tsx) | DialogContent:84 |
| [components/ui/badge.tsx](../frontend/src/components/ui/badge.tsx) | — |
| [components/ui/button.tsx](../frontend/src/components/ui/button.tsx) | — |
| [components/ui/calendar.tsx](../frontend/src/components/ui/calendar.tsx) | — |
| [components/ui/dialog.tsx](../frontend/src/components/ui/dialog.tsx) | — |
| [components/ui/dropdown-menu.tsx](../frontend/src/components/ui/dropdown-menu.tsx) | — |
| [components/ui/input.tsx](../frontend/src/components/ui/input.tsx) | — |
| [components/ui/label.tsx](../frontend/src/components/ui/label.tsx) | — |
| [components/ui/popover.tsx](../frontend/src/components/ui/popover.tsx) | — |
| [components/ui/select.tsx](../frontend/src/components/ui/select.tsx) | — |
| [components/ui/sheet.tsx](../frontend/src/components/ui/sheet.tsx) | — |
| [layouts/AppLayout.tsx](../frontend/src/layouts/AppLayout.tsx) | — |
| [main.tsx](../frontend/src/main.tsx) | — |
| [pages/403/index.tsx](../frontend/src/pages/403/index.tsx) | — |
| [pages/accounting/accounts/index.tsx](../frontend/src/pages/accounting/accounts/index.tsx) | DialogContent:130；ConfirmDialog:454；ConfirmDialog:465 |
| [pages/accounting/consolidation/index.tsx](../frontend/src/pages/accounting/consolidation/index.tsx) | DialogContent:160 |
| [pages/accounting/invoices/index.tsx](../frontend/src/pages/accounting/invoices/index.tsx) | DialogContent:71；ConfirmDialog:174 |
| [pages/accounting/ledger/index.tsx](../frontend/src/pages/accounting/ledger/index.tsx) | DialogContent:26 |
| [pages/accounting/periods/index.tsx](../frontend/src/pages/accounting/periods/index.tsx) | DialogContent:132；DialogContent:147 |
| [pages/accounting/reports/index.tsx](../frontend/src/pages/accounting/reports/index.tsx) | — |
| [pages/accounting/tax/index.tsx](../frontend/src/pages/accounting/tax/index.tsx) | — |
| [pages/accounting/vouchers/VoucherQueryDialog.tsx](../frontend/src/pages/accounting/vouchers/VoucherQueryDialog.tsx) | AppDialog:38 |
| [pages/accounting/vouchers/index.tsx](../frontend/src/pages/accounting/vouchers/index.tsx) | DialogContent:93；DialogContent:125；DialogContent:211；ConfirmDialog:415；ConfirmDialog:424 |
| [pages/approvals/flows.tsx](../frontend/src/pages/approvals/flows.tsx) | DialogContent:188；ConfirmDialog:295 |
| [pages/approvals/pending.tsx](../frontend/src/pages/approvals/pending.tsx) | — |
| [pages/carrier-accounts/AccountBindingForm.tsx](../frontend/src/pages/carrier-accounts/AccountBindingForm.tsx) | ConfirmDialog:62 |
| [pages/carrier-accounts/NewAccountForm.tsx](../frontend/src/pages/carrier-accounts/NewAccountForm.tsx) | — |
| [pages/carrier-accounts/index.tsx](../frontend/src/pages/carrier-accounts/index.tsx) | ConfirmDialog:115 |
| [pages/carriers/index.tsx](../frontend/src/pages/carriers/index.tsx) | BaseCrudPage:83 |
| [pages/categories/index.tsx](../frontend/src/pages/categories/index.tsx) | DialogContent:113；ConfirmDialog:447；ConfirmDialog:459 |
| [pages/credit-overrides/CreditOverrideQueryDialog.tsx](../frontend/src/pages/credit-overrides/CreditOverrideQueryDialog.tsx) | AppDialog:43 |
| [pages/credit-overrides/index.tsx](../frontend/src/pages/credit-overrides/index.tsx) | DialogContent:54；DialogContent:258 |
| [pages/customers/components/CustomerFormDialog.tsx](../frontend/src/pages/customers/components/CustomerFormDialog.tsx) | DialogContent:70 |
| [pages/customers/index.tsx](../frontend/src/pages/customers/index.tsx) | ConfirmDialog:162；DialogContent:174 |
| [pages/dashboard/index.tsx](../frontend/src/pages/dashboard/index.tsx) | — |
| [pages/departments/index.tsx](../frontend/src/pages/departments/index.tsx) | DialogContent:271；ConfirmDialog:324 |
| [pages/disposal/DisposalQueryDialog.tsx](../frontend/src/pages/disposal/DisposalQueryDialog.tsx) | AppDialog:46 |
| [pages/disposal/components/CreateDisposalDialog.tsx](../frontend/src/pages/disposal/components/CreateDisposalDialog.tsx) | DialogContent:100 |
| [pages/disposal/components/DisposalDetailDialog.tsx](../frontend/src/pages/disposal/components/DisposalDetailDialog.tsx) | DialogContent:54；DialogContent:149 |
| [pages/disposal/index.tsx](../frontend/src/pages/disposal/index.tsx) | — |
| [pages/finance/accounts/index.tsx](../frontend/src/pages/finance/accounts/index.tsx) | DialogContent:50；DialogContent:243；DialogContent:300；DialogContent:348；ConfirmDialog:386 |
| [pages/finance/dashboard/index.tsx](../frontend/src/pages/finance/dashboard/index.tsx) | — |
| [pages/finance/expense-categories/index.tsx](../frontend/src/pages/finance/expense-categories/index.tsx) | BaseCrudPage:30 |
| [pages/finance/expenses/index.tsx](../frontend/src/pages/finance/expenses/index.tsx) | DialogContent:59；DialogContent:291；DialogContent:356；DialogContent:403；DialogContent:445 |
| [pages/finance/transactions/index.tsx](../frontend/src/pages/finance/transactions/index.tsx) | DialogContent:52 |
| [pages/fixed-assets/index.tsx](../frontend/src/pages/fixed-assets/index.tsx) | DialogContent:43；DialogContent:109 |
| [pages/inbound-tasks/InboundTaskQueryDialog.tsx](../frontend/src/pages/inbound-tasks/InboundTaskQueryDialog.tsx) | AppDialog:66 |
| [pages/inbound-tasks/PurchaseItemPickerDialog.tsx](../frontend/src/pages/inbound-tasks/PurchaseItemPickerDialog.tsx) | AppDialog:70 |
| [pages/inbound-tasks/create.tsx](../frontend/src/pages/inbound-tasks/create.tsx) | — |
| [pages/inbound-tasks/detail.tsx](../frontend/src/pages/inbound-tasks/detail.tsx) | ConfirmDialog:276；ConfirmDialog:297；ConfirmDialog:327 |
| [pages/inbound-tasks/index.tsx](../frontend/src/pages/inbound-tasks/index.tsx) | ConfirmDialog:442 |
| [pages/inventory/InventoryLogsQueryDialog.tsx](../frontend/src/pages/inventory/InventoryLogsQueryDialog.tsx) | AppDialog:48 |
| [pages/inventory/InventoryOverviewQueryDialog.tsx](../frontend/src/pages/inventory/InventoryOverviewQueryDialog.tsx) | AppDialog:35 |
| [pages/inventory/index.tsx](../frontend/src/pages/inventory/index.tsx) | DialogContent:390；DialogContent:418 |
| [pages/inventory/trace.tsx](../frontend/src/pages/inventory/trace.tsx) | — |
| [pages/landing-preview/BusinessStory.tsx](../frontend/src/pages/landing-preview/BusinessStory.tsx) | — |
| [pages/landing-preview/ProductDemo.tsx](../frontend/src/pages/landing-preview/ProductDemo.tsx) | — |
| [pages/landing-preview/index.tsx](../frontend/src/pages/landing-preview/index.tsx) | — |
| [pages/landing/BusinessStory.tsx](../frontend/src/pages/landing/BusinessStory.tsx) | — |
| [pages/landing/ProductDemo.tsx](../frontend/src/pages/landing/ProductDemo.tsx) | — |
| [pages/landing/index.tsx](../frontend/src/pages/landing/index.tsx) | — |
| [pages/locations/LocationQueryDialog.tsx](../frontend/src/pages/locations/LocationQueryDialog.tsx) | AppDialog:45 |
| [pages/locations/index.tsx](../frontend/src/pages/locations/index.tsx) | BaseCrudPage:137 |
| [pages/login/index.tsx](../frontend/src/pages/login/index.tsx) | — |
| [pages/logistics/DirectShipmentDialog.tsx](../frontend/src/pages/logistics/DirectShipmentDialog.tsx) | DialogContent:35 |
| [pages/logistics/WaybillQueryDialog.tsx](../frontend/src/pages/logistics/WaybillQueryDialog.tsx) | AppDialog:53 |
| [pages/logistics/components/TrackTimeline.tsx](../frontend/src/pages/logistics/components/TrackTimeline.tsx) | — |
| [pages/logistics/detail.tsx](../frontend/src/pages/logistics/detail.tsx) | DialogContent:151 |
| [pages/logistics/freight-reconciliation.tsx](../frontend/src/pages/logistics/freight-reconciliation.tsx) | DialogContent:140 |
| [pages/logistics/index.tsx](../frontend/src/pages/logistics/index.tsx) | DialogContent:179 |
| [pages/oplogs/OpLogQueryDialog.tsx](../frontend/src/pages/oplogs/OpLogQueryDialog.tsx) | AppDialog:43 |
| [pages/oplogs/index.tsx](../frontend/src/pages/oplogs/index.tsx) | ConfirmDialog:209；DialogContent:219 |
| [pages/payments/PaymentsView.tsx](../frontend/src/pages/payments/PaymentsView.tsx) | — |
| [pages/payments/party-ledger.tsx](../frontend/src/pages/payments/party-ledger.tsx) | DialogContent:48 |
| [pages/payments/payable.tsx](../frontend/src/pages/payments/payable.tsx) | — |
| [pages/payments/receivable.tsx](../frontend/src/pages/payments/receivable.tsx) | — |
| [pages/permissions/index.tsx](../frontend/src/pages/permissions/index.tsx) | DialogContent:50；DialogContent:102；ConfirmDialog:266 |
| [pages/picking-waves/WaveQueryDialog.tsx](../frontend/src/pages/picking-waves/WaveQueryDialog.tsx) | AppDialog:45 |
| [pages/picking-waves/index.tsx](../frontend/src/pages/picking-waves/index.tsx) | DialogContent:263 |
| [pages/plastic-boxes/index.tsx](../frontend/src/pages/plastic-boxes/index.tsx) | BaseCrudPage:54；DialogContent:154 |
| [pages/portal/purchase-status.tsx](../frontend/src/pages/portal/purchase-status.tsx) | — |
| [pages/portal/statements.tsx](../frontend/src/pages/portal/statements.tsx) | — |
| [pages/price-change/index.tsx](../frontend/src/pages/price-change/index.tsx) | DialogContent:176；DialogContent:219；ConfirmDialog:232 |
| [pages/procurement/detail.tsx](../frontend/src/pages/procurement/detail.tsx) | — |
| [pages/procurement/index.tsx](../frontend/src/pages/procurement/index.tsx) | DialogContent:88 |
| [pages/products/ProductQueryDialog.tsx](../frontend/src/pages/products/ProductQueryDialog.tsx) | AppDialog:43 |
| [pages/products/form.tsx](../frontend/src/pages/products/form.tsx) | — |
| [pages/products/index.tsx](../frontend/src/pages/products/index.tsx) | DialogContent:228；ConfirmDialog:263 |
| [pages/purchase-requisitions/RequisitionQueryDialog.tsx](../frontend/src/pages/purchase-requisitions/RequisitionQueryDialog.tsx) | AppDialog:52 |
| [pages/purchase-requisitions/form.tsx](../frontend/src/pages/purchase-requisitions/form.tsx) | DialogContent:377；DialogContent:392 |
| [pages/purchase-requisitions/index.tsx](../frontend/src/pages/purchase-requisitions/index.tsx) | — |
| [pages/purchase/PurchaseQueryDialog.tsx](../frontend/src/pages/purchase/PurchaseQueryDialog.tsx) | AppDialog:65 |
| [pages/purchase/form/index.tsx](../frontend/src/pages/purchase/form/index.tsx) | ConfirmDialog:740；DialogContent:756 |
| [pages/purchase/index.tsx](../frontend/src/pages/purchase/index.tsx) | ConfirmDialog:368；DialogContent:389 |
| [pages/racks/RackQueryDialog.tsx](../frontend/src/pages/racks/RackQueryDialog.tsx) | AppDialog:37 |
| [pages/racks/index.tsx](../frontend/src/pages/racks/index.tsx) | BaseCrudPage:145 |
| [pages/refunds/RefundQueryDialog.tsx](../frontend/src/pages/refunds/RefundQueryDialog.tsx) | AppDialog:42 |
| [pages/refunds/components/RefundDetailDialog.tsx](../frontend/src/pages/refunds/components/RefundDetailDialog.tsx) | DialogContent:51 |
| [pages/refunds/index.tsx](../frontend/src/pages/refunds/index.tsx) | DialogContent:182 |
| [pages/reports/InventoryAgingQueryDialog.tsx](../frontend/src/pages/reports/InventoryAgingQueryDialog.tsx) | AppDialog:34 |
| [pages/reports/ReconciliationView.tsx](../frontend/src/pages/reports/ReconciliationView.tsx) | — |
| [pages/reports/ReplenishmentQueryDialog.tsx](../frontend/src/pages/reports/ReplenishmentQueryDialog.tsx) | AppDialog:34 |
| [pages/reports/ReportQueryFeedback.tsx](../frontend/src/pages/reports/ReportQueryFeedback.tsx) | — |
| [pages/reports/avg-cost-reconciliation.tsx](../frontend/src/pages/reports/avg-cost-reconciliation.tsx) | — |
| [pages/reports/index.tsx](../frontend/src/pages/reports/index.tsx) | — |
| [pages/reports/inventory-aging.tsx](../frontend/src/pages/reports/inventory-aging.tsx) | — |
| [pages/reports/kpi.tsx](../frontend/src/pages/reports/kpi.tsx) | — |
| [pages/reports/pda-anomaly.tsx](../frontend/src/pages/reports/pda-anomaly.tsx) | — |
| [pages/reports/profit-analysis.tsx](../frontend/src/pages/reports/profit-analysis.tsx) | — |
| [pages/reports/reconciliation-payable.tsx](../frontend/src/pages/reports/reconciliation-payable.tsx) | — |
| [pages/reports/reconciliation-receivable.tsx](../frontend/src/pages/reports/reconciliation-receivable.tsx) | — |
| [pages/reports/replenishment.tsx](../frontend/src/pages/reports/replenishment.tsx) | DialogContent:245 |
| [pages/reports/role-workbench.tsx](../frontend/src/pages/reports/role-workbench.tsx) | — |
| [pages/reports/warehouse-ops.tsx](../frontend/src/pages/reports/warehouse-ops.tsx) | — |
| [pages/reports/wave-performance.tsx](../frontend/src/pages/reports/wave-performance.tsx) | — |
| [pages/returns/ReturnQueryDialog.tsx](../frontend/src/pages/returns/ReturnQueryDialog.tsx) | AppDialog:67 |
| [pages/returns/index.tsx](../frontend/src/pages/returns/index.tsx) | ConfirmDialog:285 |
| [pages/returns/purchase/form/index.tsx](../frontend/src/pages/returns/purchase/form/index.tsx) | ConfirmDialog:595；ConfirmDialog:604 |
| [pages/returns/sale/form/index.tsx](../frontend/src/pages/returns/sale/form/index.tsx) | ConfirmDialog:603；ConfirmDialog:612 |
| [pages/sale/SaleQueryDialog.tsx](../frontend/src/pages/sale/SaleQueryDialog.tsx) | AppDialog:64 |
| [pages/sale/components/AddressBookDialog.tsx](../frontend/src/pages/sale/components/AddressBookDialog.tsx) | AppDialog:124 |
| [pages/sale/components/ReleaseAllocationDialog.tsx](../frontend/src/pages/sale/components/ReleaseAllocationDialog.tsx) | DialogContent:70 |
| [pages/sale/components/ReserveAllocationDialog.tsx](../frontend/src/pages/sale/components/ReserveAllocationDialog.tsx) | DialogContent:121 |
| [pages/sale/components/SaleOrderPreview.tsx](../frontend/src/pages/sale/components/SaleOrderPreview.tsx) | Dialog.Content:49 |
| [pages/sale/components/SaleRowActions.tsx](../frontend/src/pages/sale/components/SaleRowActions.tsx) | — |
| [pages/sale/components/ShipSelectDialog.tsx](../frontend/src/pages/sale/components/ShipSelectDialog.tsx) | DialogContent:50 |
| [pages/sale/components/StockShortageDialog.tsx](../frontend/src/pages/sale/components/StockShortageDialog.tsx) | DialogContent:17 |
| [pages/sale/form/components/FulfillmentProgressCard.tsx](../frontend/src/pages/sale/form/components/FulfillmentProgressCard.tsx) | — |
| [pages/sale/form/components/SaleOrderHeaderFields.tsx](../frontend/src/pages/sale/form/components/SaleOrderHeaderFields.tsx) | — |
| [pages/sale/form/components/SaleOrderItemsSection.tsx](../frontend/src/pages/sale/form/components/SaleOrderItemsSection.tsx) | — |
| [pages/sale/form/components/SaleOrderItemsTable.tsx](../frontend/src/pages/sale/form/components/SaleOrderItemsTable.tsx) | — |
| [pages/sale/form/components/SaleOrderOverview.tsx](../frontend/src/pages/sale/form/components/SaleOrderOverview.tsx) | — |
| [pages/sale/form/components/SaleOrderSummaryCard.tsx](../frontend/src/pages/sale/form/components/SaleOrderSummaryCard.tsx) | — |
| [pages/sale/form/index.tsx](../frontend/src/pages/sale/form/index.tsx) | ConfirmDialog:856 |
| [pages/sale/index.tsx](../frontend/src/pages/sale/index.tsx) | ConfirmDialog:288 |
| [pages/settings/barcode-print-query/BarcodePrintQueryDialog.tsx](../frontend/src/pages/settings/barcode-print-query/BarcodePrintQueryDialog.tsx) | AppDialog:36 |
| [pages/settings/barcode-print-query/index.tsx](../frontend/src/pages/settings/barcode-print-query/index.tsx) | — |
| [pages/settings/index.tsx](../frontend/src/pages/settings/index.tsx) | — |
| [pages/settings/pda-devices/index.tsx](../frontend/src/pages/settings/pda-devices/index.tsx) | DialogContent:172；DialogContent:218；DialogContent:259；ConfirmDialog:306 |
| [pages/settings/print-templates/editor.tsx](../frontend/src/pages/settings/print-templates/editor.tsx) | — |
| [pages/settings/print-templates/index.tsx](../frontend/src/pages/settings/print-templates/index.tsx) | ConfirmDialog:89 |
| [pages/settings/printers/index.tsx](../frontend/src/pages/settings/printers/index.tsx) | DialogContent:76；DialogContent:382；ConfirmDialog:468 |
| [pages/sorting-bins/SortingBinQueryDialog.tsx](../frontend/src/pages/sorting-bins/SortingBinQueryDialog.tsx) | AppDialog:39 |
| [pages/sorting-bins/index.tsx](../frontend/src/pages/sorting-bins/index.tsx) | DialogContent:55；BaseCrudPage:164；ConfirmDialog:267 |
| [pages/stockcheck/abc.tsx](../frontend/src/pages/stockcheck/abc.tsx) | — |
| [pages/stockcheck/components/CheckDetailDialog.tsx](../frontend/src/pages/stockcheck/components/CheckDetailDialog.tsx) | DialogContent:172；ConfirmDialog:275；ConfirmDialog:284 |
| [pages/stockcheck/index.tsx](../frontend/src/pages/stockcheck/index.tsx) | DialogContent:88 |
| [pages/suppliers/index.tsx](../frontend/src/pages/suppliers/index.tsx) | BaseCrudPage:98 |
| [pages/transfer/TransferQueryDialog.tsx](../frontend/src/pages/transfer/TransferQueryDialog.tsx) | AppDialog:61 |
| [pages/transfer/form/index.tsx](../frontend/src/pages/transfer/form/index.tsx) | ConfirmDialog:505 |
| [pages/transfer/index.tsx](../frontend/src/pages/transfer/index.tsx) | ConfirmDialog:263；AppDialog:273 |
| [pages/users/components/ResetPasswordDialog.tsx](../frontend/src/pages/users/components/ResetPasswordDialog.tsx) | DialogContent:37 |
| [pages/users/components/UserFormDialog.tsx](../frontend/src/pages/users/components/UserFormDialog.tsx) | DialogContent:102 |
| [pages/users/components/WarehouseScopeDialog.tsx](../frontend/src/pages/users/components/WarehouseScopeDialog.tsx) | DialogContent:34 |
| [pages/users/index.tsx](../frontend/src/pages/users/index.tsx) | ConfirmDialog:186 |
| [pages/warehouse-structure/index.tsx](../frontend/src/pages/warehouse-structure/index.tsx) | — |
| [pages/warehouses/index.tsx](../frontend/src/pages/warehouses/index.tsx) | BaseCrudPage:70 |
| [router/PdaAuthRoutes.tsx](../frontend/src/router/PdaAuthRoutes.tsx) | — |
| [router/index.tsx](../frontend/src/router/index.tsx) | — |
| [router/pda.tsx](../frontend/src/router/pda.tsx) | — |
| [router/pdaRoutes.tsx](../frontend/src/router/pdaRoutes.tsx) | — |
