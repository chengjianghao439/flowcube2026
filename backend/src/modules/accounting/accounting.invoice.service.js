/**
 * 发票管理 Service（文档 10 · Phase 3 · 设计 §4.5）
 * 进项/销项发票池 + 认证/抵扣/红冲台账。发票与业务单弱关联（source 可空可后补），
 * **不改采购/销售单金额口径**；税额只在凭证映射时按本表 tax_amount 拆分（见 voucher-engine §5.3）。
 * 后补/修改发票后，凭证靠幂等重算自然带上税额拆分。
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// 发票日期序列化：DB 读出的 Date 对象 → 'YYYY-MM-DD'（String(Date) 会得到 'Sun Aug 09 2026...'，
// 直接 slice 出非法日期）；前端传的字符串原样返回
const fmtDate = (d) => {
  if (!d) return null
  if (d instanceof Date) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return String(d).slice(0, 10)
}

// 进项:1待认证 2已认证 3已抵扣；销项:1已开具 2已红冲
const STATUS_NAME = {
  1: { 1: '待认证', 2: '已认证', 3: '已抵扣' },
  2: { 1: '已开具', 2: '已红冲' },
}
// 允许的状态流转：type → { action: [from, to] }
const TRANSITIONS = {
  1: { certify: [1, 2], deduct: [2, 3] },   // 进项：认证、抵扣
  2: { redFlush: [1, 2] },                    // 销项：红冲
}

function fmt(row) {
  const type = row.invoice_type
  return {
    id: row.id,
    invoiceType: type,
    invoiceTypeName: type === 1 ? '进项' : '销项',
    invoiceCode: row.invoice_code ?? null,
    invoiceNo: row.invoice_no ?? null,
    partyName: row.party_name,
    partyTaxNo: row.party_tax_no ?? null,
    amountNoTax: Number(row.amount_no_tax),
    taxRate: Number(row.tax_rate),
    taxAmount: Number(row.tax_amount),
    amountWithTax: Number(row.amount_with_tax),
    invoiceDate: row.invoice_date,
    status: row.status,
    statusName: (STATUS_NAME[type] && STATUS_NAME[type][row.status]) || String(row.status),
    sourceType: row.source_type ?? null,
    sourceId: row.source_id ?? null,
    sourceNo: row.source_no ?? null,
    remark: row.remark ?? null,
    operatorName: row.operator_name ?? null,
    createdAt: row.created_at,
    // 编辑乐观锁：客户端必须原样回传它读取时看到的这个值（迁移 263）
    revision: Number(row.revision ?? 1),
  }
}

async function listInvoices({ invoiceType, status, keyword, page = 1, pageSize = 20 } = {}, companyId = 1) {
  // 账套过滤（2026-09-18 审计 P1）：写入端与税额汇总(loadTaxMaps)都严格按 company_id 过滤，
  // 查询/编辑/红冲/删除此前却完全不过滤 —— 属单边过滤：A 账套能看到并改写 B 账套的发票。
  const where = ['deleted_at IS NULL', 'company_id = ?']
  const params = [Number(companyId) || 1]
  if (invoiceType) { where.push('invoice_type = ?'); params.push(Number(invoiceType)) }
  if (status)      { where.push('status = ?'); params.push(Number(status)) }
  if (keyword)     { where.push('(invoice_no LIKE ? OR party_name LIKE ? OR source_no LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k) }
  const whereSql = where.join(' AND ')
  const p = Math.max(1, Number(page) || 1)
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20))
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM fin_invoices WHERE ${whereSql}`, params)
  const [rows] = await pool.query(
    `SELECT * FROM fin_invoices WHERE ${whereSql} ORDER BY invoice_date DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps])
  return { list: rows.map(fmt), pagination: { page: p, pageSize: ps, total: Number(total) } }
}

async function getInvoice(id, companyId = 1) {
  // 账套不符统一按 404：不要把「存在但属于别的账套」泄露成 403/400
  const [[row]] = await pool.query(
    'SELECT * FROM fin_invoices WHERE id = ? AND company_id = ? AND deleted_at IS NULL',
    [Number(id), Number(companyId) || 1],
  )
  if (!row) throw new AppError('发票不存在', 404)
  return fmt(row)
}

/**
 * 开票量校验（P2-5 防多开票）：发票关联业务单（sourceNo）时，累计已开票价税合计
 * 不得超过该单的应收/应付基准（payment_records.total_amount——出库/收货后按实发/实收
 * 量重算的权威口径，而非订单原始总额）。
 *
 * **两件事必须分开**（2026-09-27）：本函数既反查**订单身份**、又做**配额硬校验**，二者不同步：
 *   · **配额硬校验** 只在「该单已产生账款基准（`payment_records.total_amount > 0`）」时做；
 *     无基准（未出库/未结算）时跳过校验（`quotaChecked=false`）。
 *   · **订单身份** 只要单号能查到单据就回报（`sourceId`），**不受有无基准影响**——
 *     「先开票后发货」是合法场景，此时身份已确定；若因无基准而返回 null，调用方会把这
 *     类发票的 `source_id`/`source_type` 置空，之后也不会自动回连，税额永远进不了凭证。
 * 查不到单据（期初/无单发票）时返回 null。已红冲（销项 status=2）的发票是冲销，不计入已开票合计。
 *
 * @param {object} d        - 本次录入/编辑的发票载荷
 * @param {number} d.invoiceType - 1进项 2销项
 * @param {number} d.amountWithTax - 本次价税合计
 * @param {string} [d.sourceNo]    - 关联单号（弱关联，可空）
 * @param {number} [excludeId]     - 编辑时排除自身，避免自算
 * @returns {Promise<{base: number, issued: number, sourceId: number, quotaChecked: boolean}|null>}
 *   `null` = 按该单号查不到业务单；与「查到但无基准」（`base=0, quotaChecked=false`）不同。
 */
