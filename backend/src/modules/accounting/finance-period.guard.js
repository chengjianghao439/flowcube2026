/**
 * 资金/账款侧的会计期间闸门（2026-09-26 一致性审查 · 任务 7）。
 *
 * 为什么不复用凭证侧的 assertPeriodOpen：
 *   两者的**判定**相同（都读 acct_periods.status=2），但**处置**不同。凭证侧面对的是
 *   「这张凭证不该存在」，措辞是「如需调整请先反结账」；而收付款/退款这类资金业务面对的是
 *   「这笔钱确实发生在那个月，可账已经封了」——反结账会连带打开整个期间的凭证，
 *   代价远大于补一笔。所以资金侧的处置是：**默认拒绝 + 特权补录 + 全程留痕**。
 *
 * 病灶（本模块存在的理由）：
 *   结账后若仍把 payment_entries 写进该期间，voucher-engine 会命中已结账期间而跳过生凭证
 *   （见 voucher-engine.js 的 stats.skippedClosed）。结果是钱动了、资金账户流水动了，
 *   会计账上却没有这笔，且无人知晓——账实不符。
 *
 * 落点（写 payment_entries 的三个入口，也就是 receipt_in / payment_out / refund_pay
 * 三个凭证来源的产生点）：
 *   · payments.service.js          recordPayment   —— 直付登记
 *   · payment-receipts.service.js  applyAllocations—— 收付款单核销
 *   · refund-orders.service.js     execute         —— 退款出账
 */

const AppError = require('../../utils/AppError')
const { pool } = require('../../config/db')
const { PERMISSIONS } = require('../../constants/permissions')
const { hasPermission } = require('../../middleware/auth')
const { lockAccountingCompany, lockAccountingCompanyShared } = require('./accounting.period-lock')
// 「补录当期」必须按北京时间的当期判定（业务时间唯一权威时区），不要用裸 new Date() 的本地字段
const { beijingTodayYmd } = require('../../utils/backendTime')
const { creationFingerprint, stableStringify } = require('../../utils/operationRequest')

/** 补录原因的最短长度：太短的原因（"补"、"改"）事后无法判断动机 */
const REASON_MIN = 4

/**
 * finance_period_backfills.status 取值的唯一权威定义（迁移 260 的列注释与之对齐）。
 * 定义在这里而不是 service：闸门（本模块）要按状态判断「这个请求键用过没有、原单什么状态」，
 * 而 service 依赖本模块——常量放在被依赖的一侧，避免两边各写一份而漂移。
 */
const STATUS = {
  PENDING: 0,   // 待审批
  APPROVED: 1,  // 已批准（executed_at 为空 = 已批准但尚未执行成功）
  REJECTED: 2,  // 已驳回
  LEGACY: 3,    // 历史遗留：迁移前第一期同步补录，无审批环节，需人工核对
  VOIDED: 4,    // 已作废：不再执行、不动账（迁移 261）。用于「已批准但业务已不可执行」时退出流程
}

/**
 * 业务日期归一化为 YYYY-MM-DD。
 * 与 voucher-engine.toDateStr 同规则（Date 按北京时间取字段，字符串取前 10 位）——
 * 两处必须一致，否则「凭证落在哪个期间」与「闸门拦哪个期间」会错位。
 */
function toYmd(v) {
  if (v instanceof Date) return beijingTodayYmd(v)
  return String(v || '').slice(0, 10)
}

/** YYYY-MM-DD → YYYYMM，与 voucher-engine.periodOf 同规则 */
const periodOfDate = (ymd) => `${ymd.slice(0, 4)}${ymd.slice(5, 7)}`

