// 模型配置仅由启动环境注入，服务不读写任何密钥文件。
export const config = {
  flowBaseUrl: process.env.FLOW_BASE_URL || 'http://127.0.0.1:3000',
  host: '127.0.0.1',
  port: Number(process.env.AGENT_PORT || 8932),
  previewTtlMs: Number(process.env.AGENT_PREVIEW_TTL_MS || 600000),
  allowedOrigins: (process.env.AGENT_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  model: { baseUrl: process.env.AGENT_MODEL_BASE_URL || '', apiKey: process.env.AGENT_MODEL_API_KEY || '', name: process.env.AGENT_MODEL_NAME || '' },
  modelKeySource: process.env.AGENT_MODEL_API_KEY ? 'env' : null,
  dataDir: process.env.AGENT_DATA_DIR || new URL('../data/', import.meta.url).pathname,
};
