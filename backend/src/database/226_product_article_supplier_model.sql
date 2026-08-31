-- FlowCube ERP - Migration 226
-- product_items.article_number 语义从「货号」改为「供应商型号」
--
-- 背景（2026-09 用户反馈）：
-- - 原「货号」字段只在留空时自动生成 6 位随机数（products.service.create），无业务含义。
-- - 真正的需求：系统型号（spec）可能与供应商型号不一致，需单独记录「供应商型号」。
-- - 故把 article_number 的语义改为「供应商型号」，并取消自动生成（供应商型号人工填）。
--
-- 本迁移只改字段 COMMENT（列名/类型/数据不动）：
-- - article_number 被 7 张业务表快照引用（迁移 092/093/095/096/097/099/114），改列名=改全部引用，
--   风险大、收益低，故列名保持 article_number，仅前端展示与 COMMENT 语义统一为「供应商型号」。
-- - 7 张业务表的快照列注释不随动（避免大迁移），语义跟随主档。
--
-- 幂等：MODIFY COLUMN 更新 COMMENT 本身幂等，重复执行不报错。

ALTER TABLE `product_items`
  MODIFY COLUMN `article_number` VARCHAR(100) DEFAULT NULL COMMENT '供应商型号（供应商给的商品型号，可能异于系统型号 spec）';
