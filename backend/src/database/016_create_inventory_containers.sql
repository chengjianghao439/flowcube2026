-- 库存容器模型 Phase 1
-- 支持：唯一条码、标准/拆分容器、批次、父子关系、状态管理
CREATE TABLE IF NOT EXISTS inventory_containers (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,

  -- 唯一标识
  barcode           VARCHAR(64)       NOT NULL                   COMMENT '容器唯一条码（可扫码识别）',

  -- 容器分类
  container_type    TINYINT UNSIGNED  NOT NULL DEFAULT 1         COMMENT '1=标准容器 2=拆分容器',

  -- 父子关系（拆包场景）
  parent_id         BIGINT UNSIGNED       NULL DEFAULT NULL      COMMENT '父容器ID，NULL 表示根容器',

  -- 商品归属
  product_id        BIGINT UNSIGNED   NOT NULL                   COMMENT '关联商品',
  warehouse_id      BIGINT UNSIGNED   NOT NULL                   COMMENT '所在仓库',

  -- 批次信息
  batch_no          VARCHAR(50)           NULL DEFAULT NULL      COMMENT '批次号（多批到货时区分）',
  mfg_date          DATE                  NULL DEFAULT NULL      COMMENT '生产日期',
  exp_date          DATE                  NULL DEFAULT NULL      COMMENT '过期日期',

  -- 数量
  quantity          DECIMAL(12,4)     NOT NULL DEFAULT 0         COMMENT '容器当前数量',
  unit              VARCHAR(20)           NULL DEFAULT NULL      COMMENT '计量单位',

  -- 状态
  status            TINYINT UNSIGNED  NOT NULL DEFAULT 1
    COMMENT '1=在库 2=出库中（已预占）3=已出库 4=已拆分 5=已作废',

  -- 来源单据（可追溯）
  source_ref_type   VARCHAR(30)           NULL DEFAULT NULL      COMMENT '来源类型：purchase_order / split / manual',
  source_ref_id     BIGINT UNSIGNED       NULL DEFAULT NULL      COMMENT '来源单据ID',
  source_ref_no     VARCHAR(50)           NULL DEFAULT NULL      COMMENT '来源单据号',

  remark            VARCHAR(200)          NULL DEFAULT NULL,

  created_at        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        DATETIME              NULL DEFAULT NULL      COMMENT '逻辑删除',

  PRIMARY KEY (id),

  UNIQUE KEY uk_barcode          (barcode),
  KEY        idx_product_wh      (product_id, warehouse_id),
  KEY        idx_parent          (parent_id),
  KEY        idx_batch           (batch_no),
  KEY        idx_status          (status),
  KEY        idx_source          (source_ref_type, source_ref_id),
  KEY        idx_exp_date        (exp_date)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='库存容器表 —— Phase 1 容器模型';
