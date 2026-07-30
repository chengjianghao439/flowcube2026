/**
 * Mock 快递平台适配器（文档 06）。
 *
 * 用途：本地/离线开发时把"取号—轨迹"闭环完整跑通，不依赖任何真实快递平台。
 * 生产不会启用（承运商 platform_code=mock 才会命中；正式对接用 kdniao 等真适配器）。
 *
 * 设计要点：
 *  - 取号幂等：以 waybill_no 作稳定 orderCode，同一 waybill_no 恒定映射到同一个 tracking_no
 *    （用 waybill_no 派生，不依赖随机数），模拟"平台按 orderCode 幂等返回同一单号"。
 *  - 面单走 ZPL：返回一段合法 ZPL（print 队列只收 zpl），原样入队即可打印。
 *  - 轨迹按"下单至今经过的时长"逐步揭示（已揽收→运输中→派送中→已签收），
 *    这样轨迹 worker 每轮轮询能看到进度推进，直至签收终态。
 */

// 由 waybill_no 稳定派生一个数字（简单哈希），保证同一内部单号恒得同一快递号
function stableHash(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

function buildTrackingNo(waybillNo) {
  const h = stableHash(waybillNo)
  // MOCK + 12 位定长数字，稳定且可读
  return `MOCK${String(h).padStart(10, '0').slice(0, 10)}${String(h % 100).padStart(2, '0')}`
}

/** 生成一段合法 ZPL 面单（含运单号条码 + 收件信息），print 队列只接受 zpl */
function buildWaybillZpl({ trackingNo, carrierName, receiverName, receiverPhone, receiverAddress }) {
  const clip = (v, n) => String(v || '').replace(/[\^~]/g, ' ').slice(0, n)
  return [
    '^XA',
    '^CI28',              // UTF-8
    '^PW600',
    '^LL900',
    `^FO30,30^A0N,40,40^FD${clip(carrierName, 20)}^FS`,
    `^FO30,90^BY3^BCN,120,Y,N,N^FD${clip(trackingNo, 30)}^FS`,
    `^FO30,250^A0N,30,30^FD收件: ${clip(receiverName, 16)}  ${clip(receiverPhone, 20)}^FS`,
    `^FO30,300^A0N,26,26^FB540,3,0,L^FD${clip(receiverAddress, 90)}^FS`,
    '^XZ',
  ].join('\n')
}

/**
 * 下单取号。
 * @param {object} payload - { waybill:{ waybillNo, receiverName, receiverPhone, receiverAddress, carrierName },
 *                             carrier:{ platformCarrier, monthlyAccount, netSiteCode }, credential }
 * @returns {Promise<{trackingNo, freight, printData, raw}>}
 */
async function createOrder(payload) {
  const wb = payload?.waybill || {}
  const trackingNo = buildTrackingNo(wb.waybillNo)
  // 预估运费：由单号派生一个 8–28 元的稳定值，纯为演示金额链路
  const freight = 8 + (stableHash(wb.waybillNo) % 2001) / 100
  const content = buildWaybillZpl({
    trackingNo,
    carrierName: wb.carrierName,
    receiverName: wb.receiverName,
    receiverPhone: wb.receiverPhone,
    receiverAddress: wb.receiverAddress,
  })
  return {
    trackingNo,
    freight: Number(freight.toFixed(2)),
    printData: { type: 'zpl', content },
    raw: { platform: 'mock', orderCode: wb.waybillNo },
  }
}

// 轨迹阶段：相对下单时刻的分钟阈值（演示用短周期，真实平台按小时/天）
const TRACK_STAGES = [
  { afterMin: 0,  code: 'COLLECTED',  description: '快件已揽收', location: '始发地分拨中心' },
  { afterMin: 2,  code: 'IN_TRANSIT', description: '快件运输中', location: '中转分拨中心' },
  { afterMin: 5,  code: 'DELIVERING', description: '派送中，请保持电话畅通', location: '目的地网点' },
  { afterMin: 8,  code: 'SIGNED',     description: '已签收，感谢使用', location: '目的地' },
]

/**
 * 查询轨迹。ctx.createdAt 用于按经过时长逐步揭示阶段。
 * @returns {Promise<Array<{eventTime, statusCode, description, location}>>}
 */
async function queryTrack(trackingNo, ctx = {}) {
  const base = ctx.createdAt ? new Date(ctx.createdAt).getTime() : Date.now()
  const now = Date.now()
  const elapsedMin = Math.max(0, (now - base) / 60000)
  const events = []
  for (const stage of TRACK_STAGES) {
    if (elapsedMin >= stage.afterMin) {
      events.push({
        eventTime: new Date(base + stage.afterMin * 60000),
        statusCode: stage.code,
        description: stage.description,
        location: stage.location,
      })
    }
  }
  return events
}

module.exports = { createOrder, queryTrack }
