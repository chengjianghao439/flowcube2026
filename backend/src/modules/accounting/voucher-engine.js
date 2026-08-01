/**
 * 会计凭证生成引擎（文档 10 · Phase 1 · 设计 §5）
 *
 * 架构原则（硬约束，见 §5.1/§11）：
 *  - 凭证是业务事实的**投影**：本引擎**只读业务事实表、只写 acct_***，绝不 UPDATE payment_records /
 *    inventory_stock / finance_accounts / 采购销售单等任何业务表。
 *  - **全量重算 + 幂等**：按 UNIQUE(source_type, source_id) upsert。同一业务事件反复生成不新增；
 *    金额随业务重算（分批、退货、撤回）变化时覆盖到最新值。source_hash 未变则跳过（避免无谓改写）。
 *  - **借贷平衡**：每张凭证入库前 assert（借合计 === 贷合计），不平抛错不入库。
 *  - 不塞进任何结算事务；由用户在凭证页点「生成本期凭证」或（将来）定时任务触发，走独立事务。
 *
 * 毛额口径（关键，避免退货双减，见设计 §10 勾稽）：
 *  - 采购结算(1)用**毛额** SUM(putaway×采购价)（未扣退货），采购退货(7)单独一张冲 → 净额=payment_records(type=1)。
 *  - 销售收入(2)用**毛额** SUM(shipped×售价)，销售退货(8)单独冲 → 净额=payment_records(type=2)。
 *  - 销售成本(3)用**毛额** SUM(shipped×cost_snapshot)，销售退货(8)冲回成本。
 *
 * 事实来源与口径依据均在 constants/voucherSource.js §5.2 与两次调用链调研中确认。
 */

const crypto = require('crypto')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { SOURCE_TYPES, DIR } = require('../../constants/voucherSource')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** 现金账户(finance_accounts.type=2)→库存现金 1001；其余(银行/支付宝/微信/其它)→银行存款 1002 */
function fundAccountCode(accountType) {
  return Number(accountType) === 2 ? '1001' : '1002'
}

/** mysql2 的 DATE/DATETIME 返回 Date 对象或字符串，统一成 'YYYY-MM-DD'（本地时区，连接池 +08:00） */
function toDateStr(v) {
  if (!v) {
    throw new AppError('凭证缺少业务发生日期', 500, 'ACCT_VOUCHER_NO_DATE')
  }
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v).slice(0, 10)
}
const periodOf = (dateStr) => dateStr.slice(0, 4) + dateStr.slice(5, 7)

// ─── 科目解析 ────────────────────────────────────────────────────────────────

async function loadAccountMap(conn) {
  const [rows] = await conn.query('SELECT id, code, name FROM acct_accounts WHERE deleted_at IS NULL')
  const map = new Map()
  for (const r of rows) map.set(r.code, { id: r.id, name: r.name })
  return map
}
function resolveAccount(map, code) {
  const a = map.get(code)
  if (!a) throw new AppError(`凭证映射所需科目 ${code} 不存在（请勿删除预置科目）`, 500, 'ACCT_MAPPING_MISSING_ACCOUNT')
  return a
}

// ─── 平衡与指纹 ──────────────────────────────────────────────────────────────

