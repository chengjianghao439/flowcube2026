import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

type UpdatePayload = {
  version: string
  notes: string
  downloadUrl: string
  current: string
  forceDebug?: boolean
}

/**
 * 桌面安装包：主进程自动检测更新后通过 IPC 推送，任意路由下展示（含登录页）。
 */
export default function GlobalDesktopUpdateDialog() {
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<UpdatePayload | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const d = window.flowcubeDesktop
    if (!d?.subscribeUpdateAvailable) return undefined
    return d.subscribeUpdateAvailable((p: UpdatePayload) => {
      if (!p?.version || !p?.downloadUrl) return
      setPayload(p)
      setOpen(true)
    })
  }, [])

  const onUpdate = useCallback(async () => {
    const url = payload?.downloadUrl
    const start = window.flowcubeDesktop?.startUpdateDownload
    if (!url || !start) return
    setBusy(true)
    try {
      setOpen(false)
      await start(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '无法开始下载更新')
    } finally {
      setBusy(false)
    }
  }, [payload?.downloadUrl])

  const onIgnore = useCallback(async () => {
    const v = payload?.version
    const ign = window.flowcubeDesktop?.ignoreUpdateVersion
    if (v && ign) {
      try {
        await ign(v)
      } catch {
        /* 忽略失败仍关闭弹窗 */
      }
    }
    setOpen(false)
  }, [payload?.version])

  if (!payload) return null

  const notes = String(payload.notes || '').trim()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {payload.forceDebug ? '发现新版本（调试）' : '发现新版本'}
          </DialogTitle>
          <DialogDescription>
            新版本 v{payload.version} 已发布（当前 v{payload.current}）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          {notes ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground">
              <p className="mb-1 font-medium text-muted-foreground">更新内容</p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-sans leading-relaxed">
                {notes}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无更新说明</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            稍后提醒
          </Button>
          {!payload.forceDebug && (
            <Button type="button" variant="secondary" onClick={onIgnore} disabled={busy}>
              忽略此版本
            </Button>
          )}
          <Button type="button" onClick={onUpdate} disabled={busy}>
            {busy ? '处理中…' : '立即更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
