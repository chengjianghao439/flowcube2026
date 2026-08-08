-- FlowCube ERP - Migration 192
-- 条码与序列号融合 Phase 4（设计文档 13）：序列号体系整套下线。
--
-- 背景：一物一码改由「系统打印的库存条码」承担（container_type=1 且 initial_qty=1 的库存容器
-- 即个体），厂家机身码不再采集。序列号相关链路已随 Phase 3（v0.4.58）全部摘除，本迁移删除
-- 其数据库残留。
--
-- 生产数据核查（2026-08-09，删表前已确认）：product_serials / serial_events /
-- inventory_check_item_serials 三张表生产均为 0 行、开启 serial_managed 的商品为 0 个，
-- 无真实数据需要归档，可直接删表。
--
-- 文档 13 §3.1 曾建议保留 inventory_containers.external_code（厂家码辅助查询列）：鉴于生产
-- 从未录入过厂家码、且业务取向已明确「唯一身份用系统打印的条码」，该列没有查询对象，省去。

DROP TABLE IF EXISTS `product_serials`;
DROP TABLE IF EXISTS `serial_events`;
DROP TABLE IF EXISTS `inventory_check_item_serials`;

ALTER TABLE `product_items` DROP COLUMN `serial_managed`;

-- 回收序列号权限码（权限码常量同步从 permissions.js / permission-codes.ts 删除）
DELETE FROM sys_role_permissions WHERE permission IN ('serial.view', 'serial.manage');
