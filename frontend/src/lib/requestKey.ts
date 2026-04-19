export function createRequestKey(prefix = 'req') {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${random}`
}

export function withRequestKeyHeaders(requestKey: string, headers: Record<string, string> = {}) {
  return {
    ...headers,
    'X-Request-Key': requestKey,
  }
}
