'use strict'
const AppError = require('../../utils/AppError')
const DEPPON_PRODUCTS = ['XJTK', 'DJTK', 'XJBK', 'DJBK', 'XJTH', 'DJTH', 'YTYDS']
function normalizeProduct(platform, value) {
  const code = String(value || '').trim()
  if (!code) return null
  if (platform === 'sf' && /^[1-9]\d{0,4}$/.test(code)) return code
  if (platform === 'deppon' && DEPPON_PRODUCTS.includes(code)) return code
  throw new AppError('发货产品与承运商不匹配，请选择已开通的官方产品', 400)
}
module.exports = { normalizeProduct, DEPPON_PRODUCTS }
