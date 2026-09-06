'use strict'
const AppError = require('../../utils/AppError')
const { isDirect, json, addressParts, splitPackages } = require('./logistics.direct')
const { generateDailyCode } = require('../../utils/codeGenerator')
const AUTO_REMOVED_MESSAGE = '重新打包后该批次已移除'

// packDone 完成校验并锁住任务后调用，事务内只有 SQL。按仓库任务分批，不混仓。
async function createDirectWaybillsForTaskTx(conn, taskId, createdBy) {
  const [[info]] = await conn.query(`SELECT wt.id, wt.warehouse_id, wt.sale_order_id,
      so.carrier_id, so.freight_type, so.receiver_name, so.receiver_phone, so.receiver_address,
      so.shipping_product AS order_product, c.name AS carrier_name, c.platform_code, c.platform_carrier,
      c.shipping_product, c.shipping_delivery_type, wh.manager, wh.phone, wh.address
    FROM warehouse_tasks wt JOIN sale_orders so ON so.id = wt.sale_order_id
    JOIN carriers c ON c.id = so.carrier_id
    JOIN inventory_warehouses wh ON wh.id = wt.warehouse_id WHERE wt.id = ?`, [taskId])
  if (!info || !isDirect(info.platform_code)) return
  const [packages] = await conn.query('SELECT id, barcode FROM packages WHERE warehouse_task_id = ? AND status = 2 ORDER BY id', [taskId])
  const [previous] = await conn.query('SELECT id, direct_batch_key, direct_request, shipment_json, status, error_message FROM logistics_waybills WHERE warehouse_task_id = ? AND direct_batch_key IS NOT NULL FOR UPDATE', [taskId])
  const liveIds = new Set(packages.map(p => Number(p.id)))
  for (const old of previous) {
    if (old.direct_request && (json(old.shipment_json, {}).packages || []).some(p => !liveIds.has(Number(p.id)))) {
      throw new AppError('原打包箱子已提交快递平台，箱子变更后请先核实并处理原快递订单', 409)
    }
  }
  const batches = splitPackages(packages)
  for (let i = 0; i < batches.length; i++) {
    const batchKey = `task:${taskId}:batch:${i + 1}`
    const existing = previous.find(p => p.direct_batch_key === batchKey)
    const shipment = {
      sender: { name: info.manager || '', phone: info.phone || '', ...addressParts(info.address) },
      receiver: { name: info.receiver_name || '', phone: info.receiver_phone || '', ...addressParts(info.receiver_address) },
      cargoName: '商品', productCode: info.order_product || info.shipping_product || '',
      deliveryType: info.shipping_delivery_type || '', packages: batches[i],
    }
    if (existing) {
      const old = json(existing.shipment_json, {})
      const autoRemoved = Number(existing.status) === 5 && existing.error_message === AUTO_REMOVED_MESSAGE
      if (autoRemoved || JSON.stringify((old.packages || []).map(p => p.id)) !== JSON.stringify(batches[i].map(p => p.id))) {
        if (existing.direct_request) throw new AppError('快递平台已受理原批次，不能更改该批箱数，请先核实原单', 409)
        if (Number(existing.status) !== 5 || autoRemoved) await conn.query('UPDATE logistics_waybills SET shipment_json = ?, status = 1, error_message = NULL, retry_count = 0 WHERE id = ?', [JSON.stringify({ ...old, packages: batches[i] }), existing.id])
      }
      continue
    }
    const code = await generateDailyCode(conn, 'WB', 'logistics_waybills', 'waybill_no')
    await conn.query(`INSERT INTO logistics_waybills
      (waybill_no,sale_order_id,warehouse_task_id,warehouse_id,carrier_id,carrier_name,platform_code,
       platform_carrier,status,freight_type,receiver_name,receiver_phone,receiver_address,created_by,direct_batch_key,shipment_json)
      VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`,
    [code, info.sale_order_id, taskId, info.warehouse_id, info.carrier_id, info.carrier_name, info.platform_code,
      info.platform_carrier, info.freight_type, info.receiver_name, info.receiver_phone, info.receiver_address,
      createdBy || null, batchKey, JSON.stringify(shipment)])
  }
  const currentKeys = new Set(batches.map((_, i) => `task:${taskId}:batch:${i + 1}`))
  for (const old of previous) {
    if (!currentKeys.has(old.direct_batch_key) && !old.direct_request && Number(old.status) !== 5) {
      await conn.query("UPDATE logistics_waybills SET status = 5, error_message = ? WHERE id = ?", [AUTO_REMOVED_MESSAGE, old.id])
    }
  }
}
module.exports = { createDirectWaybillsForTaskTx }