async function assertInvoiceQuota(d, excludeId = null, conn = pool) {
  const sourceNo = String(d.sourceNo ?? '').trim()
  const sourceId = d.sourceId != null && Number(d.sourceId) > 0 ? Number(d.sourceId) : null
  if (!sourceNo && !sourceId) return null
  const type = Number(d.invoiceType)
  const table = type === 2 ? 'sale_orders' : 'purchase_orders'
  const recType = type === 2 ? 2 : 1
  const label = type === 2 ? '销售' : '采购'

  // 1. 反查订单行并加锁（并发防超开票：FOR UPDATE 让同单并发开票串行化，审计 E.4 修复）。
  //    **两条入口都支持**，且都走同一套配额校验：
  //      · 按单号（事实源）——弱关联只存单号字符串，这里补查；
  //      · 按显式 id（`invoiceSchema` 既有用法）——按发票类型限定表、同样加锁与校验，
  //        避免历史上「只给 id 不给单号」直接绕过额度校验的缺口。
  //    同时给两者时必须互相匹配。单号查不到且也没有 id 时返回 null（保留既有「期初/无单
  //    发票可留单号快照」的行为）。
  let order = null
  if (sourceNo) {
    const [[byNo]] = await conn.query(
      `SELECT id, order_no FROM ${table} WHERE order_no = ? AND deleted_at IS NULL FOR UPDATE`,
      [sourceNo],
    )
    // 单号与 id 同时给出时，二者必须**互相印证**：单号查不到也算冲突，不能「按 id 兜底」
    // 再把落库单号悄悄换成真实单号——那样会把用户打错的单号吞掉。
    if (!byNo && sourceId != null) {
      throw new AppError(
        `关联单号 ${sourceNo} 未查到对应${label}单，与传入的关联单据 id=${sourceId} 不匹配`,
        400, 'INVOICE_SOURCE_ID_CONFLICT',
      )
    }
    if (byNo && sourceId != null && Number(byNo.id) !== sourceId) {
      throw new AppError(
        `传入的关联单据（${sourceId}）与单号 ${sourceNo} 反查到的单据（${byNo.id}）不一致`,
        400, 'INVOICE_SOURCE_ID_CONFLICT',
      )
    }
    order = byNo || null
  }
  if (!order && sourceId != null) {
    const [[byId]] = await conn.query(
      `SELECT id, order_no FROM ${table} WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [sourceId],
    )
    if (!byId) {
      throw new AppError(`关联单据不存在（${label}单 id=${sourceId}）`, 400, 'INVOICE_SOURCE_NOT_FOUND')
    }
    order = byId
  }
  if (!order) return null

  // 2. 该单的权威应收/应付基准（payment_records 是出库/收货后重算的唯一事实源；此表无 deleted_at）
  const [[pr]] = await conn.query(
    'SELECT total_amount FROM payment_records WHERE type = ? AND order_id = ? LIMIT 1',
    [recType, order.id],
  )
  const base = pr ? Number(pr.total_amount) : 0
  // 尚无账款基准（未出库/未结算）⇒ **只跳过配额校验，不丢订单身份**：
  // 调用方要据此建立 source_id/source_type 关联，「先开票后发货」是合法场景，
  // 身份此时已确定；返回 null 会让这类发票的关联被置空且之后不会自动回连。
  if (!(base > 0)) return { base: 0, issued: 0, sourceId: order.id, sourceNo: order.order_no, quotaChecked: false }

  // 3. 已开票合计（销项剔除红冲 status=2；编辑时排除自身；进项剔除删除）。
  //    同时按 source_id 与 source_no 匹配：旧数据可能只有 source_no 没 source_id。
  const excludeSql = excludeId ? 'AND id <> ?' : ''
  const params = excludeId ? [type, order.id, sourceNo, excludeId] : [type, order.id, sourceNo]
  const [[{ issuedSum }]] = await conn.query(
    `SELECT COALESCE(SUM(amount_with_tax), 0) AS issuedSum
       FROM fin_invoices
      WHERE invoice_type = ? AND deleted_at IS NULL
        AND (source_id = ? OR source_no = ?)
        AND (invoice_type = 1 OR status <> 2)
        ${excludeSql}`,
    params,
  )
  const issued = Number(issuedSum)
  const incoming = round2(Number(d.amountWithTax))
  if (round2(issued + incoming) > round2(base)) {
    throw new AppError(
      `该单累计已开票 ${issued.toFixed(2)} + 本次 ${incoming.toFixed(2)} 超过${type === 2 ? '应收' : '应付'}基准 ${base.toFixed(2)}，请核对是否多开票`,
      400, 'INVOICE_OVER_QUOTA',
    )
  }
  return { base, issued, sourceId: order.id, sourceNo: order.order_no, quotaChecked: true }
}

/** 发票类型 → 关联业务的 `source_type`（迁移 182 的约定值） */
const SOURCE_TYPE_OF = { 1: 'purchase_order', 2: 'sale_order' }

/**
 * 显式 `sourceType` 与发票类型的一致性（纯输入校验，不需要反查）。
 * **单独提出来是为了能放在配额校验之前**：否则「类型传错了」会被「超配额」抢先掩盖，
 * 用户看到的原因不是真实原因。
 */
function assertExplicitTypeMatches(invoiceType, explicitType) {
  if (explicitType == null) return
  const expected = SOURCE_TYPE_OF[Number(invoiceType)]
  if (!expected) throw new AppError('发票类型非法（1进项 2销项）', 400)
  if (explicitType !== expected) {
    throw new AppError(
      `关联业务类型与发票类型不符：${Number(invoiceType) === 2 ? '销项' : '进项'}发票只能关联 ${expected}`,
      400, 'INVOICE_SOURCE_TYPE_MISMATCH',
    )
  }
}

/**
 * 关联业务单的解析（2026-09-27 收口）。
 *
 * `source_type`/`source_id` 是**派生值**，权威输入只有两种：本次的「关联单号」或本次的「显式关联 id」。
 * 两者都由 `assertInvoiceQuota` 按发票类型限定表、加行锁反查为**同一份订单身份**
 * （可只给其一；两者同给时必须互相相符）。口径以迁移 `182_fin_invoices.sql` 的列注释为准
 * （`purchase_order`/`sale_order`，可空＝允许无单发票）。
 *
 * 显式 `sourceType`/`sourceId` 是 `invoiceSchema` 一直接受的字段，**不做无提示忽略**：
 *   · 与反查结果一致 → 通过（取值以后端反查为准，二者等价）；
 *   · 类型与发票类型不符、id 与单号不符、或显式 id 不存在 → 明确 400。
 * 落库的单号一律取**反查到的真实单号**（仅给 id 时也能得到一个可读的快照）；未反查到订单时
 * 保留单号快照，但 `source_id`/`source_type` 置 NULL。
 */
function resolveSource(invoiceType, { quota, fallbackSourceNo = null, explicitType = null, explicitId = null }) {
  const expectedType = SOURCE_TYPE_OF[Number(invoiceType)]
  if (!expectedType) throw new AppError('发票类型非法（1进项 2销项）', 400)
  assertExplicitTypeMatches(invoiceType, explicitType)
  const reversedId = quota && Number.isFinite(Number(quota.sourceId)) ? Number(quota.sourceId) : null

  if (reversedId) {
    // id 与单号的一致性、以及「显式 id 是否存在」已在 assertInvoiceQuota 内校验；这里再核一次
    // explicitId，保证本函数的契约自洽（可被单独复用）。
    if (explicitId != null && Number(explicitId) !== reversedId) {
      throw new AppError(
        `传入的关联单据（${explicitId}）与反查到的单据（${reversedId}）不一致`,
        400, 'INVOICE_SOURCE_ID_CONFLICT',
      )
    }
    // 落库的单号以**反查到的真实单号**为准：仅给 id 的路径也能落出一个可读的单号快照。
    return { sourceType: expectedType, sourceId: reversedId, sourceNo: quota.sourceNo || fallbackSourceNo }
  }

  // 只给了 sourceType、既无单号也无 id：schema 接受但语义无效（建立不了任何关联）。
  // 明确拒绝，而不是静默返回空关联——否则客户端会以为已经关联上了。
  // （explicitId 非空却走到这里是不可能的：按 id 反查不到时 assertInvoiceQuota 已 400。）
  if (explicitType != null) {
    throw new AppError(
      '只提供了关联业务类型，但既没有「关联单号」也没有关联单据 id，无法建立关联；请补充单号或 id',
      400, 'INVOICE_SOURCE_INCOMPLETE',
    )
  }

  // 未反查到订单：属「无单发票」（未填单号）或「填了查不到的单号」——保留既有的**单号快照**
  // 语义照旧落库，但 source_id/source_type 保持 NULL（迁移 182 明确允许），
  // 因而不影响 loadTaxMaps（它要求 source_id IS NOT NULL）。
  return { sourceType: null, sourceId: null, sourceNo: fallbackSourceNo }
}

function validatePayload(d) {
  const type = Number(d.invoiceType)
  if (type !== 1 && type !== 2) throw new AppError('发票类型非法（1进项 2销项）', 400)
  const noTax = round2(d.amountNoTax)
  const tax = round2(d.taxAmount)
  const withTax = round2(d.amountWithTax)
  if (!(withTax > 0)) throw new AppError('价税合计必须大于 0', 400)
  if (round2(noTax + tax) !== withTax) throw new AppError(`价税合计校验失败：不含税 ${noTax} + 税额 ${tax} ≠ 价税合计 ${withTax}`, 400, 'INVOICE_AMOUNT_MISMATCH')
  const no = String(d.invoiceNo ?? '').trim()
  if (!no) throw new AppError('发票号码不能为空', 400)
  const party = String(d.partyName ?? '').trim()
  if (!party) throw new AppError('对方单位不能为空', 400)
  if (!d.invoiceDate) throw new AppError('开票日期不能为空', 400)
  return { type, noTax, tax, withTax, no, party }
}

async function createInvoice(d, operator, companyId = 1) {
  const v = validatePayload(d)
  const cid = Number(companyId) || 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 并发防超开票（2026-08-21 审计 E.4 修复）：锁单据行 FOR UPDATE 让并发
    // 开票串行化——否则两个请求同时读到 issued=100 各自放行，累计突破上限。
    // assertInvoiceQuota 内先锁目标单据行再读累计，与 INSERT 同一事务。
    // 先挡「显式 sourceType 与发票类型不符」——纯输入错误，须在配额校验之前报出，
    // 否则会被「超配额」抢先掩盖成另一个原因（见 assertExplicitTypeMatches 注释）。
    assertExplicitTypeMatches(v.type, d.sourceType ?? null)
    const quota = await assertInvoiceQuota({ ...d, invoiceType: v.type, amountWithTax: v.withTax }, null, conn)
    const source = resolveSource(v.type, {
      quota,
      fallbackSourceNo: d.sourceNo || null,
      explicitType: d.sourceType ?? null,
      explicitId: d.sourceId ?? null,
    })
    // 发票归属记账账套（迁移 223 的 company_id）：发票是「先到、归属后定」，
    // 录入时按当前账套落 company_id，配合 loadTaxMaps 的按账套过滤，实现报税按账套隔离。
    // 若 invoiceCreate 不传 companyId（旧调用），这里 cid=1 主账套兜底。
    const [r] = await conn.query(
      `INSERT INTO fin_invoices
         (invoice_type, invoice_code, invoice_no, party_name, party_tax_no,
          amount_no_tax, tax_rate, tax_amount, amount_with_tax, invoice_date, status,
          source_type, source_id, source_no, remark, operator_id, operator_name, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [v.type, d.invoiceCode || null, v.no, v.party, d.partyTaxNo || null,
       v.noTax, round2(d.taxRate), v.tax, v.withTax, fmtDate(d.invoiceDate),
       source.sourceType, source.sourceId, source.sourceNo, d.remark || null,
       operator?.userId || null, operator?.username || null, cid])
    await conn.commit()
    logger.info(`录入${v.type === 1 ? '进项' : '销项'}发票 ${v.no} 价税${v.withTax} 账套${cid}`, { id: r.insertId, operatorId: operator?.userId }, 'accounting')
    return { id: r.insertId }
  } catch (e) {
    await conn.rollback()
    if (e.code === 'ER_DUP_ENTRY') throw new AppError(`发票 ${d.invoiceCode || ''} ${v.no} 已存在`, 400, 'INVOICE_DUP')
    throw e
  } finally {
    conn.release()
  }
}

async function updateInvoice(id, d, operator, companyId = 1) {
  const cid = Number(companyId) || 1
  // 事务外读只用于「未提供字段」的合并与载荷校验；**状态与版本一律以锁内读到的为准**（见下）。
  const cur = await getInvoice(id, cid)
  const v = validatePayload({ ...cur, ...d })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // **锁内**读当前行，拿权威的 `status` 与 `revision`，用于判定。
    // 说明（避免夸大）：事务外的 `cur` **仍然**参与「未提供字段」的合并与载荷校验，它**不**承担
    // 并发安全——**真正的安全前提是「客户端回传的 revision 与锁内 revision 相等」**，
    // 由下面的比对 + UPDATE 的 `AND revision=?` 保证。锁只是让这个比对能串行、不被交错。
    // 锁顺序依据（见 §20.1 的调用链核对）：本函数在**持发票行锁之后**才进入 `assertInvoiceQuota`，
    // 后者只锁订单行；全仓未见「先锁订单行、再锁发票行」的路径，故不成环。
    const [[locked]] = await conn.query(
      `SELECT status, revision FROM fin_invoices
        WHERE id=? AND company_id=? AND deleted_at IS NULL FOR UPDATE`,
      [Number(id), cid],
    )
    if (!locked) throw new AppError('发票不存在', 404)
    if (Number(locked.status) !== 1) throw new AppError('仅待认证/已开具状态的发票可编辑', 400, 'INVOICE_LOCKED')
    // **乐观锁**（2026-09-27）：客户端必须回传它读取时看到的 `revision`。
    // 注意这与 status 是**两件事**，不要混称——status 只说明「这张票当前可编辑」，
    // `revision` 才说明「你手里那份是不是最新的」；没有它，两个并发编辑会互相**静默覆盖**
    // （隔离库实测 8/8 轮两次都 200、最终只留其一）。
    // 注意 `Number(null) === 0`：必须先判 null/undefined 再判整数，否则「没传」会被当成 0 ⇒ 误报 409。
    if (d.revision == null || !Number.isInteger(Number(d.revision))) {
      throw new AppError('缺少版本号，请刷新后重试', 400, 'INVOICE_REVISION_REQUIRED')
    }
    const clientRev = Number(d.revision)
    if (clientRev !== Number(locked.revision)) {
      throw new AppError('这张发票已被其他人修改，请刷新后重新编辑', 409, 'INVOICE_CONCURRENT_MODIFIED')
    }
    // 发票类型不可修改（UPDATE 语句也不含 invoice_type 列）：若客户端传了不同的类型，
    // 明确拒绝。否则会按**另一类**去反查订单（销项查 purchase_orders / 反之），把关联写错，
    // 而单据上的 invoice_type 仍是原值——正是最难查的那类错账。
    if (d.invoiceType != null && Number(d.invoiceType) !== Number(cur.invoiceType)) {
      throw new AppError('发票类型不可修改', 400, 'INVOICE_TYPE_IMMUTABLE')
    }
    // 关联语义（2026-09-27）：source_type/source_id 是**派生值**，权威输入只有两种——
    // 本次的「关联单号」或本次的「显式关联 id」。
    // · 本次**未提供** sourceNo（部分更新，如只改备注）→ 单号与 id 都沿用旧值；
    // · 本次**显式给出** sourceNo（含清空为 null/''）→ **只能用本次的 d.sourceId**。
    //   旧 `cur.sourceId` 必须丢弃，否则两种错法：① 改成新单号时会与旧 id 冲突而误报"不一致"；
    //   ② 清空单号时旧 id 仍会按 id 反查，把刚清掉的关联又建回来。
    const sourceNoProvided = d.sourceNo !== undefined
    const nextSourceNo = sourceNoProvided
      ? (String(d.sourceNo || '').trim() || null)
      : cur.sourceNo
    const nextSourceId = sourceNoProvided ? (d.sourceId ?? null) : (d.sourceId ?? cur.sourceId)
    // P2-5：编辑时排除自身，防止「改大本次开票金额被自己挡住」。
    // 必须把 conn 传进去（2026-09-18 审计 P1）：此前漏传会落到连接池的另一条连接上，
    // assertInvoiceQuota 的 FOR UPDATE 在自动提交下取到即释放，等于没有并发保护，
    // 同单并发编辑/开票仍可超出配额；CAS 只能挡住状态变化，挡不住配额竞争。
    // 反查与校验都用 **cur.invoiceType**（库内真值），不用 v.type：见上面的不可变校验。
    const quota = await assertInvoiceQuota(
      {
        ...cur, ...d,
        invoiceType: cur.invoiceType,
        amountWithTax: v.withTax,
        // 必须用构造好的 effective 单号/ id：直接 spread `cur` 会把旧 sourceId 带进去
        // （见上面 nextSourceId 的两条错法）。
        sourceNo: nextSourceNo,
        sourceId: nextSourceId,
      },
      id,
      conn,
    )
    // 派生值由本次单号 + 反查结果**重算**（不沿用 cur）：这同时修掉历史 `invoice_order`
    // 在「仍关联订单」时的自愈——编辑一次即回到 182 约定值，无需改写存量数据的迁移。
    const source = resolveSource(cur.invoiceType, {
      quota,
      fallbackSourceNo: nextSourceNo,
      explicitType: d.sourceType ?? null,
      explicitId: d.sourceId ?? null,
    })
    // 状态 CAS（2026-08-21 审计修复）：UPDATE 带 status=1 条件 + affectedRows 校验，
    // 防止「读到 status=1 → 并发红冲为 2 → 仍执行更新」的 TOCTOU（已红冲发票被改金额）
    const [r] = await conn.query(
      `UPDATE fin_invoices SET invoice_code=?, invoice_no=?, party_name=?, party_tax_no=?,
         amount_no_tax=?, tax_rate=?, tax_amount=?, amount_with_tax=?, invoice_date=?,
         source_type=?, source_id=?, source_no=?, remark=?, revision = revision + 1
       WHERE id=? AND status=1 AND revision=? AND company_id=? AND deleted_at IS NULL`,
      [d.invoiceCode ?? cur.invoiceCode, v.no, v.party, d.partyTaxNo ?? cur.partyTaxNo,
       v.noTax, round2(d.taxRate ?? cur.taxRate), v.tax, v.withTax, fmtDate(d.invoiceDate ?? cur.invoiceDate),
       source.sourceType, source.sourceId, source.sourceNo, d.remark ?? cur.remark,
       Number(id), clientRev, cid])
    if (r.affectedRows !== 1) {
      // 已持 `FOR UPDATE` 且比对过 revision，这一步理论不可达；留作兜底（与 products.update 同思路）：
      // 宁可 fail-loud，也不要留下「以为改了、其实没改」。
      throw new AppError('这张发票已被其他人修改，请刷新后重新编辑', 409, 'INVOICE_CONCURRENT_MODIFIED')
    }
    await conn.commit()
    logger.info(`更新发票 [id=${id}]`, { operatorId: operator?.userId }, 'accounting')
  } catch (e) {
    await conn.rollback()
    if (e.code === 'ER_DUP_ENTRY') throw new AppError('发票代码+号码与已有发票重复', 400, 'INVOICE_DUP')
    throw e
  } finally {
    conn.release()
  }
}

