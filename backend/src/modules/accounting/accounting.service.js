/**
 * 会计核算 Service（文档 10 · Phase 0 科目地基）
 *
 * 本期只实现「会计科目表」的树形维护。凭证/总账/报表是后续 Phase。
 * 科目规则：
 *  - code 系用户按会计准则录入、全表唯一、一经创建不可改（凭证分录按 code 快照，映射引擎按 code 引用）。
 *  - 预置科目 is_preset=1：不可删除、不可停用、不可改分类/方向（映射引擎依赖）；仅可改排序/备注。
 *  - 含下级的科目 is_leaf=0（汇总科目，Phase1 凭证不可直接挂其分录）；删掉最后一个子级会回落 is_leaf=1。
 *  - 最多 4 级（与商品分类同口径，避免层级失控）。
 */

const { pool } = require('../../config/db')
const AppError  = require('../../utils/AppError')
const logger    = require('../../utils/logger')

const MAX_LEVEL = 4
const CATEGORY_VALUES = [1, 2, 3, 4, 5, 6] // 1资产 2负债 3权益 4成本 5损益(收入) 6损益(费用)

// 资产/成本/费用 借；负债/权益/收入 贷
function defaultBalanceDir(category) {
  return (category === 1 || category === 4 || category === 6) ? 1 : 2
}

// ─── 格式化 ────────────────────────────────────────────────────────────────

function fmt(row) {
  return {
    id:         row.id,
    code:       row.code,
    name:       row.name,
    category:   row.category,
    balanceDir: row.balance_dir,
    parentId:   row.parent_id ?? null,
    level:      row.level ?? 1,
    isLeaf:     row.is_leaf ? 1 : 0,
    auxType:    row.aux_type ?? 0,
    isActive:   row.is_active ? 1 : 0,
    isPreset:   row.is_preset ? 1 : 0,
    sortOrder:  row.sort_order ?? 0,
    remark:     row.remark ?? null,
    createdAt:  row.created_at,
  }
}

function buildTree(flat) {
  const map = {}
  flat.forEach(r => { map[r.id] = { ...r, children: [] } })
  const roots = []
  flat.forEach(r => {
    if (r.parentId && map[r.parentId]) map[r.parentId].children.push(map[r.id])
    else roots.push(map[r.id])
  })
  return roots
}

const BASE_SELECT = `
  SELECT id, code, name, category, balance_dir, parent_id, level, is_leaf,
         aux_type, is_active, is_preset, sort_order, remark, created_at
  FROM acct_accounts
  WHERE deleted_at IS NULL`

// ─── 查询 ──────────────────────────────────────────────────────────────────

/** 树形（含 children 递归），按 编码升序。companyId 账套过滤（2026-08-21 审计高危修复） */
async function getTree(companyId = 1) {
  const [rows] = await pool.query(`${BASE_SELECT} AND company_id = ? ORDER BY code ASC`, [companyId])
  return buildTree(rows.map(fmt))
}

/** 扁平列表（供下拉/凭证选科目用）；onlyLeaf=true 只返回可记账明细科目 */
async function getFlat({ onlyLeaf = false, onlyActive = false, companyId = 1 } = {}) {
  let sql = `${BASE_SELECT} AND company_id = ?`
  const params = [companyId]
  if (onlyLeaf)   { sql += ' AND is_leaf = 1' }
  if (onlyActive) { sql += ' AND is_active = 1' }
  const [rows] = await pool.query(`${sql} ORDER BY code ASC`, params)
  return rows.map(fmt)
}

async function getById(id, conn = pool, companyId = 1) {
  const [[row]] = await conn.query(`${BASE_SELECT} AND company_id = ? AND id = ?`, [companyId, id])
  if (!row) throw new AppError('科目不存在', 404)
  return fmt(row)
}

// ─── 写入 ──────────────────────────────────────────────────────────────────

function normalizeCode(code) {
  const c = String(code ?? '').trim()
  if (!c) throw new AppError('科目编码不能为空', 400)
  if (!/^[0-9A-Za-z.]{1,20}$/.test(c)) throw new AppError('科目编码只能是数字/字母/点，最长 20 位', 400)
  return c
}

function validateCategory(category) {
  const c = Number(category)
  if (!CATEGORY_VALUES.includes(c)) throw new AppError('科目类别非法（1资产 2负债 3权益 4成本 5收入 6费用）', 400)
  return c
}

