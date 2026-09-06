'use strict'
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { isDirect, json } = require('./logistics.direct')
const { normalizeProduct } = require('./shipping-products')
const { shipment: validateContacts } = require('./carrier-adapters/direct-common')

async function updateShipment(id, input, { warehouseIds = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM logistics_waybills WHERE id = ? FOR UPDATE', [id])
    if (!row) throw new AppError('运单不存在', 404)
    assertInScope(warehouseIds, row.warehouse_id, '运单')
    if (!isDirect(row.platform_code) || row.direct_request || ![1, 4].includes(Number(row.status))) throw new AppError('仅未提交平台的直连运单可以修改寄件资料', 409)
    const original = json(row.shipment_json)
    if (!original?.packages?.length) throw new AppError('该运单缺少打包快照，请核实打包任务', 409)
    let contacts
    try { contacts = validateContacts({ shipment: input }, row.platform_code) } catch (e) { throw new AppError(e.message, 400) }
    const productCode = normalizeProduct(row.platform_code, input.productCode)
    if (!productCode) throw new AppError('请选择本批发货产品', 400)
    if (![1, 2].includes(input.freightType)) throw new AppError('请选择寄付或到付', 400)
    if (row.platform_code === 'deppon' && !['1', '3', '4'].includes(input.deliveryType)) throw new AppError('请选择德邦送货方式', 400)
    const shipment = { ...contacts, productCode, deliveryType: row.platform_code === 'deppon' ? input.deliveryType : '', packages: original.packages }
    const r = shipment.receiver
    await conn.query(`UPDATE logistics_waybills SET shipment_json = ?, freight_type = ?, receiver_name = ?, receiver_phone = ?, receiver_address = ?,
      status = 1, retry_count = 0, last_tried_at = NULL, error_message = NULL WHERE id = ?`,
    [JSON.stringify(shipment), input.freightType, r.name, r.phone, [r.province, r.city, r.county, r.address].filter(Boolean).join(' '), id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  return require('./logistics.service').getWaybillById(id, { warehouseIds })
}
module.exports = { updateShipment }