/**
 * 资金业务的期间闸门。业务日期落在已结账期间时：
 *   · 未开补录 → 409 FINANCE_PERIOD_CLOSED，并把「怎么补录」写进消息；
 *   · 已开补录（调用方已校验权限与原因）→ 放行，由调用方随后写留痕。
 *
 * 加锁与凭证引擎同序（先账套行、后期间行），保证「检查期间是否结账」与「结账动作」互斥，
 * 不会出现检查时未结账、写入时已结账。
 *
 * 但**取的是共享锁**，不是排他锁（2026-09-26 修订）：闸门只读一眼期间状态，不写会计账。
 * 若用排他锁，两笔互不相干的收款也要在同一把账套锁上排队，正常登记被无谓串行化
 * （实测 F01 并发收款直接 5 秒锁等待超时）。共享锁下：登记 vs 登记 兼容（并发）；
 * 登记 vs 结账 互斥（结账在 closePeriod 取排他锁，照样挡得住）。
 *
 * 补录分支是例外，仍走排他锁：它要往**已结账期间**写凭证，属于会计账写入，必须独占。
 * 两条分支各自内部锁模式一致（要么全共享、要么全排他），不会出现同事务 S→X 升级。
 *
 * 凭证生成路径同样以账套行为最外层锁，且不在业务事务内被调用，故与此处不构成环路。
 *
 * @param {*} conn 事务连接（调用方已开启事务）
 * @param {string|Date} businessDate 业务发生日期
 * @param {{companyId?: number, bizLabel?: string, backfill?: {mode?: string, postingPeriod?: string, reason?: string}|null}} opts
 * @returns {Promise<{ymd: string, period: string, closed: boolean, voucherDateOverride: string|null}>}
 *   closed=true 表示这是一次已授权的补录；voucherDateOverride 是该补录凭证应落的日期
 */
async function assertFinancePeriodOpen(conn, businessDate, opts = {}) {
  const { companyId = 1, bizLabel = '该笔业务', backfill = null } = opts
  const ymd = toYmd(businessDate)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new AppError(`${bizLabel}缺少有效的业务发生日期，无法判断所属会计期间`, 400, 'FINANCE_PERIOD_NO_DATE')
  }
  const period = periodOfDate(ymd)
  // 普通登记：共享锁（并发不被彼此挡住，但要等结账）；补录：排他锁（要写已结账期间）。
  if (backfill) await lockAccountingCompany(conn, companyId)
  else await lockAccountingCompanyShared(conn, companyId)
  const [[row]] = await conn.query(
    `SELECT status FROM acct_periods WHERE period = ? AND company_id = ? ${backfill ? 'FOR UPDATE' : 'FOR SHARE'}`,
    [period, companyId],
  )
  const closed = !!row && Number(row.status) === 2
  if (!closed) return { ymd, period, closed: false, voucherDateOverride: null }
  if (backfill) {
    // 补录：业务日期所属期间已结账，业务写入放行；但**补录当期**（凭证归属期间）必须仍未结账，
    // 否则凭证落不下去——钱进账、会计账上没有，正是本模块存在的理由。
    //
    // 这道复核必须在这里做：调用方在业务事务外算出的 postingPeriod 只是一次预检，从预检到
    // 写入之间存在会计结账的窗口。此处已在业务事务内、且已持有账套行锁与期间行锁，
    // 读到的才是真正生效的状态——预检放行不代表写入时仍放行。
    await assertBackfillPostingPeriodOpen(conn, companyId, backfill.postingPeriod || period, { lockForUpdate: true })
    return {
      ymd,
      period,
      closed: true,
      // 凭证归属日期用**执行审批的今天**，不是业务日期：补录凭证落补录当期（前期差错在当期调整）。
      // 资金流水的 happened_at 仍是 ymd——钱确实是那天动的，银行对账依据它，不能改。
      voucherDateOverride: beijingTodayYmd(),
    }
  }
  throw new AppError(
    `会计期间 ${period} 已结账，${bizLabel}的日期（${ymd}）落在该期间内，不能登记：`
    + '账已封存，此时登记会让这笔钱进入已结账期间的凭证之外（钱动了账不记）。'
    + '请改用未结账的日期登记；若这笔业务确实发生在该期间，'
    + '需由持「跨期补录」权限的财务主管填写原因后补录。',
    409,
    'FINANCE_PERIOD_CLOSED',
    { period, businessDate: ymd },
  )
}

