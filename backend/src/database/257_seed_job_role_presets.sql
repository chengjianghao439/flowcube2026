-- 常用岗位预置角色。只插入新编码，不覆盖管理员已修改的角色或权限。
-- 授予权限前核对系统预置标记；已有同编码自定义角色不会被追加权限。
START TRANSACTION;
CREATE TEMPORARY TABLE new_job_role_presets (code VARCHAR(50) PRIMARY KEY) ENGINE=MEMORY;
INSERT INTO new_job_role_presets (code)
SELECT preset.code FROM (
  SELECT 'preset_warehouse_operator' AS code UNION ALL
  SELECT 'preset_stock_controller' UNION ALL
  SELECT 'preset_purchase_manager' UNION ALL
  SELECT 'preset_sales_manager' UNION ALL
  SELECT 'preset_finance_specialist' UNION ALL
  SELECT 'preset_accountant' UNION ALL
  SELECT 'preset_customer_service'
) AS preset
WHERE NOT EXISTS (SELECT 1 FROM sys_roles existing WHERE existing.code = preset.code);

INSERT IGNORE INTO sys_roles (code, name, remark, is_system) VALUES
  ('preset_warehouse_operator', '仓库作业员', '系统预置岗位：收货、上架、拣货、复核与打包', 1),
  ('preset_stock_controller', '库存专员', '系统预置岗位：库存查询与盘点管理', 1),
  ('preset_purchase_manager', '采购主管', '系统预置岗位：采购计划、请购与采购审批', 1),
  ('preset_sales_manager', '销售主管', '系统预置岗位：销售单、客户与销售退货管理', 1),
  ('preset_finance_specialist', '财务专员', '系统预置岗位：收付款、费用与发票日常处理', 1),
  ('preset_accountant', '会计', '系统预置岗位：会计科目、凭证与账簿', 1),
  ('preset_customer_service', '客服专员', '系统预置岗位：客户、订单与物流查询', 1);

INSERT IGNORE INTO sys_role_permissions (role_id, permission)
SELECT r.id, grants.permission
FROM (
  SELECT 'preset_warehouse_operator' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'location.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'rack.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'product.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'inventory.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'inbound.order.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'inbound.receive.execute' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'inbound.putaway.execute' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.pick' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.sort' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.check' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.check_done' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.pack' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'warehouse.task.pack_done' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'scan.log.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'scan.log.create' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'print.job.view' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'print.job.create' AS permission
  UNION ALL
  SELECT 'preset_warehouse_operator' AS code, 'print.job.reprint' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'warehouse.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'location.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'rack.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'product.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'inventory.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'inventory.trace.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'stockcheck.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'stockcheck.create' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'stockcheck.update' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'stockcheck.submit' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'stockcheck.cancel' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'stockcheck.abc.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'transfer.order.view' AS permission
  UNION ALL
  SELECT 'preset_stock_controller' AS code, 'report.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'supplier.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'supplier.create' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'supplier.update' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'product.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'category.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'warehouse.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.requisition.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.requisition.approve' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.requisition.convert' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.order.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.order.create' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.order.confirm' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.order.cancel' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'purchase.order.approve' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'procurement.plan.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'procurement.plan.manage' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'inbound.order.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'inbound.order.create' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'inbound.order.submit' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'inbound.order.cancel' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'report.view' AS permission
  UNION ALL
  SELECT 'preset_purchase_manager' AS code, 'approval.task.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'customer.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'customer.create' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'customer.update' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'carrier.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'product.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'warehouse.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'price.list.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.create' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.update' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.reserve' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.release' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.ship' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.order.cancel' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.credit.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'sale.credit.override.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'return.order.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'return.order.create' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'return.order.confirm' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'return.order.cancel' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'report.view' AS permission
  UNION ALL
  SELECT 'preset_sales_manager' AS code, 'approval.task.view' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'payment.view' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'payment.create' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'payment.execute' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'finance.account.view' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'finance.expense.view' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'finance.expense.create' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'finance.expense.update' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'finance.expense.view.all' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'invoice.view' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'invoice.manage' AS permission
  UNION ALL
  SELECT 'preset_finance_specialist' AS code, 'report.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'accounting.account.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'accounting.account.manage' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'accounting.voucher.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'accounting.voucher.manage' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'accounting.voucher.export' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'accounting.ledger.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'invoice.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'invoice.manage' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'payment.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'finance.account.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'finance.expense.view' AS permission
  UNION ALL
  SELECT 'preset_accountant' AS code, 'report.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'dashboard.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'customer.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'customer.create' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'customer.update' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'product.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'warehouse.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'inventory.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'price.list.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'sale.order.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'sale.order.create' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'sale.order.update' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'return.order.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'return.order.create' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'logistics.view' AS permission
  UNION ALL
  SELECT 'preset_customer_service' AS code, 'warehouse.task.view' AS permission
) AS grants
JOIN sys_roles r ON r.code = grants.code
JOIN new_job_role_presets newly ON newly.code = r.code
WHERE r.is_system = 1 AND r.remark LIKE '系统预置岗位：%';
DROP TEMPORARY TABLE new_job_role_presets;
COMMIT;
