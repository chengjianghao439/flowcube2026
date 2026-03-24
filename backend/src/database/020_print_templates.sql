CREATE TABLE IF NOT EXISTS print_templates (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100)    NOT NULL                  COMMENT '模板名称',
  type        TINYINT         NOT NULL                  COMMENT '1=销售订单 2=采购订单 3=出库单 4=仓库任务单',
  paper_size  VARCHAR(20)     NOT NULL DEFAULT 'A4'     COMMENT 'A4/A5/A6/thermal80/thermal58',
  layout_json JSON            NOT NULL                  COMMENT '布局 JSON',
  is_default  TINYINT(1)      NOT NULL DEFAULT 0        COMMENT '是否默认模板',
  created_by  VARCHAR(50)     DEFAULT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打印模板';
