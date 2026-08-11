const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

/**
 * 部门组织（P2-7）。树形结构（parent_id），可挂部门负责人（审批流按部门负责人寻人）。
 * 删除护栏：部门下有用户或子部门时不允许删除（只能停用语义——这里用删除检查替代停用，
 * 部门是组织主数据，历史单据不引用部门，删除不破坏数据）。
 */

function fmt(r) {
  return {
    id: Number(r.id),
    name: r.name,
    parentId: Number(r.parent_id),
    managerId: r.manager_id != null ? Number(r.manager_id) : null,
    managerName: r.manager_name || null,
    sortOrder: Number(r.sort_order),
    remark: r.remark,
    createdAt: r.created_at,
  }
}

/** 部门树（含每部门成员数、负责人姓名）。列表一次性拉全部，前端按 parentId 组树。 */
async function findAll() {
  const [rows] = await pool.query(
    `SELECT d.*, u.real_name AS manager_name,
            (SELECT COUNT(*) FROM sys_users su WHERE su.department_id=d.id AND su.deleted_at IS NULL) AS member_count
       FROM sys_departments d
       LEFT JOIN sys_users u ON u.id=d.manager_id AND u.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
      ORDER BY d.sort_order ASC, d.id ASC`,
  )
  return rows.map(r => ({ ...fmt(r), memberCount: Number(r.member_count) }))
}

/** 精简列表（下拉用，含启用校验），不受 department.view 权限限制。 */
async function listOptions() {
  const [rows] = await pool.query(
    'SELECT id, name FROM sys_departments WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC',
  )
  return rows.map(r => ({ id: Number(r.id), name: r.name }))
}

async function create({ name, parentId = 0, managerId = null, sortOrder = 0, remark }) {
  const n = String(name || '').trim()
  if (!n) throw new AppError('部门名称不能为空', 400)
  if (Number(parentId)) {
    const [[p]] = await pool.query('SELECT id FROM sys_departments WHERE id=? AND deleted_at IS NULL', [Number(parentId)])
    if (!p) throw new AppError('上级部门不存在', 400)
  }
  if (managerId) {
    const [[u]] = await pool.query('SELECT id FROM sys_users WHERE id=? AND deleted_at IS NULL', [Number(managerId)])
    if (!u) throw new AppError('部门负责人不存在', 400)
  }
  const [r] = await pool.query(
    'INSERT INTO sys_departments (name,parent_id,manager_id,sort_order,remark) VALUES (?,?,?,?,?)',
    [n, Number(parentId) || 0, managerId ? Number(managerId) : null, Number(sortOrder) || 0, remark || null],
  )
  return { id: r.insertId }
}

async function update(id, { name, parentId, managerId, sortOrder, remark }) {
  const [[d]] = await pool.query('SELECT * FROM sys_departments WHERE id=? AND deleted_at IS NULL', [Number(id)])
  if (!d) throw new AppError('部门不存在', 404)
  // 禁止把部门挂到自己或自己子孙下（防环）
  const newParent = parentId !== undefined ? Number(parentId) || 0 : Number(d.parent_id)
  if (newParent === Number(id)) throw new AppError('上级部门不能是自身', 400)
  if (newParent) {
    // 沿父链向上走，若遇到自身则成环
    let cur = newParent
    const seen = new Set()
    while (cur) {
      if (cur === Number(id)) throw new AppError('不能把部门挂到自己的子孙部门下', 400)
      if (seen.has(cur)) break
      seen.add(cur)
      const [[pp]] = await pool.query('SELECT parent_id FROM sys_departments WHERE id=? AND deleted_at IS NULL', [cur])
      cur = pp ? Number(pp.parent_id) : 0
    }
  }
  if (managerId) {
    const [[u]] = await pool.query('SELECT id FROM sys_users WHERE id=? AND deleted_at IS NULL', [Number(managerId)])
    if (!u) throw new AppError('部门负责人不存在', 400)
  }
  await pool.query(
    'UPDATE sys_departments SET name=?,parent_id=?,manager_id=?,sort_order=?,remark=? WHERE id=?',
    [
      name !== undefined && name !== null && String(name).trim() ? String(name).trim() : d.name,
      newParent,
      managerId ? Number(managerId) : null,
      sortOrder !== undefined ? Number(sortOrder) || 0 : Number(d.sort_order),
      remark !== undefined ? remark : d.remark,
      Number(id),
    ],
  )
  return { id: Number(id) }
}

async function remove(id) {
  const [[d]] = await pool.query('SELECT * FROM sys_departments WHERE id=? AND deleted_at IS NULL', [Number(id)])
  if (!d) throw new AppError('部门不存在', 404)
  const [[{ sub }]] = await pool.query('SELECT COUNT(*) AS sub FROM sys_departments WHERE parent_id=? AND deleted_at IS NULL', [Number(id)])
  if (Number(sub) > 0) throw new AppError('该部门下有子部门，请先移动或删除子部门', 409)
  const [[{ members }]] = await pool.query('SELECT COUNT(*) AS members FROM sys_users WHERE department_id=? AND deleted_at IS NULL', [Number(id)])
  if (Number(members) > 0) throw new AppError('该部门下还有用户，请先调整用户所属部门', 409)
  await pool.query('UPDATE sys_departments SET deleted_at=NOW() WHERE id=?', [Number(id)])
  return { id: Number(id) }
}

module.exports = { findAll, listOptions, create, update, remove }
