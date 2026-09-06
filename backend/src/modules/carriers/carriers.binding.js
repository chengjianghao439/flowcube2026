'use strict'
const crypto = require('node:crypto')
const AppError = require('../../utils/AppError')
const { credentials } = require('../logistics/carrier-adapters/direct-common')
const { normalizeProduct } = require('../logistics/shipping-products')
const DEPPON_OPTIONS = [ ['DJBK', '大件标快'], ['DJTK', '大件特快'], ['DJTH', '大件特惠'], ['XJBK', '小件标快'], ['XJTK', '小件特快'], ['XJTH', '小件特惠'], ['YTYDS', '精准大票电商'] ].map(([code, label]) => ({ code, label }))
const clean = v => String(v || '').trim()
function platformFor(row, selected) {
  if (selected && row.platform_code && selected !== row.platform_code) throw new AppError('该承运商已有快递公司配置，请在承运商管理中处理', 400)
  const platform = row.platform_code || selected
  if (!['sf', 'deppon'].includes(platform)) throw new AppError('请选择顺丰或德邦快递公司', 400)
  return platform
}
function revision(row) {
  return crypto.createHash('sha256').update(JSON.stringify([row.id, row.platform_code || '', row.monthly_account || '', row.shipping_product || '', row.shipping_delivery_type || '', row.credential_ref || '', !!row.waybill_enabled, !!row.is_active])).digest('hex')
}
function createBindingService({ pool, operations, getCredential = ref => require('../../config/env').getWaybillCredential(ref), getSetup = ref => require('../../config/env').getWaybillBindingSetup(ref) }) {
  async function create(data, { requestKey, userId } = {}) {
    if (!requestKey || requestKey.length > 80) throw new AppError('缺少有效的提交标识，请刷新后重试', 400)
    const name = clean(data.name)
    const monthly = clean(data.monthlyAccount)
    const platform = platformFor({}, data.platformCode)
    if (!name || name.length > 10) throw new AppError('账号名称请填写1至10个字符', 400)
    if (!/^[A-Za-z0-9_-]+$/.test(monthly) || monthly.length > (platform === 'sf' ? 20 : 32)) throw new AppError('请填写符合快递公司要求的月结账号', 400)
    const op = operations || require('../../utils/operationRequest')
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const state = await op.beginOperationRequest(conn, { requestKey, userId, action: 'carrier.createAccount' })
      if (state.replay) { await conn.commit(); return state.responseData }
      const code = await require('../../utils/codeGenerator').generateMasterCode(conn, 'CAR', 'carriers')
      const [r] = await conn.query(`INSERT INTO carriers (code,name,type,platform_code,monthly_account,credential_ref,waybill_enabled)
        VALUES (?,?,?,?,?,?,0)`, [code, name, platform === 'deppon' ? 'freight' : 'express', platform, monthly, `${platform}_main`])
      const result = { id: r.insertId, code }
      await op.completeOperationRequest(conn, state, { data: result, resourceType: 'carrier', resourceId: r.insertId })
      await conn.commit()
      return result
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  }
  async function remove(id) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [[row]] = await conn.query('SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
      if (!row) throw new AppError('承运商不存在', 404)
      if (row.waybill_enabled) throw new AppError('请先暂停自动下单，再删除承运商', 409)
      if (row.monthly_account) throw new AppError('请先解绑月结账号，再删除承运商', 409)
      // 保留所有历史引用，包括已结束或已软删除的销售单；不删除运单与账款。
      for (const table of ['sale_orders', 'logistics_waybills', 'logistics_freight_bills', 'logistics_freight_settlements']) {
        const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM ${table} WHERE carrier_id=?`, [id])
        if (Number(total)) throw new AppError('该承运商已有订单、运单或运费记录，不能删除；请保留记录并暂停自动下单', 409)
      }
      await conn.query('UPDATE carriers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id])
      await conn.commit()
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  }
  function view(row, selected) {
    const platformCode = platformFor(row, selected)
    const ref = row.credential_ref || `${platformCode}_main`
    const credential = getCredential(ref)
    const setup = getSetup(ref) || { products: [], verifiedAccounts: [] }
    let connectionReady = false
    try {
      credentials(credential, platformCode)
      if (platformCode === 'deppon') {
        credentials(credential, platformCode, true)
        if (!/^[A-Za-z0-9_-]{1,20}$/.test(credential.orderPrefix || '')) throw new Error('prefix')
      }
      connectionReady = true
    } catch { /* 仅输出准备状态，不能把凭据或原始错误回传 */ }
    const products = platformCode === 'deppon' ? DEPPON_OPTIONS : (setup.products || []).filter(p => {
      try { return !!normalizeProduct(platformCode, p.code) && typeof p.label === 'string' && p.label.trim().length > 0 && p.label.length <= 40 } catch { return false }
    }).map(p => ({ code: clean(p.code), label: p.label.trim() }))
    const accountVerified = !!row.monthly_account && (setup.verifiedAccounts || []).includes(row.monthly_account)
    const productReady = products.some(p => p.code === row.shipping_product) && (platformCode !== 'deppon' || ['1', '3', '4'].includes(row.shipping_delivery_type))
    const mode = credential?.mode === 'production' ? 'production' : 'sandbox'
    return { carrierId: row.id, carrierName: row.name, platformCode, monthlyAccount: row.monthly_account || '', shippingProduct: row.shipping_product || '', shippingDeliveryType: row.shipping_delivery_type || '', enabled: !!row.waybill_enabled, active: !!row.is_active, revision: revision(row), connectionReady, mode, accountVerified, products, productReady, canEnable: !!row.is_active && connectionReady && mode === 'production' && accountVerified && productReady }
  }
  async function get(id, platform) {
    const [[row]] = await pool.query('SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL', [id])
    if (!row) throw new AppError('承运商不存在', 404)
    return view(row, platform)
  }
  async function save(id, data) {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [[row]] = await conn.query('SELECT * FROM carriers WHERE id=? AND deleted_at IS NULL FOR UPDATE', [id])
      if (!row) throw new AppError('承运商不存在', 404)
      if (data.revision !== revision(row)) throw new AppError('账号资料已被其他人修改，请刷新后重新操作', 409)
      // 暂停不能被历史不完整资料阻止，也不重写账号或服务。
      if (data.action === 'pause') {
        await conn.query('UPDATE carriers SET waybill_enabled=0 WHERE id=? AND deleted_at IS NULL', [id])
        await conn.commit()
        return view({ ...row, waybill_enabled: 0 })
      }
      if (data.action === 'unbind') {
        data = { ...data, platformCode: row.platform_code, monthlyAccount: '', shippingProduct: '', shippingDeliveryType: '', enabled: false }
      }
      const platform = platformFor(row, data.platformCode)
      const current = view(row, platform)
      const monthly = clean(data.monthlyAccount)
      if (!/^[A-Za-z0-9_-]*$/.test(monthly) || monthly.length > (platform === 'sf' ? 20 : 32)) throw new AppError('请填写符合快递公司要求的月结账号', 400)
      const product = normalizeProduct(platform, data.shippingProduct)
      const delivery = platform === 'deppon' ? clean(data.shippingDeliveryType) || null : null
      if (product && !current.products.some(p => p.code === product) && product !== row.shipping_product) throw new AppError('请选择管理员配置的常用服务', 400)
      if (delivery && !['1', '3', '4'].includes(delivery)) throw new AppError('请选择有效的送货方式', 400)
      const accountChanged = (row.monthly_account || '') !== monthly || (row.platform_code && row.platform_code !== platform)
      const changed = accountChanged || (row.shipping_product || '') !== (product || '') || (row.shipping_delivery_type || '') !== (delivery || '')
      if (changed && data.enabled) throw new AppError('请先保存账号和服务资料，再启用自动下单', 400)
      if (accountChanged && row.waybill_enabled) throw new AppError('更换月结账号前请先暂停自动下单', 409)
      if (accountChanged) {
        const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM logistics_waybills WHERE carrier_id=? AND status IN (1,2,4,6)', [id])
        if (Number(total)) throw new AppError('该承运商尚有待处理运单，请核实原单后再更换月结账号', 409)
      }
      const next = { ...row, platform_code: platform, monthly_account: monthly || null, shipping_product: product, shipping_delivery_type: delivery, credential_ref: row.credential_ref || `${platform}_main`, waybill_enabled: data.enabled ? 1 : 0 }
      const result = view(next, platform)
      if (data.enabled && !row.is_active) throw new AppError('承运商已停用，不能启用自动下单', 400)
      if (data.enabled && !result.canEnable) throw new AppError('自动下单尚未准备好，请完成接口配置、正式账号验收和常用服务设置', 400)
      await conn.query('UPDATE carriers SET platform_code=?,monthly_account=?,shipping_product=?,shipping_delivery_type=?,credential_ref=?,waybill_enabled=? WHERE id=? AND deleted_at IS NULL', [next.platform_code, next.monthly_account, next.shipping_product, next.shipping_delivery_type, next.credential_ref, next.waybill_enabled, id])
      await conn.commit()
      return result
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  }
  return { get, save, create, remove }
}
module.exports = { createBindingService }
