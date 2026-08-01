const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  SYSTEM_HEALTH_VIEW: 'system.health.view',
  SYSTEM_HEALTH_AUTOFIX: 'system.health.autofix',
  ADMIN_PUTAWAY_EXECUTE: 'admin.putaway.execute',
  IMPORT_PRODUCT_EXECUTE: 'import.product.execute',
  IMPORT_STOCK_EXECUTE: 'import.stock.execute',

  PRODUCT_VIEW: 'product.view',
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  PRODUCT_PRINT_LABEL: 'product.print_label',

  // 序列号管理（个体制：收货逐台登记、出库逐台核销、追溯，文档 04）。
  SERIAL_VIEW: 'serial.view',
  SERIAL_MANAGE: 'serial.manage',

  CATEGORY_VIEW: 'category.view',
  CATEGORY_CREATE: 'category.create',
  CATEGORY_UPDATE: 'category.update',
  CATEGORY_DELETE: 'category.delete',

  WAREHOUSE_VIEW: 'warehouse.view',
  WAREHOUSE_CREATE: 'warehouse.create',
  WAREHOUSE_UPDATE: 'warehouse.update',
  WAREHOUSE_DELETE: 'warehouse.delete',

  LOCATION_VIEW: 'location.view',
  LOCATION_CREATE: 'location.create',
  LOCATION_UPDATE: 'location.update',
  LOCATION_DELETE: 'location.delete',

  RACK_VIEW: 'rack.view',
  RACK_CREATE: 'rack.create',
  RACK_UPDATE: 'rack.update',
  RACK_DELETE: 'rack.delete',
  RACK_PRINT_LABEL: 'rack.print_label',

  SUPPLIER_VIEW: 'supplier.view',
  SUPPLIER_CREATE: 'supplier.create',
  SUPPLIER_UPDATE: 'supplier.update',
  SUPPLIER_DELETE: 'supplier.delete',

  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_UPDATE: 'customer.update',
  CUSTOMER_DELETE: 'customer.delete',

  CARRIER_VIEW: 'carrier.view',
  CARRIER_CREATE: 'carrier.create',
  CARRIER_UPDATE: 'carrier.update',
  CARRIER_DELETE: 'carrier.delete',

  // 物流运单（电子面单：取号 / 轨迹 / 运费对账，文档 06）。
  // freight.reconcile 直接产生对承运商的应付=钱，单列并只授予财务。
  LOGISTICS_VIEW: 'logistics.view',
  LOGISTICS_MANAGE: 'logistics.manage',
  LOGISTICS_FREIGHT_RECONCILE: 'logistics.freight.reconcile',

  PRICE_LIST_VIEW: 'price.list.view',
  PRICE_LIST_CREATE: 'price.list.create',
  PRICE_LIST_UPDATE: 'price.list.update',
  PRICE_LIST_DELETE: 'price.list.delete',

  PURCHASE_ORDER_VIEW: 'purchase.order.view',
  PURCHASE_ORDER_CREATE: 'purchase.order.create',
  PURCHASE_ORDER_CONFIRM: 'purchase.order.confirm',
  PURCHASE_ORDER_CANCEL: 'purchase.order.cancel',

  // 采购请购单（PR → 审批 → 转采购单）。APPROVE 是内控点，刻意不 seed（见 153 迁移）。
  PURCHASE_REQUISITION_VIEW: 'purchase.requisition.view',
  PURCHASE_REQUISITION_CREATE: 'purchase.requisition.create',
  PURCHASE_REQUISITION_APPROVE: 'purchase.requisition.approve',
  PURCHASE_REQUISITION_CONVERT: 'purchase.requisition.convert',

  INBOUND_ORDER_VIEW: 'inbound.order.view',
  INBOUND_ORDER_CREATE: 'inbound.order.create',
  INBOUND_ORDER_SUBMIT: 'inbound.order.submit',
  INBOUND_ORDER_CANCEL: 'inbound.order.cancel',
  INBOUND_RECEIVE_EXECUTE: 'inbound.receive.execute',
  INBOUND_PUTAWAY_EXECUTE: 'inbound.putaway.execute',
  INBOUND_PRINT_REPRINT: 'inbound.print.reprint',
  INBOUND_QA_DISPOSE: 'inbound.qa.dispose',

  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_CONTAINER_MOVE: 'inventory.container.move',
  INVENTORY_CONTAINER_SPLIT: 'inventory.container.split',
  INVENTORY_TRACE_VIEW: 'inventory.trace.view',

  STOCKCHECK_VIEW: 'stockcheck.view',
  STOCKCHECK_CREATE: 'stockcheck.create',
  STOCKCHECK_UPDATE: 'stockcheck.update',
  STOCKCHECK_SUBMIT: 'stockcheck.submit',
  STOCKCHECK_CANCEL: 'stockcheck.cancel',

  // 循环盘点 ABC 分类与频率规则（配置类操作独立控权）
  STOCKCHECK_ABC_VIEW: 'stockcheck.abc.view',
  STOCKCHECK_ABC_MANAGE: 'stockcheck.abc.manage',

  TRANSFER_ORDER_VIEW: 'transfer.order.view',
  TRANSFER_ORDER_CREATE: 'transfer.order.create',
  TRANSFER_ORDER_CONFIRM: 'transfer.order.confirm',
  TRANSFER_ORDER_EXECUTE: 'transfer.order.execute',
  TRANSFER_ORDER_CANCEL: 'transfer.order.cancel',
  TRANSFER_ORDER_FORCE_CLOSE: 'transfer.order.force-close',

  SALE_ORDER_VIEW: 'sale.order.view',
  SALE_ORDER_CREATE: 'sale.order.create',
  SALE_ORDER_UPDATE: 'sale.order.update',
  SALE_ORDER_RESERVE: 'sale.order.reserve',
  SALE_ORDER_RELEASE: 'sale.order.release',
  SALE_ORDER_SHIP: 'sale.order.ship',
  SALE_ORDER_CANCEL: 'sale.order.cancel',
  SALE_ORDER_DELETE: 'sale.order.delete',

  // 客户授信：view 看用信、manage 调额度(财务风控)、override 超额一次性放行(销售)。敏感，override 服务端校验。
  SALE_CREDIT_VIEW: 'sale.credit.view',
  SALE_CREDIT_MANAGE: 'sale.credit.manage',
  SALE_CREDIT_OVERRIDE: 'sale.credit.override',

  RETURN_ORDER_VIEW: 'return.order.view',
  RETURN_ORDER_CREATE: 'return.order.create',
  RETURN_ORDER_CONFIRM: 'return.order.confirm',
  RETURN_ORDER_EXECUTE: 'return.order.execute',
  RETURN_ORDER_CANCEL: 'return.order.cancel',

  PAYMENT_VIEW: 'payment.view',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_EXECUTE: 'payment.execute',
  // 应付结算财务确认。刻意不 seed 给任何角色（超管硬编码豁免可用），
  // 由产品在权限管理页手动开放给财务角色——与 TRANSFER_ORDER_FORCE_CLOSE 同先例。
  PAYMENT_CONFIRM: 'payment.confirm',

  // 资金账户。ADJUST 能直接改变账面余额（补差额流水），敏感度等同 PAYMENT_CONFIRM，
  // 同样不 seed 给普通角色，由产品在权限管理页手动开放。
  FINANCE_ACCOUNT_VIEW: 'finance.account.view',
  FINANCE_ACCOUNT_CREATE: 'finance.account.create',
  FINANCE_ACCOUNT_UPDATE: 'finance.account.update',
  FINANCE_ACCOUNT_DELETE: 'finance.account.delete',
  FINANCE_ACCOUNT_ADJUST: 'finance.account.adjust',

  // 费用报销。APPROVE 与 PAY 是内控的两道口子，同样不 seed 给普通角色。
  FINANCE_EXPENSE_VIEW: 'finance.expense.view',
  FINANCE_EXPENSE_CREATE: 'finance.expense.create',
  FINANCE_EXPENSE_UPDATE: 'finance.expense.update',
  FINANCE_EXPENSE_APPROVE: 'finance.expense.approve',
  FINANCE_EXPENSE_PAY: 'finance.expense.pay',
  FINANCE_EXPENSE_CATEGORY_MANAGE: 'finance.expense.category.manage',
  // 见全部报销：无此权限者(超管 role_id=1 走 roleId 豁免恒有)列表只能看自己提交的单。
  FINANCE_EXPENSE_VIEW_ALL: 'finance.expense.view.all',

  WAREHOUSE_TASK_VIEW: 'warehouse.task.view',
  WAREHOUSE_TASK_ASSIGN: 'warehouse.task.assign',
  WAREHOUSE_TASK_PICK: 'warehouse.task.pick',
  WAREHOUSE_TASK_CHECK: 'warehouse.task.check',
  WAREHOUSE_TASK_PACK: 'warehouse.task.pack',
  WAREHOUSE_TASK_SORT: 'warehouse.task.sort',
  WAREHOUSE_TASK_CHECK_DONE: 'warehouse.task.check_done',
  WAREHOUSE_TASK_PACK_DONE: 'warehouse.task.pack_done',
  WAREHOUSE_TASK_SHIP: 'warehouse.task.ship',
  WAREHOUSE_TASK_CANCEL: 'warehouse.task.cancel',
  WAREHOUSE_TASK_CANCEL_RETURN: 'warehouse.task.cancel_return',
  WAREHOUSE_TASK_CANCEL_RETURN_VIEW: 'warehouse.task.cancel_return.view',
  WAREHOUSE_TASK_ADJUST: 'warehouse.task.adjust',
  WAREHOUSE_TASK_ADJUST_VIEW: 'warehouse.task.adjust.view',
  WAREHOUSE_TASK_PRIORITY: 'warehouse.task.priority',
  WAREHOUSE_TASK_DEBUG: 'warehouse.task.debug',

  PICKING_WAVE_VIEW: 'picking.wave.view',
  PICKING_WAVE_MANAGE: 'picking.wave.manage',

  SORTING_BIN_VIEW: 'sorting.bin.view',
  SORTING_BIN_MANAGE: 'sorting.bin.manage',

  SCAN_LOG_VIEW: 'scan.log.view',
  SCAN_LOG_CREATE: 'scan.log.create',

  REPORT_VIEW: 'report.view',

  // 采购计划（文档 11 单据化）：生成/编辑/转采购涉写，独立控权；转采购动作复用 PURCHASE_ORDER_CREATE
  PROCUREMENT_PLAN_VIEW: 'procurement.plan.view',
  PROCUREMENT_PLAN_MANAGE: 'procurement.plan.manage',

  // 会计核算（文档 10）。会计凭证/科目是敏感数据，只授财务，不走「登录即可」例外。
  // account.* 管科目表（Phase0）；voucher.* 管记账凭证（Phase1）；后续 ledger.* 再单列。
  ACCOUNTING_ACCOUNT_VIEW: 'accounting.account.view',
  ACCOUNTING_ACCOUNT_MANAGE: 'accounting.account.manage',
  ACCOUNTING_VOUCHER_VIEW: 'accounting.voucher.view',
  ACCOUNTING_VOUCHER_MANAGE: 'accounting.voucher.manage',   // 生成本期凭证 / 手工凭证 / 冲销
  ACCOUNTING_VOUCHER_EXPORT: 'accounting.voucher.export',   // 导出金蝶/用友模板
  ACCOUNTING_LEDGER_VIEW: 'accounting.ledger.view',         // 总账/明细账/试算平衡/三大报表（Phase2）

  // 发票管理（文档 10 · Phase 3）。进项/销项发票池 + 认证抵扣，敏感只授财务。
  INVOICE_VIEW: 'invoice.view',
  INVOICE_MANAGE: 'invoice.manage',

  USER_VIEW: 'user.view',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_RESET_PASSWORD: 'user.reset_password',
  USER_DELETE: 'user.delete',

  ROLE_VIEW: 'role.view',
  ROLE_ASSIGN: 'role.assign',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_UPDATE: 'settings.update',

  PRINT_JOB_VIEW: 'print.job.view',
  PRINT_JOB_CREATE: 'print.job.create',
  PRINT_JOB_REPRINT: 'print.job.reprint',
  PRINT_JOB_RETRY: 'print.job.retry',
  PRINT_CLIENT_CONSUME: 'print.client.consume',

  PRINT_TEMPLATE_VIEW: 'print.template.view',
  PRINT_TEMPLATE_MANAGE: 'print.template.manage',

  PRINT_PRINTER_VIEW: 'print.printer.view',
  PRINT_PRINTER_MANAGE: 'print.printer.manage',
  PDA_DEVICE_VIEW: 'pda.device.view',
  PDA_DEVICE_MANAGE: 'pda.device.manage',

  AUDIT_LOG_VIEW: 'audit.log.view',
  AUDIT_LOG_CLEAR: 'audit.log.clear',
}

module.exports = { PERMISSIONS }
