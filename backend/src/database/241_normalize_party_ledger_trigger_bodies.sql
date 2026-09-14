-- 2026-09-14 备份恢复演练事故的存量修复。
--
-- 238/239/240 建触发器时，迁移运行器把整个文件当成「一条多语句」发给 MySQL
-- （mysql2 multipleStatements）。当 `CREATE TRIGGER ... <单语句>;` 后面还有别的
-- 语句时，MySQL 会把结尾的分号一起存进 information_schema.triggers.ACTION_STATEMENT。
-- mysqldump 随后把该函数体包进 /*!50003 ... */ 可执行注释，导出成 `... ); */;;`；
-- 导入时这个分号提前终止语句，剩下的 `*/` 触发 1064，于是 9/9 起每天的备份都无法
-- 按演练脚本恢复（备份数据本身完好）。
--
-- 运行器已改为逐条执行（backend/src/database/sqlStatements.js），新迁移不会再出现；
-- 本迁移重建生产存量的三个触发器，让函数体回到干净形态。触发器语义与 238/240 完全一致，
-- 不改数据、不改账款，仅重建定义。

DROP TRIGGER IF EXISTS trg_party_ledger_record_insert;
CREATE TRIGGER trg_party_ledger_record_insert AFTER INSERT ON payment_records
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,record_id,order_id,document_no,event_type,delta,business_date)
VALUES (NEW.type, CASE WHEN NEW.type=2 AND NEW.order_id IS NOT NULL THEN
      (SELECT customer_id FROM sale_orders WHERE id=NEW.order_id)
    WHEN NEW.type=1 AND NEW.order_id IS NOT NULL THEN
      (SELECT supplier_id FROM purchase_orders WHERE id=NEW.order_id)
    ELSE NULL END, NEW.party_name,NEW.id,NEW.order_id,NEW.order_no,
 'CHARGE',NEW.total_amount-NEW.paid_amount,DATE(NEW.created_at));

DROP TRIGGER IF EXISTS trg_party_ledger_record_update;
CREATE TRIGGER trg_party_ledger_record_update AFTER UPDATE ON payment_records
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,record_id,order_id,document_no,event_type,delta)
SELECT NEW.type,
 (SELECT e.party_id FROM party_ledger_events e WHERE e.record_id=NEW.id ORDER BY e.id LIMIT 1),
 NEW.party_name,NEW.id,NEW.order_id,NEW.order_no,'CHARGE_ADJUSTMENT',NEW.total_amount-OLD.total_amount
WHERE NEW.total_amount<>OLD.total_amount;

DROP TRIGGER IF EXISTS trg_party_ledger_receipt_insert;
CREATE TRIGGER trg_party_ledger_receipt_insert AFTER INSERT ON payment_receipts
FOR EACH ROW
INSERT INTO party_ledger_events
 (type,party_id,party_name,receipt_id,document_no,event_type,delta,business_date)
VALUES (NEW.type,NEW.party_id,NEW.party_name,NEW.id,NEW.receipt_no,'RECEIPT',-NEW.amount,NEW.payment_date);
