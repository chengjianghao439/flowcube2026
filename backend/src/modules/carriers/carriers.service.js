const { pool }    = require('../../config/db')
const { normalizeProduct } = require('../logistics/shipping-products')
const AppError    = require('../../utils/AppError')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { normalizePagination } = require('../../utils/pagination')
const { assertAccountChangeAllowed, accountChangedOf } = require('./carriers.guards')

/** carriers 表上的平台对接列（写在这里的都是非敏感项，密钥只经 env 引用名） */
const PLATFORM_FIELDS = ['platformCode', 'platformCarrier', 'monthlyAccount', 'netSiteCode', 'credentialRef', 'waybillEnabled', 'shippingProduct', 'shippingDeliveryType']
const SUPPORTED_PLATFORMS = ['sf', 'deppon', 'kdniao', 'mock']
/**
 * 顺丰/德邦的月结账号、常用服务与「取号」开关**只能**由「快递账号绑定」页维护：那条路径有
 * revision CAS、暂停前置、待处理运单与 canEnable（正式凭据 + 账号已验收 + 服务就绪）四道闸门。
 * 承运商管理页直接拒绝这几个字段，不再充当绕过闸门的第二条写路径（2026-09-18 审计 [9]）。
 * 快递公司自身的声明/变更仍可在此进行，但同样受「启用中或有待处理运单不得更换」约束。
 */
const DIRECT_PLATFORMS = ['sf', 'deppon']
const DIRECT_ACCOUNT_FIELDS = ['monthlyAccount', 'netSiteCode', 'credentialRef', 'waybillEnabled', 'shippingProduct', 'shippingDeliveryType']

const clean  = v => String(v ?? '').trim()
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** 只取出请求里出现的平台字段——缺失的必须沿用库中现值，不能当作「清空」 */
function pickPlatform(src) {
  const out = {}
  for (const key of PLATFORM_FIELDS) if (hasOwn(src, key)) out[key] = src[key]
  return out
}
function rowPlatform(row) {
  return {
    platformCode:    row.platform_code,
    platformCarrier: row.platform_carrier,
    monthlyAccount:  row.monthly_account,
    netSiteCode:     row.net_site_code,
    credentialRef:   row.credential_ref,
    waybillEnabled:  !!row.waybill_enabled,
    shippingProduct: row.shipping_product,
    shippingDeliveryType: row.shipping_delivery_type,
  }
}
function assertNoDirectAccountFields(payload, currentPlatform, targetPlatform) {
  if (!DIRECT_PLATFORMS.includes(currentPlatform) && !DIRECT_PLATFORMS.includes(targetPlatform)) return
  if (DIRECT_ACCOUNT_FIELDS.some(k => hasOwn(payload, k))) {
    throw new AppError('顺丰/德邦的月结账号、常用服务与取号开关请在「快递账号绑定」页维护', 400, 'CARRIER_ACCOUNT_FIELDS_MOVED')
  }
}

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

// 平台编码白名单 + 本地演示(mock)闸门（与 carriers 管理的两条写路径共用）
function assertPlatformSupported(code) {
  if (code && !SUPPORTED_PLATFORMS.includes(code)) throw new AppError('该平台暂未实现下单，请选择已支持的平台', 400)
  // 本地演示(mock)适配器无 HTTP、无凭据即可「签出」一个由运单号哈希出来的假快递单号，并生成假面单入打印队列，
  // worker 还会把它当真实取号成功推进运单状态（2026-09-18 审计 P2）。生产启用等于对真实出库签发假单号。
  // 闸门放在**配置入口**而不是适配器内部：在那里拦会把「静默造假」变成 worker 每轮刷屏的失败，
  // 仍然留下一批状态已推进的脏运单。与 carrier-adapters/direct-common.js 的生产隔离保持同一口径。
  if (code === 'mock' && !(process.env.ALLOW_MOCK_CARRIER === '1' && process.env.NODE_ENV !== 'production')) {
    throw new AppError('「本地演示(mock)」平台仅限开发环境调试使用，生产不可启用', 400, 'CARRIER_MOCK_NOT_ALLOWED')
  }
  return code
}

// 平台对接字段统一清洗（空串归 null；开通取号需先选平台）
function normPlatform({ platformCode, platformCarrier, monthlyAccount, netSiteCode, credentialRef, waybillEnabled, shippingProduct, shippingDeliveryType }) {
  const s = v => { const t = (v ?? '').toString().trim(); return t || null }
  const code = s(platformCode)
  const enabled = waybillEnabled ? 1 : 0
  if (enabled && !code) throw new AppError('开通电子面单取号前需先选择对接平台', 400)
  assertPlatformSupported(code)
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

async function create(payload) {
  const { name, type, contact, phone, remark } = payload
  if (!name) throw new AppError('名称不能为空', 400)
  const wanted = pickPlatform(payload)
  assertNoDirectAccountFields(payload, null, clean(wanted.platformCode) || null)
  const p = normPlatform(wanted)
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

async function update(id, payload) {
  const { name, type, contact, phone, remark, isActive } = payload
  if (!name) throw new AppError('名称不能为空', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 行锁：账号/平台判定的读—判—写必须在同一事务里，否则两个管理员并发保存会互相覆盖
    const [[row]] = await conn.query(`SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id])
    if (!row) throw new AppError('承运商不存在', 404)
    const wanted = pickPlatform(payload)
    const targetPlatform = clean(wanted.platformCode) || row.platform_code || null
    assertNoDirectAccountFields(payload, row.platform_code, targetPlatform)
    const direct = DIRECT_PLATFORMS.includes(row.platform_code) || DIRECT_PLATFORMS.includes(targetPlatform)
    const basic = [name, type || 'express', contact || null, phone || null, remark || null, isActive ? 1 : 0]
    if (direct) {
      // 只允许改「平台声明」本身；月结账号等列原样保留，绝不在这里写入
      assertPlatformSupported(targetPlatform)
      const platformCarrier = hasOwn(wanted, 'platformCarrier') ? (clean(wanted.platformCarrier) || null) : row.platform_carrier
      await assertAccountChangeAllowed(conn, row, accountChangedOf(row, { platformCode: targetPlatform, monthlyAccount: row.monthly_account }))
      await conn.query(
        `UPDATE carriers SET name=?, type=?, contact=?, phone=?, remark=?, is_active=?,
           platform_code=?, platform_carrier=?
         WHERE id=? AND deleted_at IS NULL`,
        [...basic, targetPlatform, platformCarrier, id],
      )
    } else {
      const merged = { ...rowPlatform(row), ...wanted, platformCode: targetPlatform }
      const p = normPlatform(merged)
      await assertAccountChangeAllowed(conn, row, accountChangedOf(row, p))
      await conn.query(
        `UPDATE carriers SET name=?, type=?, contact=?, phone=?, remark=?, is_active=?,
           platform_code=?, platform_carrier=?, monthly_account=?, net_site_code=?, credential_ref=?, waybill_enabled=?, shipping_product=?, shipping_delivery_type=?
         WHERE id=? AND deleted_at IS NULL`,
        [...basic, p.platformCode, p.platformCarrier, p.monthlyAccount, p.netSiteCode, p.credentialRef, p.waybillEnabled, p.shippingProduct, p.shippingDeliveryType, id],
      )
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

async function remove(id) {
  await require('./carriers.binding').createBindingService({ pool }).remove(id)
}

module.exports = { findAll, findAllActive, findById, create, update, remove }
