const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

/**
 * 资金账户与账户流水。
 *
 * **流水是唯一事实源**：`finance_accounts.current_balance` 只是它的投影，由
 * `refreshBalance()` 在每次写流水后于同一事务内重算（期初 + Σ收 − Σ支），
 * 绝不做「读余额 → 加减 → 写回」的独立累加。理由见 CLAUDE.md 第 9 节
 * （inventory_stock 的缓存漂移事故），钱的账目更不能出这种事。
 *
 * 收款核销、付款核销、费用报销都调 `recordTransaction()` 写流水，账户余额才完整。
 */

const ACCOUNT_TYPE = { BANK: 1, CASH: 2, ALIPAY: 3, WECHAT: 4, OTHER: 5 }
const ACCOUNT_TYPE_NAME = { 1: '银行账户', 2: '现金', 3: '支付宝', 4: '微信', 5: '其他' }

const DIRECTION = { IN: 1, OUT: 2 }
const BIZ_TYPE = { RECEIPT: 1, PAYMENT: 2, EXPENSE: 3, ADJUST: 4, REFUND: 5 }
const BIZ_TYPE_NAME = { 1: '收款', 2: '付款', 3: '费用报销', 4: '余额调整', 5: '退货退款' }

function fmtAccount(row) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    type: Number(row.type),
    typeName: ACCOUNT_TYPE_NAME[Number(row.type)] || '其他',
    accountNo: row.account_no,
    bankName: row.bank_name,
    holder: row.holder,
    openingBalance: Number(row.opening_balance),
    currentBalance: Number(row.current_balance),
    isActive: !!row.is_active,
    sortOrder: Number(row.sort_order),
    remark: row.remark,
    createdAt: row.created_at,
  }
}

function fmtTransaction(row) {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    accountName: row.account_name,
    direction: Number(row.direction),
    directionName: Number(row.direction) === DIRECTION.IN ? '收入' : '支出',
    amount: Number(row.amount),
    bizType: Number(row.biz_type),
    bizTypeName: BIZ_TYPE_NAME[Number(row.biz_type)] || '其他',
    bizId: row.biz_id != null ? Number(row.biz_id) : null,
    bizNo: row.biz_no,
    partyName: row.party_name,
    balanceAfter: Number(row.balance_after),
    happenedAt: row.happened_at,
    remark: row.remark,
    operatorName: row.operator_name,
    createdAt: row.created_at,
  }
}

/**
 * 按流水重算账户余额。调用方须已开启事务并锁住账户行。
 * 这是 current_balance 的**唯一**合法写入口。
 */
async function refreshBalance(conn, accountId) {
  const [[acc]] = await conn.query('SELECT opening_balance FROM finance_accounts WHERE id=? FOR UPDATE', [accountId])
  if (!acc) throw new AppError('账户不存在', 404)
  const [[agg]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE -amount END), 0) AS delta
       FROM finance_account_transactions WHERE account_id = ?`,
    [accountId],
  )
  const balance = Number(acc.opening_balance) + Number(agg.delta)
  await conn.query('UPDATE finance_accounts SET current_balance=? WHERE id=?', [balance, accountId])
  return balance
}

/**
 * 写一条账户流水并刷新余额。收付款核销、报销付款都走这里。
 * @param conn 调用方的事务连接——资金流水必须与业务动作同生共死，不能各写各的
 */
async function recordTransaction(conn, {
  accountId, direction, amount, bizType, bizId = null, bizNo = null,
  partyName = null, happenedAt, remark = null,
}, operator = {}) {
  const id = Number(accountId)
  const value = Number(amount)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('请选择资金账户', 400)
  if (!Number.isFinite(value) || value <= 0) throw new AppError('流水金额必须大于 0', 400)

  const [[acc]] = await conn.query('SELECT * FROM finance_accounts WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
  if (!acc) throw new AppError('资金账户不存在', 404)
  if (!acc.is_active) throw new AppError(`账户「${acc.name}」已停用，不能再用于收付款`, 400)

  // 先落流水，再由 refreshBalance 从全量流水重算，balance_after 取重算结果
  const [r] = await conn.query(
    `INSERT INTO finance_account_transactions
       (account_id,direction,amount,biz_type,biz_id,biz_no,party_name,balance_after,happened_at,remark,operator_id,operator_name)
     VALUES (?,?,?,?,?,?,?,0,?,?,?,?)`,
    [id, Number(direction), value, Number(bizType), bizId, bizNo, partyName,
     happenedAt, remark, operator.operatorId ?? null, operator.operatorName ?? null],
  )
  const balance = await refreshBalance(conn, id)
  await conn.query('UPDATE finance_account_transactions SET balance_after=? WHERE id=?', [balance, r.insertId])
  return { id: r.insertId, balanceAfter: balance }
}

async function findAll({ keyword = '', type = '', isActive = '' } = {}) {
  const conds = ['deleted_at IS NULL']
  const params = []
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(code LIKE ? OR name LIKE ? OR account_no LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`) }
  if (type) { conds.push('type=?'); params.push(Number(type)) }
  if (isActive !== '' && isActive != null) { conds.push('is_active=?'); params.push(Number(isActive)) }
  const where = `WHERE ${conds.join(' AND ')}`

  const [rows] = await pool.query(
    `SELECT * FROM finance_accounts ${where} ORDER BY sort_order ASC, id ASC`, params,
  )
  const [[summary]] = await pool.query(
    `SELECT COALESCE(SUM(current_balance),0) AS totalBalance, COUNT(*) AS accountCount
       FROM finance_accounts ${where}`,
    params,
  )
  return {
    list: rows.map(fmtAccount),
    summary: { totalBalance: Number(summary.totalBalance), accountCount: Number(summary.accountCount) },
    pagination: { page: 1, pageSize: rows.length, total: rows.length },
  }
}

