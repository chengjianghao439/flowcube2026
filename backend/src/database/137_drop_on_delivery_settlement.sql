-- FlowCube ERP - Migration 137
-- 删除「货到付款」(4) 结算方式，并入「现结」(1)。
--
-- 迁移 135 引入四种结算方式时把货到付款单列了一档，与现结的差别只有到期日基准：
-- 现结从单据创建日起算、货到付款从收货/发货时刻起算。实际业务里这两个时点只差一两天，
-- 对方要付的钱和催收节奏完全一样，多这一档只是让建档时多一个要纠结的选项。
--
-- 执行时本地与生产均无 settlement_type=4 的数据（已核对），下面的 UPDATE 是防御性的：
-- 若代码已部署而本迁移尚未执行，遗留的 4 会被 normalizeSettlementType() 兜底映射成现结，
-- 两边行为一致，不会出现「一部分账款归错页面」的中间态。
--
-- 保留 3（预付定金）不动：它的业务含义是先付款后供货，与现结的先货后款方向相反。

UPDATE `supply_suppliers` SET `settlement_type` = 1 WHERE `settlement_type` = 4;
UPDATE `sale_customers`   SET `settlement_type` = 1 WHERE `settlement_type` = 4;
UPDATE `payment_records`  SET `settlement_type` = 1 WHERE `settlement_type` = 4;

-- 同步列注释，避免注释与枚举脱节（第 8 节列过这类漂移的事故）
ALTER TABLE `supply_suppliers`
  MODIFY COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式 1现结 2月结 3预付定金';

ALTER TABLE `sale_customers`
  MODIFY COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式 1现结 2月结 3预付定金';

ALTER TABLE `payment_records`
  MODIFY COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式快照 1现结 2月结 3预付定金（生成时固化，不随往来方主数据变更）';