function assertBalanced(legs) {
  const debit = round2(legs.filter(l => l.direction === DIR.DEBIT).reduce((s, l) => s + l.amount, 0))
  const credit = round2(legs.filter(l => l.direction === DIR.CREDIT).reduce((s, l) => s + l.amount, 0))
  if (debit !== credit) {
    throw new AppError(`凭证借贷不平：借 ${debit} ≠ 贷 ${credit}`, 500, 'ACCT_VOUCHER_UNBALANCED')
  }
  return { debit, credit }
}
function hashSpec(voucherDate, legs) {
  const payload = JSON.stringify({
    d: voucherDate,
    legs: legs.map(l => [l.code, l.direction, l.amount, l.auxId ?? null, l.auxName ?? null]),
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

// ─── 凭证号序列分配（按期间 记-YYYYMM-序号） ─────────────────────────────────

async function makeSeqAllocator(conn) {
  const cache = new Map()
  return async (period) => {
    if (!cache.has(period)) {
      const [[row]] = await conn.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(voucher_no,'-',-1) AS UNSIGNED)), 0) AS mx
           FROM acct_vouchers WHERE period = ?`,
        [period],
      )
      cache.set(period, Number(row.mx) || 0)
    }
    const next = cache.get(period) + 1
    cache.set(period, next)
    return next
  }
}

// ─── upsert 单张凭证 ─────────────────────────────────────────────────────────

async function insertEntries(conn, voucherId, legs, accountMap) {
  let lineNo = 0
  for (const l of legs) {
    lineNo += 1
    const acct = resolveAccount(accountMap, l.code)
    await conn.query(
      `INSERT INTO acct_voucher_entries
         (voucher_id, line_no, account_id, account_code, account_name, direction, amount, summary, aux_type, aux_id, aux_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [voucherId, lineNo, acct.id, l.code, acct.name, l.direction, l.amount, l.summary || null,
       l.auxType || 0, l.auxId || null, l.auxName || null],
    )
  }
}

async function upsertVoucher(conn, spec, accountMap, allocSeq, createdBy) {
  const legs = spec.legs
    .map(l => ({ ...l, amount: round2(l.amount) }))
    .filter(l => l.amount > 0)
  if (legs.length === 0) return { skipped: true, reason: 'empty' }

  const { debit, credit } = assertBalanced(legs)
  const voucherDate = toDateStr(spec.voucherDate)
  const period = periodOf(voucherDate)
  const hash = hashSpec(voucherDate, legs)

  const [[existing]] = await conn.query(
    'SELECT id, voucher_no, source_hash, status FROM acct_vouchers WHERE source_type = ? AND source_id = ?',
    [spec.sourceType, spec.sourceId],
  )

  if (existing) {
    // 已冲销(3)的凭证不再被自动重算覆盖（保留冲销痕迹）；正常凭证 hash 未变则跳过
    if (existing.status === 3) return { skipped: true, reason: 'reversed', id: existing.id }
    if (existing.source_hash === hash) return { skipped: true, reason: 'unchanged', id: existing.id }
    await conn.query(
      `UPDATE acct_vouchers
          SET voucher_date = ?, period = ?, source_no = ?, summary = ?,
              total_debit = ?, total_credit = ?, source_hash = ?, status = 1
        WHERE id = ?`,
      [voucherDate, period, spec.sourceNo || null, spec.summary || null, debit, credit, hash, existing.id],
    )
    await conn.query('DELETE FROM acct_voucher_entries WHERE voucher_id = ?', [existing.id])
    await insertEntries(conn, existing.id, legs, accountMap)
    return { updated: true, id: existing.id }
  }

  const seq = await allocSeq(period)
  const voucherNo = `记-${period}-${String(seq).padStart(4, '0')}`
  const [r] = await conn.query(
    `INSERT INTO acct_vouchers
       (voucher_no, voucher_date, period, source_type, source_id, source_no, summary,
        total_debit, total_credit, status, source_hash, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [voucherNo, voucherDate, period, spec.sourceType, spec.sourceId, spec.sourceNo || null,
     spec.summary || null, debit, credit, hash, createdBy || null],
  )
  await insertEntries(conn, r.insertId, legs, accountMap)
  return { created: true, id: r.insertId }
}

// ─── 事件 → 凭证规格 builders（只读业务事实） ────────────────────────────────

/** 事件1：采购入库结算应付。借 库存商品1405 / 贷 应付账款2202〔供应商〕，毛额=SUM(putaway×采购价) */
async function buildPurchaseSettle(conn) {
  const [rows] = await conn.query(`
    SELECT pr.order_id AS poId, pr.order_no, pr.created_at AS vdate,
           po.supplier_id, po.supplier_name,
           COALESCE((
             SELECT SUM(iti.putaway_qty * poi.unit_price)
               FROM inbound_tasks it
               JOIN inbound_task_items iti ON iti.task_id = it.id
               JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
              WHERE iti.purchase_order_id = pr.order_id AND it.deleted_at IS NULL
                AND it.status <> 5 AND it.audit_status = 1
           ), 0) AS gross
      FROM payment_records pr
      JOIN purchase_orders po ON po.id = pr.order_id
     WHERE pr.type = 1 AND pr.order_id IS NOT NULL`)
  return rows.filter(r => round2(r.gross) > 0).map(r => ({
    sourceType: SOURCE_TYPES.PURCHASE_SETTLE,
    sourceId: r.poId,
    sourceNo: r.order_no,
    voucherDate: r.vdate,
    summary: `采购入库结算应付 ${r.order_no || ''}`.trim(),
    legs: [
      { code: '1405', direction: DIR.DEBIT, amount: r.gross, summary: '采购入库' },
      { code: '2202', direction: DIR.CREDIT, amount: r.gross, auxType: 1, auxId: r.supplier_id || null, auxName: r.supplier_name || null, summary: '应付账款' },
    ],
  }))
}

/** 事件2：销售出库确认收入。借 应收账款1122〔客户〕 / 贷 主营业务收入6001，毛额=SUM(shipped×售价) */
async function buildSaleRevenue(conn) {
  const [rows] = await conn.query(`
    SELECT pr.order_id AS soId, pr.order_no, pr.created_at AS vdate,
           so.customer_id, so.customer_name,
           COALESCE((SELECT SUM(shipped_qty * unit_price) FROM sale_order_items WHERE order_id = pr.order_id), 0) AS gross
      FROM payment_records pr
      JOIN sale_orders so ON so.id = pr.order_id
     WHERE pr.type = 2 AND pr.order_id IS NOT NULL`)
  return rows.filter(r => round2(r.gross) > 0).map(r => ({
    sourceType: SOURCE_TYPES.SALE_REVENUE,
    sourceId: r.soId,
    sourceNo: r.order_no,
    voucherDate: r.vdate,
    summary: `销售出库确认收入 ${r.order_no || ''}`.trim(),
    legs: [
      { code: '1122', direction: DIR.DEBIT, amount: r.gross, auxType: 1, auxId: r.customer_id || null, auxName: r.customer_name || null, summary: '应收账款' },
      { code: '6001', direction: DIR.CREDIT, amount: r.gross, summary: '主营业务收入' },
    ],
  }))
}

/** 事件3：销售出库结转成本。借 主营业务成本6401 / 贷 库存商品1405，毛额=SUM(shipped×cost_snapshot) */
async function buildSaleCogs(conn) {
  const [rows] = await conn.query(`
    SELECT pr.order_id AS soId, pr.order_no, pr.created_at AS vdate,
           COALESCE((SELECT SUM(shipped_qty * COALESCE(cost_snapshot, 0)) FROM sale_order_items WHERE order_id = pr.order_id), 0) AS cogs
      FROM payment_records pr
      JOIN sale_orders so ON so.id = pr.order_id
     WHERE pr.type = 2 AND pr.order_id IS NOT NULL`)
  return rows.filter(r => round2(r.cogs) > 0).map(r => ({
    sourceType: SOURCE_TYPES.SALE_COGS,
    sourceId: r.soId,
    sourceNo: r.order_no,
    voucherDate: r.vdate,
    summary: `销售出库结转成本 ${r.order_no || ''}`.trim(),
    legs: [
      { code: '6401', direction: DIR.DEBIT, amount: r.cogs, summary: '主营业务成本' },
      { code: '1405', direction: DIR.CREDIT, amount: r.cogs, summary: '库存商品' },
    ],
  }))
}

/**
 * 事件4/5/6：收款/付款/费用报销。以 finance_account_transactions（资金进出唯一事实源）为驱动，
 * 一笔资金流水一张凭证，天然与资金流水勾稽。现金/银行由 finance_accounts.type 决定。
 *   收款(biz_type=1)：借 银行/现金 / 贷 应收账款〔客户〕
 *   付款(biz_type=2)：借 应付账款〔供应商〕 / 贷 银行/现金
 *   报销(biz_type=3)：借 管理费用6602（费用类别→科目映射暂缺，统一落管理费用）/ 贷 银行/现金
 *   余额调整(biz_type=4)：不生成凭证（无对应会计事件）
 */
async function buildFundVouchers(conn) {
  const [rows] = await conn.query(`
    SELECT t.id AS txnId, t.biz_type, t.biz_no, t.amount, t.party_name, t.happened_at AS vdate,
           fa.type AS acctType
      FROM finance_account_transactions t
      JOIN finance_accounts fa ON fa.id = t.account_id
     WHERE t.biz_type IN (1, 2, 3)`)
  const specs = []
  for (const r of rows) {
    const amount = round2(r.amount)
    if (amount <= 0) continue
    const fundCode = fundAccountCode(r.acctType)
    if (r.biz_type === 1) {
      specs.push({
        sourceType: SOURCE_TYPES.RECEIPT_IN, sourceId: r.txnId, sourceNo: r.biz_no, voucherDate: r.vdate,
        summary: `收款核销 ${r.party_name || ''}`.trim(),
        legs: [
          { code: fundCode, direction: DIR.DEBIT, amount, summary: '收款' },
          { code: '1122', direction: DIR.CREDIT, amount, auxType: 1, auxName: r.party_name || null, summary: '应收账款' },
        ],
      })
    } else if (r.biz_type === 2) {
      specs.push({
        sourceType: SOURCE_TYPES.PAYMENT_OUT, sourceId: r.txnId, sourceNo: r.biz_no, voucherDate: r.vdate,
        summary: `付款核销 ${r.party_name || ''}`.trim(),
        legs: [
          { code: '2202', direction: DIR.DEBIT, amount, auxType: 1, auxName: r.party_name || null, summary: '应付账款' },
          { code: fundCode, direction: DIR.CREDIT, amount, summary: '付款' },
        ],
      })
    } else if (r.biz_type === 3) {
      specs.push({
        sourceType: SOURCE_TYPES.EXPENSE_PAY, sourceId: r.txnId, sourceNo: r.biz_no, voucherDate: r.vdate,
        summary: `费用报销付款 ${r.party_name || ''}`.trim(),
        legs: [
          { code: '6602', direction: DIR.DEBIT, amount, summary: '管理费用' },
          { code: fundCode, direction: DIR.CREDIT, amount, summary: '付款' },
        ],
      })
    }
  }
  return specs
}

/** 事件7：采购退货出库冲应付。借 应付账款2202〔供应商〕 / 贷 库存商品1405，额=退货单 total_amount */
async function buildPurchaseReturn(conn) {
  const [rows] = await conn.query(`
    SELECT id, return_no, supplier_id, supplier_name, total_amount, updated_at AS vdate
      FROM purchase_returns
     WHERE status = 3 AND deleted_at IS NULL`)
  return rows.filter(r => round2(r.total_amount) > 0).map(r => ({
    sourceType: SOURCE_TYPES.PURCHASE_RETURN,
    sourceId: r.id,
    sourceNo: r.return_no,
    voucherDate: r.vdate,
    summary: `采购退货冲应付 ${r.return_no || ''}`.trim(),
    legs: [
      { code: '2202', direction: DIR.DEBIT, amount: r.total_amount, auxType: 1, auxId: r.supplier_id || null, auxName: r.supplier_name || null, summary: '冲减应付' },
      { code: '1405', direction: DIR.CREDIT, amount: r.total_amount, summary: '退货出库' },
    ],
  }))
}

/**
 * 事件8：销售退货入库冲收入与成本。一张凭证 4 分录：
 *   借 主营业务收入6001（冲）+ 借 库存商品1405（退回入库）
 *   贷 应收账款1122〔客户〕 + 贷 主营业务成本6401（冲）
 * 应收冲减额 = SUM((合格入库量)×退货单价)（与 recomputeSaleReceivable 严格一致）；
 * 成本冲回额 = SUM((合格入库量)×原出库 cost_snapshot 回退 avg_cost/cost_price)（源系统不存，引擎自算）。
 */
async function buildSaleReturn(conn) {
  const [rows] = await conn.query(`
    SELECT sr.id, sr.return_no, sr.customer_id, sr.customer_name, sr.updated_at AS vdate,
           COALESCE(SUM((rti.checked_qty - rti.rejected_qty) * sri.unit_price), 0) AS arAmount,
           COALESCE(SUM((rti.checked_qty - rti.rejected_qty) * COALESCE(soi.cost_snapshot, p.avg_cost, p.cost_price, 0)), 0) AS cogsBack
      FROM sale_returns sr
      JOIN return_tasks rt ON rt.return_id = sr.id AND rt.return_type = 'sale' AND rt.deleted_at IS NULL
      JOIN return_task_items rti ON rti.task_id = rt.id
      JOIN sale_return_items sri ON sri.id = rti.return_item_id
      LEFT JOIN sale_order_items soi ON soi.id = sri.sale_item_id
      LEFT JOIN product_items p ON p.id = soi.product_id
     WHERE sr.status = 3 AND sr.deleted_at IS NULL
     GROUP BY sr.id, sr.return_no, sr.customer_id, sr.customer_name, sr.updated_at`)
  const specs = []
  for (const r of rows) {
    const ar = round2(r.arAmount)
    const cogs = round2(r.cogsBack)
    if (ar <= 0 && cogs <= 0) continue
    const legs = []
    if (ar > 0) {
      legs.push({ code: '6001', direction: DIR.DEBIT, amount: ar, summary: '冲减收入' })
      legs.push({ code: '1122', direction: DIR.CREDIT, amount: ar, auxType: 1, auxId: r.customer_id || null, auxName: r.customer_name || null, summary: '冲减应收' })
    }
    if (cogs > 0) {
      legs.push({ code: '1405', direction: DIR.DEBIT, amount: cogs, summary: '退货入库' })
      legs.push({ code: '6401', direction: DIR.CREDIT, amount: cogs, summary: '冲回成本' })
    }
    specs.push({
      sourceType: SOURCE_TYPES.SALE_RETURN, sourceId: r.id, sourceNo: r.return_no, voucherDate: r.vdate,
      summary: `销售退货冲收入与成本 ${r.return_no || ''}`.trim(), legs,
    })
  }
  return specs
}

/**
 * 事件9：盘盈/盘亏。盘盈 借 库存商品1405 / 贷 待处理财产损溢1901；盘亏 借1901 / 贷1405。
 * 金额 = |diff_qty| × COALESCE(avg_cost, cost_price)（源系统不存成本，引擎自算，按商品口径）。
 * 一张盘点单可同时有盈有亏，合并为一张凭证的两对分录。
 */
async function buildStockCheck(conn) {
  const [rows] = await conn.query(`
    SELECT ic.id, ic.check_no, ic.updated_at AS vdate,
           COALESCE(SUM(CASE WHEN ici.diff_qty > 0 THEN ici.diff_qty * COALESCE(p.avg_cost, p.cost_price, 0) ELSE 0 END), 0) AS gain,
           COALESCE(SUM(CASE WHEN ici.diff_qty < 0 THEN -ici.diff_qty * COALESCE(p.avg_cost, p.cost_price, 0) ELSE 0 END), 0) AS loss
      FROM inventory_checks ic
      JOIN inventory_check_items ici ON ici.check_id = ic.id
      JOIN product_items p ON p.id = ici.product_id
     WHERE ic.status = 2 AND ic.deleted_at IS NULL
     GROUP BY ic.id, ic.check_no, ic.updated_at`)
  const specs = []
  for (const r of rows) {
    const gain = round2(r.gain)
    const loss = round2(r.loss)
    if (gain <= 0 && loss <= 0) continue
    const legs = []
    if (gain > 0) {
      legs.push({ code: '1405', direction: DIR.DEBIT, amount: gain, summary: '盘盈入账' })
      legs.push({ code: '1901', direction: DIR.CREDIT, amount: gain, summary: '盘盈' })
    }
    if (loss > 0) {
      legs.push({ code: '1901', direction: DIR.DEBIT, amount: loss, summary: '盘亏' })
      legs.push({ code: '1405', direction: DIR.CREDIT, amount: loss, summary: '盘亏出账' })
    }
    specs.push({
      sourceType: SOURCE_TYPES.STOCK_CHECK, sourceId: r.id, sourceNo: r.check_no, voucherDate: r.vdate,
      summary: `盘点盈亏 ${r.check_no || ''}`.trim(), legs,
    })
  }
  return specs
}

// ─── 生成入口 ────────────────────────────────────────────────────────────────

/**
 * 全量生成/重算凭证。在调用方开启的事务连接上执行（引擎不自开事务）。
 * @param {*} conn 事务连接
 * @param {{period?: string, createdBy?: number}} opts period='YYYYMM' 只生成该期间(按 voucher_date)；省略=全部
 * @returns {{created,updated,unchanged,reversed,empty, total}}
 */
async function generateVouchers(conn, { period = null, createdBy = null } = {}) {
  const accountMap = await loadAccountMap(conn)
  const allocSeq = await makeSeqAllocator(conn)
  const specs = [
    ...await buildPurchaseSettle(conn),
    ...await buildSaleRevenue(conn),
    ...await buildSaleCogs(conn),
    ...await buildFundVouchers(conn),
    ...await buildPurchaseReturn(conn),
    ...await buildSaleReturn(conn),
    ...await buildStockCheck(conn),
  ]
  const stats = { created: 0, updated: 0, unchanged: 0, reversed: 0, empty: 0, total: 0 }
  for (const spec of specs) {
    let dateStr
    try { dateStr = toDateStr(spec.voucherDate) } catch { continue }
    if (period && periodOf(dateStr) !== period) continue
    stats.total += 1
    const res = await upsertVoucher(conn, spec, accountMap, allocSeq, createdBy)
    if (res.created) stats.created += 1
    else if (res.updated) stats.updated += 1
    else if (res.reason === 'unchanged') stats.unchanged += 1
    else if (res.reason === 'reversed') stats.reversed += 1
    else stats.empty += 1
  }
  logger.info('accounting', `生成凭证 period=${period || 'ALL'} ${JSON.stringify(stats)}`, { createdBy })
  return stats
}

module.exports = {
  generateVouchers,
  // 导出内部件供测试与对账复用
  loadAccountMap,
  assertBalanced,
  round2,
  toDateStr,
}
