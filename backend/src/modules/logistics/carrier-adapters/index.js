/**
 * 快递平台适配器注册表（文档 06 · 5.1/6）。
 *
 * 统一接口，供 **异步 worker（事务外）** 调用，绝不被 controller 同步调用：
 *   createOrder(payload) -> { trackingNo, freight, printData:{ type:'zpl'|'image_url'|'pdf_url', content }, raw }
 *   queryTrack(trackingNo, ctx) -> [{ eventTime, statusCode, description, location }]
 *
 * HTTP 只在各适配器内部发生。新增平台=新增一个 <platform>.js 并在此登记。
 */
const mock = require('./mock')
const kdniao = require('./kdniao')

const REGISTRY = {
  mock,
  kdniao,
}

/**
 * @param {string} platformCode - carriers.platform_code
 * @returns {object|null} 适配器；未登记的平台返回 null（worker 据此把运单置失败并给出清晰错误）
 */
function getAdapter(platformCode) {
  const code = String(platformCode || '').trim().toLowerCase()
  if (!code) return null
  return REGISTRY[code] || null
}

function listPlatforms() {
  return Object.keys(REGISTRY)
}

module.exports = { getAdapter, listPlatforms }
