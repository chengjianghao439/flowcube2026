-- FlowCube ERP - Migration 150
-- 客户常用地址簿：按客户存「常发的几个收货地址」，供新建/编辑销售单时双击选用。
--
-- 背景：销售单收货信息（收货人/电话/地址）此前是纯手填，同一客户往往固定发那么
-- 几个地址，每次重敲既慢又易错。这里按客户持久化常用地址，跨单据/跨设备复用。
-- 只是「填进销售单已有的 receiver 字段」的便捷数据，不参与库存/账款/状态机。
--
-- 字段口径与销售单收货字段保持一致（收货人≤5 / 手机号 11 位 / 地址≤30，由后端 zod
-- 校验兜住），保证任何存下来的地址都能原样落进订单表单、不被截断。列宽给足冗余。
-- is_default 至多一条为真，由 service 在事务内「先清零再置一」保证，不用生成列唯一索引。
-- 不加外键：sale_customers 走 deleted_at 逻辑删除，且这张表纯便捷数据、无账务后果
-- （同 dashboard_layouts 的取舍）；客户删除与否不牵连历史地址。
CREATE TABLE IF NOT EXISTS sale_customer_addresses (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id      BIGINT UNSIGNED NOT NULL COMMENT '客户 sale_customers.id',
  receiver_name    VARCHAR(20)  DEFAULT NULL COMMENT '收货人',
  receiver_phone   VARCHAR(20)  DEFAULT NULL COMMENT '联系电话',
  receiver_address VARCHAR(200) NOT NULL COMMENT '收货地址',
  is_default       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否默认地址：每客户至多一条为真，由 service 事务保证',
  sort_order       INT NOT NULL DEFAULT 0 COMMENT '排序，越小越靠前',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_cust_addr_customer (customer_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户常用收货地址簿';
