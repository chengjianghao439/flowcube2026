-- FlowCube ERP - Migration 138
-- 删除「预付/定金」(3) 结算方式，并入「现结」(1)。结算方式最终只剩两档：现结 / 月结。
--
-- 迁移 137 已把货到付款并入现结；预付与现结在系统里的行为本就完全一致——
-- 到期日基准同为单据创建日、账期同为 0，差别只在「钱是在发货前还是发货当天到账」，
-- 而系统并不跟踪这个时点，两者产生的账款、到期日、催收提醒一模一样。
-- 既然区分不出可执行的差异，就不该在建档时多一个要纠结的选项。
--
-- 执行时三张表均无 settlement_type=3 的数据（已核对），UPDATE 是防御性的：
-- 若代码已部署而本迁移尚未执行，遗留的 3 会被 normalizeSettlementType() 兜底映射成现结。
--
-- 至此结算方式与「账款页 / 对账页」形成一一对应：现结→账款页，月结→对账页。

UPDATE `supply_suppliers` SET `settlement_type` = 1 WHERE `settlement_type` = 3;
UPDATE `sale_customers`   SET `settlement_type` = 1 WHERE `settlement_type` = 3;
UPDATE `payment_records`  SET `settlement_type` = 1 WHERE `settlement_type` = 3;

ALTER TABLE `supply_suppliers`
  MODIFY COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式 1现结 2月结';

ALTER TABLE `sale_customers`
  MODIFY COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式 1现结 2月结';

ALTER TABLE `payment_records`
  MODIFY COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式快照 1现结 2月结（生成时固化，不随往来方主数据变更）';
