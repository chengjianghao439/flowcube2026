-- 必须停写执行；服务层已验证的 NULL 也有意义，触发器不得再按名称猜测。
DROP TRIGGER IF EXISTS trg_party_ledger_receipt_insert;
CREATE TRIGGER trg_party_ledger_receipt_insert AFTER INSERT ON payment_receipts
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,receipt_id,document_no,event_type,delta,business_date)
VALUES (NEW.type,NEW.party_id,NEW.party_name,NEW.id,NEW.receipt_no,'RECEIPT',-NEW.amount,NEW.payment_date);

-- 修正 239 可能给明确未归属汇款误填的事件；不改账款、汇款或资金余额。
UPDATE party_ledger_events e JOIN payment_receipts r ON r.id=e.receipt_id
SET e.party_id=r.party_id WHERE NOT (e.party_id <=> r.party_id);
