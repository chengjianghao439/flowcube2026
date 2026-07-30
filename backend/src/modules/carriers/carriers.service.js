const { pool }    = require('../../config/db')
const AppError    = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')

const fmt = r => ({
  id:        r.id,
  code:      r.code,
  name:      r.name,
  type:      r.type || 'express',
  contact:   r.contact  || null,
  phone:     r.phone    || null,
  remark:    r.remark   || null,
  isActive:  !!r.is_active,
  // 电子面单平台对接配置（文档 06）。全是非敏感项，密钥不在此处、也从不返回前端。
  platformCode:     r.platform_code    || null,
  platformCarrier:  r.platform_carrier || null,
  monthlyAccount:   r.monthly_account  || null,
  netSiteCode:      r.net_site_code    || null,
  credentialRef:    r.credential_ref   || null,
  waybillEnabled:   !!r.waybill_enabled,
  createdAt: r.created_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '' } = {}) {
  const like   = `%${keyword}%`
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT * FROM carriers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR contact LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [like, like, like, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM carriers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR contact LIKE ?)`,
    [like, like, like],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    `SELECT id, code, name FROM carriers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC`,
  )
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name }))
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL`, [id],
  )
  if (!row) throw new AppError('承运商不存在', 404)
  return fmt(row)
}

// 平台对接字段统一清洗（空串归 null；开通取号需先选平台）
function normPlatform({ platformCode, platformCarrier, monthlyAccount, netSiteCode, credentialRef, waybillEnabled }) {
  const s = v => { const t = (v ?? '').toString().trim(); return t || null }
  const code = s(platformCode)
  const enabled = waybillEnabled ? 1 : 0
  if (enabled && !code) throw new AppError('开通电子面单取号前需先选择对接平台', 400)
  return {
    platformCode:    code,
    platformCarrier: s(platformCarrier),
    monthlyAccount:  s(monthlyAccount),
    netSiteCode:     s(netSiteCode),
    credentialRef:   s(credentialRef),
    waybillEnabled:  enabled,
  }
}

async function create({ name, type, contact, phone, remark, ...rest }) {
  if (!name) throw new AppError('名称不能为空', 400)
  const p = normPlatform(rest)
  const code = await generateMasterCode(pool, 'CAR', 'carriers')
  const [r] = await pool.query(
    `INSERT INTO carriers (code, name, type, contact, phone, remark,
       platform_code, platform_carrier, monthly_account, net_site_code, credential_ref, waybill_enabled)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, name, type || 'express', contact || null, phone || null, remark || null,
     p.platformCode, p.platformCarrier, p.monthlyAccount, p.netSiteCode, p.credentialRef, p.waybillEnabled],
  )
  return { id: r.insertId, code }
}

async function update(id, { name, type, contact, phone, remark, isActive, ...rest }) {
  await findById(id)
  const p = normPlatform(rest)
  await pool.query(
    `UPDATE carriers SET name=?, type=?, contact=?, phone=?, remark=?, is_active=?,
       platform_code=?, platform_carrier=?, monthly_account=?, net_site_code=?, credential_ref=?, waybill_enabled=?
     WHERE id=? AND deleted_at IS NULL`,
    [name, type || 'express', contact || null, phone || null, remark || null, isActive ? 1 : 0,
     p.platformCode, p.platformCarrier, p.monthlyAccount, p.netSiteCode, p.credentialRef, p.waybillEnabled, id],
  )
}

async function remove(id) {
  await findById(id)
  await pool.query(`UPDATE carriers SET deleted_at=NOW() WHERE id=?`, [id])
}

module.exports = { findAll, findAllActive, findById, create, update, remove }