async function create({ code, name, category, balanceDir, parentId, auxType, sortOrder, remark, companyId = 1 }, operatorId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const theCode = normalizeCode(code)
    const cat = validateCategory(category)
    const dir = balanceDir ? (Number(balanceDir) === 1 ? 1 : 2) : defaultBalanceDir(cat)
    const nm = String(name ?? '').trim()
    if (!nm) throw new AppError('科目名称不能为空', 400)

    let level = 1
    if (parentId) {
      const parent = await getById(parentId, conn, companyId)
      if (parent.level >= MAX_LEVEL) throw new AppError(`已达最大层级（${MAX_LEVEL}级），无法在此科目下新建下级`, 400)
      level = parent.level + 1
      // 父科目变为汇总科目（不可直接记账）
      await conn.query('UPDATE acct_accounts SET is_leaf = 0 WHERE id = ? AND company_id = ?', [parentId, companyId])
    }

    let insertId
    try {
      const [r] = await conn.query(
        `INSERT INTO acct_accounts
           (company_id, code, name, category, balance_dir, parent_id, level, is_leaf, aux_type, is_active, is_preset, sort_order, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, ?)`,
        [companyId, theCode, nm, cat, dir, parentId || null, level, auxType ? 1 : 0, sortOrder ?? 0, remark || null],
      )
      insertId = r.insertId
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new AppError(`科目编码 ${theCode} 已存在`, 400, 'ACCT_CODE_DUP')
      throw e
    }

    await conn.commit()
    logger.info('accounting', `新建科目 [${theCode} ${nm}] level=${level}`, { id: insertId, operatorId, companyId })
    return { id: insertId, code: theCode }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function update(id, { name, category, balanceDir, auxType, sortOrder, remark, companyId = 1 }, operatorId) {
  const acct = await getById(id, pool, companyId)

  if (acct.isPreset) {
    // 预置科目：只允许改排序与备注
    await pool.query(
      'UPDATE acct_accounts SET sort_order = ?, remark = ? WHERE id = ? AND company_id = ? AND deleted_at IS NULL',
      [sortOrder ?? acct.sortOrder, remark ?? acct.remark, id, companyId],
    )
    logger.info('accounting', `更新预置科目排序/备注 [id=${id}]`, { operatorId })
    return
  }

  const nm = String(name ?? '').trim()
  if (!nm) throw new AppError('科目名称不能为空', 400)
  const cat = category !== undefined ? validateCategory(category) : acct.category
  const dir = balanceDir !== undefined ? (Number(balanceDir) === 1 ? 1 : 2) : acct.balanceDir

  await pool.query(
    `UPDATE acct_accounts
       SET name = ?, category = ?, balance_dir = ?, aux_type = ?, sort_order = ?, remark = ?
     WHERE id = ? AND company_id = ? AND deleted_at IS NULL`,
    [nm, cat, dir, auxType ? 1 : 0, sortOrder ?? acct.sortOrder, remark ?? acct.remark, id, companyId],
  )
  logger.info('accounting', `更新科目 [${acct.code} ${nm}]`, { operatorId })
}

async function remove(id, operatorId, companyId = 1) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const acct = await getById(id, conn, companyId)
    if (acct.isPreset) throw new AppError('系统预置科目不可删除', 400, 'ACCT_PRESET_LOCKED')

    const [[{ childCount }]] = await conn.query(
      'SELECT COUNT(*) AS childCount FROM acct_accounts WHERE parent_id = ? AND company_id = ? AND deleted_at IS NULL', [id, companyId],
    )
    if (childCount > 0) throw new AppError('该科目下存在下级科目，请先删除下级', 400)

    // 已使用科目禁止删除（2026-08-21 审计 E.6 修复）：凭证分录快照科目编码/名称，
    // 但试算平衡/报表 FROM acct_accounts LEFT JOIN entries 依赖科目主表——删掉后
    // 该科目历史发生额从报表消失、借贷恒等式被打破、明细账 404。引导走停用(is_active=0)。
    const [[{ entryCount }]] = await conn.query(
      'SELECT COUNT(*) AS entryCount FROM acct_voucher_entries WHERE account_id = ?',
      [id],
    )
    if (entryCount > 0) throw new AppError('该科目已有凭证分录，不可删除；请改为停用', 400, 'ACCT_ACCOUNT_IN_USE')

    // 硬删除（非软删）：科目编码是用户手输且受 uk_acct_accounts_code_company 唯一约束，软删会让该编码被永久占用、
    // 无法重建同码科目。会计语义上删除只针对「建错、从未使用」的科目——凭证分录已快照科目编码/名称
    // （acct_voucher_entries），不依赖科目主表，故硬删不影响历史凭证。「用过但想弃用」的科目走停用(is_active=0)。
    // Phase1 上线凭证后，此处需再加「该科目已有凭证分录则禁止删除、只能停用」的前置校验。
    await conn.query('DELETE FROM acct_accounts WHERE id = ? AND company_id = ?', [id, companyId])

    // 若父科目已无其它存活下级，回落为明细科目（可记账）
    if (acct.parentId) {
      const [[{ remain }]] = await conn.query(
        'SELECT COUNT(*) AS remain FROM acct_accounts WHERE parent_id = ? AND company_id = ? AND deleted_at IS NULL', [acct.parentId, companyId],
      )
      if (remain === 0) await conn.query('UPDATE acct_accounts SET is_leaf = 1 WHERE id = ? AND company_id = ?', [acct.parentId, companyId])
    }

    await conn.commit()
    logger.info('accounting', `删除科目 [${acct.code} ${acct.name}]`, { operatorId })
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function toggleStatus(id, isActive, operatorId, companyId = 1) {
  const acct = await getById(id, pool, companyId)
  if (acct.isPreset) throw new AppError('系统预置科目不可停用（映射引擎依赖）', 400, 'ACCT_PRESET_LOCKED')
  await pool.query('UPDATE acct_accounts SET is_active = ? WHERE id = ? AND company_id = ? AND deleted_at IS NULL', [isActive ? 1 : 0, id, companyId])
  logger.info('accounting', `${isActive ? '启用' : '停用'}科目 [${acct.code} ${acct.name}]`, { operatorId })
}

module.exports = { getTree, getFlat, getById, create, update, remove, toggleStatus }
