const { pdaSessionOptional } = require('../../middleware/pdaSession')
const { isSplitAction } = require('../inventory/inventory.split-receipt')
const { isPlasticBoxAction } = require('../plastic-boxes/plastic-boxes.receipt')
const optional = pdaSessionOptional()
const needsDevice = action => isSplitAction(action) || isPlasticBoxAction(action)
// 只对明确的库存拆分/塑料盒领域查询核设备；宽前缀由controller匹配后补核。
function splitReceiptDevice(req, res, next) {
  if (!needsDevice(req.query.action)) return next()
  optional(req, res, error => { if (!error) req.splitDeviceChecked = true; next(error) })
}
async function ensureSplitReceiptDevice(req, res, action) {
  if (!needsDevice(action) || req.splitDeviceChecked) return
  await new Promise((resolve, reject) => optional(req, res, error => error ? reject(error) : resolve()))
  req.splitDeviceChecked = true
}
module.exports = { splitReceiptDevice, ensureSplitReceiptDevice }
