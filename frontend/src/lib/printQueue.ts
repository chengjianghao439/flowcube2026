/**
 * 打印队列前端协作点。
 *
 * 打印任务只有一个消费者：桌面端轮询客户端（DesktopPrintClientBridge）。
 * 业务页面只负责把任务入队，随后调用 triggerPrintPoll() 唤醒客户端立刻领取，
 * 自己不执行物理打印 —— 单一消费路径，从根上不存在「页面和轮询各打一次」的重复出纸竞态。
 */

type Poller = () => void

let poller: Poller | null = null
let desktopClientId: string | null = null

/** 由 DesktopPrintClientBridge 挂载时注册、卸载时传 null 注销 */
export function registerPrintPoller(fn: Poller | null): void {
  poller = fn
}

/**
 * 记录本机桌面客户端标识（由 Bridge 每轮拿到 clientInfo 后写入）。
 * 供入队请求带给后端做「谁点的就从谁连的打印机出纸」路由。
 */
export function setDesktopClientId(clientId: string | null): void {
  desktopClientId = clientId && clientId.trim() ? clientId.trim() : null
}

export function getDesktopClientId(): string | null {
  return desktopClientId
}

/**
 * 入队后唤醒桌面客户端立即跑一次「领取 + 打印」，省去等待下一个轮询周期。
 * 浏览器端、或桌面端打印桥接未就绪时静默跳过 —— 任务仍会被后续轮询正常领取，不会丢。
 */
export function triggerPrintPoll(): void {
  poller?.()
}

export interface PrintQueueDispatchHint {
  code?: string | null
  message?: string | null
}

export interface PrintQueueFeedback {
  level: 'success' | 'warning'
  message: string
}

/**
 * 入队结果 → 统一用户提示，区分「需要用户干预」与「正常排队」。
 * 集中在此，避免每个打印入口各写一份分支（历史上三个页面各有一份，且判断了后端从不返回的 code）。
 */
export function printQueueFeedback(hint?: PrintQueueDispatchHint | null): PrintQueueFeedback {
  const code = hint?.code ?? ''
  const message = hint?.message ?? ''
  if (code === 'client_not_bound' || code === 'client_offline') {
    return { level: 'warning', message: message || '任务已入队，等待打印客户端上线后自动打印' }
  }
  if (code === 'failed') {
    return { level: 'warning', message: message || '打印任务失败，请在「打印任务」中查看原因' }
  }
  return { level: 'success', message: '已加入打印队列' }
}
