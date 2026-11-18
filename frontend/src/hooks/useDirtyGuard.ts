/**
 * useDirtyGuard — 未保存变更保护 Hook
 *
 * 使用方式（在表单页面中调用）：
 *
 *   const tabPath = useContext(TabPathContext)
 *   const isDirty = !!(customerId || items.length > 0)
 *   useDirtyGuard(tabPath, isDirty)
 *
 * 功能：
 * 1. 将 isDirty 状态同步到 dirtyGuardStore，供全局拦截层读取
 * 2. 组件卸载时自动清除注册（Tab 关闭后自动解除保护）
 * 3. isDirty=true 时注册 beforeunload，防止浏览器刷新/关闭标签页丢失数据
 *
 * @param tabPath  当前 Tab 的路径（来自 useContext(TabPathContext)）
 * @param isDirty  表单是否有未保存变更
 */

import { useEffect, useState } from 'react'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'
import { consumeAllowUnloadOnce } from '@/lib/electronUnloadGate'

export function useDirtyGuard(tabPath: string, isDirty: boolean) {
  const setDirty = useDirtyGuardStore(s => s.setDirty)

  const [source] = useState(() => Symbol())

  useEffect(() => {
    if (!tabPath || !isDirty) return
    setDirty(tabPath, true, source)
    return () => setDirty(tabPath, false, source)
  }, [tabPath, isDirty, setDirty, source])

  // 浏览器刷新 / 关闭标签页保护（Electron 内主进程退出确认后会 dispatch 事件放行一次，避免二次原生离开提示）
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      if (consumeAllowUnloadOnce()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])
}
