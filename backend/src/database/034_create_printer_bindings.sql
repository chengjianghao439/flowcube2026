-- 034: 打印机用途绑定表
-- 将打印类型（waybill / product_label / inventory_label）绑定到具体打印机

CREATE TABLE IF NOT EXISTS `printer_bindings` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `print_type`  VARCHAR(50)     NOT NULL UNIQUE COMMENT '打印类型：waybill/product_label/inventory_label',
  `printer_id`  BIGINT UNSIGNED NOT NULL COMMENT '绑定的打印机 ID',
  `printer_code` VARCHAR(50)    NOT NULL COMMENT '打印机编码（冗余，方便查询）',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_print_type` (`print_type`),
  KEY `idx_printer_id` (`printer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