/** 可选账户下拉：只给启用的 */
async function findActive() {
  const [rows] = await pool.query(
    'SELECT * FROM finance_accounts WHERE deleted_at IS NULL AND is_active=1 ORDER BY sort_order ASC, id ASC',
  )
  return rows.map(fmtAccount)
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM finance_accounts WHERE id=? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('资金账户不存在', 404)
  return fmtAccount(row)
}

async function create({ name, type, accountNo, bankName, holder, openingBalance = 0, sortOrder = 0, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const code = await generateMasterCode(conn, 'ACC', 'finance_accounts')
    const opening = Number(openingBalance) || 0
    const [r] = await conn.query(
      `INSERT INTO finance_accounts
         (code,name,type,account_no,bank_name,holder,opening_balance,current_balance,sort_order,remark,operator_id,operator_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, String(name).trim(), Number(type) || ACCOUNT_TYPE.BANK, accountNo || null, bankName || null,
       holder || null, opening, opening, Number(sortOrder) || 0, remark || null,
       operator.operatorId, operator.operatorName],
    )
    await conn.commit()
    return { id: r.insertId, code }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/**
 * 编辑账户。**期初余额一旦有流水就不允许再改**——改了会让所有历史流水的
 * balance_after 快照与实际对不上，等于篡改账目。要调整余额请走 adjust()。
 */
async function update(id, { name, type, accountNo, bankName, holder, openingBalance, isActive, sortOrder, remark }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[acc]] = await conn.query('SELECT * FROM finance_accounts WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    if (!acc) throw new AppError('资金账户不存在', 404)

    const nextOpening = openingBalance != null ? Number(openingBalance) : Number(acc.opening_balance)
    if (nextOpening !== Number(acc.opening_balance)) {
      const [[{ n }]] = await conn.query(
        'SELECT COUNT(*) AS n FROM finance_account_transactions WHERE account_id=?', [id],
      )
      if (Number(n) > 0) {
        throw new AppError('该账户已有资金流水，期初余额不能再改；如需调整请用「余额调整」', 409)
      }
    }

    await conn.query(
      `UPDATE finance_accounts
          SET name=?,type=?,account_no=?,bank_name=?,holder=?,opening_balance=?,is_active=?,sort_order=?,remark=?
        WHERE id=? AND deleted_at IS NULL`,
      [String(name).trim(), Number(type), accountNo || null, bankName || null, holder || null,
       nextOpening, isActive ? 1 : 0, Number(sortOrder) || 0, remark || null, id],
    )
    await refreshBalance(conn, id)
    await conn.commit()
    return { id: Number(id) }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/**
 * 余额调整：账实不符时补一笔差额流水。
 * 不直接改余额——那样查不出「谁在什么时候把账改成了这样」。
 */
async function adjust(id, { targetBalance, happenedAt, remark }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[acc]] = await conn.query('SELECT * FROM finance_accounts WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
    if (!acc) throw new AppError('资金账户不存在', 404)

    const target = Number(targetBalance)
    if (!Number.isFinite(target)) throw new AppError('请填写调整后的账户余额', 400)
    const diff = Number((target - Number(acc.current_balance)).toFixed(4))
    if (Math.abs(diff) < 1e-6) throw new AppError('调整后余额与当前余额相同，无需调整', 400)

    const res = await recordTransaction(conn, {
      accountId: id,
      direction: diff > 0 ? DIRECTION.IN : DIRECTION.OUT,
      amount: Math.abs(diff),
      bizType: BIZ_TYPE.ADJUST,
      happenedAt: happenedAt || new Date().toISOString().slice(0, 10),
      remark: remark || `余额调整：${Number(acc.current_balance).toFixed(2)} → ${target.toFixed(2)}`,
    }, operator)
    await conn.commit()
    return { id: Number(id), balance: res.balanceAfter, diff }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

/** 有流水的账户不允许删除，只能停用——删了流水就成了孤儿，账对不上 */
async function softDelete(id) {
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM finance_account_transactions WHERE account_id=?', [id],
  )
  if (Number(n) > 0) throw new AppError('该账户已有资金流水，不能删除；请改为停用', 409)
  const [r] = await pool.query(
    'UPDATE finance_accounts SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id],
  )
  if (!r.affectedRows) throw new AppError('资金账户不存在', 404)
  return { id: Number(id) }
}

async function findTransactions({ accountId, page = 1, pageSize = 50, bizType = '', direction = '', startDate = '', endDate = '' } = {}) {
  const p = Number(page) || 1
  const ps = Number(pageSize) || 50
  const conds = []
  const params = []
  if (accountId) { conds.push('t.account_id=?'); params.push(Number(accountId)) }
  if (bizType) { conds.push('t.biz_type=?'); params.push(Number(bizType)) }
  if (direction) { conds.push('t.direction=?'); params.push(Number(direction)) }
  if (startDate) { conds.push('t.happened_at>=?'); params.push(startDate) }
  if (endDate) { conds.push('t.happened_at<=?'); params.push(endDate) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const [rows] = await pool.query(
    `SELECT t.*, a.name AS account_name
       FROM finance_account_transactions t
       JOIN finance_accounts a ON a.id = t.account_id
       ${where}
      ORDER BY t.happened_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM finance_account_transactions t ${where}`, params,
  )
  const [[sum]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN t.direction=1 THEN t.amount ELSE 0 END),0) AS inAmount,
            COALESCE(SUM(CASE WHEN t.direction=2 THEN t.amount ELSE 0 END),0) AS outAmount
       FROM finance_account_transactions t ${where}`,
    params,
  )
  return {
    list: rows.map(fmtTransaction),
    summary: { inAmount: Number(sum.inAmount), outAmount: Number(sum.outAmount) },
    pagination: { page: p, pageSize: ps, total },
  }
}

/**
 * 一致性检查：逐个账户比对 current_balance 与流水重算值。
 * 与 inventory/check-consistency 同一个用途——缓存必须能被验证，否则不敢信。
 */
async function checkConsistency() {
  const [rows] = await pool.query(
    `SELECT a.id, a.code, a.name, a.opening_balance, a.current_balance,
            COALESCE(SUM(CASE WHEN t.direction=1 THEN t.amount ELSE -t.amount END), 0) AS delta
       FROM finance_accounts a
       LEFT JOIN finance_account_transactions t ON t.account_id = a.id
      WHERE a.deleted_at IS NULL
      GROUP BY a.id`,
  )
  const mismatches = rows
    .map(r => ({
      id: Number(r.id), code: r.code, name: r.name,
      recorded: Number(r.current_balance),
      expected: Number(r.opening_balance) + Number(r.delta),
    }))
    .filter(r => Math.abs(r.recorded - r.expected) > 1e-6)
  return { checked: rows.length, mismatchCount: mismatches.length, mismatches }
}

module.exports = {
  ACCOUNT_TYPE, ACCOUNT_TYPE_NAME, DIRECTION, BIZ_TYPE, BIZ_TYPE_NAME,
  findAll, findActive, findById, create, update, adjust, softDelete,
  findTransactions, recordTransaction, refreshBalance, checkConsistency,
}
