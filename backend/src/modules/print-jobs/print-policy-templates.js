/**
 * 策略模板：稳定优先 / 速度优先 / 均衡
 * 写入 print_tenant_settings 数值字段，exploration_mode=adaptive
 */

const TEMPLATES = {
  stable: {
    label: '稳定优先',
    description: '更低探索率、更重视错误率，适合生产环境少折腾',
    explorationMode: 'adaptive',
    explorationMin: 0.04,
    explorationMax: 0.18,
    explorationBase: 0.08,
    explorationKErr: 0.45,
    explorationKLat: 0.28,
    explorationLatNormMs: 55_000,
    weightErr: 0.52,
    weightLat: 0.28,
    weightHb: 0.2,
    latScoreScaleMs: 40_000,
  },
  speed: {
    label: '速度优先',
    description: '更重视延迟与探测，尽快找到更快设备',
    explorationMode: 'adaptive',
    explorationMin: 0.08,
    explorationMax: 0.38,
    explorationBase: 0.14,
    explorationKErr: 0.4,
    explorationKLat: 0.48,
    explorationLatNormMs: 48_000,
    weightErr: 0.32,
    weightLat: 0.45,
    weightHb: 0.23,
    latScoreScaleMs: 55_000,
  },
  balanced: {
    label: '均衡模式',
    description: '与默认环境变量相近的综合策略',
    explorationMode: 'adaptive',
    explorationMin: 0.06,
    explorationMax: 0.42,
    explorationBase: 0.12,
    explorationKErr: 0.55,
    explorationKLat: 0.35,
    explorationLatNormMs: 60_000,
    weightErr: 0.42,
    weightLat: 0.33,
    weightHb: 0.25,
    latScoreScaleMs: 45_000,
  },
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, v]) => ({
    key,
    label: v.label,
    description: v.description,
  }))
}

function getTemplatePayload(key) {
  const k = String(key || '').toLowerCase()
  const t = TEMPLATES[k]
  if (!t) return null
  const { label: _l, description: _d, ...rest } = t
  return { templateKey: k, ...rest }
}

module.exports = { TEMPLATES, listTemplates, getTemplatePayload }
