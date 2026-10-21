-- Explicit empty-schema bootstrap only, invoked by bootstrapNewDatabase.js.
-- Historical 001--296 remain immutable. Freeze the exact 001--295 default seed,
-- then install the approved 13-role BEFORE state and run ordinary strict 296.
-- Never run this SQL against an existing installation or an interrupted schema.
CREATE TEMPORARY TABLE new_install_expected (
 phase VARCHAR(16) NOT NULL, id BIGINT UNSIGNED NOT NULL, code VARCHAR(50) NOT NULL,
 name VARCHAR(50) NOT NULL, remark VARCHAR(255), is_system TINYINT NOT NULL,
 permissions JSON NOT NULL, PRIMARY KEY(phase,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO new_install_expected (phase,id,code,name,remark,is_system,permissions) VALUES
 ('seed',1,'admin','管理员','系统管理员',1,'["approval.task.view","print:client"]'),
 ('seed',2,'warehouse_manager','仓库管理员','仓储主管',1,'["approval.task.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","import.stock.execute","inbound.order.view","inbound.print.reprint","inbound.putaway.execute","inbound.receive.execute","inventory.adjust","inventory.container.move","inventory.container.split","inventory.view","location.view","logistics.manage","logistics.view","page:inbound","picking.wave.manage","picking.wave.view","print.client.consume","print.job.create","print.job.reprint","print.job.view","print.printer.manage","print.printer.view","print.template.manage","print.template.view","procurement.plan.view","product.view","purchase.requisition.create","purchase.requisition.view","rack.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.view","scan.log.create","scan.log.view","sorting.bin.manage","sorting.bin.view","stockcheck.abc.manage","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.cancel","transfer.order.confirm","transfer.order.create","transfer.order.execute","transfer.order.view","warehouse.task.adjust","warehouse.task.adjust.view","warehouse.task.assign","warehouse.task.cancel","warehouse.task.cancel_return","warehouse.task.cancel_return.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.priority","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]'),
 ('seed',3,'purchaser','采购员','采购业务',1,'["approval.task.view","category.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","import.product.execute","inbound.order.create","inbound.order.submit","inbound.order.view","inbound.print.reprint","logistics.view","page:inbound","payment.view","print.client.consume","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.convert","purchase.requisition.create","purchase.requisition.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.view","stockcheck.abc.view","supplier.view","warehouse.view"]'),
 ('seed',4,'sales','销售员','销售业务',1,'["approval.task.view","carrier.view","customer.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","invoice.view","logistics.view","payment.view","price.list.view","product.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.override.apply","sale.credit.override.view","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]'),
 ('seed',5,'viewer','只读用户','只读访问',1,'["approval.task.view","audit.log.view","carrier.view","category.view","customer.view","dashboard.view","finance.expense.view","inbound.order.view","inventory.view","location.view","page:inbound","picking.wave.view","price.list.view","print.job.view","print.printer.view","print.template.view","product.view","purchase.order.view","purchase.requisition.view","rack.view","report.view","return.order.view","sale.order.view","scan.log.view","sorting.bin.view","stockcheck.view","supplier.view","transfer.order.view","warehouse.task.view","warehouse.view"]'),
 ('seed',6,'preset_warehouse_operator','仓库作业员','系统预置岗位：收货、上架、拣货、复核与打包',1,'["dashboard.view","inbound.order.view","inbound.putaway.execute","inbound.receive.execute","inventory.view","location.view","print.job.create","print.job.reprint","print.job.view","product.view","rack.view","scan.log.create","scan.log.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]'),
 ('seed',7,'preset_stock_controller','库存专员','系统预置岗位：库存查询与盘点管理',1,'["dashboard.view","inventory.trace.view","inventory.view","location.view","product.view","rack.view","report.view","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.view","warehouse.view"]'),
 ('seed',8,'preset_purchase_manager','采购主管','系统预置岗位：采购计划、请购与采购审批',1,'["approval.task.view","category.view","dashboard.view","inbound.order.cancel","inbound.order.create","inbound.order.submit","inbound.order.view","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.approve","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.approve","purchase.requisition.convert","purchase.requisition.view","report.view","supplier.create","supplier.update","supplier.view","warehouse.view"]'),
 ('seed',9,'preset_sales_manager','销售主管','系统预置岗位：销售单、客户与销售退货管理',1,'["approval.task.view","carrier.view","customer.create","customer.update","customer.view","dashboard.view","price.list.view","product.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.override.view","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.view"]'),
 ('seed',10,'preset_finance_specialist','财务专员','系统预置岗位：收付款、费用与发票日常处理',1,'["approval.task.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","finance.expense.view.all","invoice.manage","invoice.view","payment.create","payment.execute","payment.view","report.view","sale.credit.override.approve","sale.credit.override.view","sale.credit.view"]'),
 ('seed',11,'preset_accountant','会计','系统预置岗位：会计科目、凭证与账簿',1,'["accounting.account.manage","accounting.account.view","accounting.ledger.view","accounting.voucher.export","accounting.voucher.manage","accounting.voucher.view","dashboard.view","finance.account.view","finance.expense.view","invoice.manage","invoice.view","payment.view","report.view"]'),
 ('seed',12,'preset_customer_service','客服专员','系统预置岗位：客户、订单与物流查询',1,'["customer.create","customer.update","customer.view","dashboard.view","inventory.view","logistics.view","price.list.view","product.view","return.order.create","return.order.view","sale.order.create","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]'),
 ('approved',1,'admin','系统管理员','拥有全部权限',1,'["approval.task.view","print:client"]'),
 ('approved',2,'warehouse','仓库管理员','仓库/库存/盘点/商品',1,'["action:inventory:adjust","action:inventory:inbound","action:inventory:outbound","action:stockcheck:create","action:stockcheck:submit","approval.task.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","import.stock.execute","inbound.order.view","inbound.print.reprint","inbound.putaway.execute","inbound.receive.execute","inventory.adjust","inventory.container.move","inventory.container.split","inventory.view","location.view","logistics.manage","logistics.view","page:dashboard","page:inbound","page:inventory","page:products","page:stockcheck","page:warehouses","payment.create","payment.execute","payment.view","picking.wave.manage","picking.wave.view","print.client.consume","print.job.create","print.job.reprint","print.job.view","print.printer.manage","print.printer.view","print.template.manage","print.template.view","procurement.plan.view","purchase.requisition.create","purchase.requisition.view","rack.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.view","scan.log.create","scan.log.view","sorting.bin.manage","sorting.bin.view","stockcheck.abc.manage","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.cancel","transfer.order.confirm","transfer.order.create","transfer.order.execute","transfer.order.view","warehouse.task.adjust","warehouse.task.adjust.view","warehouse.task.assign","warehouse.task.cancel","warehouse.task.cancel_return","warehouse.task.cancel_return.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.priority","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]'),
 ('approved',3,'purchaser','采购员','采购/供应商/商品/库存查看',1,'["action:purchase:confirm","action:purchase:create","action:purchase:receive","approval.task.view","category.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","import.product.execute","inbound.order.create","inbound.order.submit","inbound.order.view","inbound.print.reprint","logistics.manage","logistics.view","page:dashboard","page:inbound","page:inventory","page:products","page:purchase","page:suppliers","payment.view","print.client.consume","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.convert","purchase.requisition.create","purchase.requisition.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.override","sale.credit.override.apply","sale.credit.override.view","sale.credit.view","stockcheck.abc.view","supplier.view","warehouse.view"]'),
 ('approved',4,'sales','销售员','销售/客户/商品/库存查看',1,'["accounting.account.manage","accounting.account.view","accounting.ledger.view","accounting.period.manage","accounting.voucher.export","accounting.voucher.manage","accounting.voucher.view","action:sale:confirm","action:sale:create","action:sale:ship","approval.task.view","carrier.view","customer.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","invoice.manage","invoice.view","logistics.freight.reconcile","logistics.view","page:customers","page:dashboard","page:inventory","page:products","page:sale","payment.create","payment.execute","payment.view","price.list.view","product.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.override","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]'),
 ('approved',5,'viewer','只读查看','全部模块只读',1,'["approval.task.view","audit.log.view","carrier.view","category.view","customer.view","dashboard.view","finance.account.view","finance.expense.view","inbound.order.view","inventory.view","location.view","page:customers","page:dashboard","page:inbound","page:inventory","page:products","page:purchase","page:sale","page:suppliers","page:warehouses","payment.view","picking.wave.view","price.list.view","print.job.view","print.printer.view","print.template.view","product.view","purchase.order.view","purchase.requisition.view","rack.view","report.view","return.order.view","sale.order.view","scan.log.view","sorting.bin.view","stockcheck.view","supplier.view","transfer.order.view","warehouse.task.view","warehouse.view"]'),
 ('approved',6,'smoke_limited','Smoke受限','smoke test limited role',0,'["dashboard.view","inbound.order.view"]'),
 ('approved',7,'preset_warehouse_operator','仓库作业员','系统预置岗位：收货、上架、拣货、复核与打包',1,'["dashboard.view","inbound.order.view","inbound.putaway.execute","inbound.receive.execute","inventory.view","location.view","print.job.create","print.job.reprint","print.job.view","product.view","rack.view","scan.log.create","scan.log.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]'),
 ('approved',8,'preset_stock_controller','库存专员','系统预置岗位：库存查询与盘点管理',1,'["dashboard.view","inventory.trace.view","inventory.view","location.view","product.view","rack.view","report.view","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.view","warehouse.view"]'),
 ('approved',9,'preset_purchase_manager','采购主管','系统预置岗位：采购计划、请购与采购审批',1,'["approval.task.view","category.view","dashboard.view","inbound.order.cancel","inbound.order.create","inbound.order.submit","inbound.order.view","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.approve","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.approve","purchase.requisition.convert","purchase.requisition.view","report.view","supplier.create","supplier.update","supplier.view","warehouse.view"]'),
 ('approved',10,'preset_sales_manager','销售主管','系统预置岗位：销售单、客户与销售退货管理',1,'["approval.task.view","carrier.view","customer.create","customer.update","customer.view","dashboard.view","price.list.view","product.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.override.view","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.view"]'),
 ('approved',11,'preset_finance_specialist','财务专员','系统预置岗位：收付款、费用与发票日常处理',1,'["approval.task.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","finance.expense.view.all","invoice.manage","invoice.view","payment.create","payment.execute","payment.view","report.view","sale.credit.override.approve","sale.credit.override.view","sale.credit.view"]'),
 ('approved',12,'preset_accountant','会计','系统预置岗位：会计科目、凭证与账簿',1,'["accounting.account.manage","accounting.account.view","accounting.ledger.view","accounting.voucher.export","accounting.voucher.manage","accounting.voucher.view","dashboard.view","finance.account.view","finance.expense.view","invoice.manage","invoice.view","payment.view","report.view"]'),
 ('approved',13,'preset_customer_service','客服专员','系统预置岗位：客户、订单与物流查询',1,'["customer.create","customer.update","customer.view","dashboard.view","inventory.view","logistics.view","price.list.view","product.view","return.order.create","return.order.view","sale.order.create","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]');

CREATE TEMPORARY TABLE new_install_roles_actual (
 id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(50), name VARCHAR(50), remark VARCHAR(255), is_system TINYINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE new_install_permissions_actual (
 role_id BIGINT UNSIGNED NOT NULL, permission VARCHAR(100) NOT NULL, PRIMARY KEY(role_id,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE new_install_diagnostics (
 detail TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE new_install_assertion (
 ok INT NOT NULL, CONSTRAINT new_install_exact_seed_required CHECK(ok=1)
) ENGINE=InnoDB;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
INSERT INTO new_install_roles_actual SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id FOR UPDATE;
INSERT INTO new_install_permissions_actual SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission FOR UPDATE;
INSERT INTO new_install_diagnostics
 SELECT CONCAT('missing seed role: ',b.id,'/',b.code)
 FROM new_install_expected b LEFT JOIN new_install_roles_actual a ON a.id=b.id WHERE b.phase='seed' AND a.id IS NULL;
INSERT INTO new_install_diagnostics
 SELECT CONCAT('unexpected seed role: ',a.id,'/',a.code)
 FROM new_install_roles_actual a LEFT JOIN new_install_expected b ON b.phase='seed' AND b.id=a.id WHERE b.id IS NULL;
INSERT INTO new_install_diagnostics
 SELECT CONCAT('seed metadata drift: ',b.id,'/',b.code,
  ' expected=',JSON_OBJECT('code',b.code,'name',b.name,'remark',b.remark,'is_system',b.is_system),
  ' actual=',JSON_OBJECT('code',a.code,'name',a.name,'remark',a.remark,'is_system',a.is_system))
 FROM new_install_expected b JOIN new_install_roles_actual a ON a.id=b.id WHERE b.phase='seed'
 AND (NOT(BINARY a.code <=> BINARY b.code) OR NOT(BINARY a.name <=> BINARY b.name)
 OR NOT(BINARY a.remark <=> BINARY b.remark) OR NOT(a.is_system <=> b.is_system));
INSERT INTO new_install_diagnostics
 SELECT CONCAT('missing seed permission: ',b.id,'/',b.code,'/',p.permission)
 FROM new_install_expected b JOIN JSON_TABLE(b.permissions,'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p
 LEFT JOIN new_install_permissions_actual a ON a.role_id=b.id AND BINARY a.permission=BINARY p.permission
 WHERE b.phase='seed' AND a.role_id IS NULL;
INSERT INTO new_install_diagnostics
 SELECT CONCAT('extra seed permission: ',a.role_id,'/',COALESCE(b.code,'<unknown>'),'/',a.permission)
 FROM new_install_permissions_actual a LEFT JOIN new_install_expected b ON b.phase='seed' AND b.id=a.role_id
 LEFT JOIN JSON_TABLE(b.permissions,'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p ON BINARY p.permission=BINARY a.permission
 WHERE p.permission IS NULL;
INSERT INTO new_install_diagnostics
 SELECT 'new install requires only the inactive seed administrator'
 WHERE (SELECT COUNT(*) FROM sys_users)<>1 OR NOT EXISTS (
  SELECT 1 FROM sys_users WHERE id=1 AND BINARY username=BINARY 'admin' AND role_id=1 AND is_active=0
 );
INSERT INTO new_install_diagnostics
 SELECT 'new install refuses existing business facts'
 WHERE EXISTS(SELECT 1 FROM sale_orders) OR EXISTS(SELECT 1 FROM purchase_orders)
 OR EXISTS(SELECT 1 FROM inventory_containers) OR EXISTS(SELECT 1 FROM payment_records) OR EXISTS(SELECT 1 FROM expense_claims);
INSERT INTO new_install_diagnostics
 SELECT 'new install requires completed 295 and no 296 receipt'
 WHERE NOT EXISTS(SELECT 1 FROM db_migrations WHERE filename='295_role_duties_approval.sql')
 OR EXISTS(SELECT 1 FROM db_migrations WHERE filename='296_qa_role_permissions.sql')
 OR EXISTS(SELECT 1 FROM sys_role_default_revisions WHERE revision_key='qa_roles_20261021_v2');
SELECT CONCAT('[Bootstrap] ',detail) AS migration_error FROM new_install_diagnostics ORDER BY BINARY detail;
-- Raw SQL clients must also fail before any persistent role/grant mutation.
INSERT INTO new_install_assertion SELECT IF(COUNT(*)=0,1,0) FROM new_install_diagnostics;
DELETE FROM sys_role_permissions;
DELETE FROM sys_roles;
INSERT INTO sys_roles (id,code,name,remark,is_system)
 SELECT id,code,name,remark,is_system FROM new_install_expected WHERE phase='approved' ORDER BY id;
INSERT INTO sys_role_permissions (role_id,permission)
 SELECT b.id,p.permission FROM new_install_expected b
 JOIN JSON_TABLE(b.permissions,'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p WHERE b.phase='approved';
COMMIT;
DROP TEMPORARY TABLE new_install_expected;
DROP TEMPORARY TABLE new_install_roles_actual;
DROP TEMPORARY TABLE new_install_permissions_actual;
DROP TEMPORARY TABLE new_install_diagnostics;
DROP TEMPORARY TABLE new_install_assertion;