/**
 * 从请求体解析「跨期补录**申请**」意图与授权。
 *
 * 权限是**条件校验**而非路由级：日常（未结账期间）登记不受此权限影响，
 * 只有显式请求补录时才要求 finance.period.backfill。若做成路由中间件，
 * 没这个权限的出纳连正常付款都做不了。
 *
 * 用 hasPermission 而非直接查 req.user.permissions：超管（roleId=1）在权限中间件里是
 * 硬编码豁免的，其 permissions 数组里并没有这个新权限码——各写一份判定必然漏掉超管。
 *
 * 注意这里是**申请**而非放行：业务口径为「先审批、后动账」，申请只落一张待审批单
 * （finance_period_backfills.status=0），业务数据不写；批准是**他人**的权限，见
 * finance-backfills.service.approve。
 *
 * @returns {{reason: string, applicantId: number|null, applicantName: string|null}|null} null = 本次不申请
 */
function resolveBackfillRequest(req) {
  if (!req?.body?.backfillRequest) return null
  if (!hasPermission(req, PERMISSIONS.FINANCE_PERIOD_BACKFILL)) {
    throw new AppError(
      '当前账号没有跨期补录权限，不能申请把业务登记进已结账的会计期间。'
      + '请改选未结账的日期，或让持该权限的财务主管操作。',
      403,
      'FINANCE_BACKFILL_FORBIDDEN',
    )
  }
  const reason = String(req.body?.backfillReason || '').trim()
  if (reason.length < REASON_MIN) {
    throw new AppError(
      `跨期补录申请必须填写原因（至少 ${REASON_MIN} 个字），以便审批人判断这笔业务为什么记在已结账期间`,
      400,
      'FINANCE_BACKFILL_REASON_REQUIRED',
    )
  }
  return {
    reason,
    applicantId: req.user?.userId ?? null,
    applicantName: req.user?.realName || req.user?.username || null,
  }
}

/**
 * 补录凭证的归属期间 = **补录当期**（业务口径 2026-09-26 确认：前期差错在当期调整）。
 *
 * 「当期」= **执行审批日所在的会计期间**（北京时间）。
 *
 * 为什么不是「业务期间之后第一个未结账期间」（本函数的第一版写法）：那会在历史期间存在
 * **开放空档**时把调整凭证落进过去的月份。例如补录一笔 2024-03 的业务，而 2024-05 从没
 * 结过账——第一版会落到 202405。那不是「当期调整」，是把账改回两年前，且下一次有人补录
 * 会落到同一个旧月份，越积越偏。**当期就是当期，与业务发生在哪个月无关。**
 *
 * 当期已结账时**明确拒绝**，不静默回落到任何期间：把当期账面改写本身是重大动作，
 * 该由人决定是反结账当期还是另走流程，不能由系统替会计挑一个「恰好还能写」的月份。
 *
 * @param {*} conn
 * @param {number} companyId
 * @param {string|Date|null} atDate 执行审批的业务日期；缺省取北京今天（仅供测试注入）
 * @returns {Promise<string>} YYYYMM
 */
async function resolvePostingPeriod(conn, companyId, atDate = null) {
  const ymd = atDate ? toYmd(atDate) : beijingTodayYmd()
  const period = periodOfDate(ymd)
  await assertBackfillPostingPeriodOpen(conn, companyId, period)
  return period
}

/**
 * 补录当期（凭证归属期间）的开放校验。**这是本次补录能否执行的最后一道期间防线**，
 * 两处调用、强度不同：
 *   · resolvePostingPeriod 调它（不加锁）= 执行前的**预检**，好在写业务之前就给出明确拒绝；
 *   · assertFinancePeriodOpen 在业务事务内调它（lockForUpdate） = **真正的防线**——
 *     预检通过后、业务写入前，会计仍可能把当期结掉，那时凭证就没有落脚处了。
 *
 * @param {boolean} lockForUpdate 是否对期间行加锁（必须在业务事务内使用）
 */
