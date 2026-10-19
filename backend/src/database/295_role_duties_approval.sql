-- Approved minimum duties, baseline bd011c1 / v0.13.6.
-- 293 belongs to the separate PDA work; 294 is credit approval proof/audit.
-- Never infer a job from a numeric role ID. Never overwrite customized grants.
-- Only exact original system metadata AND the complete original permission set
-- qualify. A missing/custom/renamed role is preserved and recorded for review.
-- A recorded revision is never reapplied, including after later manual changes.
CREATE TABLE IF NOT EXISTS sys_role_default_revisions (
  revision_key VARCHAR(64) NOT NULL,
  role_code VARCHAR(50) NOT NULL,
  role_id BIGINT UNSIGNED NULL,
  outcome VARCHAR(32) NOT NULL,
  before_count INT UNSIGNED NULL,
  after_count INT UNSIGNED NULL,
  reason VARCHAR(255) NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (revision_key, role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
CREATE TEMPORARY TABLE role_duties_baseline (
  code VARCHAR(50) PRIMARY KEY, name VARCHAR(50) NOT NULL,
  remark VARCHAR(255) NOT NULL, before_count INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO role_duties_baseline (code,name,remark,before_count) VALUES
  ('warehouse_manager', '仓库管理员', '仓储主管', 75),
  ('purchaser', '采购员', '采购业务', 38),
  ('sales', '销售员', '销售业务', 41),
  ('viewer', '只读用户', '只读访问', 32),
  ('preset_warehouse_operator', '仓库作业员', '系统预置岗位：收货、上架、拣货、复核与打包', 21),
  ('preset_finance_specialist', '财务专员', '系统预置岗位：收付款、费用与发票日常处理', 12);

CREATE TEMPORARY TABLE role_duties_known (
  code VARCHAR(50) NOT NULL, permission VARCHAR(100) NOT NULL,
  PRIMARY KEY (code,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO role_duties_known (code,permission) VALUES
  ('warehouse_manager', 'approval.task.view'),
  ('warehouse_manager', 'dashboard.view'),
  ('warehouse_manager', 'finance.account.view'),
  ('warehouse_manager', 'finance.expense.create'),
  ('warehouse_manager', 'finance.expense.update'),
  ('warehouse_manager', 'finance.expense.view'),
  ('warehouse_manager', 'import.stock.execute'),
  ('warehouse_manager', 'inbound.order.view'),
  ('warehouse_manager', 'inbound.print.reprint'),
  ('warehouse_manager', 'inbound.putaway.execute'),
  ('warehouse_manager', 'inbound.receive.execute'),
  ('warehouse_manager', 'inventory.adjust'),
  ('warehouse_manager', 'inventory.container.move'),
  ('warehouse_manager', 'inventory.container.split'),
  ('warehouse_manager', 'inventory.view'),
  ('warehouse_manager', 'location.view'),
  ('warehouse_manager', 'logistics.manage'),
  ('warehouse_manager', 'logistics.view'),
  ('warehouse_manager', 'page:inbound'),
  ('warehouse_manager', 'payment.create'),
  ('warehouse_manager', 'payment.execute'),
  ('warehouse_manager', 'payment.view'),
  ('warehouse_manager', 'picking.wave.manage'),
  ('warehouse_manager', 'picking.wave.view'),
  ('warehouse_manager', 'print.client.consume'),
  ('warehouse_manager', 'print.job.create'),
  ('warehouse_manager', 'print.job.reprint'),
  ('warehouse_manager', 'print.job.view'),
  ('warehouse_manager', 'print.printer.manage'),
  ('warehouse_manager', 'print.printer.view'),
  ('warehouse_manager', 'print.template.manage'),
  ('warehouse_manager', 'print.template.view'),
  ('warehouse_manager', 'procurement.plan.view'),
  ('warehouse_manager', 'purchase.requisition.create'),
  ('warehouse_manager', 'purchase.requisition.view'),
  ('warehouse_manager', 'rack.view'),
  ('warehouse_manager', 'report.view'),
  ('warehouse_manager', 'return.order.cancel'),
  ('warehouse_manager', 'return.order.confirm'),
  ('warehouse_manager', 'return.order.create'),
  ('warehouse_manager', 'return.order.execute'),
  ('warehouse_manager', 'return.order.view'),
  ('warehouse_manager', 'sale.credit.view'),
  ('warehouse_manager', 'scan.log.create'),
  ('warehouse_manager', 'scan.log.view'),
  ('warehouse_manager', 'sorting.bin.manage'),
  ('warehouse_manager', 'sorting.bin.view'),
  ('warehouse_manager', 'stockcheck.abc.manage'),
  ('warehouse_manager', 'stockcheck.abc.view'),
  ('warehouse_manager', 'stockcheck.cancel'),
  ('warehouse_manager', 'stockcheck.create'),
  ('warehouse_manager', 'stockcheck.submit'),
  ('warehouse_manager', 'stockcheck.update'),
  ('warehouse_manager', 'stockcheck.view'),
  ('warehouse_manager', 'transfer.order.cancel'),
  ('warehouse_manager', 'transfer.order.confirm'),
  ('warehouse_manager', 'transfer.order.create'),
  ('warehouse_manager', 'transfer.order.execute'),
  ('warehouse_manager', 'transfer.order.view'),
  ('warehouse_manager', 'warehouse.task.adjust'),
  ('warehouse_manager', 'warehouse.task.adjust.view'),
  ('warehouse_manager', 'warehouse.task.assign'),
  ('warehouse_manager', 'warehouse.task.cancel'),
  ('warehouse_manager', 'warehouse.task.cancel_return'),
  ('warehouse_manager', 'warehouse.task.cancel_return.view'),
  ('warehouse_manager', 'warehouse.task.check'),
  ('warehouse_manager', 'warehouse.task.check_done'),
  ('warehouse_manager', 'warehouse.task.pack'),
  ('warehouse_manager', 'warehouse.task.pack_done'),
  ('warehouse_manager', 'warehouse.task.pick'),
  ('warehouse_manager', 'warehouse.task.priority'),
  ('warehouse_manager', 'warehouse.task.ship'),
  ('warehouse_manager', 'warehouse.task.sort'),
  ('warehouse_manager', 'warehouse.task.view'),
  ('warehouse_manager', 'warehouse.view'),
  ('purchaser', 'approval.task.view'),
  ('purchaser', 'category.view'),
  ('purchaser', 'dashboard.view'),
  ('purchaser', 'finance.expense.create'),
  ('purchaser', 'finance.expense.update'),
  ('purchaser', 'finance.expense.view'),
  ('purchaser', 'import.product.execute'),
  ('purchaser', 'inbound.order.create'),
  ('purchaser', 'inbound.order.submit'),
  ('purchaser', 'inbound.order.view'),
  ('purchaser', 'inbound.print.reprint'),
  ('purchaser', 'logistics.manage'),
  ('purchaser', 'logistics.view'),
  ('purchaser', 'page:inbound'),
  ('purchaser', 'payment.view'),
  ('purchaser', 'print.client.consume'),
  ('purchaser', 'procurement.plan.manage'),
  ('purchaser', 'procurement.plan.view'),
  ('purchaser', 'product.view'),
  ('purchaser', 'purchase.order.cancel'),
  ('purchaser', 'purchase.order.confirm'),
  ('purchaser', 'purchase.order.create'),
  ('purchaser', 'purchase.order.view'),
  ('purchaser', 'purchase.requisition.convert'),
  ('purchaser', 'purchase.requisition.create'),
  ('purchaser', 'purchase.requisition.view'),
  ('purchaser', 'report.view'),
  ('purchaser', 'return.order.cancel'),
  ('purchaser', 'return.order.confirm'),
  ('purchaser', 'return.order.create'),
  ('purchaser', 'return.order.view'),
  ('purchaser', 'sale.credit.override'),
  ('purchaser', 'sale.credit.override.apply'),
  ('purchaser', 'sale.credit.override.view'),
  ('purchaser', 'sale.credit.view'),
  ('purchaser', 'stockcheck.abc.view'),
  ('purchaser', 'supplier.view'),
  ('purchaser', 'warehouse.view'),
  ('sales', 'accounting.account.manage'),
  ('sales', 'accounting.account.view'),
  ('sales', 'accounting.ledger.view'),
  ('sales', 'accounting.period.manage'),
  ('sales', 'accounting.voucher.export'),
  ('sales', 'accounting.voucher.manage'),
  ('sales', 'accounting.voucher.view'),
  ('sales', 'approval.task.view'),
  ('sales', 'carrier.view'),
  ('sales', 'customer.view'),
  ('sales', 'dashboard.view'),
  ('sales', 'finance.account.view'),
  ('sales', 'finance.expense.create'),
  ('sales', 'finance.expense.update'),
  ('sales', 'finance.expense.view'),
  ('sales', 'invoice.manage'),
  ('sales', 'invoice.view'),
  ('sales', 'logistics.freight.reconcile'),
  ('sales', 'logistics.view'),
  ('sales', 'payment.create'),
  ('sales', 'payment.execute'),
  ('sales', 'payment.view'),
  ('sales', 'price.list.view'),
  ('sales', 'product.view'),
  ('sales', 'report.view'),
  ('sales', 'return.order.cancel'),
  ('sales', 'return.order.confirm'),
  ('sales', 'return.order.create'),
  ('sales', 'return.order.execute'),
  ('sales', 'return.order.view'),
  ('sales', 'sale.credit.override'),
  ('sales', 'sale.credit.view'),
  ('sales', 'sale.order.cancel'),
  ('sales', 'sale.order.create'),
  ('sales', 'sale.order.release'),
  ('sales', 'sale.order.reserve'),
  ('sales', 'sale.order.ship'),
  ('sales', 'sale.order.update'),
  ('sales', 'sale.order.view'),
  ('sales', 'warehouse.task.view'),
  ('sales', 'warehouse.view'),
  ('viewer', 'approval.task.view'),
  ('viewer', 'audit.log.view'),
  ('viewer', 'carrier.view'),
  ('viewer', 'category.view'),
  ('viewer', 'customer.view'),
  ('viewer', 'dashboard.view'),
  ('viewer', 'finance.account.view'),
  ('viewer', 'finance.expense.view'),
  ('viewer', 'inbound.order.view'),
  ('viewer', 'inventory.view'),
  ('viewer', 'location.view'),
  ('viewer', 'page:inbound'),
  ('viewer', 'payment.view'),
  ('viewer', 'picking.wave.view'),
  ('viewer', 'price.list.view'),
  ('viewer', 'print.job.view'),
  ('viewer', 'print.printer.view'),
  ('viewer', 'print.template.view'),
  ('viewer', 'product.view'),
  ('viewer', 'purchase.order.view'),
  ('viewer', 'purchase.requisition.view'),
  ('viewer', 'rack.view'),
  ('viewer', 'report.view'),
  ('viewer', 'return.order.view'),
  ('viewer', 'sale.order.view'),
  ('viewer', 'scan.log.view'),
  ('viewer', 'sorting.bin.view'),
  ('viewer', 'stockcheck.view'),
  ('viewer', 'supplier.view'),
  ('viewer', 'transfer.order.view'),
  ('viewer', 'warehouse.task.view'),
  ('viewer', 'warehouse.view'),
  ('preset_warehouse_operator', 'dashboard.view'),
  ('preset_warehouse_operator', 'inbound.order.view'),
  ('preset_warehouse_operator', 'inbound.putaway.execute'),
  ('preset_warehouse_operator', 'inbound.receive.execute'),
  ('preset_warehouse_operator', 'inventory.view'),
  ('preset_warehouse_operator', 'location.view'),
  ('preset_warehouse_operator', 'print.job.create'),
  ('preset_warehouse_operator', 'print.job.reprint'),
  ('preset_warehouse_operator', 'print.job.view'),
  ('preset_warehouse_operator', 'product.view'),
  ('preset_warehouse_operator', 'rack.view'),
  ('preset_warehouse_operator', 'scan.log.create'),
  ('preset_warehouse_operator', 'scan.log.view'),
  ('preset_warehouse_operator', 'warehouse.task.check'),
  ('preset_warehouse_operator', 'warehouse.task.check_done'),
  ('preset_warehouse_operator', 'warehouse.task.pack'),
  ('preset_warehouse_operator', 'warehouse.task.pack_done'),
  ('preset_warehouse_operator', 'warehouse.task.pick'),
  ('preset_warehouse_operator', 'warehouse.task.sort'),
  ('preset_warehouse_operator', 'warehouse.task.view'),
  ('preset_warehouse_operator', 'warehouse.view'),
  ('preset_finance_specialist', 'dashboard.view'),
  ('preset_finance_specialist', 'finance.account.view'),
  ('preset_finance_specialist', 'finance.expense.create'),
  ('preset_finance_specialist', 'finance.expense.update'),
  ('preset_finance_specialist', 'finance.expense.view'),
  ('preset_finance_specialist', 'finance.expense.view.all'),
  ('preset_finance_specialist', 'invoice.manage'),
  ('preset_finance_specialist', 'invoice.view'),
  ('preset_finance_specialist', 'payment.create'),
  ('preset_finance_specialist', 'payment.execute'),
  ('preset_finance_specialist', 'payment.view'),
  ('preset_finance_specialist', 'report.view');

CREATE TEMPORARY TABLE role_duties_revoke (
  code VARCHAR(50) NOT NULL, permission VARCHAR(100) NOT NULL,
  PRIMARY KEY (code,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO role_duties_revoke (code,permission) VALUES
  ('warehouse_manager', 'finance.account.view'),
  ('warehouse_manager', 'payment.create'),
  ('warehouse_manager', 'payment.execute'),
  ('warehouse_manager', 'payment.view'),
  ('purchaser', 'logistics.manage'),
  ('purchaser', 'sale.credit.override'),
  ('purchaser', 'sale.credit.override.apply'),
  ('purchaser', 'sale.credit.override.view'),
  ('sales', 'accounting.account.manage'),
  ('sales', 'accounting.account.view'),
  ('sales', 'accounting.ledger.view'),
  ('sales', 'accounting.period.manage'),
  ('sales', 'accounting.voucher.export'),
  ('sales', 'accounting.voucher.manage'),
  ('sales', 'accounting.voucher.view'),
  ('sales', 'finance.account.view'),
  ('sales', 'invoice.manage'),
  ('sales', 'logistics.freight.reconcile'),
  ('sales', 'payment.create'),
  ('sales', 'payment.execute'),
  ('sales', 'sale.credit.override'),
  ('viewer', 'finance.account.view'),
  ('viewer', 'payment.view');

CREATE TEMPORARY TABLE role_duties_grant (
  code VARCHAR(50) NOT NULL, permission VARCHAR(100) NOT NULL,
  PRIMARY KEY (code,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO role_duties_grant (code,permission) VALUES
  ('warehouse_manager', 'product.view'),
  ('sales', 'sale.credit.override.apply'),
  ('sales', 'sale.credit.override.view'),
  ('preset_warehouse_operator', 'warehouse.task.ship'),
  ('preset_finance_specialist', 'approval.task.view'),
  ('preset_finance_specialist', 'sale.credit.override.approve'),
  ('preset_finance_specialist', 'sale.credit.override.view'),
  ('preset_finance_specialist', 'sale.credit.view');

-- Match the same role-row lock used by roles.service.replacePermissions.
-- This serializes the full-set comparison with ordinary administrator saves.
SELECT r.id FROM sys_roles r JOIN role_duties_baseline b ON b.code=r.code
ORDER BY r.id FOR UPDATE;
SELECT p.role_id,p.permission FROM sys_role_permissions p
JOIN sys_roles r ON r.id=p.role_id JOIN role_duties_baseline b ON b.code=r.code
ORDER BY p.role_id,p.permission FOR UPDATE;

CREATE TEMPORARY TABLE role_duties_eligible (
  role_id BIGINT UNSIGNED PRIMARY KEY, code VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO role_duties_eligible (role_id,code)
SELECT r.id,b.code FROM role_duties_baseline b JOIN sys_roles r ON r.code=b.code
WHERE r.id<>1 AND r.is_system=1
  AND CAST(r.code AS BINARY)=CAST(b.code AS BINARY)
  AND CAST(r.name AS BINARY)=CAST(b.name AS BINARY)
  AND CAST(r.remark AS BINARY)=CAST(b.remark AS BINARY)
  AND EXISTS (
    SELECT 1 FROM sys_role_permissions p LEFT JOIN role_duties_known k
      ON k.code=b.code AND CAST(k.permission AS BINARY)=CAST(p.permission AS BINARY)
    WHERE p.role_id=r.id GROUP BY p.role_id
    HAVING COUNT(*)=b.before_count AND COUNT(k.permission)=b.before_count
  )
  AND NOT EXISTS (SELECT 1 FROM sys_role_default_revisions v
    WHERE v.revision_key='20261019_minimum_duties_v1' AND v.role_code=b.code);

CREATE TEMPORARY TABLE role_duties_observed (
  code VARCHAR(50) PRIMARY KEY, role_id BIGINT UNSIGNED NULL,
  before_count INT UNSIGNED NULL, outcome VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO role_duties_observed (code,role_id,before_count,outcome)
SELECT b.code,r.id,
  IF(r.id IS NULL,NULL,(SELECT COUNT(*) FROM sys_role_permissions p WHERE p.role_id=r.id)),
  CASE WHEN r.id IS NULL THEN 'missing'
    WHEN e.role_id IS NOT NULL THEN 'applied' ELSE 'preserved_custom' END
FROM role_duties_baseline b LEFT JOIN sys_roles r ON r.code=b.code
LEFT JOIN role_duties_eligible e ON e.role_id=r.id
WHERE NOT EXISTS (SELECT 1 FROM sys_role_default_revisions v
  WHERE v.revision_key='20261019_minimum_duties_v1' AND v.role_code=b.code);

DELETE p FROM sys_role_permissions p JOIN role_duties_eligible e ON e.role_id=p.role_id
JOIN role_duties_revoke d ON d.code=e.code AND CAST(d.permission AS BINARY)=CAST(p.permission AS BINARY);
INSERT INTO sys_role_permissions (role_id,permission)
SELECT e.role_id,g.permission FROM role_duties_eligible e JOIN role_duties_grant g ON g.code=e.code;

INSERT INTO sys_role_default_revisions
  (revision_key,role_code,role_id,outcome,before_count,after_count,reason)
SELECT '20261019_minimum_duties_v1',o.code,o.role_id,o.outcome,o.before_count,
  IF(o.role_id IS NULL,NULL,(SELECT COUNT(*) FROM sys_role_permissions p WHERE p.role_id=o.role_id)),
  CASE o.outcome WHEN 'applied' THEN 'Exact repository baseline; approved explicit delta only'
    WHEN 'missing' THEN 'No matching role; no role or grants created'
    ELSE 'Metadata or full grant set differs; preserve all customizations for review' END
FROM role_duties_observed o;

DROP TEMPORARY TABLE role_duties_observed;
DROP TEMPORARY TABLE role_duties_eligible;
DROP TEMPORARY TABLE role_duties_grant;
DROP TEMPORARY TABLE role_duties_revoke;
DROP TEMPORARY TABLE role_duties_known;
DROP TEMPORARY TABLE role_duties_baseline;
COMMIT;
