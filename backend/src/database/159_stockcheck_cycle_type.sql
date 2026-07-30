-- FlowCube ERP - Migration 159
-- 循环盘点（文档 08）：给盘点单加类型与范围快照。取向=复用现有全盘内核，只改"这次盘哪些"。
--
-- 现状 inventory_checks 是全盘：create 拉全仓 ACTIVE 容器所有有货商品为明细，提交时整单校验漂移
-- （任一行漂移整单 409）。大仓不停机时几乎必然触发 409。循环抽盘=每次只盘小范围，把 409 爆炸面
-- 从"全仓"缩到"本次范围"。check_type 默认 1，存量全盘单与现有 create 路径零影响。
-- scope_type/scope_value 是审计快照（本单当初盘的哪个范围），不是执行依赖（明细已展开成具体行）。

ALTER TABLE `inventory_checks`
  ADD COLUMN `check_type` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '盘点类型：1=全盘 2=循环抽盘' AFTER `warehouse_name`,
  ADD COLUMN `scope_type` VARCHAR(16) NULL
    COMMENT '抽盘范围维度：abc / zone / manual；全盘为 NULL' AFTER `check_type`,
  ADD COLUMN `scope_value` VARCHAR(64) NULL
    COMMENT '范围取值快照，如 A/B/C（abc）或库区/货架（zone）；全盘为 NULL' AFTER `scope_type`;
