import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useLocation, useNavigate } from 'react-router-dom'

/** 独立 PDA 应用的实体返回键：页面返回上一页，工作台和登录页退到后台。 */
export default function PdaHardwareBack() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeRef = useRef(location.pathname)
  const navigateRef = useRef(navigate)
  routeRef.current = location.pathname
  navigateRef.current = navigate

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    let listener: { remove: () => Promise<void> } | undefined

    void CapacitorApp.addListener('backButton', async ({ canGoBack }) => {
      if (disposed) return
      const path = routeRef.current
      if (path === '/pda' || path === '/pda/' || path === '/pda/login') {
        await CapacitorApp.minimizeApp()
      } else if (canGoBack) {
        navigateRef.current(-1)
      } else {
        navigateRef.current('/pda', { replace: true })
      }
    }).then(handle => {
      if (disposed) void handle.remove()
      else listener = handle
    })

    return () => {
      disposed = true
      if (listener) void listener.remove()
    }
  }, [])

  return null
}
