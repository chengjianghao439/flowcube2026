-- FlowCube ERP - Migration 177
-- 预置最小科目集（文档 10 · Phase 0）。全部 is_preset=1，凭证映射引擎（voucherSource.js）按 code 引用，不可删/不可改码。
-- 与 backend/src/constants/voucherSource.js 的 PRESET_ACCOUNTS 一一对应（tests/accounting-voucher-mapping 校验两者不漂移）。
-- 科目编码采用企业会计准则常用编码；余额方向 1借 2贷。
--   1001 库存现金 / 1002 银行存款 / 1122 应收账款(往来:客户) / 1405 库存商品 / 1901 待处理财产损溢
--   2202 应付账款(往来:供应商) / 2221 应交税费 [子:222101 进项税额 / 222102 销项税额]
--   6001 主营业务收入 / 6401 主营业务成本 / 6601 销售费用 / 6602 管理费用

INSERT INTO `acct_accounts`
  (`code`, `name`, `category`, `balance_dir`, `parent_id`, `level`, `is_leaf`, `aux_type`, `is_preset`, `sort_order`)
VALUES
  ('1001', '库存现金',       1, 1, NULL, 1, 1, 0, 1, 10),
  ('1002', '银行存款',       1, 1, NULL, 1, 1, 0, 1, 20),
  ('1122', '应收账款',       1, 1, NULL, 1, 1, 1, 1, 30),
  ('1405', '库存商品',       1, 1, NULL, 1, 1, 0, 1, 40),
  ('1901', '待处理财产损溢', 1, 1, NULL, 1, 1, 0, 1, 50),
  ('2202', '应付账款',       2, 2, NULL, 1, 1, 1, 1, 60),
  ('2221', '应交税费',       2, 2, NULL, 1, 0, 0, 1, 70),
  ('6001', '主营业务收入',   5, 2, NULL, 1, 1, 0, 1, 80),
  ('6401', '主营业务成本',   6, 1, NULL, 1, 1, 0, 1, 90),
  ('6601', '销售费用',       6, 1, NULL, 1, 1, 0, 1, 100),
  ('6602', '管理费用',       6, 1, NULL, 1, 1, 0, 1, 110);

-- 应交税费子级（parent 按 code 关联，进项借/销项贷）
INSERT INTO `acct_accounts`
  (`code`, `name`, `category`, `balance_dir`, `parent_id`, `level`, `is_leaf`, `aux_type`, `is_preset`, `sort_order`)
SELECT '222101', '进项税额', 2, 1, p.id, 2, 1, 0, 1, 10 FROM `acct_accounts` p WHERE p.code = '2221'
UNION ALL
SELECT '222102', '销项税额', 2, 2, p.id, 2, 1, 0, 1, 20 FROM `acct_accounts` p WHERE p.code = '2221';