async function changeStatus(id, action, operator, companyId = 1) {
  const cid = Number(companyId) || 1
  const cur = await getInvoice(id, cid)
  const rule = TRANSITIONS[cur.invoiceType] && TRANSITIONS[cur.invoiceType][action]
  if (!rule) throw new AppError('该发票不支持此操作', 400, 'INVOICE_ACTION_INVALID')
  const [from, to] = rule
  if (cur.status !== from) throw new AppError(`当前状态「${cur.statusName}」不可执行此操作`, 400, 'INVOICE_STATUS_INVALID')
  const [r] = await pool.query('UPDATE fin_invoices SET status=? WHERE id=? AND status=? AND company_id=? AND deleted_at IS NULL', [to, Number(id), from, cid])
  if (r.affectedRows !== 1) throw new AppError('状态已变化，请刷新重试', 409)
  logger.info(`发票 ${cur.invoiceNo} ${action} ${from}→${to}`, { operatorId: operator?.userId }, 'accounting')
  return { status: to }
}

async function removeInvoice(id, operator, companyId = 1) {
  const cid = Number(companyId) || 1
  const cur = await getInvoice(id, cid)
  // 状态校验（2026-08-21 审计修复）：已抵扣/已红冲的发票禁止删除——
  // 它们已影响凭证/税额，软删会让历史账目追溯断裂
  if (cur.status !== 1) {
    throw new AppError(`当前状态「${cur.statusName}」的发票不可删除`, 400, 'INVOICE_DELETE_LOCKED')
  }
  // 带状态 CAS：防止「读到 status=1 → 并发红冲 → 仍软删」的 TOCTOU
  const [r] = await pool.query(
    'UPDATE fin_invoices SET deleted_at=NOW() WHERE id=? AND status=1 AND company_id=? AND deleted_at IS NULL',
    [Number(id), cid],
  )
  if (r.affectedRows !== 1) throw new AppError('发票状态已变化，请刷新重试', 409, 'INVOICE_STATUS_CHANGED')
  logger.info(`删除发票 ${cur.invoiceNo}`, { operatorId: operator?.userId }, 'accounting')
}

module.exports = { listInvoices, getInvoice, createInvoice, updateInvoice, changeStatus, removeInvoice, assertInvoiceQuota }
