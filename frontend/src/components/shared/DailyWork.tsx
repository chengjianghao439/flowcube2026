import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { canOpenWorkbenchPath } from '@/lib/workbench'
import { resolveRouteTitle } from '@/router/routeDefinitions'
import { buildWorkspaceTabRegistrationFromPath, resolveWorkspaceEntryPath } from '@/router/workspaceRouteMeta'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaceStore } from '@/store/workspaceStore'

// 只列日常列表路径；权限与名称统一从现有路由注册读取。
const DAILY_GROUPS = [
  { title: '采购与销售', paths: ['/sale', '/purchase'] },
  { title: '仓库作业', paths: ['/inbound-tasks', '/picking-waves', '/inventory'] },
  { title: '财务往来', paths: ['/payments/receivable', '/payments/payable', '/reports/reconciliation/receivable', '/reports/reconciliation/payable', '/finance/dashboard'] },
  { title: '物流与打印', paths: ['/logistics', '/settings/barcode-print-query'] },
]

/** 首页与待办中心共用；随当前登录者权限更新，不增加配置或持久化。 */
export function DailyWork() {
  const { can } = usePermission()
  const authenticated = useAuthStore(s => s.isAuthenticated)
  const addTab = useWorkspaceStore(s => s.addTab)
  const navigate = useNavigate()
  const seen = new Set<string>()
  const groups = DAILY_GROUPS.map(group => ({
    ...group,
    items: group.paths.flatMap(path => {
      const title = resolveRouteTitle(path)
      const key = buildWorkspaceTabRegistrationFromPath(path).key
      if (!authenticated || !title || !canOpenWorkbenchPath(path, can) || seen.has(key)) return []
      seen.add(key)
      return [{ path, title }]
    }),
  })).filter(group => group.items.length > 0)

  function open(path: string, title: string) {
    if (!authenticated || !canOpenWorkbenchPath(path, can)) return
    const target = buildWorkspaceTabRegistrationFromPath(path)
    // 已打开的列表沿用自己的 query 与组件实例，保留筛选和未保存输入。
    const existing = useWorkspaceStore.getState().tabs.find(tab => tab.key === target.key)
    const registration = { key: target.key, path: resolveWorkspaceEntryPath(path, existing, can) }
    if (addTab({ ...registration, title })) navigate(registration.path)
  }

  if (!groups.length) return null
  return (
    <nav aria-label="常用工作" className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-section-title mb-3">常用工作</h2>
      <div className="space-y-3">
        {groups.map(group => (
          <div key={group.title} className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <h3 className="w-20 shrink-0 pt-2 text-sm font-medium text-muted-foreground">{group.title}</h3>
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              {group.items.map(item => (
                <Button key={item.path} type="button" size="sm" variant="outline"
                  className="h-auto min-h-9 max-w-full whitespace-normal break-words py-1.5 text-left"
                  onClick={() => open(item.path, item.title)}>{item.title}</Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )
}
