// 完整路径边界保证 /purchase/12 不会匹配 /purchase/123。
const DOCUMENT_PATHS = Object.freeze({
  sale: '/api/sale', purchase: '/api/purchase', inbound: '/api/inbound-tasks',
  'purchase-return': '/api/returns/purchase', 'sale-return': '/api/returns/sale',
  transfer: '/api/transfer', stockcheck: '/api/stockcheck', disposal: '/api/disposals',
  requisition: '/api/purchase-requisitions', refund: '/api/refunds',
  expense: '/api/finance/expense-claims', credit: '/api/credit-overrides',
  price: '/api/price-change', plan: '/api/procurement/plans',
  wave: '/api/picking-waves', logistics: '/api/logistics',
  'warehouse-task': '/api/warehouse-tasks', 'return-task': '/api/return-tasks',
})
const ACTIONS = Object.freeze({
  confirm: '确认单据', submit: '提交单据', approve: '审批通过', reject: '驳回申请',
  cancel: '取消单据', withdraw: '撤回提交', 'withdraw-confirm': '撤回确认',
  'close-remaining': '关闭剩余', close: '结束收货', 'close-receiving': '结束收货',
  'void-receipt': '撤回收货', 'scan-out': '扫码调出', 'scan-in': '扫码调入',
  receive: '扫码收货', check: '质检 / 复核', putaway: '扫码上架',
  reserve: '占用库存', release: '释放库存', dispatch: '派发仓库任务',
  ship: '确认出库', pack: '装箱', pick: '拣货', sort: '分拣',
  execute: '执行单据', dispose: '执行处置', pay: '登记付款', convert: '转为采购',
  'force-close': '异常了结', start: '开始拣货', 'finish-pick': '完成拣货',
  finish: '完成批次', retry: '重新取号', void: '作废运单', tracking: '录入物流单号',
  'finish-picking': '完成拣货', 'start-picking': '开始拣货', 'sort-done': '分拣完成', 'check-done': '复核完成', 'pack-done': '打包完成', ready: '准备出库', assign: '分配作业人', priority: '调整优先级', adjust: '修改订单', scan: '扫码盘点', refresh: '刷新账面数量',
  items: '修改明细', 'request-adjustment': '申请改单', 'confirm-adjustment': '确认改单',
})
function resolveOperation(method, rawPath, statusCode, response) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || statusCode < 200 || statusCode >= 300 || response?.success !== true) return null
  const path = rawPath.split('?')[0].replace(/\/$/, '')
  for (const [type, prefix] of Object.entries(DOCUMENT_PATHS)) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue
    const segments = path.slice(prefix.length).split('/').filter(Boolean)
    const rawId = segments.length ? segments[0] : response.data?.id ?? response.data?.taskId ?? response.data?.waveId
    if (!/^[1-9]\d*$/.test(String(rawId))) return null
    const id = Number(rawId)
    if (!Number.isSafeInteger(id)) return null
    const action = segments.slice(1).reverse().find(key => Object.hasOwn(ACTIONS, key))
    const title = segments.length === 0 ? '创建单据'
      : (type === 'purchase' && action === 'close' ? '关闭剩余采购' : ACTIONS[action]) ?? (method === 'DELETE' ? '删除单据' : method === 'POST' ? '处理单据' : '修改单据')
    return { type, id, title }
  }
  return null
}
module.exports = { resolveOperation, DOCUMENT_PATHS }
