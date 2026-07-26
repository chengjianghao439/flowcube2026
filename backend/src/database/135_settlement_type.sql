-- FlowCube ERP - Migration 135
-- 结算方式：区分现结 / 月结 / 预付定金 / 货到付款。
--
-- 与迁移 120 的 payment_terms_days 配套：只有月结（2）才带账期天数（30/60/90），
-- 其余三种结算方式账期恒为 0。到期日的起算基准由
-- backend/src/constants/settlementType.js 统一决定（现结/预付从单据创建日起算，
-- 月结/货到付款从结算发生时刻起算）。

ALTER TABLE `supply_suppliers`
  ADD COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式 1现结 2月结 3预付定金 4货到付款' AFTER `remark`;

ALTER TABLE `sale_customers`
  ADD COLUMN `settlement_type` TINYINT NOT NULL DEFAULT 2
    COMMENT '结算方式 1现结 2月结 3预付定金 4货到付款' AFTER `remark`;

-- 存量数据回填：账期 0 天的历史记录语义上就是现结，标为现结；
-- 其余保持默认的月结（2），账期沿用已有的 payment_terms_days。
UPDATE `supply_suppliers` SET `settlement_type` = 1 WHERE `payment_terms_days` = 0;
UPDATE `sale_customers`   SET `settlement_type` = 1 WHERE `payment_terms_days` = 0;

-- 一致性收敛：非月结的账期天数一律归零，避免「现结但账期 30 天」这类矛盾数据。
UPDATE `supply_suppliers` SET `payment_terms_days` = 0 WHERE `settlement_type` <> 2;
UPDATE `sale_customers`   SET `payment_terms_days` = 0 WHERE `settlement_type` <> 2;

-- 月结账期收敛到允许的 30/60/90 三档：不在档位内的存量值就近落到 30。
UPDATE `supply_suppliers`
   SET `payment_terms_days` = 30
 WHERE `settlement_type` = 2 AND `payment_terms_days` NOT IN (30, 60, 90);
UPDATE `sale_customers`
   SET `payment_terms_days` = 30
 WHERE `settlement_type` = 2 AND `payment_terms_days` NOT IN (30, 60, 90);
