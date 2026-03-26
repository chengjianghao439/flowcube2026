/**
 * Electron：主进程拦截窗口关闭后，在渲染进程展示自定义确认（替代系统 dialog.showMessageBox）。
 */
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { setAllowUnloadOnce } from '@/lib/electronUnloadGate'

export function DesktopQuitDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const d = window.flowcubeDesktop
    if (!d?.onCloseRequest) return
    return d.onCloseRequest(() => setOpen(true))
  }, [])

  if (!window.flowcubeDesktop?.acceptClose) return null

  return (
    <ConfirmDialog
      open={open}
      title="退出 FlowCube"
      description="确定要退出 FlowCube ERP 吗？"
      confirmText="退出应用"
      cancelText="取消"
      variant="destructive"
      onConfirm={() => {
        setAllowUnloadOnce()
        setOpen(false)
        window.flowcubeDesktop?.acceptClose?.()
      }}
      onCancel={() => setOpen(false)}
    />
  )
}
