import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'

/** 根部订阅，与登录、当前工作区或仪表盘是否打开无关。晚到快照由 preload 补送。 */
export function DesktopUpdateBridge() {
  const [update, setUpdate] = useState<DesktopUpdateAvailable | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const desktop = window.flowcubeDesktop
    if (!desktop?.isDesktop) return
    return desktop.subscribeUpdateAvailable?.(setUpdate)
  }, [])

  async function handleUpdate() {
    const start = window.flowcubeDesktop?.startUpdateDownload
    if (!update || !start || busy) return
    setBusy(true)
    try {
      await start({ downloadUrl: update.downloadUrl, version: update.version })
      setUpdate(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法开始下载更新，请稍后重试')
    } finally { setBusy(false) }
  }

  async function handleIgnore() {
    const ignore = window.flowcubeDesktop?.ignoreUpdateVersion
    if (!update || !ignore || busy) return
    setBusy(true)
    try {
      await ignore(update.version)
      setUpdate(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法保存更新偏好，请稍后重试')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={update != null} onOpenChange={open => { if (!open && !busy) setUpdate(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>发现新版本{update?.forceDebug ? '（调试）' : ''}</DialogTitle>
          <DialogDescription>新版本 {update?.version} 已发布，当前版本为 {update?.current}。</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
          {update?.notes.trim() || '暂无更新说明'}
        </div>
        <DialogFooter>
          {!update?.forceDebug && <Button type="button" variant="ghost" disabled={busy} onClick={() => void handleIgnore()}>忽略此版本</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => setUpdate(null)}>稍后提醒</Button>
          <Button type="button" disabled={busy} onClick={() => void handleUpdate()}>{busy ? '处理中…' : '立即更新'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
