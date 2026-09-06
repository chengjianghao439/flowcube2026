const { pool }    = require('../../config/db')
const { normalizeProduct } = require('../logistics/shipping-products')
const AppError    = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { normalizePagination } = require('../../utils/pagination')

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
  shippingProduct: r.shipping_product || null,
  shippingDeliveryType: r.shipping_delivery_type || null,
  createdAt: r.created_at,
})

async function findAll({ page = 1, pageSize = 20, keyword = '' } = {}) {
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const like   = `%${keyword}%`
  const [rows] = await pool.query(
    `SELECT * FROM carriers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR contact LIKE ?)
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [like, like, like, ps, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM carriers WHERE deleted_at IS NULL AND (code LIKE ? OR name LIKE ? OR contact LIKE ?)`,
    [like, like, like],
  )
  return { list: rows.map(fmt), pagination: { page, pageSize: ps, total } }
}

async function findAllActive() {
  const [rows] = await pool.query(
    `SELECT id, code, name, platform_code, shipping_product FROM carriers WHERE deleted_at IS NULL AND is_active=1 ORDER BY name ASC`,
  )
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name, platformCode: r.platform_code || null, shippingProduct: r.shipping_product || null }))
}

async function findById(id) {
  const [[row]] = await pool.query(
    `SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL`, [id],
  )
  if (!row) throw new AppError('承运商不存在', 404)
  return fmt(row)
}

// 平台对接字段统一清洗（空串归 null；开通取号需先选平台）
function normPlatform({ platformCode, platformCarrier, monthlyAccount, netSiteCode, credentialRef, waybillEnabled, shippingProduct, shippingDeliveryType }) {
  const s = v => { const t = (v ?? '').toString().trim(); return t || null }
  const code = s(platformCode)
  const enabled = waybillEnabled ? 1 : 0
  if (enabled && !code) throw new AppError('开通电子面单取号前需先选择对接平台', 400)
  if (code && !['sf', 'deppon', 'kdniao', 'mock'].includes(code)) throw new AppError('该平台暂未实现下单，请选择已支持的平台', 400)
  const product = normalizeProduct(code, shippingProduct)
  if (enabled && ['sf', 'deppon'].includes(code) && (!product || !s(monthlyAccount) || !s(credentialRef))) throw new AppError('启用直连下单前请填写月结账号、凭据引用名和默认发货产品', 400)
  if (code === 'deppon' && enabled && !['1', '3', '4'].includes(s(shippingDeliveryType))) throw new AppError('请选择德邦送货方式', 400)
  return {
    shippingProduct: product,
    shippingDeliveryType: code === 'deppon' ? s(shippingDeliveryType) : null,
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
       platform_code, platform_carrier, monthly_account, net_site_code, credential_ref, waybill_enabled, shipping_product, shipping_delivery_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, name, type || 'express', contact || null, phone || null, remark || null,
     p.platformCode, p.platformCarrier, p.monthlyAccount, p.netSiteCode, p.credentialRef, p.waybillEnabled, p.shippingProduct, p.shippingDeliveryType],
  )
  return { id: r.insertId, code }
}

async function update(id, { name, type, contact, phone, remark, isActive, ...rest }) {
  await findById(id)
  const p = normPlatform(rest)
  await pool.query(
    `UPDATE carriers SET name=?, type=?, contact=?, phone=?, remark=?, is_active=?,
       platform_code=?, platform_carrier=?, monthly_account=?, net_site_code=?, credential_ref=?, waybill_enabled=?, shipping_product=?, shipping_delivery_type=?
     WHERE id=? AND deleted_at IS NULL`,
    [name, type || 'express', contact || null, phone || null, remark || null, isActive ? 1 : 0,
     p.platformCode, p.platformCarrier, p.monthlyAccount, p.netSiteCode, p.credentialRef, p.waybillEnabled, p.shippingProduct, p.shippingDeliveryType, id],
  )
}

async function remove(id) {
  await require('./carriers.binding').createBindingService({ pool }).remove(id)
}

module.exports = { findAll, findAllActive, findById, create, update, remove }