async function assertBackfillPostingPeriodOpen(conn, companyId, postingPeriod, { lockForUpdate = false } = {}) {
  const [[row]] = await conn.query(
    `SELECT status FROM acct_periods WHERE company_id = ? AND period = ?${lockForUpdate ? ' FOR UPDATE' : ''}`,
    [companyId, postingPeriod],
  )
  if (row && Number(row.status) === 2) {
    throw new AppError(
      `补录当期 ${postingPeriod} 已结账，调整凭证无处可落。跨期补录的凭证只能做在未结账的当期：`
      + `请先反结账 ${postingPeriod} 再执行本笔补录，或与财务主管确认处理方式。`,
      409,
      'FINANCE_BACKFILL_POSTING_PERIOD_CLOSED',
      { postingPeriod },
    )
  }
  return postingPeriod
}

/**
 * 申请单号：`BF-<受理日期>-<id4>`。日期取 DB 的 created_at（库时区 +08:00），
 * 而不是应用服务器的本地时区——同一张单在两个时区不同的部署上必须显示同一个号。
 * 列表查询复用同一表达式，避免「详情页和列表页单号不一致」。
 */
const APPLICATION_NO_SQL = "CONCAT('BF-', DATE_FORMAT(created_at, '%Y%m%d'), '-', LPAD(id, 4, '0'))"

/** JSON 列读回来的可能是对象也可能是字符串（取决于驱动配置），两种都要能比 */
function parseSnapshot(raw) {
  if (raw == null) return null
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return null }
}

/**
 * 落一张补录申请单（status=0 待审批）。业务数据此时**一律不写**——
 * 批准前这笔钱不进账，避免「钱动了、会计账上还没有、然后被驳回」的窗口。
 *
 * 与业务写入**不**同事务（申请成功即提交）：申请单是独立记录，业务回滚不该抹掉申请。
 *
 * ## 幂等（本函数最容易做错的地方）
 *
 * 申请会被重复提交：出纳点提交 → 网络超时 → 重开弹窗再提交。两张内容相同的单子摆在
 * 审批人面前，批准两次就是同一笔钱记两次账。
 *
 * **身份 = 请求键 `requestKey`，且是全生命周期的身份**：一次操作一个键，键相同才是同一次
 * 操作。客户端约定与 operation_requests 一致——超时后**保留原键**重发或查询上次结果，
 * 不换键重发；换了键就是声明「这是新的一次业务」。
 *
 * 为什么身份在**终态也不能释放**（唯一约束覆盖全生命周期，而不是只在途）：
 *   申请分支跑在业务 operation_requests 落回执**之前**。若键在已执行/已驳回后释放，
 *   同一次操作的超时重放就会绕过回执、直接再插一张新申请单——出纳看到「申请已提交」，
 *   库里却多了一张迟早被人批准的单子，同一笔钱记两次。**「这次操作办完了」不等于
 *   「这个身份可以再用」**：身份跟着操作走，不跟着状态走。
 *
 * 为什么身份不是 biz_id，也不是载荷指纹（两者都试过，都会丢账）：
 *   · `biz_id` 是账款 id，同一笔账款天然有多次付款（先付 5000，再付 3000）→ 按它去重
 *     会把第二笔并进第一张单；
 *   · 载荷指纹同样拦不住「同一账款、同一天、两次各 500 元」——金额/日期/方式/账户**全一样**，
 *     指纹必然相同，第二笔照样被并掉，且要等对账才发现少了 500。
 *   指纹能证明「两次提交内容相同」，**不能证明「这是同一次操作」**。
 *   丢账比重复记账更糟：重复记账对账能查出来，丢账要等一笔钱不见了才知道。
 *
 * 指纹降级为**同键载荷不可变校验**（见 replayExistingApplication）：同键重发时载荷必须一致。
 *
 * 无请求键（客户端没传）时不参与唯一约束、不做幂等：与 operation_requests「无键即无幂等」
 * 的既有语义一致。这是客户端契约问题，不该由本函数猜。
 *
 * 并发不在应用层判断：直接 INSERT，由唯一索引 `uk_fpb_request_key`（迁移 260）挡。
 * 先 SELECT 再 INSERT 是 TOCTOU——两个并发请求都读到「不存在」，然后各插一行，谁也拦不住。
 * 「是否已存在」与「写入」必须是同一个原子操作，也就是那次 INSERT 本身。
 *
 * @param {object} p
 * @param {string|null} p.requestKey 本次操作的幂等键；同键即同一次操作
 * @param {object|null} p.fingerprintPayload 参与载荷指纹的业务字段（金额/日期/方式/账户/…），
 *   仅用于校验同键载荷未变
 * @returns {Promise<{id: number, applicationNo: string, reused?: boolean}>}
 */
