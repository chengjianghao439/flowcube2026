const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  ADMIN_PUTAWAY_EXECUTE: 'admin.putaway.execute',
  IMPORT_PRODUCT_EXECUTE: 'import.product.execute',
  IMPORT_STOCK_EXECUTE: 'import.stock.execute',

  PRODUCT_VIEW: 'product.view',
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  PRODUCT_PRINT_LABEL: 'product.print_label',

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

  PRICE_LIST_VIEW: 'price.list.view',
  PRICE_LIST_CREATE: 'price.list.create',
  PRICE_LIST_UPDATE: 'price.list.update',
  PRICE_LIST_DELETE: 'price.list.delete',

  PURCHASE_ORDER_VIEW: 'purchase.order.view',
  PURCHASE_ORDER_CREATE: 'purchase.order.create',
  PURCHASE_ORDER_CONFIRM: 'purchase.order.confirm',
  PURCHASE_ORDER_CANCEL: 'purchase.order.cancel',

  INBOUND_ORDER_VIEW: 'inbound.order.view',
  INBOUND_ORDER_CREATE: 'inbound.order.create',
  INBOUND_ORDER_SUBMIT: 'inbound.order.submit',
  INBOUND_ORDER_AUDIT: 'inbound.order.audit',
  INBOUND_ORDER_CANCEL: 'inbound.order.cancel',
  INBOUND_RECEIVE_EXECUTE: 'inbound.receive.execute',
  INBOUND_PUTAWAY_EXECUTE: 'inbound.putaway.execute',
  INBOUND_PRINT_REPRINT: 'inbound.print.reprint',

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

  TRANSFER_ORDER_VIEW: 'transfer.order.view',
  TRANSFER_ORDER_CREATE: 'transfer.order.create',
  TRANSFER_ORDER_CONFIRM: 'transfer.order.confirm',
  TRANSFER_ORDER_EXECUTE: 'transfer.order.execute',
  TRANSFER_ORDER_CANCEL: 'transfer.order.cancel',

  SALE_ORDER_VIEW: 'sale.order.view',
  SALE_ORDER_CREATE: 'sale.order.create',
  SALE_ORDER_UPDATE: 'sale.order.update',
  SALE_ORDER_RESERVE: 'sale.order.reserve',
  SALE_ORDER_RELEASE: 'sale.order.release',
  SALE_ORDER_SHIP: 'sale.order.ship',
  SALE_ORDER_CANCEL: 'sale.order.cancel',
  SALE_ORDER_DELETE: 'sale.order.delete',

  RETURN_ORDER_VIEW: 'return.order.view',
  RETURN_ORDER_CREATE: 'return.order.create',
  RETURN_ORDER_CONFIRM: 'return.order.confirm',
  RETURN_ORDER_EXECUTE: 'return.order.execute',
  RETURN_ORDER_CANCEL: 'return.order.cancel',

  PAYMENT_VIEW: 'payment.view',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_EXECUTE: 'payment.execute',

  WAREHOUSE_TASK_VIEW: 'warehouse.task.view',
  WAREHOUSE_TASK_ASSIGN: 'warehouse.task.assign',
  WAREHOUSE_TASK_PICK: 'warehouse.task.pick',
  WAREHOUSE_TASK_CHECK: 'warehouse.task.check',
  WAREHOUSE_TASK_PACK: 'warehouse.task.pack',
  WAREHOUSE_TASK_SHIP: 'warehouse.task.ship',
  WAREHOUSE_TASK_DEBUG: 'warehouse.task.debug',

  PICKING_WAVE_VIEW: 'picking.wave.view',
  PICKING_WAVE_MANAGE: 'picking.wave.manage',

  SORTING_BIN_VIEW: 'sorting.bin.view',
  SORTING_BIN_MANAGE: 'sorting.bin.manage',

  SCAN_LOG_VIEW: 'scan.log.view',
  SCAN_LOG_CREATE: 'scan.log.create',

  REPORT_VIEW: 'report.view',

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

  AUDIT_LOG_VIEW: 'audit.log.view',
  AUDIT_LOG_CLEAR: 'audit.log.clear',
}

module.exports = { PERMISSIONS }
