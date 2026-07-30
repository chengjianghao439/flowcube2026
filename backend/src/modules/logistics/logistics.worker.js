/**
 * 物流异步 worker（文档 06 · 5.1/5.5）——取号 + 轨迹拉取。
 *
 * 铁律：HTTP **绝不进业务事务**。这里所有平台调用都在事务外；写库是短事务/单语句。
 * 并发安全靠 CAS 抢占：把 status 1/4 → 2(取号中) 的 UPDATE 作为"抢锁"，affectedRows!==1 即别人已抢走。
 * 参考 print sweeper 的抢占式回收：中断在"取号中"的运单由 reclaimStale 兜底打回失败可重试。
 */
const crypto = require('crypto')
const { pool } = require('../../config/db')
const logger = require('../../utils/logger')
const { getWaybillCredential } = require('../../config/env')
const { getAdapter } = require('./carrier-adapters')
const { WB_STATUS } = require('./logistics.service')

const FETCH_BATCH = 20
const TRACK_BATCH = 30
const MAX_RETRY = 5
const FAIL_BACKOFF_SEC = 60          // 失败后至少隔 60s 再自动重试
const STALE_FETCHING_SEC = 120       // 卡在"取号中" 超过 120s 视为中断，打回失败

function eventHash(trackingNo, eventTime, description) {
  return crypto.createHash('md5')
    .update(`${trackingNo}|${eventTime || ''}|${description || ''}`, 'utf8')
    .digest('hex')
}

/** 把中断在"取号中"的运单打回失败（进程崩溃/重启兜底），下一轮可重试 */
async function reclaimStaleFetching() {
  const [r] = await pool.query(
    `UPDATE logistics_waybills
     SET status = ?, error_message = '取号中断（超时回收），可重试', retry_count = retry_count + 1
     WHERE status = ? AND last_tried_at < NOW() - INTERVAL ? SECOND`,
    [WB_STATUS.FAILED, WB_STATUS.FETCHING, STALE_FETCHING_SEC],
  )
  if (r.affectedRows > 0) logger.warn(`[logistics] 回收中断取号 ${r.affectedRows} 单`, {}, 'Logistics')
}

/** 取号 worker：扫待取号(1) + 可重试的失败单(4)，抢占后事务外调平台 */
async function runFetchWaybills() {
  try {
    await reclaimStaleFetching()
    const [rows] = await pool.query(
      `SELECT w.id, w.waybill_no, w.warehouse_id, w.platform_code, w.platform_carrier, w.request_key,
              w.receiver_name, w.receiver_phone, w.receiver_address, w.carrier_name,
              c.credential_ref, c.monthly_account, c.net_site_code
       FROM logistics_waybills w
       JOIN carriers c ON c.id = w.carrier_id
       WHERE c.waybill_enabled = 1 AND w.platform_code IS NOT NULL
         AND (
           w.status = ?
           OR (w.status = ? AND w.retry_count < ? AND (w.last_tried_at IS NULL OR w.last_tried_at < NOW() - INTERVAL ? SECOND))
         )
       ORDER BY w.id ASC
       LIMIT ?`,
      [WB_STATUS.PENDING, WB_STATUS.FAILED, MAX_RETRY, FAIL_BACKOFF_SEC, FETCH_BATCH],
    )
    for (const row of rows) {
      await fetchOne(row).catch(e =>
        logger.error(`[logistics] 取号异常 waybill=${row.id}`, e, {}, 'Logistics'))
    }
  } catch (e) {
    logger.error('[logistics] 取号 worker 失败', e, {}, 'Logistics')
  }
}

