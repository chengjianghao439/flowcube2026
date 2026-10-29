// /health 出参与规划器判定口径：与 agent.js handleMessage 的实际判定保持一致——
// 有 apiKey 才走 LLM 规划器（parseIntentLLM），否则规则规划器。
import { config } from './config.js';
import { GRAPHS } from './llm.js';

export function plannerMode(model = config.model) {
  return model.apiKey ? 'llm' : 'rule';
}

export function realGraphs() {
  return GRAPHS.filter((g) => g !== 'none');
}

export function buildHealth() {
  return {
    ok: true,
    service: 'jixu-agent',
    flow: config.flowBaseUrl,
    modelConfigured: Boolean(config.model.apiKey),
    planner: plannerMode(),
    model: config.model.name || null,
    graphs: realGraphs(),
    keySource: config.modelKeySource,
  };
}
