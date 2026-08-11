/**
 * 会计凭证「业务事件 → 借贷分录」映射（文档 10 · §5.2）
 *
 * ⚠️ Phase 0 现状：本文件是**配置与设计锚点**，尚未接入凭证生成。
 *   - Phase 0（当前）：只定义「事件枚举 + 科目映射规则 + 预置科目清单」，不生成任何凭证。
 *     价值有二：① 强制预置科目 seed（177 迁移）与映射需要的科目一致（下方一致性由
 *     tests/accounting-voucher-mapping 守护）；② 把 Phase 1 凭证引擎的映射规则先定下来、可评审。
 *   - Phase 1：新建 modules/accounting/voucher-engine.js **消费本表**，从既有业务事实（payment_records /
 *     payment_receipts / finance_account_transactions / sale_order_items.cost_snapshot / 退货 / 盘点）
 *     全量重算生成凭证；借贷平衡 assert；UNIQUE(source_type, source_id) 幂等。**只读业务表、只写 acct_*。**
 *
 * 硬约束（文档 10 · §11）：凭证是业务的投影，绝不反向改业务事实。本文件不含任何写业务表的逻辑。
 */

// ─── 业务来源类型（source_type 字符串枚举，禁散落魔法串） ──────────────────────
// 用字符串而非 tinyint：事件类型会随业务演进新增（预付款/押金…），字符串可读、扩展不撞编号。
const SOURCE_TYPES = {
  PURCHASE_SETTLE: 'purchase_settle', // 采购收货上架结算应付
  SALE_REVENUE:    'sale_revenue',    // 销售出库确认收入
  SALE_COGS:       'sale_cogs',       // 销售出库结转成本
  RECEIPT_IN:      'receipt_in',      // 收款核销
  PAYMENT_OUT:     'payment_out',     // 付款核销
  EXPENSE_PAY:     'expense_pay',     // 费用报销付款
  PURCHASE_RETURN: 'purchase_return', // 采购退货出库
  SALE_RETURN:     'sale_return',     // 销售退货入库
  STOCK_CHECK:     'stock_check',     // 盘盈/盘亏
  PERIOD_CLOSE:    'period_close',    // 期末损益结转（source_id = 期间 YYYYMM 数字）
  PERIOD_CLOSE_Y:  'period_close_year', // 年末本年利润转利润分配（source_id = 年份 YYYY 数字）
  MANUAL:          'manual',          // 手工凭证
  // 固定资产（文档10 完整会计准则）
  ASSET_ACQUIRE:   'asset_acquire',   // 固定资产购入入账（source_id = fixed_assets.id）
  ASSET_DEPRECIATION: 'asset_depreciation', // 折旧计提（source_id = fixed_asset_depr.id，台账行本身 UNIQUE(asset_id,period) 幂等）
  ASSET_DISPOSAL:  'asset_disposal',  // 固定资产处置/报废（source_id = fixed_asset_disposals.id）
}

const SOURCE_TYPE_VALUES = Object.values(SOURCE_TYPES)

// 借贷方向（与 acct_accounts.balance_dir / acct_voucher_entries.direction 一致）
const DIR = { DEBIT: 1, CREDIT: 2 }

// ─── 预置科目清单（镜像 177 seed，一致性由测试守护） ──────────────────────────
// category: 1资产 2负债 3权益 4成本 5损益(收入) 6损益(费用)；dir: 1借 2贷；aux: 0无 1往来单位
const PRESET_ACCOUNTS = [
  { code: '1001',   name: '库存现金',       category: 1, dir: DIR.DEBIT,  aux: 0, parentCode: null },
  { code: '1002',   name: '银行存款',       category: 1, dir: DIR.DEBIT,  aux: 0, parentCode: null },
  { code: '1122',   name: '应收账款',       category: 1, dir: DIR.DEBIT,  aux: 1, parentCode: null },
  { code: '1405',   name: '库存商品',       category: 1, dir: DIR.DEBIT,  aux: 0, parentCode: null },
  { code: '1901',   name: '待处理财产损溢', category: 1, dir: DIR.DEBIT,  aux: 0, parentCode: null },
  { code: '2202',   name: '应付账款',       category: 2, dir: DIR.CREDIT, aux: 1, parentCode: null },
  { code: '4103',   name: '本年利润',       category: 3, dir: DIR.CREDIT, aux: 0, parentCode: null },
  { code: '4104',   name: '利润分配',       category: 3, dir: DIR.CREDIT, aux: 0, parentCode: null },
  { code: '2221',   name: '应交税费',       category: 2, dir: DIR.CREDIT, aux: 0, parentCode: null },
  { code: '222101', name: '进项税额',       category: 2, dir: DIR.DEBIT,  aux: 0, parentCode: '2221' },
  { code: '222102', name: '销项税额',       category: 2, dir: DIR.CREDIT, aux: 0, parentCode: '2221' },
  { code: '6001',   name: '主营业务收入',   category: 5, dir: DIR.CREDIT, aux: 0, parentCode: null },
  { code: '6401',   name: '主营业务成本',   category: 6, dir: DIR.DEBIT,  aux: 0, parentCode: null },
  { code: '6601',   name: '销售费用',       category: 6, dir: DIR.DEBIT,  aux: 0, parentCode: null },
  { code: '6602',   name: '管理费用',       category: 6, dir: DIR.DEBIT,  aux: 0, parentCode: null },
]