async function fetchOne(row) {
  // ① CAS 抢占：1/4 → 2 取号中。affectedRows!==1 说明别的 worker 抢走了，跳过
  const [claim] = await pool.query(
    `UPDATE logistics_waybills SET status = ?, last_tried_at = NOW()
     WHERE id = ? AND status IN (?, ?)`,
    [WB_STATUS.FETCHING, row.id, WB_STATUS.PENDING, WB_STATUS.FAILED],
  )
  if (claim.affectedRows !== 1) return

  const adapter = getAdapter(row.platform_code)
  if (!adapter) {
    await pool.query(
      `UPDATE logistics_waybills SET status = ?, error_message = ?, retry_count = retry_count + 1 WHERE id = ?`,
      [WB_STATUS.FAILED, `未知快递平台：${row.platform_code}`, row.id],
    )
    return
  }

  const credential = getWaybillCredential(row.credential_ref)
  try {
    // ② 事务外 HTTP 取号（幂等：waybill_no 作平台 orderCode）
    const res = await adapter.createOrder({
      waybill: {
        waybillNo: row.waybill_no,
        receiverName: row.receiver_name,
        receiverPhone: row.receiver_phone,
        receiverAddress: row.receiver_address,
        carrierName: row.carrier_name,
      },
      carrier: {
        platformCarrier: row.platform_carrier,
        monthlyAccount: row.monthly_account,
        netSiteCode: row.net_site_code,
      },
      credential,
    })
    if (!res || !res.trackingNo) throw new Error('平台未返回运单号')

    const printType = res.printData?.type || null
    const printDataRef = printType === 'zpl' ? 'zpl_inline' : printType
    // ③ 回写成功
    await pool.query(
      `UPDATE logistics_waybills
       SET status = ?, tracking_no = ?, est_freight = ?, print_data_ref = ?, error_message = NULL
       WHERE id = ?`,
      [WB_STATUS.FETCHED, res.trackingNo, res.freight != null ? res.freight : null, printDataRef, row.id],
    )
    // ④ ZPL 面单入队（事务外；失败不影响取号成功——面单可补打）
    if (printType === 'zpl' && res.printData?.content) {
      try {
        const { enqueueWaybillLabelJob } = require('../print-jobs/print-jobs.label-command')
        await enqueueWaybillLabelJob({
          waybillId: row.id,
          warehouseId: row.warehouse_id,
          content: res.printData.content,
          title: `面单 ${res.trackingNo}`,
          refCode: res.trackingNo,
        })
      } catch (e) {
        logger.warn(`[logistics] 面单入队失败 waybill=${row.id}: ${e.message}`, {}, 'Logistics')
      }
    }
  } catch (e) {
    await pool.query(
      `UPDATE logistics_waybills SET status = ?, error_message = ?, retry_count = retry_count + 1 WHERE id = ?`,
      [WB_STATUS.FAILED, String(e.message || '取号失败').slice(0, 500), row.id],
    )
  }
}

/** 轨迹 worker：扫已取号(3) 且未签收(track_status=0) 的运单，事务外拉平台轨迹并去重写入 */
async function runTrackWaybills() {
  try {
    const [rows] = await pool.query(
      `SELECT w.id, w.tracking_no, w.platform_code, w.platform_carrier, w.created_at,
              c.credential_ref
       FROM logistics_waybills w
       JOIN carriers c ON c.id = w.carrier_id
       WHERE w.status = ? AND w.track_status = 0 AND w.tracking_no IS NOT NULL
         AND c.waybill_enabled = 1 AND w.platform_code IS NOT NULL
       ORDER BY w.id ASC
       LIMIT ?`,
      [WB_STATUS.FETCHED, TRACK_BATCH],
    )
    for (const row of rows) {
      await trackOne(row).catch(e =>
        logger.error(`[logistics] 轨迹异常 waybill=${row.id}`, e, {}, 'Logistics'))
    }
  } catch (e) {
    logger.error('[logistics] 轨迹 worker 失败', e, {}, 'Logistics')
  }
}

async function trackOne(row) {
  const adapter = getAdapter(row.platform_code)
  if (!adapter || typeof adapter.queryTrack !== 'function') return
  const credential = getWaybillCredential(row.credential_ref)
  const events = await adapter.queryTrack(row.tracking_no, {
    createdAt: row.created_at,
    platformCarrier: row.platform_carrier,
    credential,
  })
  if (!Array.isArray(events) || !events.length) return

  let signed = false
  for (const ev of events) {
    const eventTime = ev.eventTime ? new Date(ev.eventTime) : null
    const hash = eventHash(row.tracking_no, eventTime ? eventTime.toISOString() : '', ev.description)
    await pool.query(
      `INSERT INTO logistics_tracking_events
         (waybill_id, tracking_no, event_time, status_code, description, location, event_hash)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE id = id`,
      [row.id, row.tracking_no, eventTime, ev.statusCode || null,
       (ev.description || '').slice(0, 500), (ev.location || '').slice(0, 255) || null, hash],
    )
    if (String(ev.statusCode || '').toUpperCase() === 'SIGNED') signed = true
  }
  if (signed) {
    await pool.query('UPDATE logistics_waybills SET track_status = 1 WHERE id = ?', [row.id])
  }
}

module.exports = { runFetchWaybills, runTrackWaybills, reclaimStaleFetching }
