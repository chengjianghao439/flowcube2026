-- FlowCube ERP - Migration 168
-- 商品序列号管控开关（文档 04 · 序列号管理，仿迁移 121 的 batch_managed）。
--
-- =1 的商品进入"个体制"：收货逐台登记序列号、出库逐台核销。序列号是**容器的下挂个体**，
-- 容器仍是库存唯一事实源；核心不变量：某容器 remaining_qty == 挂在它上、状态=在库的序列号行数。
-- 与 batch_managed 相互独立、可共存。默认 0，存量商品零行为变化。

ALTER TABLE `product_items`
  ADD COLUMN `serial_managed` TINYINT NOT NULL DEFAULT 0
    COMMENT '1=收货逐台登记序列号、出库逐台核销（个体制）；容器下挂个体，数量以容器为准' AFTER `shelf_life_days`;