const PRESET_CODES = new Set(PRESET_ACCOUNTS.map(a => a.code))

// ─── 事件 → 借贷分录规则（草案，Phase 1 消费） ────────────────────────────────
// 每条 leg：{ code 科目编码, dir 借贷, aux 是否往来核算 'supplier'|'customer'|null }
// 说明：
//   - 金额与 aux 对象在 Phase 1 由引擎按业务事实填充，此处只声明「用哪个科目、哪个方向」。
//   - 动态科目（收/付款走银行 1002 还是现金 1001、费用按类别落 6601/6602）在此登记默认科目，
//     引擎按运行期数据择一；下方 referencedAccountCodes() 会把候选科目都算进依赖集。
//   - 税额拆分（进项/销项）仅在发票子模块（Phase 3）上线后追加，此处先不含税分录。
const ACCOUNT_MAPPING = {
  [SOURCE_TYPES.PURCHASE_SETTLE]: {
    summary: '采购入库结算应付',
    legs: [
      { code: '1405', dir: DIR.DEBIT,  aux: null },       // 借 库存商品
      { code: '2202', dir: DIR.CREDIT, aux: 'supplier' }, // 贷 应付账款〔供应商〕
    ],
  },
  [SOURCE_TYPES.SALE_REVENUE]: {
    summary: '销售出库确认收入',
    legs: [
      { code: '1122', dir: DIR.DEBIT,  aux: 'customer' }, // 借 应收账款〔客户〕
      { code: '6001', dir: DIR.CREDIT, aux: null },       // 贷 主营业务收入
    ],
  },
  [SOURCE_TYPES.SALE_COGS]: {
    summary: '销售出库结转成本',
    legs: [
      { code: '6401', dir: DIR.DEBIT,  aux: null }, // 借 主营业务成本
      { code: '1405', dir: DIR.CREDIT, aux: null }, // 贷 库存商品
    ],
  },
  [SOURCE_TYPES.RECEIPT_IN]: {
    summary: '收款核销',
    // 借方走银行存款或库存现金（引擎按资金账户类型择一，默认银行）
    legs: [
      { code: '1002', dir: DIR.DEBIT,  aux: null, altCodes: ['1001'] }, // 借 银行存款/库存现金
      { code: '1122', dir: DIR.CREDIT, aux: 'customer' },               // 贷 应收账款〔客户〕
    ],
  },
  [SOURCE_TYPES.PAYMENT_OUT]: {
    summary: '付款核销',
    legs: [
      { code: '2202', dir: DIR.DEBIT,  aux: 'supplier' },               // 借 应付账款〔供应商〕
      { code: '1002', dir: DIR.CREDIT, aux: null, altCodes: ['1001'] }, // 贷 银行存款/库存现金
    ],
  },
  [SOURCE_TYPES.EXPENSE_PAY]: {
    summary: '费用报销付款',
    // 借方按费用类别落管理费用/销售费用（引擎按 expense_categories 映射，默认管理费用）
    legs: [
      { code: '6602', dir: DIR.DEBIT,  aux: null, altCodes: ['6601'] }, // 借 管理费用/销售费用
      { code: '1002', dir: DIR.CREDIT, aux: null, altCodes: ['1001'] }, // 贷 银行存款/库存现金
    ],
  },
  [SOURCE_TYPES.PURCHASE_RETURN]: {
    summary: '采购退货出库冲应付',
    legs: [
      { code: '2202', dir: DIR.DEBIT,  aux: 'supplier' }, // 借 应付账款〔供应商〕
      { code: '1405', dir: DIR.CREDIT, aux: null },       // 贷 库存商品
    ],
  },
  [SOURCE_TYPES.SALE_RETURN]: {
    summary: '销售退货入库冲收入与成本',
    // 收入冲减(借6001/贷1122) + 成本冲回(借1405/贷6401)，两组分录同一张凭证
    legs: [
      { code: '6001', dir: DIR.DEBIT,  aux: null },       // 借 主营业务收入（冲）
      { code: '1122', dir: DIR.CREDIT, aux: 'customer' }, // 贷 应收账款〔客户〕
      { code: '1405', dir: DIR.DEBIT,  aux: null },       // 借 库存商品（退回入库）
      { code: '6401', dir: DIR.CREDIT, aux: null },       // 贷 主营业务成本（冲）
    ],
  },
  [SOURCE_TYPES.STOCK_CHECK]: {
    summary: '盘盈/盘亏',
    // 盘盈:借1405/贷1901；盘亏:借1901/贷1405（引擎按差异正负择方向）
    legs: [
      { code: '1405', dir: DIR.DEBIT,  aux: null }, // 库存商品
      { code: '1901', dir: DIR.CREDIT, aux: null }, // 待处理财产损溢
    ],
  },
}

/** 映射规则引用到的全部科目编码（含候选 altCodes），用于校验它们都在预置科目中存在 */
function referencedAccountCodes() {
  const set = new Set()
  for (const rule of Object.values(ACCOUNT_MAPPING)) {
    for (const leg of rule.legs) {
      set.add(leg.code)
      for (const alt of (leg.altCodes || [])) set.add(alt)
    }
  }
  return [...set]
}

module.exports = {
  SOURCE_TYPES,
  SOURCE_TYPE_VALUES,
  DIR,
  PRESET_ACCOUNTS,
  PRESET_CODES,
  ACCOUNT_MAPPING,
  referencedAccountCodes,
}
