import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { getRoleWorkbenchApi, type WorkbenchCard, type WorkbenchItem, type WorkbenchSection } from '@/api/reports'

const ACCENT_CLASSES: Record<WorkbenchCard['accent'], { card: string; badge: string; pill: string; button: string }> = {
  blue:   { card: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white', badge: 'border-blue-200 bg-blue-50 text-blue-700', pill: 'bg-blue-500', button: 'border-blue-200 text-blue-700 hover:bg-blue-50' },
  amber:  { card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', badge: 'border-amber-200 bg-amber-50 text-amber-700', pill: 'bg-amber-500', button: 'border-amber-200 text-amber-700 hover:bg-amber-50' },
  emerald:{ card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', pill: 'bg-emerald-500', button: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
  rose:   { card: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white', badge: 'border-rose-200 bg-rose-50 text-rose-700', pill: 'bg-rose-500', button: 'border-rose-200 text-rose-700 hover:bg-rose-50' },
  slate:  { card: 'border-slate-200 bg-gradient-to-br from-slate-50 to-white', badge: 'border-slate-200 bg-slate-50 text-slate-700', pill: 'bg-slate-500', button: 'border-slate-200 text-slate-700 hover:bg-slate-50' },
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function PriorityBanner({
  title,
  description,
  count,
  sectionTitle,
  badge,
  priorityLabel,
  onOpen,
}: {
  title: string
  description: string
  count: number
  sectionTitle: string
  badge: string
  priorityLabel: string
  onOpen: () => void
}) {
  return (
    <section className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded-full border-rose-200 bg-rose-100 text-rose-700">
              {badge}
            </Badge>
            <Badge variant="outline" className="rounded-full border-border/60 bg-white/80 text-[10px] text-muted-foreground">
              {priorityLabel}
            </Badge>
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

function ItemRow({ item, onOpen }: { item: WorkbenchItem; onOpen: (path: string, title: string) => void }) {
  const hint = item.hint || (item.createdAt ? formatDisplayDateTime(item.createdAt) : '待处理')
  return (
    <button
      type="button"
      onClick={() => onOpen(item.path, item.title)}
      className="w-full rounded-xl border border-border/70 bg-white/80 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
            {item.badge && (
              <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] leading-4">
                {item.badge}
              </Badge>
            )}
          </div>
          {item.subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</p>}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>
      </div>
    </button>
  )
}

function CardView({ card, onOpen }: { card: WorkbenchCard; onOpen: (path: string, title: string) => void }) {
  const accent = ACCENT_CLASSES[card.accent]
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-card-title">{card.title}</p>
            <Badge variant="outline" className="rounded-full border-border/60 bg-white/90 px-2 text-[10px] text-muted-foreground">
              {card.priorityLabel}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant="outline" className={`gap-1 rounded-full ${accent.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${accent.pill}`} />
            {card.count}
          </Badge>
          <Button size="sm" variant="outline" className={accent.button} onClick={() => onOpen(card.path, card.title)}>
            {card.actionLabel}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {card.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            暂无待处理项
          </div>
        ) : (
          card.items.map(item => (
            <ItemRow key={`${card.key}-${item.id}`} item={item} onOpen={onOpen} />
          ))
        )}
      </div>
    </div>
  )
}

function FocusQueue({
  items,
  onOpen,
}: {
  items: Array<{ key: string; title: string; path: string; priorityLabel: string; sectionTitle: string; count: number }>
  onOpen: (path: string, title: string) => void
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-card-title">今日处理顺序</h2>
          <p className="text-sm text-muted-foreground">按固定优先级给出今日建议处理顺序，先做高频且最容易形成堵点的待办。</p>
        </div>
        <Badge variant="outline" className="w-fit rounded-full border-slate-200 bg-white text-slate-700">
          {items.length} 项建议优先处理
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        {items.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => onOpen(item.path, item.title)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-100 text-slate-700">
                {item.priorityLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">{item.sectionTitle}</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">{item.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">当前待处理 {item.count} 项</p>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function RoleWorkbenchPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)

  const workbenchQ = useQuery({
    queryKey: ['role-workbench'],
    queryFn: () => getRoleWorkbenchApi().then(r => r.data.data!),
    refetchInterval: 60_000,
  })

  const { data, isLoading, isError, error, refetch } = workbenchQ

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  const summary = data?.summary
  const topAlert = data?.topAlert
  const sections: WorkbenchSection[] = [...(data?.sections ?? [])].sort((a, b) => a.priorityRank - b.priorityRank)
  const focusQueue = sections
    .flatMap(section =>
      section.cards.map(card => ({
        key: card.key,
        title: card.title,
        path: card.path,
        priorityLabel: card.priorityLabel,
        sectionTitle: section.title,
        count: card.count,
        priorityRank: card.priorityRank,
      })),
    )
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .slice(0, 4)

  return (
    <div className="space-y-6">
      <PageHeader
        title="岗位工作台"
        description="按岗位聚合待办，优先收口收货、出库、库存和管理异常。"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>
              打开异常工作台
            </Button>
            <Button variant="outline" onClick={() => openPath('/reports/warehouse-ops', '仓库运营看板')}>
              打开仓库运营看板
            </Button>
            <Button onClick={() => refetch()}>立即刷新</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="总待办" value={summary?.totalAlerts ?? 0} hint="岗位工作台全部卡片合计" />
        <StatCard label="仓库角色" value={summary?.warehouseCount ?? 0} hint="收货、上架、审核、补打" />
        <StatCard label="销售/客服" value={summary?.saleCount ?? 0} hint="出库、异常销售、低于进价" />
        <StatCard label="管理角色" value={summary?.managementCount ?? 0} hint="审核、异常任务、库存风险" />
      </div>

      <FocusModePanel
        badge="跨页协同"
        title="岗位工作台负责决定今天先处理什么"
        description="这里先确定优先级和处理顺序；遇到异常就去异常工作台，涉及财务 / 系统提醒就去审批与提醒，想看整体风险再去作业绩效页。"
        summary={`当前总待办 ${summary?.totalAlerts ?? 0} 项`}
        steps={[
          '先按今日处理顺序执行待办',
          '异常堵点切到异常工作台',
          '经营风险和趋势切到审批或绩效页',
        ]}
        actions={[
          { label: '打开异常工作台', onClick: () => openPath('/reports/exception-workbench', '异常工作台') },
          { label: '打开审批与提醒', variant: 'outline', onClick: () => openPath('/reports/approvals', '审批与提醒') },
          { label: '打开仓库运营看板', variant: 'outline', onClick: () => openPath('/reports/warehouse-ops', '仓库运营看板') },
        ]}
      />

      {topAlert && (
        <PriorityBanner
          title={topAlert.title}
          description={topAlert.description}
          count={topAlert.count}
          sectionTitle={topAlert.sectionTitle}
          badge={topAlert.badge}
          priorityLabel={topAlert.priorityLabel}
          onOpen={() => openPath(topAlert.path, topAlert.title)}
        />
      )}

      {!isLoading && !isError && focusQueue.length > 0 && (
        <FocusQueue items={focusQueue} onOpen={openPath} />
      )}

      {isLoading && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="h-72 animate-pulse rounded-2xl border border-border bg-muted/40" />
          <div className="h-72 animate-pulse rounded-2xl border border-border bg-muted/40" />
        </div>
      )}

      {isError && !data && (
        <QueryErrorState
          error={error}
          onRetry={() => void refetch()}
          title="岗位工作台加载失败"
          description="当前岗位待办暂时无法加载，请点击重试或稍后再试"
          compact
        />
      )}

      {!isLoading && !isError && sections.length > 0 && (
        <div className="space-y-6">
          {sections.map(section => (
            <section key={section.key} className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-section-title">{section.title}</h2>
                    <Badge variant="outline" className="rounded-full border-border/60 bg-white/90 px-2 text-[10px] text-muted-foreground">
                      区块 P{section.priorityRank / 10}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openPath('/reports/exception-workbench', '异常工作台')}>
                  查看异常工作台
                </Button>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {section.cards
                  .slice()
                  .sort((a, b) => a.priorityRank - b.priorityRank)
                  .map(card => (
                  <CardView key={card.key} card={card} onOpen={openPath} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!isLoading && !isError && !sections.length && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          暂无岗位工作台数据
        </div>
      )}
    </div>
  )
}
