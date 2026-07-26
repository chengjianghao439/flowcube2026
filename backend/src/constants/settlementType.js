/**
 * 结算方式（供应商应付 / 客户应收共用同一套枚举）
 *
 * 与 `payment_terms_days`（账期天数，迁移 120）的关系：
 *   **只有月结才有账期天数**，其余结算方式账期恒为 0，由
 *   `normalizeTermsDays()` 在写库前强制归零，避免出现「标记现结但账期 30 天」的矛盾数据。
 *
 * 到期日 = 基准日 + 账期天数，基准日按结算方式取两种之一：
 *   | 结算方式 | 基准日             | 账期     |
 *   |---------|-------------------|---------|
 *   | 现结     | **单据创建日**（下单当天就该付） | 0       |
 *   | 月结     | 结算发生时刻（收货上架完成 / 出库完成） | 30/60/90 |
 *
 * 注意现结的基准日是单据创建日，而应付记录要到收货上架完成才创建——
 * 因此下单到收货之间隔了几天的话，应付记录一落库就是逾期状态，会立刻被
 * `notifications.service.js` 的逾期扫描捞出来提醒。这是「下单当天付款」的正确语义，
 * 不是 bug；如果线下已付款，应及时在应付页登记付款。
 *
 * 曾经还有「货到付款」(4) 与「预付/定金」(3) 两档，迁移 137/138 已并入现结：
 * 三者在系统里的到期日基准与账期完全相同，区分不出可执行的差异，只是让建档时多几个
 * 要纠结的选项。现在两档与两个页面一一对应：现结→账款页，月结→对账页。
 */

const SETTLEMENT_TYPE = {
  CASH: 1,    // 现结
  MONTHLY: 2, // 月结
}

const SETTLEMENT_TYPE_NAME = {
  1: '现结',
  2: '月结',
}

/** 前端徽章配色档位，取值需存在于 frontend/src/lib/statusTone.ts 的 6 档中 */
const SETTLEMENT_TYPE_TONE = {
  1: 'warning', // 现结：钱得马上付，列表里要显眼
  2: 'active',  // 月结：最常规
}

/** 迁移 137/138 删除的旧枚举值 → 现在的归属。代码可能先于迁移生效，读到旧值也要落对地方。 */
const LEGACY_TYPE_MAP = {
  3: SETTLEMENT_TYPE.CASH, // 预付/定金
  4: SETTLEMENT_TYPE.CASH, // 货到付款
}

/** 月结允许的账期天数，其余结算方式一律 0 天 */
const MONTHLY_TERMS_OPTIONS = [30, 60, 90]

/** 到期日从「单据创建日」起算的结算方式；其余从结算发生时刻起算 */
const DUE_FROM_ORDER_CREATED = [SETTLEMENT_TYPE.CASH]

const VALID_TYPES = Object.values(SETTLEMENT_TYPE)

function isValidSettlementType(value) {
  return VALID_TYPES.includes(Number(value))
}

/** 落库前归一：非月结强制 0 天；月结只接受 30/60/90，非法值落回 30 */
function normalizeTermsDays(settlementType, days) {
  if (Number(settlementType) !== SETTLEMENT_TYPE.MONTHLY) return 0
  const n = Number(days)
  return MONTHLY_TERMS_OPTIONS.includes(n) ? n : 30
}

/**
 * 归一结算方式：已删除的旧值按 LEGACY_TYPE_MAP 迁移，其余非法值落回月结
 * （与建表默认值一致），保证老数据与异常入参都有确定行为。
 */
function normalizeSettlementType(value) {
  const n = Number(value)
  if (isValidSettlementType(n)) return n
  if (LEGACY_TYPE_MAP[n]) return LEGACY_TYPE_MAP[n]
  return SETTLEMENT_TYPE.MONTHLY
}

/**
 * 生成 due_date 的 SQL 片段与参数。
 *
 * 调用方把返回的 `expr` 直接插进 INSERT 的 VALUES 里、把 `params` 按序展开，
 * 这样「从单据创建日起算」和「从结算时刻起算」两种基准都由本模块统一决定，
 * 应付（inbound-tasks.settle.js）与应收（sale.service.js）不会各写一套。
 *
 * @param {number} settlementType 结算方式
 * @param {number} termsDays      账期天数（已归一）
 * @param {Date|string} orderCreatedAt 单据创建时间，仅现结会用到
 */
function buildDueDateSql(settlementType, termsDays, orderCreatedAt) {
  const type = normalizeSettlementType(settlementType)
  const days = normalizeTermsDays(type, termsDays)
  if (DUE_FROM_ORDER_CREATED.includes(type) && orderCreatedAt) {
    return { expr: 'DATE_ADD(DATE(?), INTERVAL ? DAY)', params: [orderCreatedAt, days] }
  }
  return { expr: 'DATE_ADD(NOW(), INTERVAL ? DAY)', params: [days] }
}

/**
 * 账款页负责的结算方式。现在只剩现结一种，仍保留数组形式：
 * 接口参数 `settlementTypes` 本就支持多值，将来若再分档不必改调用方。
 */
const IMMEDIATE_SETTLEMENT_TYPES = [SETTLEMENT_TYPE.CASH]

/**
 * 按结算方式过滤账款的判定列。
 *
 * 读的是 `payment_records.settlement_type` 这个**快照**（迁移 136），而不是回溯往来方主数据——
 * 账款是历史事实，当初按什么条件结算就是什么条件。把客户从现结改成月结，只影响他之后
 * 新产生的账款，已生成的老账不会整批搬家。
 */
const SETTLEMENT_SCOPE_COLUMN = 'pr.settlement_type'

module.exports = {
  SETTLEMENT_TYPE,
  SETTLEMENT_TYPE_NAME,
  SETTLEMENT_TYPE_TONE,
  MONTHLY_TERMS_OPTIONS,
  DUE_FROM_ORDER_CREATED,
  IMMEDIATE_SETTLEMENT_TYPES,
  SETTLEMENT_SCOPE_COLUMN,
  isValidSettlementType,
  normalizeSettlementType,
  normalizeTermsDays,
  buildDueDateSql,
}
