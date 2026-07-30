-- FlowCube ERP - Migration 151
-- 商品补货策略（按仓 + 通用默认）：给每个商品（可细到每个仓库）设「该备多少」的基准，
-- 支撑补货建议报表与低库存告警的专业化。
--
-- 背景：此前唯一沾边的机制是 notifications.service.js 里硬编码的 threshold=10——所有商品、
-- 所有仓库统一「少于 10 个才告警」，完全不区分品类与仓库。这张表把它升级为真实基准。
--
-- 维度：按仓。warehouse_id=0 是哨兵，表示「该商品的通用默认」，具体仓有行则覆盖默认。
--   取值一律 COALESCE(本仓行, warehouse_id=0 默认行, 0)。
--   *为何用 0 而非 NULL*：MySQL 唯一索引不约束 NULL，(product_id, NULL) 可插入任意多行，
--    「默认值」就不唯一；用 0（非法仓库 id）当哨兵，UNIQUE(product_id, warehouse_id) 才锁得住。
-- 不设 deleted_at：这是配置不是单据，软删会和唯一键打架（软删后再设同商品同仓即撞键）；
--   写入走 upsert（INSERT ... ON DUPLICATE KEY UPDATE），取消某仓特殊设置直接物理 DELETE 回落默认。
-- 语义：safety_stock 安全库存下限（低于=紧急）；reorder_point 补货点（可用+在途 低于此即建议补货）；
--   target_stock 目标库存（补货补到此值，NULL 则补到补货点）。均为 DECIMAL，与库存数量口径一致。
-- 只读展示用途：补货建议/低库存告警读 inventory_stock 缓存投影（非实时容器聚合），不参与库存扣减判定。
CREATE TABLE IF NOT EXISTS product_stock_policies (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL COMMENT '商品 product_items.id',
  warehouse_id  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=该商品通用默认；>0=特定仓 inventory_warehouses.id 覆盖',
  safety_stock  DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '安全库存下限（低于=紧急缺货风险）',
  reorder_point DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '补货点：可用+在途 低于此即建议补货',
  target_stock  DECIMAL(18,4) DEFAULT NULL COMMENT '目标库存，补货补到此值；NULL 则补到补货点',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_product_wh (product_id, warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品补货策略（按仓，warehouse_id=0 为通用默认）';
