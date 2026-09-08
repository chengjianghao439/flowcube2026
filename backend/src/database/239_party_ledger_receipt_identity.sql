-- 保留已执行的 238；补强汇款的稳定单位 ID。必须在业务停写窗口执行。
SET @has_receipt_party=(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='payment_receipts' AND column_name='party_id');
SET @sql=IF(@has_receipt_party=0,'ALTER TABLE payment_receipts ADD COLUMN party_id BIGINT UNSIGNED NULL, ADD KEY idx_receipt_party_id(type,party_id)','SELECT 1');
PREPARE receipt_identity_stmt FROM @sql;
EXECUTE receipt_identity_stmt;
DEALLOCATE PREPARE receipt_identity_stmt;

-- 仅用于兼容旧客户端没有单位 ID 的输入：现名+原单快照名必须唯一归属。
-- 保留已删除档案/原单的身份，防止同名复用误记给新档案。
CREATE OR REPLACE VIEW party_identity_names AS
 SELECT 2 type,id party_id,name party_name FROM sale_customers
 UNION SELECT 2,customer_id,customer_name FROM sale_orders
 UNION SELECT 1,id,name FROM supply_suppliers
 UNION SELECT 1,supplier_id,supplier_name FROM purchase_orders;

UPDATE payment_receipts r JOIN (
 SELECT pe.receipt_id,
   IF(COUNT(*)=COUNT(COALESCE(so.customer_id,po.supplier_id)) AND COUNT(DISTINCT COALESCE(so.customer_id,po.supplier_id))=1,
      MIN(COALESCE(so.customer_id,po.supplier_id)),NULL) party_id
 FROM payment_entries pe JOIN payment_records pr ON pr.id=pe.record_id
 JOIN payment_receipts rr ON rr.id=pe.receipt_id AND rr.type=pr.type
 LEFT JOIN sale_orders so ON pr.type=2 AND so.id=pr.order_id
 LEFT JOIN purchase_orders po ON pr.type=1 AND po.id=pr.order_id
 WHERE pe.receipt_id IS NOT NULL GROUP BY pe.receipt_id
) owners ON owners.receipt_id=r.id
SET r.party_id=owners.party_id WHERE r.party_id IS NULL;
UPDATE payment_receipts r SET r.party_id=(
 SELECT IF(COUNT(DISTINCT n.party_id)=1,MIN(n.party_id),NULL) FROM party_identity_names n
 WHERE n.type=r.type AND BINARY n.party_name=BINARY r.party_name
) WHERE r.party_id IS NULL AND NOT EXISTS(SELECT 1 FROM payment_entries pe WHERE pe.receipt_id=r.id);
UPDATE party_ledger_events e JOIN payment_receipts r ON r.id=e.receipt_id
SET e.party_id=r.party_id;

DROP TRIGGER IF EXISTS trg_party_ledger_receipt_insert;
CREATE TRIGGER trg_party_ledger_receipt_insert AFTER INSERT ON payment_receipts
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,receipt_id,document_no,event_type,delta,business_date)
VALUES (NEW.type, COALESCE(NEW.party_id,(
 SELECT IF(COUNT(DISTINCT n.party_id)=1,MIN(n.party_id),NULL) FROM party_identity_names n
 WHERE n.type=NEW.type AND BINARY n.party_name=BINARY NEW.party_name
)),NEW.party_name,NEW.id,NEW.receipt_no,'RECEIPT',-NEW.amount,NEW.payment_date);
