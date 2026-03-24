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

import { useEffect } from 'react'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

export function useDirtyGuard(tabPath: string, isDirty: boolean) {
  const setDirty = useDirtyGuardStore(s => s.setDirty)

  // 同步脏状态到全局 store
  useEffect(() => {
    if (!tabPath) return
    setDirty(tabPath, isDirty)
  }, [tabPath, isDirty, setDirty])

  // 组件卸载时清除（Tab 被关闭后解除保护）
  useEffect(() => {
    if (!tabPath) return
    return () => {
      setDirty(tabPath, false)
    }
  }, [tabPath, setDirty])

  // 浏览器刷新 / 关闭标签页保护
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 部分浏览器仍需设置 returnValue 才能显示原生提示
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])
}
