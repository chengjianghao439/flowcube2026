import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Package, BellRing, Download, RefreshCw } from 'lucide-react'
import { WidgetShell } from './WidgetShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getAppUpdateLatestApi } from '@/api/appUpdate'
import { CURRENT_ERP_WEB_VERSION } from '@/constants/appVersion'
import { getApiBase } from '@/config/api'
import { normalizeVersion, isRemoteNewer } from '@/lib/appVersionCompare'
import { resolveAppUpdateDownloadUrl } from '@/lib/resolveAppUpdateDownloadUrl'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { STATUS_TONE_CLASS } from '@/lib/statusTone'

export default function DashboardVersionCard() {
  const qc = useQueryClient()
  const [updateBusy, setUpdateBusy] = useState(false)
  const [checking, setChecking] = useState(false)

  const { data: desktopRuntime } = useQuery({
    queryKey: ['desktop-runtime-info'],
    queryFn: async () => {
      const d = window.flowcubeDesktop
      if (!d?.isPackaged || !d.getAppVersion) return { packaged: false as const, version: null as string | null }
      const packaged = await d.isPackaged()
      if (!packaged) return { packaged: false as const, version: null as string | null }
      const version = await d.getAppVersion()
      return { packaged: true as const, version }
    },
    staleTime: Infinity,
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['app-update-latest'],
    queryFn: async () => {
      const res = await getAppUpdateLatestApi()
      if (!res?.version) return null
      return res
    },
    staleTime: 1000 * 60 * 5,
    retry: 1,
  })

  async function handleCheckUpdate() {
    setChecking(true)
    try {
      await qc.invalidateQueries({ queryKey: ['app-update-latest'] })
      // 等待 React Query 重新获取最新数据
      await new Promise(r => setTimeout(r, 800))
      const fresh = qc.getQueryData<typeof data>(['app-update-latest'])
      const freshVer = (fresh as any)?.version

      if (freshVer && isRemoteNewer(currentDisplay, freshVer)) {
        toast.success(`发现新版本 v${normalizeVersion(freshVer)}，可在下方查看更新内容`)
      } else if (freshVer) {
        toast.success(`已是最新版本 v${normalizeVersion(currentDisplay)}`)
      } else {
        toast.warning('暂无法获取服务端版本，请稍后重试')
      }

      const d = window.flowcubeDesktop
      if (d?.triggerUpdateCheck) {
        await d.triggerUpdateCheck()
      }
    } catch {
      toast.error('检查更新失败，请检查网络连接')
    } finally {
      setChecking(false)
    }
  }

  const latestVer = data?.version
  const notes = data?.notes?.trim() || ''
  const currentDisplay =
    desktopRuntime?.packaged && desktopRuntime.version
      ? desktopRuntime.version
      : CURRENT_ERP_WEB_VERSION
  const showNewAvailable =
    latestVer != null && isRemoteNewer(currentDisplay, latestVer)

  const origin = getApiBase()
  const downloadUrl =
    data && origin ? resolveAppUpdateDownloadUrl(data, origin) : ''

  const showDesktopUpdateButton =
    Boolean(desktopRuntime?.packaged) && showNewAvailable && Boolean(downloadUrl)

  async function handleDesktopUpdate() {
    const start = window.flowcubeDesktop?.startUpdateDownload
    if (!downloadUrl || !latestVer || !start) return
    setUpdateBusy(true)
    try {
      await start({ downloadUrl, version: latestVer })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '无法开始下载更新')
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <WidgetShell title="系统版本" icon={Package} scrollBody
      action={<Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={checking} onClick={() => void handleCheckUpdate()}>
        <RefreshCw className={checking ? 'motion-safe:animate-spin' : ''} />{checking ? '检查中…' : '检查更新'}
      </Button>}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">与服务器发布信息同步</p>
        <dl className="grid grid-cols-2 gap-4 border-b border-border pb-4">
          <div><dt className="text-xs text-muted-foreground">当前版本</dt><dd className="mt-1 text-xl font-semibold tabular-nums">v{normalizeVersion(currentDisplay)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">服务端最新</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{isLoading ? '加载中…' : isError || !latestVer ? '暂无法获取' : `v${normalizeVersion(latestVer)}`}</dd></div>
        </dl>
        {showNewAvailable && <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('gap-1 text-xs font-medium', STATUS_TONE_CLASS.warning)}><BellRing className="h-3 w-3" />有新版本可用</Badge>
          {showDesktopUpdateButton ? <Button size="sm" disabled={updateBusy} onClick={() => void handleDesktopUpdate()}><Download />{updateBusy ? '处理中…' : '立即更新'}</Button> : <p className="text-xs leading-5 text-muted-foreground">请在极序 Flow 桌面客户端完成自动更新。</p>}
        </div>}
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">更新内容</h4>
          <div className="whitespace-pre-wrap break-words text-xs leading-6 text-foreground">{isLoading ? '正在加载更新内容…' : isError || !notes ? '暂无说明或获取失败，可点击检查更新重试。' : notes}</div>
        </div>
      </div>
    </WidgetShell>
  )
}