async function recordBackfillApplication(conn, {
  companyId = 1, period, businessDate, bizType, bizId = null, bizNo = null,
  amount = null, reason, requestSnapshot = null, requestKey = null,
  fingerprintPayload = null,
  applicantId = null, applicantName = null,
}) {
  const fingerprint = creationFingerprint({ bizType, bizId, payload: fingerprintPayload ?? null })
  let insertId
  try {
    const [result] = await conn.query(
      `INSERT INTO finance_period_backfills
         (company_id, period, business_date, biz_type, biz_id, biz_no, amount, reason,
          request_snapshot, request_key, payload_fingerprint,
          applicant_id, applicant_name, operator_id, operator_name, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [companyId, period, businessDate, bizType, bizId, bizNo, amount, reason,
        requestSnapshot ? JSON.stringify(requestSnapshot) : null, requestKey, fingerprint,
        applicantId, applicantName, applicantId, applicantName],
    )
    insertId = result.insertId
  } catch (e) {
    // 撞唯一键 = 这个请求键已经用过（同一次操作的重放），读回原来那张单子。
    // 注意：不同键的同载荷不会撞键——那是两笔业务，各落各的单。
    if (e?.code !== 'ER_DUP_ENTRY') throw e
    return replayExistingApplication(conn, { companyId, bizType, requestKey, fingerprint, requestSnapshot })
  }
  const [[row]] = await conn.query(
    `SELECT ${APPLICATION_NO_SQL} AS application_no FROM finance_period_backfills WHERE id = ?`,
    [insertId],
  )
  return { id: insertId, applicationNo: row.application_no }
}

/**
 * 同键重放时读回**原来那张**申请单（不限状态），并校验载荷确实没变。
 *
 * 读回的行必然是同一键的（唯一索引保证）。但键相同**不代表内容相同**——客户端若把同一个键
 * 用在了另一笔业务上（键管理缺陷、或前端复用变量），沉默返回就会让出纳以为自己的钱进了审批，
 * 而那张单写的是别的内容。两种成因分开报：
 *   · 指纹不同 → 键被复用到了别的内容，报错要求换键重试（本次内容一笔都没丢，重新提交即可）；
 *   · 指纹相同但快照不同 → 指纹字段漏了影响金额的字段，属编程疏漏，同样报错交人工。
 *
 * 指纹一致时**返回原单的当前状态**，让调用方如实呈现：待审批 → 「已提交待审批」；
 * 已执行 → 「这次操作当时已经完成」；已驳回 → 「那张申请被驳回了，要重来请换一个新的
 * 请求键」。三种情况都**不新增第二张单**、也不写任何业务数据——重放一次操作不会多记一笔账。
 */
async function replayExistingApplication(conn, { companyId, bizType, requestKey, fingerprint, requestSnapshot }) {
  const [[existing]] = await conn.query(
    `SELECT id, status, executed_at, request_snapshot, payload_fingerprint, period, business_date,
            ${APPLICATION_NO_SQL} AS application_no
       FROM finance_period_backfills
      WHERE company_id = ? AND biz_type = ? AND request_key = ?
      ORDER BY id LIMIT 1`,
    [companyId, bizType, requestKey],
  )
  if (!existing) {
    // 唯一键报了冲突、却读不回那一行：并发事务还没提交，等它提交后再查就能看到
    throw new AppError(
      '这次提交已经有一张补录申请了，请稍后刷新查看，不要重复提交',
      409,
      'FINANCE_BACKFILL_CONFLICT',
    )
  }
  if (String(existing.payload_fingerprint || '') !== String(fingerprint || '')) {
    throw new AppError(
      '这个请求键已经用在另一笔内容不同的补录申请上了。'
      + '请用新的请求键重新提交本次业务，以免两笔业务混成一张单。',
      409,
      'FINANCE_BACKFILL_REQUEST_KEY_REUSED',
    )
  }
  if (stableStringify(parseSnapshot(existing.request_snapshot)) !== stableStringify(requestSnapshot ?? null)) {
    throw new AppError(
      '这个请求键对应的补录申请内容与本次提交不一致。'
      + '为避免把两笔不同的业务当成同一笔，请先到「跨期补录审批」页查看那张申请单。',
      409,
      'FINANCE_BACKFILL_SNAPSHOT_MISMATCH',
    )
  }
  // 作废单上的键仍然占着唯一索引（见迁移 260 的长注释），所以同一次操作的重放会读回一张
  // **已经作废**的单子。此时绝不能按「已提交待审批」返回：出纳会拿着一个永远不会被执行的
  // 单号等下去。明确告知并要求重新申请（前端重开对话框会生成新键）。
  if (Number(existing.status) === STATUS.VOIDED) {
    throw new AppError(
      '这次提交对应的补录申请已经作废，不会被执行。请重新发起补录申请。',
      409,
      'FINANCE_BACKFILL_VOIDED',
    )
  }
  return {
    id: Number(existing.id),
    applicationNo: existing.application_no,
    reused: true,
    // 原单当前状态，供调用方如实呈现（而不是一律当成「刚提交待审批」）
    status: Number(existing.status),
    executed: !!existing.executed_at,
    rejected: Number(existing.status) === STATUS.REJECTED,
    period: existing.period,
    businessDate: existing.business_date instanceof Date
      ? toYmd(existing.business_date)
      : String(existing.business_date).slice(0, 10),
  }
}

/**
 * 按请求键读回这张单（**不限状态**）。请求键为空（客户端没传键）时返回 null：
 * 没有身份就无从判断「是不是同一次操作」，无从复用，只能按新业务受理。
 *
 * 返回结构刻意与 recordBackfillApplication 的返回值同形（都带 id/applicationNo/reused），
 * 让调用方两条路径共用同一段响应代码。
 */
async function findApplicationByRequestKey(conn, { companyId = 1, bizType, requestKey }) {
  if (!requestKey) return null
  const [[row]] = await conn.query(
    `SELECT id, status, executed_at, period, business_date, ${APPLICATION_NO_SQL} AS application_no
       FROM finance_period_backfills
      WHERE company_id = ? AND biz_type = ? AND request_key = ?
      ORDER BY id LIMIT 1`,
    [companyId, bizType, requestKey],
  )
  if (!row) return null
  // 作废单上的键仍在唯一索引里，同一次操作的重放会读回它——不能当成「已提交待审批」返回，
  // 那会让出纳等一张永远不会执行的单子（同 replayExistingApplication 的处理）。
  if (Number(row.status) === STATUS.VOIDED) {
    throw new AppError(
      '这次提交对应的补录申请已经作废，不会被执行。请重新发起补录申请。',
      409,
      'FINANCE_BACKFILL_VOIDED',
    )
  }
  return {
    id: Number(row.id),
    applicationNo: row.application_no,
    reused: true,
    status: Number(row.status),
    executed: !!row.executed_at,
    rejected: Number(row.status) === STATUS.REJECTED,
    period: row.period,
    businessDate: row.business_date instanceof Date
      ? toYmd(row.business_date)
      : String(row.business_date).slice(0, 10),
  }
}

/**
 * 业务日期落在**已结账期间**时的申请分支：只落一张待审批申请单，业务数据一行不写。
 *
 * 为什么先探测、而不是让调用方在业务事务里捕获 409 再补落单：申请单与业务数据必须分开提交。
 * 若在同一事务里，「业务回滚」会把申请单一起回滚掉——出纳看到申请单号，库里却没有这张单。
 * 所以这里用独立连接先探测一次：
 *   · 未结账 → 返回 null，调用方照常写业务（走原有逻辑，一分钱不改）；
 *   · 已结账 → 落单 + 提交，返回申请信息，调用方直接返回 202，根本不进业务逻辑。
 *
 * 探测与业务写入之间有窗口（探测说未结账、写入时已结账）：那种情况由业务事务内的
 * assertFinancePeriodOpen 兜底抛 409，出纳重新提交即转为申请——不会静默写进已结账期间。
 * 反方向窗口（探测说已结账、实际已反结账）：只是白落一张申请单，审批时会被正常执行，无害。
 *
 * @returns {Promise<{id: number, applicationNo: string, period: string, businessDate: string}|null>}
 *   null = 期间未结账，本次不是补录申请
 */
async function tryRecordBackfillApplication({
  companyId = 1, businessDate, bizType, bizId = null, bizNo = null,
  amount = null, reason, requestSnapshot = null, requestKey = null, fingerprintPayload = null,
  applicantId = null, applicantName = null,
}) {
  const ymd = toYmd(businessDate)
  // 日期不合法不在这里报错：那是业务侧的既有校验（FINANCE_PERIOD_NO_DATE），
  // 这里只判断「是否落在已结账期间」，不该抢走业务校验的职责
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null

  // **先看这个请求键用过没有，用过就返回原来那张单——不看期间、也不进业务写入。**
  //
  // 这一步不能省，也不能挪到「期间已结账」判断之后：申请单可能正等着审批，而那个期间
  // 中途被反结账了。此时同一次操作的超时重放若只按期间判断（现在开放了）就会直接走
  // 业务写入——钱当场付掉，而那张待审批的申请单还在，批准后**再付一次**。
  // 请求键是这笔操作的永久身份，重放就必须停在「原单」上，与期间后来开没开无关。
  const existing = await findApplicationByRequestKey(pool, { companyId, bizType, requestKey })
  if (existing) return existing

  const period = periodOfDate(ymd)
  const [[row]] = await pool.query(
    'SELECT status FROM acct_periods WHERE company_id = ? AND period = ?',
    [companyId, period],
  )
  if (!row || Number(row.status) !== 2) return null

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const applied = await recordBackfillApplication(conn, {
      companyId, period, businessDate: ymd, bizType, bizId, bizNo, amount, reason,
      requestSnapshot, requestKey, fingerprintPayload, applicantId, applicantName,
    })
    await conn.commit()
    return { ...applied, period, businessDate: ymd }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 回填执行结果：批准后业务写入**同事务**调用，所以业务回滚则这一笔执行痕迹一并回滚，
 * 申请单回到「已批准 · 待执行」，可重试——不会出现「业务没写成、却记着已执行」的假状态。
 *
 * 条件 `status=1 AND executed_at IS NULL` 是并发下的护栏：两个人同时点「执行」时，
 * 只有一个能把行从「未执行」改成「已执行」，另一个 affectedRows=0，由调用方据此判断。
 *
 * @returns {Promise<number>} 受影响行数（0 = 已被别人执行过）
 */
async function markBackfillExecuted(conn, id, { bizId = null, postingPeriod = null, executedBy = null, executedByName = null }) {
  const [result] = await conn.query(
    `UPDATE finance_period_backfills
        SET executed_at = NOW(), executed_biz_id = ?, posting_period = ?,
            operator_id = ?, operator_name = ?
      WHERE id = ? AND status = 1 AND executed_at IS NULL`,
    [bizId, postingPeriod, executedBy, executedByName, id],
  )
  return result.affectedRows
}

module.exports = {
  STATUS,
  toYmd,
  periodOfDate,
  assertFinancePeriodOpen,
  resolveBackfillRequest,
  resolvePostingPeriod,
  assertBackfillPostingPeriodOpen,
  recordBackfillApplication,
  tryRecordBackfillApplication,
  markBackfillExecuted,
  APPLICATION_NO_SQL,
  REASON_MIN,
}
