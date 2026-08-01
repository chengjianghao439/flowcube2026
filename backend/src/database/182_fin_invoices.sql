-- FlowCube ERP - Migration 182
-- 发票管理（文档 10 · Phase 3 · 设计 §4.5）。进项/销项发票登记本 + 认证/抵扣/红冲台账。
-- 采用「发票池弱关联业务单」口径（设计 §4.5 口径1，风险最低）：发票与采购/销售单 source 弱关联
-- （可空、可后补），**不改 purchase_order_items/sale_order_items 的金额口径**；业务金额继续按现口径
-- （含税总额）走结算，税额只在凭证映射时按本表 tax_amount 拆分「应交税费-进项/销项税额」（见 §5.3）。
-- status 一列双义：进项 1待认证 2已认证 3已抵扣；销项 1已开具 2已红冲（前端按 invoice_type 映射标签）。

CREATE TABLE IF NOT EXISTS `fin_invoices` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_type`     TINYINT       NOT NULL              COMMENT '1进项(采购取得) 2销项(销售开出)',
  `invoice_code`     VARCHAR(20)   DEFAULT NULL          COMMENT '发票代码',
  `invoice_no`       VARCHAR(20)   DEFAULT NULL          COMMENT '发票号码',
  `party_name`       VARCHAR(100)  NOT NULL              COMMENT '对方单位（进项=供应商，销项=客户）',
  `party_tax_no`     VARCHAR(30)   DEFAULT NULL          COMMENT '对方纳税人识别号',
  `amount_no_tax`    DECIMAL(16,2) NOT NULL DEFAULT 0    COMMENT '不含税金额',
  `tax_rate`         DECIMAL(6,4)  NOT NULL DEFAULT 0    COMMENT '税率，如 0.13/0.09/0.06/0.03',
  `tax_amount`       DECIMAL(16,2) NOT NULL DEFAULT 0    COMMENT '税额',
  `amount_with_tax`  DECIMAL(16,2) NOT NULL DEFAULT 0    COMMENT '价税合计（= 不含税 + 税额，入库前校验）',
  `invoice_date`     DATE          NOT NULL              COMMENT '开票日期',
  `status`           TINYINT       NOT NULL DEFAULT 1    COMMENT '进项:1待认证 2已认证 3已抵扣；销项:1已开具 2已红冲',
  `source_type`      VARCHAR(40)   DEFAULT NULL          COMMENT '关联业务：purchase_order/sale_order（可空，允许无单发票）',
  `source_id`        BIGINT UNSIGNED DEFAULT NULL        COMMENT '关联业务单据 id',
  `source_no`        VARCHAR(40)   DEFAULT NULL          COMMENT '关联业务单号快照',
  `remark`           VARCHAR(300)  DEFAULT NULL,
  `operator_id`      BIGINT UNSIGNED DEFAULT NULL,
  `operator_name`    VARCHAR(50)   DEFAULT NULL,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       DATETIME      DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- 发票唯一性：同类型下代码+号码唯一（号码可空时不参与，靠应用层校验必填）
  UNIQUE KEY `uk_fin_invoices_no` (`invoice_type`, `invoice_code`, `invoice_no`),
  KEY `idx_fin_invoices_party` (`party_name`),
  KEY `idx_fin_invoices_source` (`source_type`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='进项/销项发票池（文档10）';
