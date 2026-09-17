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
  { value: 'picking-waves', label: '批次拣货' },
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

function formatStatusCode(statusCode: unknown): string {
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

/**
 * 业务接口 → 「模块 · 动作」。
 *
 * 操作日志列表的「操作内容」此前对绝大多数写操作只显示「系统接口访问」，管理员
 * 要逐条点开详情才知道改了什么（2026-09-17 验收 ISSUE-014）。这里按模块前缀给出
 * 中文描述，特殊动作（收货/上架/出库/扫码）单独命名，其余按 HTTP 方法归类。
 */
const BUSINESS_ENDPOINT_LABELS: Array<[RegExp, string]> = [
  [/^\/api\/purchase-orders?(?:\/|$)/, '采购单'],
  [/^\/api\/purchase(?:\/|$)/, '采购单'],
  [/^\/api\/purchase-requisitions?(?:\/|$)/, '采购申请'],
  [/^\/api\/procurement(?:\/|$)/, '采购建议'],
  [/^\/api\/inbound-tasks?(?:\/|$)/, '收货订单'],
  [/^\/api\/sale-orders?(?:\/|$)/, '销售单'],
  [/^\/api\/sales?(?:\/|$)/, '销售单'],
  [/^\/api\/returns?(?:\/|$)/, '退货单'],
  [/^\/api\/transfer(?:\/|$)/, '调拨单'],
  [/^\/api\/warehouse-tasks?(?:\/|$)/, '仓库任务'],
  [/^\/api\/packages?(?:\/|$)/, '装箱'],
  [/^\/api\/stockcheck(?:\/|$)/, '盘点单'],
  [/^\/api\/inventory(?:\/|$)/, '库存'],
  [/^\/api\/containers?(?:\/|$)/, '库存容器'],
  [/^\/api\/plastic-boxes(?:\/|$)/, '塑料盒'],
  [/^\/api\/products?(?:\/|$)/, '商品'],
  [/^\/api\/customers?(?:\/|$)/, '客户'],
  [/^\/api\/suppliers?(?:\/|$)/, '供应商'],
  [/^\/api\/carriers?(?:\/|$)/, '承运商'],
  [/^\/api\/users?(?:\/|$)/, '用户'],
  [/^\/api\/roles?(?:\/|$)/, '角色权限'],
  [/^\/api\/departments?(?:\/|$)/, '部门'],
  [/^\/api\/settings?(?:\/|$)/, '系统设置'],
  [/^\/api\/pda-devices?(?:\/|$)/, 'PDA 设备'],
  [/^\/api\/print-jobs?(?:\/|$)/, '打印任务'],
  [/^\/api\/printers?(?:\/|$)/, '打印机'],
  [/^\/api\/logistics(?:\/|$)/, '物流运单'],
  [/^\/api\/payments?(?:\/|$)/, '账款'],
  [/^\/api\/refunds?(?:\/|$)/, '退款单'],
  [/^\/api\/finance(?:\/|$)/, '资金'],
  [/^\/api\/accounting(?:\/|$)/, '会计'],
]

const ACTION_SUFFIX_LABELS: Array<[RegExp, string]> = [
  [/\/receive(?:\?|$)/, '收货登记'],
  [/\/putaway(?:\?|$)/, '上架登记'],
  [/\/scan-out(?:\?|$)/, '扫码出库'],
  [/\/scan-in(?:\?|$)/, '扫码入库'],
  [/\/pack-done(?:\?|$)/, '完成打包'],
  [/\/ship(?:\?|$)/, '出库确认'],
  [/\/confirm(?:\?|$)/, '确认'],
  [/\/cancel(?:\?|$)/, '取消'],
  [/\/submit(?:\?|$)/, '提交'],
  [/\/void(?:\?|$)/, '作废'],
  [/\/add-item(?:\?|$)/, '装箱上架商品'],
  [/\/remove-item(?:\?|$)/, '移出商品'],
  [/\/print-label(?:\?|$)/, '打印标签'],
  [/\/items\/[^/]+\/scan(?:\?|$)/, '扫码盘点'],
]

function describeBusinessEndpoint(lowerPath: string, method?: unknown): string | null {
  const hit = BUSINESS_ENDPOINT_LABELS.find(([pattern]) => pattern.test(lowerPath))
  if (!hit) return null
  const suffix = ACTION_SUFFIX_LABELS.find(([pattern]) => pattern.test(lowerPath))
  if (suffix) return `${hit[1]} · ${suffix[1]}`
  switch (String(method || '').toUpperCase()) {
    case 'POST': return `${hit[1]} · 新增/提交`
    case 'PUT':
    case 'PATCH': return `${hit[1]} · 修改`
    case 'DELETE': return `${hit[1]} · 删除`
    case 'GET': return `${hit[1]} · 查询`
    default: return hit[1]
  }
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
  // 未单列映射的业务接口：按模块给出「模块名 + 动作」，比笼统的「系统接口访问」
  // 有用得多（2026-09-17 验收 ISSUE-014：操作日志整列都是同一句话，无法一眼看出改了
  // 什么，只能逐条点开详情）。非业务接口保留方法 + 路径，便于排障。
  const business = describeBusinessEndpoint(lower, method)
  if (business) return business
  if (lower.startsWith('/api')) return `${String(method || 'GET').toUpperCase()} ${normalized}`

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
