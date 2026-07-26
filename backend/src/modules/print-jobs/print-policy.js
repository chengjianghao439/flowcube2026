/**
 * 自适应调度策略：探索率、设备综合分（错误率 / 延迟 / 心跳）
 * 数值由环境变量（PRINT_EXPLORATION_*、PRINT_SCORE_* 等）与 defaultDispatchPolicy() 提供
 */

/**
 * 读数值型环境变量。
 * 不能用 `Number(env) || fallback`：显式配置的 0 会被 `||` 当成假值吞掉，
 * 导致运维「设 0 关闭探索」实际无效且无从察觉。
 */
function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const clamp01 = (n) => Math.min(1, Math.max(0, n))

const COLD_BONUS = envNumber('PRINT_SCORE_COLD_BONUS', 0.12)

const W_ERR = envNumber('PRINT_SCORE_W_ERR', 0.42)
const W_LAT = envNumber('PRINT_SCORE_W_LAT', 0.33)
const W_HB = envNumber('PRINT_SCORE_W_HB', 0.25)

const LAT_SCORE_SCALE_MS = envNumber('PRINT_SCORE_LAT_SCALE_MS', 45_000)

/**
 * 探索默认关闭（base/min = 0）：多仓库下同一用途绑多台是「物理隔离」而非负载分担，
 * 仓库解析已把候选限定在本仓库内，此时再随机跳到另一台只会让操作员在 A 工位点、B 工位出纸。
 * 但保留 max：设备错误率/延迟真的上来时，探索率仍会自动抬升并分流到其它机器（容错仍在）。
 */
const EXPL_MIN = clamp01(envNumber('PRINT_EXPLORATION_MIN', 0))
const EXPL_MAX = clamp01(envNumber('PRINT_EXPLORATION_MAX', 0.42))
const EXPL_BASE = envNumber('PRINT_EXPLORATION_BASE', 0)
const EXPL_K_ERR = envNumber('PRINT_EXPLORATION_K_ERR', 0.55)
const EXPL_K_LAT = envNumber('PRINT_EXPLORATION_K_LAT', 0.35)
const LAT_NORM_MS = envNumber('PRINT_EXPLORATION_LAT_NORM_MS', 60_000)

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
 * 心跳分：30s 内满分，随时间指数衰减（依赖 print_clients.last_seen；独立打印客户端已移除，表可为历史数据）
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
