import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { getWorkspaceFullPath as getFullPath, buildWorkspaceTabRegistrationFromPath } from './workspaceRouteMeta'
import { getHashRouterWindowLocation } from './hashLocation'

type Entry = { url: string; state: { idx?: number; [key: string]: unknown } | null; path: string }

// 必须在 createRoot/HashRouter 订阅历史之前初始化；登录后才挂载工作区也能拦截。
function createWorkspaceHistoryGuard() {
  let currentEntry: Entry | null = null
  let blocked: { current: Entry; target: Entry; delta: number | null; confirming: boolean; decision: boolean | null } | null = null
  let approved: Entry | null = null
  const indexOf = (entry: Entry): number | null => {
    const index = entry.state?.idx
    return typeof index === 'number' && Number.isInteger(index) ? index : null
  }
  const sameEntry = (left: Entry, right: Entry) => left.url === right.url && indexOf(left) === indexOf(right)
  const settle = () => {
    const attempt = blocked
    if (!attempt || attempt.decision === null) return
    // history.go 的恢复是异步的。确认/取消都必须等待真正回到当前条目，
    // 否则再次后退途中确认会从错误位置遍历，甚至越过当前文档。
    if (!sameEntry(attempt.current, { ...attempt.current, url: window.location.href, state: window.history.state })) return
    blocked = null
    if (!attempt.decision || (!currentEntry || !sameEntry(currentEntry, attempt.current))) return
    approved = attempt.target
    if (attempt.delta !== null) {
      window.history.go(attempt.delta)
    } else {
      window.history.replaceState(attempt.target.state, '', attempt.target.url)
      window.dispatchEvent(new PopStateEvent('popstate', { state: attempt.target.state }))
    }
  }
  const confirm = () => {
    if (!blocked || blocked.confirming) return
    const attempt = blocked
    attempt.confirming = true
    const decide = (accepted: boolean) => {
      if (blocked !== attempt) return
      attempt.decision = accepted
      settle()
    }
    useDirtyGuardStore.getState().showConfirm('当前内容尚未保存，确定离开吗？', () => decide(true), () => decide(false))
  }
  const restore = (target: Entry) => {
    if (!blocked) return
    const currentIndex = indexOf(blocked.current), targetIndex = indexOf(target)
    if (currentIndex !== null && targetIndex !== null && currentIndex !== targetIndex) {
      // 回到真正的历史条目，再等待确认；不能覆盖目标条目或丢弃前进历史。
      window.history.go(currentIndex - targetIndex)
    } else {
      window.history.replaceState(blocked.current.state, '', blocked.current.url)
      settle()
      confirm()
    }
  }
  const handlePopState = (event: PopStateEvent) => {
    const targetLocation = getHashRouterWindowLocation()
    const target: Entry = {
      url: window.location.href, state: window.history.state,
      path: getFullPath(targetLocation.pathname, targetLocation.search),
    }
    if (approved && sameEntry(approved, target)) { approved = null; return }
    approved = null
    if (blocked) {
      event.stopImmediatePropagation()
      if (sameEntry(blocked.current, target)) { settle(); confirm() }
      else restore(target)
      return
    }
    const current = currentEntry
    if (!current) return
    if (sameEntry(current, target)) return
    const activeKey = buildWorkspaceTabRegistrationFromPath(current.path).key
    if (!useDirtyGuardStore.getState().isTabDirty(activeKey)) return
    event.stopImmediatePropagation()
    const currentIndex = indexOf(current), targetIndex = indexOf(target)
    blocked = {
      current, target, confirming: false, decision: null,
      delta: currentIndex !== null && targetIndex !== null && currentIndex !== targetIndex
        ? targetIndex - currentIndex : null,
    }
    restore(target)
  }
  window.addEventListener('popstate', handlePopState, true)
  return {
    update(entry: Entry) { currentEntry = entry },
    deactivate() { currentEntry = null; blocked = null; approved = null },
    dispose() { this.deactivate(); window.removeEventListener('popstate', handlePopState, true) },
  }
}
let instance: ReturnType<typeof createWorkspaceHistoryGuard> | undefined
export function initializeWorkspaceHistoryGuard() {
  return instance ??= createWorkspaceHistoryGuard()
}
/** 测试与热重载释放自己的监听器，生产实例与应用同寿命。 */
export function disposeWorkspaceHistoryGuard() {
  instance?.dispose()
  instance = undefined
}
if (import.meta.hot) import.meta.hot.dispose(disposeWorkspaceHistoryGuard)
