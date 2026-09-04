-- 销售收货信息支持部门名称、座机和国际号码；与 sale_orders 已有宽字段保持一致。
ALTER TABLE sale_customer_addresses
  MODIFY COLUMN receiver_name VARCHAR(30) DEFAULT NULL COMMENT '收货人或收货部门',
  MODIFY COLUMN receiver_phone VARCHAR(30) DEFAULT NULL COMMENT '手机、座机或国际联系电话';
