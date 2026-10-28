// Flow API 客户端：Agent 只走正式 API，透传发起人 Token。
// 错误分三类（总体设计 §8）：
//  - business: 确定性业务拒绝（4xx 带结构化明细）→ 原样转述，停步
//  - unknown:  超时/断网/5xx → 结果未知，必须先查回执，禁止换键重试
//  - auth:     401/403 → 权限问题，点名说明
export class FlowError extends Error {
  constructor(kind, { status = 0, code = null, message = '', data = null } = {}) {
    super(message || kind);
    this.kind = kind; this.status = status; this.code = code; this.data = data;
  }
}

export class FlowClient {
  constructor(baseUrl, token, { clientId } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.clientId = clientId;
  }

  async request(method, path, { body, requestKey, timeoutMs = 15000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(this.clientId ? { 'X-Client-Id': this.clientId } : {}),
          ...(requestKey ? { 'X-Request-Key': requestKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      // 断网/超时：写操作可能已落库 → unknown
      throw new FlowError('unknown', { message: `网络异常（${e.name}），结果未知` });
    } finally { clearTimeout(timer); }

    let payload = null;
    try { payload = await res.json(); } catch { /* 非 JSON 响应按状态码处理 */ }

    if (res.status >= 500) {
      throw new FlowError('unknown', { status: res.status, message: payload?.message || `服务异常 ${res.status}，结果未知` });
    }
    if (res.status === 401 || res.status === 403) {
      throw new FlowError('auth', { status: res.status, code: payload?.code, message: payload?.message || '无权限' });
    }
    if (res.status >= 400 || payload?.success === false) {
      throw new FlowError('business', {
        status: res.status, code: payload?.code,
        message: payload?.message || `请求被拒绝 ${res.status}`,
        data: payload?.data ?? null,
      });
    }
    return payload?.data;
  }

  get(path) { return this.request('GET', path); }
  post(path, body, opts = {}) { return this.request('POST', path, { body, ...opts }); }

  // 断网后查回执：GET /api/system/request-status/:key
  async requestStatus(requestKey, action) {
    if (!action) throw new Error('查询原请求回执必须指定领域 action');
    try {
      const receipt = await this.get(`/api/system/request-status/${encodeURIComponent(requestKey)}?action=${encodeURIComponent(action)}`);
      return receipt?.status === 'success' ? receipt : null;
    } catch (e) {
      if (e.kind === 'business') return null; // 无回执记录
      throw e;
    }
  }
}
