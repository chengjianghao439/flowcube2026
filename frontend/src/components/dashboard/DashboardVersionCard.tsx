import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Package, BellRing, Download, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getAppUpdateLatestApi } from '@/api/appUpdate'
import { CURRENT_ERP_WEB_VERSION } from '@/constants/appVersion'
import { getApiBase } from '@/config/api'
import { normalizeVersion, isRemoteNewer } from '@/lib/appVersionCompare'
import { resolveAppUpdateDownloadUrl } from '@/lib/resolveAppUpdateDownloadUrl'
import { toast } from '@/lib/toast'

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
    if (!downloadUrl || !start) return
    setUpdateBusy(true)
    try {
      await start(downloadUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '无法开始下载更新')
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <CardTitle className="text-base">系统版本</CardTitle>
              <CardDescription className="mt-1">与服务器发布信息同步</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={checking}
              onClick={() => void handleCheckUpdate()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? '检查中…' : '检查更新'}
            </Button>
            {showNewAvailable && (
              <Badge variant="default" className="gap-1 bg-amber-600 hover:bg-amber-600/90">
                <BellRing className="h-3 w-3" />
                有新版本可用
              </Badge>
            )}
            {showDesktopUpdateButton && (
              <Button
                type="button"
                size="sm"
                disabled={updateBusy}
                onClick={() => void handleDesktopUpdate()}
              >
                <Download className="h-3.5 w-3.5" />
                {updateBusy ? '处理中…' : '立即更新'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">当前版本：</span>
          <span className="font-mono font-semibold text-foreground">
            v{normalizeVersion(currentDisplay)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">服务端最新：</span>
          {isLoading ? (
            <span className="text-muted-foreground">加载中…</span>
          ) : isError || !latestVer ? (
            <span className="text-muted-foreground">暂无法获取</span>
          ) : (
            <span className="font-mono font-semibold text-foreground">
              v{normalizeVersion(latestVer)}
            </span>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-muted-foreground">更新内容</p>
          {isLoading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : isError || !notes ? (
            <p className="text-muted-foreground">暂无说明或获取失败</p>
          ) : (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 font-sans text-xs leading-relaxed text-foreground">
              {notes}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
