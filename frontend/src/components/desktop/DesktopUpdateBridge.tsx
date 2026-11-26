import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DESKTOP_UPDATE_OPEN_EVENT, getElectronBridge } from '@/lib/platform'
import { toast } from '@/lib/toast'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

const UPDATE_LABELS: Record<DesktopUpdateState['stage'], string> = {
  idle: '可手动检查更新',
  checking: '正在检查更新…',
  downloading: '正在下载更新',
  cancelling: '正在取消下载…',
  cancelled: '已取消下载',
  current: '当前已是最新版本',
  ready: '已下载，等待重启',
  installing: '正在验证并启动安装程序…',
  error: '更新未完成',
  unsupported: '此版本无法自动更新',
}

function progressLabel({ percent, received }: DesktopUpdateState) {
  if (percent != null) return `${percent}%`
  return received ? `${(received / 1024 / 1024).toFixed(1)} MB` : '正在连接…'
}

function checkForUpdate() {
  void getElectronBridge()?.triggerUpdateCheck?.().catch(() => toast.error('无法检查更新，请稍后重试'))
}

/** 根部订阅让登录页和业务工作区共用主进程的更新状态。 */
export function DesktopUpdateBridge() {
  const [update, setUpdate] = useState<DesktopUpdateState>({ stage: 'idle' })
  const [open, setOpen] = useState(false)
  const [restartPending, setRestartPending] = useState(false)
  const [minimizedStage, setMinimizedStage] = useState<DesktopUpdateState['stage'] | null>(null)

  useEffect(() => {
    const bridge = getElectronBridge()
    if (!bridge?.subscribeUpdateState) return
    const unsubscribe = bridge.subscribeUpdateState(setUpdate)
    const handleOpen = () => {
      setOpen(true)
      checkForUpdate()
    }
    window.addEventListener(DESKTOP_UPDATE_OPEN_EVENT, handleOpen)
    return () => {
      unsubscribe()
      window.removeEventListener(DESKTOP_UPDATE_OPEN_EVENT, handleOpen)
    }
  }, [])

  const { stage, version, current, notes, message, percent } = update
  const downloading = stage === 'downloading' || stage === 'cancelling'
  const noticeStage = downloading ? 'downloading' : stage
  const showNotice = downloading || stage === 'ready' || (stage === 'error' && update.showNotice)
  const locked = restartPending || stage === 'installing'
  const canCheck = stage === 'idle' || stage === 'current' || stage === 'cancelled' || stage === 'error'

  function handleRestart() {
    const restart = getElectronBridge()?.restartToUpdate
    if (!restart || locked) return
    setOpen(true)
    setRestartPending(true)
    const doRestart = () => {
      void restart()
        .catch(() => toast.error('无法启动更新，请重新检查'))
        .finally(() => setRestartPending(false))
    }
    const dirty = useDirtyGuardStore.getState()
    if (Object.keys(dirty.dirtyTabs).length === 0) {
      doRestart()
      return
    }
    dirty.showConfirm('有未保存的单据或表单。确定放弃这些修改并重启升级吗？', doRestart, () => setRestartPending(false))
  }

  return (
    <>
      {showNotice && !open && (minimizedStage === noticeStage ? (
        <Button type="button" variant="outline" size="sm" className="fixed bottom-4 right-5 z-40 bg-popover shadow-md" onClick={() => {
          setMinimizedStage(null)
          setOpen(true)
        }}><Download aria-hidden="true" />桌面更新</Button>
      ) : (
        <aside aria-label="桌面更新提醒" className="fixed inset-x-4 bottom-4 z-40 flex flex-wrap items-center gap-2 rounded-[var(--desktop-radius-popover,14px)] border bg-popover p-3 text-popover-foreground shadow-[var(--desktop-shadow-lg,var(--shadow-popover))] sm:left-auto sm:right-5 sm:w-[29rem] sm:gap-x-3 sm:px-4">
          <Download aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <div className="min-w-28 flex-1">
            <p className="text-sm font-medium">{UPDATE_LABELS[stage]}</p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {version ? `v${version}` : '桌面更新'}{downloading && ` · ${progressLabel(update)}`}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>查看更新</Button>
          {stage === 'ready' && <Button type="button" size="sm" onClick={handleRestart}>重启升级</Button>}
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="收起更新提醒" onClick={() => setMinimizedStage(noticeStage)}>
            <X aria-hidden="true" />
          </Button>
        </aside>
      ))}
      <Dialog open={open} onOpenChange={value => { if (!locked) setOpen(value) }}>
        <DialogContent hideClose={locked} className="fc-form-dialog fc-update-dialog">
          <DialogHeader description={current ? `当前版本 v${current}${version && version !== current && stage !== 'current' ? ` · 更新版本 v${version}` : ''}` : '检查此客户端的可用更新'}>
            <DialogTitle>桌面更新</DialogTitle>
          </DialogHeader>
          <div className="fc-form-dialog-body space-y-2">
            <p role="status" className="text-sm font-medium">{UPDATE_LABELS[stage]}</p>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            {downloading && (
              <div className="flex items-center gap-3">
                <div role="progressbar" aria-label="下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
                  className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={percent == null ? 'h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse' : 'h-full rounded-full bg-primary'}
                    style={percent == null ? undefined : { width: `${percent}%` }} />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{progressLabel(update)}</span>
              </div>
            )}
            {notes?.trim() && stage !== 'current' && (
              <div className="whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-sm leading-6">{notes.trim()}</div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={locked} onClick={() => setOpen(false)}>{showNotice ? '稍后' : '关闭'}</Button>
            {downloading && (
              <Button type="button" variant="outline" disabled={stage !== 'downloading'} onClick={() => {
                void getElectronBridge()?.cancelUpdateDownload?.().catch(() => toast.error('无法取消下载，请稍后重试'))
              }}>取消下载</Button>
            )}
            {canCheck && <Button type="button" onClick={checkForUpdate}>{stage === 'error' || stage === 'cancelled' ? '重新检查' : '检查更新'}</Button>}
            {stage === 'ready' && <Button type="button" disabled={locked} onClick={handleRestart}>重启升级</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
