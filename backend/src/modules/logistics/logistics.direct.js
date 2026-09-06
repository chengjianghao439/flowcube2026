'use strict'
const crypto = require('node:crypto')
const { failure } = require('./carrier-adapters/direct-common')

const isDirect = code => ['sf', 'deppon'].includes(code)
function json(value, fallback = null) {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}
function addressParts(value) {
  const address = String(value || '').trim()
  const municipality = address.match(/^(北京|上海|天津|重庆)(?:市)?\s*(?:市辖区)?\s*(.+?(?:区|县))\s*(.+)$/)
  if (municipality) return { province: municipality[1], city: `${municipality[1]}市`, county: municipality[2], address: municipality[3] }
  const match = address.match(/^(.+?(?:省|自治区))\s*(.+?(?:市|自治州|地区|盟))\s*(.+?(?:区|县|市|旗))\s*(.+)$/)
  if (match) return { province: match[1], city: match[2], county: match[3], address: match[4] }
  return { province: '', city: '', county: '', address }
}
function splitPackages(packages) {
  const result = []
  for (let offset = 0; offset < packages.length; offset += 30) result.push(packages.slice(offset, offset + 30))
  return result
}
function credentialBinding(credential) {
  return { appId: credential?.appId || '', mode: credential?.mode || 'sandbox', apiBase: credential?.apiBase || '', queryApiBase: credential?.queryApiBase || '' }
}
function createDirectWorker({ pool, getAdapter, getCredential }) {
  async function process(id) {
    let payload, adapter, lease, lookup = false
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      // 与打包完成保持 task → waybill 的锁顺序，任务取消不能穿过领取窗口。
      const [[owner]] = await conn.query('SELECT warehouse_task_id FROM logistics_waybills WHERE id = ?', [id])
      if (owner?.warehouse_task_id) await conn.query('SELECT id FROM warehouse_tasks WHERE id = ? FOR UPDATE', [owner.warehouse_task_id])
      const [[row]] = await conn.query(
        `SELECT w.*, c.credential_ref, c.monthly_account, c.shipping_product, c.shipping_delivery_type,
                c.waybill_enabled, c.is_active, c.deleted_at AS carrier_deleted,
                wt.status AS task_status, wt.deleted_at AS task_deleted, wt.cancel_requested_at, wt.adjustment_requested_at
         FROM logistics_waybills w LEFT JOIN carriers c ON c.id = w.carrier_id
         LEFT JOIN warehouse_tasks wt ON wt.id = w.warehouse_task_id
         WHERE w.id = ? FOR UPDATE`, [id])
      if (!row || !isDirect(row.platform_code) || ![1, 6].includes(Number(row.status))) { await conn.commit(); return }
      const saved = json(row.direct_request)
      lookup = !!saved || Number(row.status) === 6
      if (!lookup && (!row.waybill_enabled || !row.is_active || row.carrier_deleted || row.cancel_requested_at || row.adjustment_requested_at)) { await conn.commit(); return }
      try {
        adapter = getAdapter(row.platform_code)
        if (!adapter?.lookupOrder) throw failure('该平台没有可用的原单查询接口')
        if (lookup && !saved) throw failure('历史运单缺少下单快照，请在平台核实，不能自动重新下单')
        const credentialRef = saved?.credentialRef || row.credential_ref
        const credential = getCredential(credentialRef)
        if (saved) {
          if (Object.entries(credentialBinding(credential)).some(([key, value]) => saved.binding?.[key] !== value)) throw failure('下单后平台账号或环境已变更，请恢复原凭据组后核实原单')
          payload = { ...saved, credential }
        } else {
          if (![6, 7].includes(Number(row.task_status)) || row.task_deleted) throw failure('任务已取消或需要重新打包，不能按原箱数下单')
          const shipment = json(row.shipment_json, {})
          const packages = shipment.packages || []
          if (!packages.length) throw failure('缺少实际打包件数，请核实打包批次')
          const [live] = await conn.query('SELECT id FROM packages WHERE warehouse_task_id = ? AND status = 2 AND id IN (?)', [row.warehouse_task_id, packages.map(p => p.id)])
          if (live.length !== packages.length || new Set(packages.map(p => Number(p.id))).size !== packages.length) throw failure('打包箱子已变更，请完成重新打包后再下单')
          payload = {
            waybill: { waybillNo: row.waybill_no, freightType: row.freight_type, packageCount: packages.length },
            shipment,
            carrier: { monthlyAccount: row.monthly_account, productCode: shipment.productCode || row.shipping_product, deliveryType: shipment.deliveryType || row.shipping_delivery_type },
            credentialRef, binding: credentialBinding(credential), credential,
          }
          payload.preparedRequest = adapter.prepareOrder(payload)
        }
      } catch (error) {
        await conn.query('UPDATE logistics_waybills SET status = ?, error_message = ?, last_tried_at = NOW(), retry_count = LEAST(retry_count + 1, 250) WHERE id = ?', [lookup ? 6 : 4, error.uncertain === false ? error.message.slice(0, 500) : '下单配置不完整，请检查承运商和寄收件资料', id])
        await conn.commit()
        return
      }
      lease = crypto.randomUUID()
      const { credential: _credential, ...snapshot } = payload
      // 保存可重放的原始业务报文，不含 appKey/checkword；提交后才允许外部 HTTP。
      await conn.query(`UPDATE logistics_waybills SET direct_request = ?, request_key = ?, status = 2,
        last_tried_at = NOW(), error_message = NULL WHERE id = ?`, [JSON.stringify(snapshot), lease, id])
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    } finally { conn.release() }

    try {
      const result = await (lookup ? adapter.lookupOrder(payload) : adapter.createOrder(payload))
      // 凭 lease CAS：过期 worker 不覆盖人工操作或后续恢复结果。
      await pool.query(`UPDATE logistics_waybills SET status = 3, tracking_no = ?, tracking_numbers = ?,
        error_message = NULL, print_data_ref = 'official_platform'
        WHERE id = ? AND status = 2 AND request_key = ?`, [result.trackingNo, JSON.stringify(result.trackingNos), id, lease])
    } catch (error) {
      // 一旦快照提交，任何异常都只查原单，包括本地回写失败与进程恢复。
      await pool.query(`UPDATE logistics_waybills SET status = ?, error_message = ?, retry_count = LEAST(retry_count + 1, 250)
        WHERE id = ? AND status = 2 AND request_key = ?`, [6, error.uncertain === true ? error.message.slice(0, 500) : '下单结果尚未核实，请查询原单，系统不会重复提交', id, lease])
    }
  }
  async function run() {
    await pool.query(`UPDATE logistics_waybills SET status = 6, request_key = NULL,
      error_message = '下单进程中断，等待查询原单', retry_count = LEAST(retry_count + 1, 250)
      WHERE platform_code IN ('sf','deppon') AND status = 2 AND last_tried_at < NOW() - INTERVAL 120 SECOND`)
    const [rows] = await pool.query(`SELECT w.id FROM logistics_waybills w LEFT JOIN carriers c ON c.id = w.carrier_id
      LEFT JOIN warehouse_tasks wt ON wt.id = w.warehouse_task_id
      WHERE w.platform_code IN ('sf','deppon') AND
      ((w.status = 1 AND c.waybill_enabled = 1 AND c.is_active = 1 AND c.deleted_at IS NULL
         AND wt.status IN (6,7) AND wt.deleted_at IS NULL AND wt.cancel_requested_at IS NULL AND wt.adjustment_requested_at IS NULL)
       OR (w.status = 6 AND w.retry_count < 5 AND (w.last_tried_at IS NULL OR w.last_tried_at < NOW() - INTERVAL 60 SECOND)))
      ORDER BY w.id LIMIT 20`)
    for (const row of rows) await process(row.id)
  }
  return { process, run }
}
module.exports = { isDirect, json, addressParts, splitPackages, createDirectWorker }
