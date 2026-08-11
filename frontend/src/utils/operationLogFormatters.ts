export type OperationLogStatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export const OPERATION_LOG_MODULE_OPTIONS = [
  { value: 'system', label: '系统' },
  { value: 'auth', label: '登录认证' },
  { value: 'users', label: '用户管理' },
  { value: 'roles', label: '角色权限' },
  { value: 'inventory', label: '库存' },
  { value: 'warehouse', label: '仓库' },
  { value: 'warehouse-tasks', label: '仓库任务' },
  { value: 'inbound-tasks', label: '入库任务' },
  { value: 'scan-logs', label: '扫码记录' },
  { value: 'print-jobs', label: '打印任务' },
  { value: 'picking-waves', label: '波次拣货' },
  { value: 'packages', label: '包裹' },
  { value: 'pda', label: 'PDA 作业' },
  { value: 'sale', label: '销售' },
  { value: 'sales', label: '销售' },
  { value: 'purchase', label: '采购' },
  { value: 'claim-client', label: '打印客户端' },
  { value: 'warehouses', label: '仓库' },
  { value: 'suppliers', label: '供应商' },
  { value: 'products', label: '商品' },
  { value: 'customers', label: '客户' },
  { value: 'stockcheck', label: '盘点' },
  { value: 'transfer', label: '调拨' },
  { value: 'returns', label: '退货' },
  { value: 'payments', label: '账款' },
  { value: 'settings', label: '设置' },
] as const

const MODULE_LABELS = Object.fromEntries(
  OPERATION_LOG_MODULE_OPTIONS.map(item => [item.value, item.label]),
) as Record<string, string>

const SENSITIVE_PATH_KEYWORDS = [
  '.env',
  'env.yaml',
  'config',
  'wp-admin',
  'phpmyadmin',
  'adminer',
  'backup',
  'passwd',
  'secret',
  'token',
  'aws',
  '.git',
  'git',
] as const

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizePath(value: unknown): string {
  const raw = normalizeText(value)
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const url = new URL(raw)
      return `${url.pathname}${url.search}`
    } catch {
      return raw
    }
  }
  return raw
}

export function formatHttpMethod(method: unknown): string {
  switch (normalizeText(method).toUpperCase()) {
    case 'GET':
      return '查询访问'
    case 'POST':
      return '提交操作'
    case 'PUT':
      return '更新操作'
    case 'PATCH':
      return '局部更新'
    case 'DELETE':
      return '删除操作'
    case 'HEAD':
      return '系统探测'
    case 'OPTIONS':
      return '浏览器预检'
    default:
      return '其它操作'
  }
}

export function formatStatusCode(statusCode: unknown): string {
  const code = Number(statusCode)
  if (!Number.isFinite(code)) return '未知结果'

  if (code === 200 || code === 201 || code === 204) return '成功'
  if (code === 400) return '请求内容有误'
  if (code === 401) return '未登录'
  if (code === 403) return '无权限'
  if (code === 404) return '未找到 / 已拦截'
  if (code === 409) return '状态冲突 / 重复操作'
  if (code === 500) return '系统异常'
  if (code === 502 || code === 503 || code === 504) return '服务不可用'
  if (code >= 400 && code < 500) return '访问异常'
  if (code >= 500 && code < 600) return '系统异常'
  return '未知结果'
}

export function getStatusTone(statusCode: unknown): OperationLogStatusTone {
  const code = Number(statusCode)
  if (!Number.isFinite(code)) return 'neutral'
  if (code >= 200 && code < 300) return 'success'
  if (code >= 400 && code < 500) return code === 403 || code === 404 ? 'warning' : 'danger'
  if (code >= 500 && code < 600) return 'danger'
  return 'neutral'
}

export function formatModuleName(module: unknown): string {
  const key = normalizeText(module).toLowerCase()
  if (!key || key === 'unknown' || key === '未知') return '未识别模块'
  return MODULE_LABELS[key] ?? '系统模块'
}

export function formatOperator(userName: unknown): string {
  const name = normalizeText(userName)
  const lower = name.toLowerCase()
  if (!name || lower === 'unknown' || name === '未知') return '未识别访问者'
  if (lower === 'admin') return '系统管理员'
  if (lower === 'system') return '系统任务'
  return name
}

export function isSensitivePath(path: unknown): boolean {
  const normalized = normalizePath(path).toLowerCase()
  if (!normalized) return false
  return SENSITIVE_PATH_KEYWORDS.some(keyword => normalized.includes(keyword))
}

export function formatApiPath(path: unknown, method?: unknown, statusCode?: unknown): string {
  const normalized = normalizePath(path)
  const lower = normalized.toLowerCase()

  if (!lower) return '未识别访问'
  if (isSensitivePath(lower)) return '外部探测敏感路径'
  if (lower === '/api/test' || lower.startsWith('/api/test?')) return '外部测试访问'
  if (lower === '/claim-client' || lower.endsWith('/claim-client')) return '打印客户端领取打印任务'
  if (lower === '/api/print-jobs/claim-client' || lower.includes('/print-jobs/claim-client')) return '打印客户端领取打印任务'
  if (lower === '/api/scan-logs' || lower.startsWith('/api/scan-logs?')) return 'PDA 扫码作业'
  if (lower === '/api/scan-logs/check' || lower.startsWith('/api/scan-logs/check?')) return 'PDA 复核扫码'
  if (/\/api\/warehouse-tasks\/[^/]+\/ship(?:\?|$)/.test(lower)) return '仓库任务出库'
  if (/\/api\/warehouse-tasks\/[^/]+\/pack-done(?:\?|$)/.test(lower)) return '仓库任务完成打包'
  if (/\/api\/warehouse-tasks\/[^/]+\/check-done(?:\?|$)/.test(lower)) return '仓库任务完成复核'
  if (/\/api\/warehouse-tasks\/[^/]+\/sort-done(?:\?|$)/.test(lower)) return '仓库任务完成分拣'
  if (lower === '/api/pda/sessions' || lower.startsWith('/api/pda/sessions/')) return 'PDA 设备会话'
  if (lower.startsWith('/api')) return '系统接口访问'

  const methodLabel = formatHttpMethod(method)
  const resultLabel = formatStatusCode(statusCode)
  if (methodLabel === '系统探测' && resultLabel !== '未知结果') return '系统探测访问'
  return '系统访问'
}

export function formatOperationResult(path: unknown, statusCode: unknown): string {
  if (isSensitivePath(path)) {
    const code = Number(statusCode)
    if (code === 404) return '已拦截 / 未找到'
    if (code === 403) return '已拦截'
    if (code >= 400 && code < 500) return '访问异常'
    if (code >= 500 && code < 600) return '系统异常'
  }
  return formatStatusCode(statusCode)
}
