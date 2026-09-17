-- 回填缺失的库位条码（2026-09-17 验收 ISSUE-018）
--
-- 背景：新建库位会自动写入条码 `R+6位ID`（locations.service.makeLocationBarcode），
-- 但历史/测试库位（例如开发库上海分仓唯一库位 SH-A01、北京主仓 SMK-396842）barcode 为空。
-- PDA 上架/调拨调入扫不到条码就落不了库，现场表现为「调拨永远在途、上架卡在第二步」。
--
-- 处理：仅回填 barcode 为空（NULL 或空串）的库位，取自身 ID 生成 `R+6位`；
-- 已有条码的库位不动（避免覆盖现场已打印的标签）。幂等：重复执行不会改变结果。
-- 说明：`RPAD(CAST(id AS CHAR), 6, '0')` 对 7 位以上 ID 不会截断，与后端
-- makeLocationBarcode 的实现（padStart(6,'0')）一致。
UPDATE `warehouse_locations`
   SET `barcode` = CONCAT('R', LPAD(CAST(`id` AS CHAR), 6, '0'))
 WHERE `deleted_at` IS NULL
   AND (`barcode` IS NULL OR `barcode` = '');
