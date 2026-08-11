const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { normalizePagination } = require('../../utils/pagination')

/**
 * 会计账套管理（文档10 多账套地基）。
 *
 * 建账：创建账套 + 自动从主账套复制预置科目（company_id 维度）+ 初始化当前期间。
 * 切换：前端带 X-Company-Id 头，由 companyScope 中间件注入 req.companyId。
 * 默认账套 id=1（主账套，现有全部数据）。只允许超管/会计管理角色操作账套。
 */

function fmt(r) {
  return {
    id: Number(r.id),
    code: r.code,
    name: r.name,
    taxNo: r.tax_no,
    parentId: r.parent_id != null ? Number(r.parent_id) : null,
    isGroup: !!r.is_group,
    currency: r.currency,
    startPeriod: r.start_period,
    isActive: !!r.is_active,
    remark: r.remark,
    createdAt: r.created_at,
  }
}

async function listCompanies({ page = 1, pageSize = 20, keyword = '' } = {}) {
  const { page: p, pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const conds = ['1=1']
  const params = []
  const kw = String(keyword || '').trim()
  if (kw) { conds.push('(code LIKE ? OR name LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`) }
  const where = `WHERE ${conds.join(' AND ')}`
  const [rows] = await pool.query(
    `SELECT * FROM acct_companies ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM acct_companies ${where}`, params)
  return { list: rows.map(fmt), pagination: { page: p, pageSize: ps, total } }
}

/** 建账：创建账套 + 复制主账套预置科目 + 初始化当前期间。 */
async function createCompany({ code, name, taxNo, parentId, isGroup, startPeriod, remark }) {
  const c = String(code || '').trim().toUpperCase()
  if (!/^[A-Z0-9_]{1,20}$/.test(c)) throw new AppError('账套编码只能是字母/数字/下划线，最长 20 位', 400)
  if (!String(name || '').trim()) throw new AppError('请填写账套名称', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 编码唯一
    const [[dup]] = await conn.query('SELECT id FROM acct_companies WHERE code = ?', [c])
    if (dup) throw new AppError('账套编码已存在', 409)

    const [r] = await conn.query(
      `INSERT INTO acct_companies (code, name, tax_no, parent_id, is_group, currency, start_period, remark)
       VALUES (?,?,?,?,?,?,?,?)`,
      [c, String(name).trim(), taxNo || null, parentId ? Number(parentId) : null, isGroup ? 1 : 0, 'CNY', startPeriod || null, remark || null],
    )
    const newId = r.insertId

    // 复制主账套(is_preset=1)科目 → 新账套
    await conn.query(
      `INSERT INTO acct_accounts (company_id, code, name, category, balance_dir, parent_id, level, is_leaf, aux_type, is_preset, sort_order, is_active)
       SELECT ?, code, name, category, balance_dir, parent_id, level, is_leaf, aux_type, is_preset, sort_order, is_active
       FROM acct_accounts WHERE company_id = 1 AND is_preset = 1 AND deleted_at IS NULL`,
      [newId],
    )
    await conn.commit()
    return { id: newId, code: c }
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function updateCompany(id, { name, taxNo, parentId, isGroup, isActive, startPeriod, remark }) {
  const [[row]] = await pool.query('SELECT id FROM acct_companies WHERE id = ?', [Number(id)])
  if (!row) throw new AppError('账套不存在', 404)
  if (Number(id) === 1 && isActive === false) throw new AppError('主账套不能停用', 400)
  await pool.query(
    `UPDATE acct_companies SET name=?, tax_no=?, parent_id=?, is_group=?, is_active=?, start_period=?, remark=? WHERE id=?`,
    [name != null ? String(name) : row.name, taxNo || null, parentId ? Number(parentId) : null, isGroup ? 1 : 0, isActive ? 1 : 0, startPeriod || null, remark || null, Number(id)],
  )
  return { id: Number(id) }
}

module.exports = { listCompanies, createCompany, updateCompany }
