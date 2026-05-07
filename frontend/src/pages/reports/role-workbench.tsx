import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { getRoleWorkbenchApi, type WorkbenchCard } from '@/api/reports'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'

function PriorityBanner({
  title,
  description,
  count,
  sectionTitle,
  badge,
  onOpen,
}: {
  title: string
  description: string
  count: number
  sectionTitle: string
  badge: string
  onOpen: () => void
}) {
  return (
    <section className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-100 text-rose-700">{badge}</Badge>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">最优先待办</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <p className="mt-2 text-xs text-muted-foreground">来源：{sectionTitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3 text-right shadow-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">待处理数</p>
            <p className="text-3xl font-bold tabular-nums text-rose-700">{count}</p>
          </div>
          <Button onClick={onOpen}>立即处理</Button>
        </div>
      </div>
    </section>
  )
}

function SectionList({ cards, onOpen }: { cards: WorkbenchCard[]; onOpen: (path: string, title: string) => void }) {
  return (
    <div className="space-y-3">
      {cards.map(card => (
        <div key={card.key} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{card.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{card.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge variant="outline" className="rounded-full border-border/60 bg-white/90 px-2">{card.count}</Badge>
              <Button size="sm" variant="outline" onClick={() => onOpen(card.path, card.title)}>{card.actionLabel}</Button>
            </div>
          </div>
          {card.items.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
              {card.items.map(item => (
                <button
                  key={`${card.key}-${item.id}`}
                  type="button"
                  onClick={() => onOpen(item.path, item.title)}
                  className="w-full rounded-xl border border-border/60 bg-white/70 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                        {item.badge && <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">{item.badge}</Badge>}
                      </div>
                      {item.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.hint || (item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '待处理')}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function RoleWorkbenchPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const isActiveTab = useActiveWorkspaceTab()

  const workbenchQ = useQuery({
    queryKey: ['role-workbench'],
    queryFn: () => getRoleWorkbenchApi(),
    enabled: isActiveTab,
    refetchInterval: isActiveTab ? 60_000 : false,
  })

  const { data, isLoading, isError, error, refetch } = workbenchQ
  const topAlert = data?.topAlert
  const sections = [...(data?.sections ?? [])].sort((a, b) => a.priorityRank - b.priorityRank)

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="岗位工作台"
        description="按岗位分组展示待办事项，优先处理最优先待办。"
        actions={<Button onClick={() => refetch()}>立即刷新</Button>}
      />

      {topAlert && (
        <PriorityBanner
          title={topAlert.title}
          description={topAlert.description}
          count={topAlert.count}
          sectionTitle={topAlert.sectionTitle}
          badge={topAlert.badge}
          onOpen={() => openPath(topAlert.path, topAlert.title)}
        />
      )}

      {isLoading && (
        <div className="grid gap-4">
          <div className="h-48 animate-pulse rounded-2xl border border-border bg-muted/40" />
          <div className="h-48 animate-pulse rounded-2xl border border-border bg-muted/40" />
        </div>
      )}

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="岗位工作台加载失败"
          compact
        />
      )}

      {!isLoading && !isError && sections.length > 0 && sections.map(section => (
        <section key={section.key} className="space-y-3">
          <div>
            <h2 className="text-section-title">{section.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
          </div>
          <SectionList
            cards={section.cards.slice().sort((a, b) => a.priorityRank - b.priorityRank)}
            onOpen={openPath}
          />
        </section>
      ))}

      {!isLoading && !isError && !sections.length && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          暂无待办事项
        </div>
      )}
    </div>
  )
}
