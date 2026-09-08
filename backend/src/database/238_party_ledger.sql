-- 往来净额明细。部署时先停止业务写入（含 scheduler/worker），迁移完成再启动。
-- 历史仅保存启用时点净余额，不能倒推旧业务发生额；不修改原账款/收付款。
CREATE TABLE IF NOT EXISTS party_ledger_meta (
  id TINYINT NOT NULL PRIMARY KEY,
  started_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO party_ledger_meta VALUES (1, CURRENT_TIMESTAMP(6));
CREATE TABLE IF NOT EXISTS party_ledger_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type TINYINT NOT NULL,
  party_id BIGINT UNSIGNED NULL,
  party_name VARCHAR(100) NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  receipt_id BIGINT UNSIGNED NULL,
  entry_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  document_no VARCHAR(100) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  delta DECIMAL(18,4) NOT NULL,
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  business_date DATE NULL,
  baseline_key VARCHAR(60) NULL,
  UNIQUE KEY uk_party_ledger_baseline (baseline_key),
  KEY idx_party_ledger_party (type,party_id,occurred_at,id),
  KEY idx_party_ledger_record (record_id,id),
  KEY idx_party_ledger_receipt (receipt_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO party_ledger_events
 (type,party_id,party_name,record_id,order_id,document_no,event_type,delta,occurred_at,business_date,baseline_key)
SELECT pr.type, CASE WHEN pr.type=2 AND pr.order_id IS NOT NULL THEN
      (SELECT customer_id FROM sale_orders WHERE id=pr.order_id)
    WHEN pr.type=1 AND pr.order_id IS NOT NULL THEN
      (SELECT supplier_id FROM purchase_orders WHERE id=pr.order_id)
    ELSE NULL END,pr.party_name,pr.id,pr.order_id,pr.order_no,
 'OPENING_RECORD',pr.total_amount-pr.paid_amount,m.started_at,DATE(pr.created_at),CONCAT('record:',pr.id)
FROM payment_records pr CROSS JOIN party_ledger_meta m
WHERE m.id=1 AND NOT EXISTS(SELECT 1 FROM party_ledger_events e WHERE e.record_id=pr.id);

INSERT IGNORE INTO party_ledger_events
 (type,party_id,party_name,receipt_id,document_no,event_type,delta,occurred_at,business_date,baseline_key)
SELECT r.type, CASE WHEN r.type=2 THEN
      (SELECT IF(COUNT(*)=1,MIN(id),NULL) FROM sale_customers WHERE BINARY name=BINARY r.party_name AND deleted_at IS NULL)
    ELSE (SELECT IF(COUNT(*)=1,MIN(id),NULL) FROM supply_suppliers WHERE BINARY name=BINARY r.party_name AND deleted_at IS NULL) END,r.party_name,r.id,r.receipt_no,
 'OPENING_ADVANCE',-r.balance,m.started_at,r.payment_date,CONCAT('receipt:',r.id)
FROM payment_receipts r CROSS JOIN party_ledger_meta m
WHERE m.id=1 AND r.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM party_ledger_events e WHERE e.receipt_id=r.id);

CREATE TRIGGER IF NOT EXISTS trg_party_ledger_record_insert AFTER INSERT ON payment_records
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,record_id,order_id,document_no,event_type,delta,business_date)
VALUES (NEW.type, CASE WHEN NEW.type=2 AND NEW.order_id IS NOT NULL THEN
      (SELECT customer_id FROM sale_orders WHERE id=NEW.order_id)
    WHEN NEW.type=1 AND NEW.order_id IS NOT NULL THEN
      (SELECT supplier_id FROM purchase_orders WHERE id=NEW.order_id)
    ELSE NULL END, NEW.party_name,NEW.id,NEW.order_id,NEW.order_no,
 'CHARGE',NEW.total_amount-NEW.paid_amount,DATE(NEW.created_at));

CREATE TRIGGER IF NOT EXISTS trg_party_ledger_record_update AFTER UPDATE ON payment_records
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,record_id,order_id,document_no,event_type,delta)
SELECT NEW.type,
 (SELECT e.party_id FROM party_ledger_events e WHERE e.record_id=NEW.id ORDER BY e.id LIMIT 1),
 NEW.party_name,NEW.id,NEW.order_id,NEW.order_no,'CHARGE_ADJUSTMENT',NEW.total_amount-OLD.total_amount
WHERE NEW.total_amount<>OLD.total_amount;

-- 汇款在登记时只记一次，后续核销不重复记账。未核销余额自然表现为预收/预付。
CREATE TRIGGER IF NOT EXISTS trg_party_ledger_receipt_insert AFTER INSERT ON payment_receipts
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,receipt_id,document_no,event_type,delta,business_date)
VALUES (NEW.type, CASE WHEN NEW.type=2 THEN
      (SELECT IF(COUNT(*)=1,MIN(id),NULL) FROM sale_customers WHERE BINARY name=BINARY NEW.party_name AND deleted_at IS NULL)
    ELSE (SELECT IF(COUNT(*)=1,MIN(id),NULL) FROM supply_suppliers WHERE BINARY name=BINARY NEW.party_name AND deleted_at IS NULL) END, NEW.party_name,NEW.id,NEW.receipt_no,
 'RECEIPT',-NEW.amount,NEW.payment_date);

-- 直接收付款和退款有真实分录；receipt_id 不为空的只是核销，不能重复扣。
CREATE TRIGGER IF NOT EXISTS trg_party_ledger_entry_insert AFTER INSERT ON payment_entries
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,record_id,entry_id,order_id,document_no,event_type,delta,business_date)
SELECT pr.type,
 (SELECT e.party_id FROM party_ledger_events e WHERE e.record_id=pr.id ORDER BY e.id LIMIT 1),
 pr.party_name,pr.id,NEW.id,pr.order_id,pr.order_no,
 IF(NEW.amount<0,'REFUND','DIRECT_PAYMENT'),-NEW.amount,NEW.payment_date
FROM payment_records pr WHERE pr.id=NEW.record_id AND NEW.receipt_id IS NULL;
