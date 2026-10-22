-- 296: user-approved QA role table v2, frozen at b7df530.
-- All 13 exact identities and full sets must match before ANY grant change.
-- 35 revocations / 3 additions. No role is skipped, recreated or inferred.
-- SQL clients print all diagnostic rows then fail a CHECK; the migration runner
-- raises those rows in full and rolls back. Do not use a client that ignores errors.
DROP TEMPORARY TABLE IF EXISTS qa296_baseline;
DROP TEMPORARY TABLE IF EXISTS qa296_roles_actual;
DROP TEMPORARY TABLE IF EXISTS qa296_permissions_actual;
DROP TEMPORARY TABLE IF EXISTS qa296_receipts;
DROP TEMPORARY TABLE IF EXISTS qa296_diagnostics;
DROP TEMPORARY TABLE IF EXISTS qa296_assertion;
CREATE TEMPORARY TABLE qa296_baseline (
 id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(50) NOT NULL, name VARCHAR(50) NOT NULL,
 remark VARCHAR(255) NOT NULL, is_system TINYINT NOT NULL,
 before_permissions JSON NOT NULL, after_permissions JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO qa296_baseline (id,code,name,remark,is_system,before_permissions,after_permissions) VALUES
 (1,'admin','系统管理员','拥有全部权限',1,'["approval.task.view","print:client"]','["approval.task.view","print:client"]'),
 (2,'warehouse','仓库管理员','仓库/库存/盘点/商品',1,'["action:inventory:adjust","action:inventory:inbound","action:inventory:outbound","action:stockcheck:create","action:stockcheck:submit","approval.task.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","import.stock.execute","inbound.order.view","inbound.print.reprint","inbound.putaway.execute","inbound.receive.execute","inventory.adjust","inventory.container.move","inventory.container.split","inventory.view","location.view","logistics.manage","logistics.view","page:dashboard","page:inbound","page:inventory","page:products","page:stockcheck","page:warehouses","payment.create","payment.execute","payment.view","picking.wave.manage","picking.wave.view","print.client.consume","print.job.create","print.job.reprint","print.job.view","print.printer.manage","print.printer.view","print.template.manage","print.template.view","procurement.plan.view","purchase.requisition.create","purchase.requisition.view","rack.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.view","scan.log.create","scan.log.view","sorting.bin.manage","sorting.bin.view","stockcheck.abc.manage","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.cancel","transfer.order.confirm","transfer.order.create","transfer.order.execute","transfer.order.view","warehouse.task.adjust","warehouse.task.adjust.view","warehouse.task.assign","warehouse.task.cancel","warehouse.task.cancel_return","warehouse.task.cancel_return.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.priority","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]','["action:inventory:adjust","action:inventory:inbound","action:inventory:outbound","action:stockcheck:create","action:stockcheck:submit","approval.task.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","import.stock.execute","inbound.order.view","inbound.print.reprint","inbound.putaway.execute","inbound.receive.execute","inventory.adjust","inventory.container.move","inventory.container.split","inventory.view","location.view","logistics.manage","logistics.view","page:dashboard","page:inbound","page:inventory","page:products","page:stockcheck","page:warehouses","picking.wave.manage","picking.wave.view","print.client.consume","print.job.create","print.job.reprint","print.job.view","print.printer.manage","print.printer.view","print.template.manage","print.template.view","procurement.plan.view","product.view","purchase.requisition.create","purchase.requisition.view","rack.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.view","scan.log.create","scan.log.view","sorting.bin.manage","sorting.bin.view","stockcheck.abc.manage","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.cancel","transfer.order.confirm","transfer.order.create","transfer.order.execute","transfer.order.view","warehouse.task.adjust","warehouse.task.adjust.view","warehouse.task.assign","warehouse.task.cancel","warehouse.task.cancel_return","warehouse.task.cancel_return.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.priority","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]'),
 (3,'purchaser','采购员','采购/供应商/商品/库存查看',1,'["action:purchase:confirm","action:purchase:create","action:purchase:receive","approval.task.view","category.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","import.product.execute","inbound.order.create","inbound.order.submit","inbound.order.view","inbound.print.reprint","logistics.manage","logistics.view","page:dashboard","page:inbound","page:inventory","page:products","page:purchase","page:suppliers","payment.view","print.client.consume","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.convert","purchase.requisition.create","purchase.requisition.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.override","sale.credit.override.apply","sale.credit.override.view","sale.credit.view","stockcheck.abc.view","supplier.view","warehouse.view"]','["action:purchase:confirm","action:purchase:create","action:purchase:receive","approval.task.view","category.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","import.product.execute","inbound.order.create","inbound.order.submit","inbound.order.view","inbound.print.reprint","logistics.view","page:dashboard","page:inbound","page:inventory","page:products","page:purchase","page:suppliers","print.client.consume","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.convert","purchase.requisition.create","purchase.requisition.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.view","stockcheck.abc.view","supplier.view","warehouse.view"]'),
 (4,'sales','销售员','销售/客户/商品/库存查看',1,'["accounting.account.manage","accounting.account.view","accounting.ledger.view","accounting.period.manage","accounting.voucher.export","accounting.voucher.manage","accounting.voucher.view","action:sale:confirm","action:sale:create","action:sale:ship","approval.task.view","carrier.view","customer.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","invoice.manage","invoice.view","logistics.freight.reconcile","logistics.view","page:customers","page:dashboard","page:inventory","page:products","page:sale","payment.create","payment.execute","payment.view","price.list.view","product.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.override","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]','["action:sale:confirm","action:sale:create","action:sale:ship","approval.task.view","carrier.view","customer.view","dashboard.view","finance.expense.create","finance.expense.update","finance.expense.view","logistics.view","page:customers","page:dashboard","page:inventory","page:products","page:sale","price.list.view","product.view","return.order.cancel","return.order.confirm","return.order.create","return.order.execute","return.order.view","sale.credit.override.apply","sale.credit.override.view","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]'),
 (5,'viewer','只读查看','全部模块只读',1,'["approval.task.view","audit.log.view","carrier.view","category.view","customer.view","dashboard.view","finance.account.view","finance.expense.view","inbound.order.view","inventory.view","location.view","page:customers","page:dashboard","page:inbound","page:inventory","page:products","page:purchase","page:sale","page:suppliers","page:warehouses","payment.view","picking.wave.view","price.list.view","print.job.view","print.printer.view","print.template.view","product.view","purchase.order.view","purchase.requisition.view","rack.view","report.view","return.order.view","sale.order.view","scan.log.view","sorting.bin.view","stockcheck.view","supplier.view","transfer.order.view","warehouse.task.view","warehouse.view"]','["approval.task.view","carrier.view","category.view","customer.view","dashboard.view","inbound.order.view","inventory.view","location.view","page:customers","page:dashboard","page:inbound","page:inventory","page:products","page:purchase","page:sale","page:suppliers","page:warehouses","picking.wave.view","price.list.view","print.job.view","print.printer.view","print.template.view","product.view","purchase.order.view","purchase.requisition.view","rack.view","return.order.view","sale.order.view","scan.log.view","sorting.bin.view","stockcheck.view","supplier.view","transfer.order.view","warehouse.task.view","warehouse.view"]'),
 (6,'smoke_limited','Smoke受限','smoke test limited role',0,'["dashboard.view","inbound.order.view"]','["dashboard.view","inbound.order.view"]'),
 (7,'preset_warehouse_operator','仓库作业员','系统预置岗位：收货、上架、拣货、复核与打包',1,'["dashboard.view","inbound.order.view","inbound.putaway.execute","inbound.receive.execute","inventory.view","location.view","print.job.create","print.job.reprint","print.job.view","product.view","rack.view","scan.log.create","scan.log.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]','["dashboard.view","inbound.order.view","inbound.putaway.execute","inbound.receive.execute","inventory.view","location.view","print.job.create","print.job.reprint","print.job.view","product.view","rack.view","scan.log.create","scan.log.view","warehouse.task.check","warehouse.task.check_done","warehouse.task.pack","warehouse.task.pack_done","warehouse.task.pick","warehouse.task.ship","warehouse.task.sort","warehouse.task.view","warehouse.view"]'),
 (8,'preset_stock_controller','库存专员','系统预置岗位：库存查询与盘点管理',1,'["dashboard.view","inventory.trace.view","inventory.view","location.view","product.view","rack.view","report.view","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.view","warehouse.view"]','["dashboard.view","inventory.trace.view","inventory.view","location.view","product.view","rack.view","stockcheck.abc.view","stockcheck.cancel","stockcheck.create","stockcheck.submit","stockcheck.update","stockcheck.view","transfer.order.view","warehouse.view"]'),
 (9,'preset_purchase_manager','采购主管','系统预置岗位：采购计划、请购与采购审批',1,'["approval.task.view","category.view","dashboard.view","inbound.order.cancel","inbound.order.create","inbound.order.submit","inbound.order.view","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.approve","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.approve","purchase.requisition.convert","purchase.requisition.view","report.view","supplier.create","supplier.update","supplier.view","warehouse.view"]','["approval.task.view","category.view","dashboard.view","inbound.order.cancel","inbound.order.create","inbound.order.submit","inbound.order.view","procurement.plan.manage","procurement.plan.view","product.view","purchase.order.approve","purchase.order.cancel","purchase.order.confirm","purchase.order.create","purchase.order.view","purchase.requisition.approve","purchase.requisition.convert","purchase.requisition.view","supplier.create","supplier.update","supplier.view","warehouse.view"]'),
 (10,'preset_sales_manager','销售主管','系统预置岗位：销售单、客户与销售退货管理',1,'["approval.task.view","carrier.view","customer.create","customer.update","customer.view","dashboard.view","price.list.view","product.view","report.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.override.view","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.view"]','["approval.task.view","carrier.view","customer.create","customer.update","customer.view","dashboard.view","price.list.view","product.view","return.order.cancel","return.order.confirm","return.order.create","return.order.view","sale.credit.override.view","sale.credit.view","sale.order.cancel","sale.order.create","sale.order.release","sale.order.reserve","sale.order.ship","sale.order.update","sale.order.view","warehouse.view"]'),
 (11,'preset_finance_specialist','财务专员','系统预置岗位：收付款、费用与发票日常处理',1,'["approval.task.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","finance.expense.view.all","invoice.manage","invoice.view","payment.create","payment.execute","payment.view","report.view","sale.credit.override.approve","sale.credit.override.view","sale.credit.view"]','["approval.task.view","dashboard.view","finance.account.view","finance.expense.create","finance.expense.update","finance.expense.view","finance.expense.view.all","invoice.manage","invoice.view","payment.create","payment.execute","payment.view","report.view","sale.credit.override.approve","sale.credit.override.view","sale.credit.view"]'),
 (12,'preset_accountant','会计','系统预置岗位：会计科目、凭证与账簿',1,'["accounting.account.manage","accounting.account.view","accounting.ledger.view","accounting.voucher.export","accounting.voucher.manage","accounting.voucher.view","dashboard.view","finance.account.view","finance.expense.view","invoice.manage","invoice.view","payment.view","report.view"]','["accounting.account.manage","accounting.account.view","accounting.ledger.view","accounting.voucher.export","accounting.voucher.manage","accounting.voucher.view","dashboard.view","finance.account.view","finance.expense.view","invoice.manage","invoice.view","payment.view","report.view"]'),
 (13,'preset_customer_service','客服专员','系统预置岗位：客户、订单与物流查询',1,'["customer.create","customer.update","customer.view","dashboard.view","inventory.view","logistics.view","price.list.view","product.view","return.order.create","return.order.view","sale.order.create","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]','["customer.create","customer.update","customer.view","dashboard.view","inventory.view","logistics.view","price.list.view","product.view","return.order.create","return.order.view","sale.order.create","sale.order.update","sale.order.view","warehouse.task.view","warehouse.view"]');
CREATE TEMPORARY TABLE qa296_roles_actual (
 id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(50), name VARCHAR(50), remark VARCHAR(255), is_system TINYINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE qa296_permissions_actual (
 role_id BIGINT UNSIGNED NOT NULL, permission VARCHAR(100) NOT NULL,
 PRIMARY KEY(role_id,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE qa296_receipts (
 role_code VARCHAR(50) PRIMARY KEY, role_id BIGINT UNSIGNED NULL, outcome VARCHAR(32),
 before_count INT, after_count INT, reason VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE qa296_diagnostics (
 role_id BIGINT UNSIGNED NOT NULL, role_code VARCHAR(50) NOT NULL, role_name VARCHAR(50) NOT NULL,
 kind VARCHAR(32) NOT NULL, detail TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TEMPORARY TABLE qa296_assertion (ok INT NOT NULL, CONSTRAINT qa296_full_baseline_required CHECK(ok=1)) ENGINE=InnoDB;

-- Pin this transaction only: range/gap protection must also hold when the caller defaults to READ COMMITTED.
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
-- Current locking reads, ordered by primary keys, also lock insertion gaps.
-- Role saves already lock sys_roles before changing grants; direct grant writes
-- are serialized by the complete permission range locking read as well.
INSERT INTO qa296_roles_actual SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id FOR UPDATE;
INSERT INTO qa296_permissions_actual SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission FOR UPDATE;
INSERT INTO qa296_receipts SELECT role_code,role_id,outcome,before_count,after_count,reason
 FROM sys_role_default_revisions WHERE BINARY revision_key=BINARY 'qa_roles_20261021_v2' ORDER BY role_code FOR UPDATE;
SET @qa296_replay := (SELECT COUNT(*)>0 FROM qa296_receipts);
SET @qa296_expected_after := @qa296_replay;
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'role_missing','expected exact approved role ID'
 FROM qa296_baseline b LEFT JOIN qa296_roles_actual a ON a.id=b.id WHERE a.id IS NULL;
INSERT INTO qa296_diagnostics
 SELECT a.id,COALESCE(a.code,''),COALESCE(a.name,''),'unexpected_role','role is not in the approved 13-role baseline'
 FROM qa296_roles_actual a LEFT JOIN qa296_baseline b ON b.id=a.id WHERE b.id IS NULL;
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.code',CONCAT('expected=',JSON_QUOTE(CAST(b.code AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.code AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.code <=> BINARY b.code);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.name',CONCAT('expected=',JSON_QUOTE(CAST(b.name AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.name AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.name <=> BINARY b.name);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.remark',CONCAT('expected=',JSON_QUOTE(CAST(b.remark AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.remark AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.remark <=> BINARY b.remark);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.is_system',CONCAT('expected=',JSON_QUOTE(CAST(b.is_system AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.is_system AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.is_system <=> BINARY b.is_system);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'missing_permission',p.permission
 FROM qa296_baseline b
 JOIN JSON_TABLE(IF(@qa296_expected_after,b.after_permissions,b.before_permissions),'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p
 LEFT JOIN qa296_permissions_actual a ON a.role_id=b.id AND BINARY a.permission=BINARY p.permission WHERE a.role_id IS NULL;
INSERT INTO qa296_diagnostics
 SELECT a.role_id,COALESCE(b.code,'<unapproved>'),COALESCE(b.name,'<unapproved>'),'extra_permission',a.permission
 FROM qa296_permissions_actual a LEFT JOIN qa296_baseline b ON b.id=a.role_id
 LEFT JOIN JSON_TABLE(IF(@qa296_expected_after,b.after_permissions,b.before_permissions),'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p ON BINARY p.permission=BINARY a.permission
 WHERE p.permission IS NULL;
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'permission_count',CONCAT('expected=',JSON_LENGTH(IF(@qa296_expected_after,b.after_permissions,b.before_permissions)),' actual=',COALESCE(a.n,0))
 FROM qa296_baseline b LEFT JOIN (SELECT role_id,COUNT(*) n FROM qa296_permissions_actual GROUP BY role_id) a ON a.role_id=b.id
 WHERE JSON_LENGTH(IF(@qa296_expected_after,b.after_permissions,b.before_permissions))<>COALESCE(a.n,0);
-- A replay is allowed only with every exact receipt AND the full after-state.
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'revision_receipt',CONCAT('expected complete approved receipt; actual=',COALESCE(JSON_OBJECT('role_id',r.role_id,'outcome',r.outcome,'before',r.before_count,'after',r.after_count,'reason',r.reason),'null'))
 FROM qa296_baseline b LEFT JOIN qa296_receipts r ON BINARY r.role_code=BINARY b.code
 WHERE @qa296_replay AND (r.role_code IS NULL OR NOT(r.role_id <=> b.id) OR NOT(BINARY r.outcome <=> BINARY 'applied')
 OR NOT(r.before_count <=> JSON_LENGTH(b.before_permissions)) OR NOT(r.after_count <=> JSON_LENGTH(b.after_permissions)) OR NOT(BINARY r.reason <=> BINARY 'approved=b7df530;manifest_sha256=7b1c23fcd02cb3c3a590c9e870888b43a9984711c9555be856d52623964be033'));
INSERT INTO qa296_diagnostics
 SELECT COALESCE(r.role_id,0),r.role_code,'<unapproved>','revision_receipt','unexpected receipt role'
 FROM qa296_receipts r LEFT JOIN qa296_baseline b ON BINARY b.code=BINARY r.role_code WHERE b.id IS NULL;
SELECT CONCAT('[296] role=',d.role_id,'/',d.role_code,'/',d.role_name,
 ' expected_count=',COALESCE(JSON_LENGTH(IF(@qa296_expected_after,b.after_permissions,b.before_permissions)),0),
 ' actual_count=',COALESCE(a.n,0),' ',d.kind,': ',d.detail) AS migration_error
 FROM qa296_diagnostics d LEFT JOIN qa296_baseline b ON b.id=d.role_id
 LEFT JOIN (SELECT role_id,COUNT(*) n FROM qa296_permissions_actual GROUP BY role_id) a ON a.role_id=d.role_id
 ORDER BY d.role_id,d.kind,d.detail;
SET @qa296_ok := (SELECT COUNT(*)=0 FROM qa296_diagnostics);
INSERT INTO qa296_assertion VALUES (@qa296_ok);

-- Apply only the approved differences, never reset/reseed a complete role.
DELETE p FROM sys_role_permissions p JOIN qa296_baseline b ON b.id=p.role_id
 LEFT JOIN JSON_TABLE(b.after_permissions,'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) k ON BINARY k.permission=BINARY p.permission
 WHERE k.permission IS NULL AND @qa296_ok AND NOT @qa296_replay;
INSERT INTO sys_role_permissions (role_id,permission)
 SELECT b.id,p.permission FROM qa296_baseline b
 JOIN JSON_TABLE(b.after_permissions,'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p
 LEFT JOIN JSON_TABLE(b.before_permissions,'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) a ON BINARY a.permission=BINARY p.permission
 WHERE a.permission IS NULL AND @qa296_ok AND NOT @qa296_replay;

-- Check the entire result before recording or committing anything.
DELETE FROM qa296_roles_actual;
INSERT INTO qa296_roles_actual SELECT id,code,name,remark,is_system FROM sys_roles ORDER BY id FOR UPDATE;
DELETE FROM qa296_permissions_actual;
INSERT INTO qa296_permissions_actual SELECT role_id,permission FROM sys_role_permissions ORDER BY role_id,permission FOR UPDATE;
DELETE FROM qa296_diagnostics;
SET @qa296_expected_after := 1;
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'role_missing','expected exact approved role ID'
 FROM qa296_baseline b LEFT JOIN qa296_roles_actual a ON a.id=b.id WHERE a.id IS NULL;
INSERT INTO qa296_diagnostics
 SELECT a.id,COALESCE(a.code,''),COALESCE(a.name,''),'unexpected_role','role is not in the approved 13-role baseline'
 FROM qa296_roles_actual a LEFT JOIN qa296_baseline b ON b.id=a.id WHERE b.id IS NULL;
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.code',CONCAT('expected=',JSON_QUOTE(CAST(b.code AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.code AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.code <=> BINARY b.code);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.name',CONCAT('expected=',JSON_QUOTE(CAST(b.name AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.name AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.name <=> BINARY b.name);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.remark',CONCAT('expected=',JSON_QUOTE(CAST(b.remark AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.remark AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.remark <=> BINARY b.remark);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'metadata.is_system',CONCAT('expected=',JSON_QUOTE(CAST(b.is_system AS CHAR)),' actual=',COALESCE(JSON_QUOTE(CAST(a.is_system AS CHAR)),'null'))
 FROM qa296_baseline b JOIN qa296_roles_actual a ON a.id=b.id WHERE NOT (BINARY a.is_system <=> BINARY b.is_system);
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'missing_permission',p.permission
 FROM qa296_baseline b
 JOIN JSON_TABLE(IF(@qa296_expected_after,b.after_permissions,b.before_permissions),'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p
 LEFT JOIN qa296_permissions_actual a ON a.role_id=b.id AND BINARY a.permission=BINARY p.permission WHERE a.role_id IS NULL;
INSERT INTO qa296_diagnostics
 SELECT a.role_id,COALESCE(b.code,'<unapproved>'),COALESCE(b.name,'<unapproved>'),'extra_permission',a.permission
 FROM qa296_permissions_actual a LEFT JOIN qa296_baseline b ON b.id=a.role_id
 LEFT JOIN JSON_TABLE(IF(@qa296_expected_after,b.after_permissions,b.before_permissions),'$[*]' COLUMNS(permission VARCHAR(100) PATH '$')) p ON BINARY p.permission=BINARY a.permission
 WHERE p.permission IS NULL;
INSERT INTO qa296_diagnostics
 SELECT b.id,b.code,b.name,'permission_count',CONCAT('expected=',JSON_LENGTH(IF(@qa296_expected_after,b.after_permissions,b.before_permissions)),' actual=',COALESCE(a.n,0))
 FROM qa296_baseline b LEFT JOIN (SELECT role_id,COUNT(*) n FROM qa296_permissions_actual GROUP BY role_id) a ON a.role_id=b.id
 WHERE JSON_LENGTH(IF(@qa296_expected_after,b.after_permissions,b.before_permissions))<>COALESCE(a.n,0);
SELECT CONCAT('[296] role=',d.role_id,'/',d.role_code,'/',d.role_name,
 ' expected_count=',COALESCE(JSON_LENGTH(IF(@qa296_expected_after,b.after_permissions,b.before_permissions)),0),
 ' actual_count=',COALESCE(a.n,0),' ',d.kind,': ',d.detail) AS migration_error
 FROM qa296_diagnostics d LEFT JOIN qa296_baseline b ON b.id=d.role_id
 LEFT JOIN (SELECT role_id,COUNT(*) n FROM qa296_permissions_actual GROUP BY role_id) a ON a.role_id=d.role_id
 ORDER BY d.role_id,d.kind,d.detail;
INSERT INTO qa296_assertion SELECT IF(COUNT(*)=0,1,0) FROM qa296_diagnostics;
INSERT INTO sys_role_default_revisions (revision_key,role_code,role_id,outcome,before_count,after_count,reason)
 SELECT 'qa_roles_20261021_v2',b.code,b.id,'applied',JSON_LENGTH(b.before_permissions),JSON_LENGTH(b.after_permissions),'approved=b7df530;manifest_sha256=7b1c23fcd02cb3c3a590c9e870888b43a9984711c9555be856d52623964be033'
 FROM qa296_baseline b WHERE @qa296_ok AND NOT @qa296_replay;
COMMIT;
DROP TEMPORARY TABLE qa296_baseline;
DROP TEMPORARY TABLE qa296_roles_actual;
DROP TEMPORARY TABLE qa296_permissions_actual;
DROP TEMPORARY TABLE qa296_receipts;
DROP TEMPORARY TABLE qa296_diagnostics;
DROP TEMPORARY TABLE qa296_assertion;
