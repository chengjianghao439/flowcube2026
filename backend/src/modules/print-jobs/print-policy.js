/**
 * 自适应调度策略：探索率、设备综合分（错误率 / 延迟 / 心跳）
 * policy 对象由 print-tenant-settings.mergeRow / env 默认值构造
 */

const COLD_BONUS = Number(process.env.PRINT_SCORE_COLD_BONUS) || 0.12

const W_ERR = Number(process.env.PRINT_SCORE_W_ERR) || 0.42
const W_LAT = Number(process.env.PRINT_SCORE_W_LAT) || 0.33
const W_HB = Number(process.env.PRINT_SCORE_W_HB) || 0.25

const LAT_SCORE_SCALE_MS = Number(process.env.PRINT_SCORE_LAT_SCALE_MS) || 45_000

const EXPL_MIN = Math.min(1, Math.max(0, Number(process.env.PRINT_EXPLORATION_MIN) || 0.06))
const EXPL_MAX = Math.min(1, Math.max(0, Number(process.env.PRINT_EXPLORATION_MAX) || 0.42))
const EXPL_BASE = Number(process.env.PRINT_EXPLORATION_BASE) || 0.12
const EXPL_K_ERR = Number(process.env.PRINT_EXPLORATION_K_ERR) || 0.55
const EXPL_K_LAT = Number(process.env.PRINT_EXPLORATION_K_LAT) || 0.35
const LAT_NORM_MS = Number(process.env.PRINT_EXPLORATION_LAT_NORM_MS) || 60_000

/** 无租户配置时使用 */
function defaultDispatchPolicy() {
  return {
    explorationMode: 'adaptive',
    explorationRateFixed: null,
    explMin: EXPL_MIN,
    explMax: EXPL_MAX,
    explBase: EXPL_BASE,
    explKErr: EXPL_K_ERR,
    explKLat: EXPL_K_LAT,
    latNormMs: LAT_NORM_MS,
    wErr: W_ERR,
    wLat: W_LAT,
    wHb: W_HB,
    latScoreScaleMs: LAT_SCORE_SCALE_MS,
    coldBonus: COLD_BONUS,
  }
}

/**
 * 心跳分：30s 内满分，随时间指数衰减（依赖 print_clients.last_seen）
 * @param {Date|string|null} lastSeen
 * @returns {number} 0~1
 */
function heartbeatScore(lastSeen) {
  if (!lastSeen) return 0.35
  const t = new Date(lastSeen).getTime()
  if (Number.isNaN(t)) return 0.35
  const sec = (Date.now() - t) / 1000
  if (sec <= 30) return 1
  if (sec <= 90) return 0.82
  return Math.max(0.15, Math.exp(-sec / 240))
}

/**
 * @param {{ error_rate: number, avg_latency_ms: number, coldStart?: boolean }} h
 * @param {number} hb
 * @param {ReturnType<typeof defaultDispatchPolicy>} [policy]
 */
function printerScore(h, hb, policy) {
  const p = policy || defaultDispatchPolicy()
  const er = Math.min(1, Math.max(0, Number(h.error_rate) || 0))
  const lat = Math.max(0, Number(h.avg_latency_ms) || 0)
  const scale = Math.max(1, Number(p.latScoreScaleMs) || LAT_SCORE_SCALE_MS)
  const latFactor = Math.exp(-lat / scale)
  const wE = Number(p.wErr)
  const wL = Number(p.wLat)
  const wH = Number(p.wHb)
  let s = wE * (1 - er) + wL * latFactor + wH * Math.min(1, Math.max(0, hb))
  if (h.coldStart) s += Number(p.coldBonus) || COLD_BONUS
  return s
}

/**
 * @param {Map<number, object>} healthMap
 * @param {number[]} printerIds
 * @param {ReturnType<typeof defaultDispatchPolicy>} [policy]
 */
function computeExplorationRate(healthMap, printerIds, policy) {
  const p = policy || defaultDispatchPolicy()
  if (p.explorationMode === 'fixed' && p.explorationRateFixed != null && Number.isFinite(Number(p.explorationRateFixed))) {
    const r = Number(p.explorationRateFixed)
    return Math.min(1, Math.max(0, r))
  }

  if (!printerIds.length) return Math.min(p.explMax, Math.max(p.explMin, p.explBase))
  let sumE = 0
  let sumL = 0
  let n = 0
  for (const id of printerIds) {
    const h = healthMap.get(id)
    if (!h) continue
    sumE += Number(h.error_rate) || 0
    sumL += Number(h.avg_latency_ms) || 0
    n += 1
  }
  if (!n) return Math.min(p.explMax, Math.max(p.explMin, p.explBase))
  const avgE = sumE / n
  const avgL = sumL / n
  const latN = Math.min(1, avgL / Math.max(1, Number(p.latNormMs) || LAT_NORM_MS))
  const r = p.explBase + p.explKErr * avgE + p.explKLat * latN
  return Math.min(p.explMax, Math.max(p.explMin, r))
}

function pickWithExploration(onlineOrdered, explorationRate) {
  if (!onlineOrdered.length) return null
  if (onlineOrdered.length === 1) return onlineOrdered[0]
  const prob = Math.min(1, Math.max(0, explorationRate))
  return Math.random() < prob ? onlineOrdered[1] : onlineOrdered[0]
}

module.exports = {
  heartbeatScore,
  printerScore,
  computeExplorationRate,
  pickWithExploration,
  defaultDispatchPolicy,
}
