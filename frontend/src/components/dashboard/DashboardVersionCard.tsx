import { useQuery } from '@tanstack/react-query'
import { Package, BellRing } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAppUpdateLatestApi } from '@/api/appUpdate'
import { CURRENT_ERP_WEB_VERSION } from '@/constants/appVersion'

function normalizeVersion(v: string): string {
  return String(v).trim().replace(/^v/i, '')
}

/** 远程版本是否高于当前 Web 构建版本（按 x.y.z 数值比较） */
function isRemoteNewer(current: string, remote: string): boolean {
  const a = normalizeVersion(current)
  const b = normalizeVersion(remote)
  if (!b || a === b) return false
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export default function DashboardVersionCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['app-update-latest'],
    queryFn: async () => {
      const res = await getAppUpdateLatestApi()
      if (!res.data.success || !res.data.data?.version) return null
      return res.data.data
    },
    staleTime: 1000 * 60 * 5,
    retry: 1,
  })

  const latestVer = data?.version
  const notes = data?.notes?.trim() || ''
  const showNewAvailable =
    latestVer != null && isRemoteNewer(CURRENT_ERP_WEB_VERSION, latestVer)

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
          {showNewAvailable && (
            <Badge variant="default" className="gap-1 bg-amber-600 hover:bg-amber-600/90">
              <BellRing className="h-3 w-3" />
              有新版本可用
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">当前版本：</span>
          <span className="font-mono font-semibold text-foreground">
            v{normalizeVersion(CURRENT_ERP_WEB_VERSION)}
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
