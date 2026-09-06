-- 顺丰/德邦官方月结直连：整批实际箱数、原始下单快照、未知结果只查询。
ALTER TABLE carriers
  ADD COLUMN shipping_product VARCHAR(32) DEFAULT NULL COMMENT '默认官方产品编码',
  ADD COLUMN shipping_delivery_type VARCHAR(8) DEFAULT NULL COMMENT '德邦送货方式1自提3不上楼4上楼';
ALTER TABLE sale_orders
  ADD COLUMN shipping_product VARCHAR(32) DEFAULT NULL COMMENT '本单指定官方产品编码，空则沿用承运商配置';
ALTER TABLE logistics_waybills
  ADD COLUMN direct_batch_key VARCHAR(80) DEFAULT NULL COMMENT '直连仓库任务及分批唯一键',
  ADD COLUMN shipment_json JSON DEFAULT NULL COMMENT '寄收件、实际包裹和产品快照，不含重量',
  ADD COLUMN direct_request JSON DEFAULT NULL COMMENT '已提交平台业务报文及凭据引用，不含密钥',
  ADD COLUMN tracking_numbers JSON DEFAULT NULL COMMENT '本批母子运单号集合',
  ADD UNIQUE KEY uk_direct_batch (direct_batch_key);
