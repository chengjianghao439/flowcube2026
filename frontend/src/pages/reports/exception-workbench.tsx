import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getSystemAutoFixTypesApi,
  getSystemHealthLogsApi,
  getSystemHealthRunsApi,
  runSystemAutoFixApi,
  runSystemHealthApi,
  type SystemHealthIssue,
  type SystemHealthLog,
} from '@/api/system'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { toast } from '@/lib/toast'

function severityBadge(level: string) {
  if (level === 'high' || level === 'danger') return <Badge variant="destructive">高风险</Badge>
  if (level === 'medium' || level === 'warning') return <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">中风险</Badge>
  if (level === 'fix_failed') return <Badge variant="destructive">修复失败</Badge>
  return <Badge variant="outline">低风险</Badge>
}

function detectActionTarget(issue: Pick<SystemHealthIssue, 'checkType' | 'relatedTable'> | Pick<SystemHealthLog, 'check_type' | 'related_table'>) {
  const checkType = 'checkType' in issue ? issue.checkType : issue.check_type
  const table = 'relatedTable' in issue ? issue.relatedTable : issue.related_table

  if (checkType === 'ORPHANED_RESERVATION' || checkType === 'CONFIRMED_SALE_NO_RESERVATION') {
    return { path: '/sale', title: '销售管理', actionLabel: '查看销售单' }
  }
  if (checkType === 'HIGH_PRIORITY_TASK_DELAY' || checkType === 'SHIPPED_TASK_UNSYNCED_SALE' || table === 'warehouse_tasks') {
    return { path: '/warehouse-tasks', title: '仓库任务', actionLabel: '查看仓库任务' }
  }
  if (checkType === 'ORPHANED_SORTING_BIN' || table === 'sorting_bins') {
    return { path: '/sorting-bins', title: '分拣格管理', actionLabel: '查看分拣格' }
  }
  if (checkType === 'ORPHANED_CONTAINER_LOCK' || table === 'inventory_containers') {
    return { path: '/inventory', title: '库存管理', actionLabel: '查看库存' }
  }
  if (checkType === 'LONG_PENDING_RESERVATION' || checkType === 'RESERVED_EXCEEDS_ON_HAND' || checkType === 'NEGATIVE_ON_HAND') {
    return { path: '/inventory/overview', title: '库存总览', actionLabel: '查看库存总览' }
  }
  return { path: '/reports/pda-anomaly', title: 'PDA 异常分析', actionLabel: '查看异常分析' }
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-helper">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-helper">{hint}</p>}
    </div>
  )
}

export default function ExceptionWorkbenchPage() {
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const qc = useQueryClient()

  const runsQ = useQuery({
    queryKey: ['system-health-runs'],
    queryFn: () => getSystemHealthRunsApi(12).then(r => r.data.data ?? []),
  })
  const logsQ = useQuery({
    queryKey: ['system-health-logs'],
    queryFn: () => getSystemHealthLogsApi(80).then(r => r.data.data ?? []),
  })
  const autoFixTypesQ = useQuery({
    queryKey: ['system-health-autofix-types'],
    queryFn: () => getSystemAutoFixTypesApi().then(r => r.data.data ?? []),
  })

  const runHealthMut = useMutation({
    mutationFn: () => runSystemHealthApi().then(r => r.data.data!),
    onSuccess: (data) => {
      toast.success(data.healthy ? '巡检完成，当前未发现异常' : `巡检完成，发现 ${data.totalIssues} 项异常`)
      qc.invalidateQueries({ queryKey: ['system-health-runs'] })
      qc.invalidateQueries({ queryKey: ['system-health-logs'] })
      qc.setQueryData(['system-health-latest-run'], data)
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '巡检失败')
    },
  })

  const autoFixMut = useMutation({
    mutationFn: () => runSystemAutoFixApi().then(r => r.data.data!),
    onSuccess: (data) => {
      toast.success(data.fixedCount > 0 ? `自动修复完成，共修复 ${data.fixedCount} 项` : '没有发现可自动修复的异常')
      qc.invalidateQueries({ queryKey: ['system-health-logs'] })
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '自动修复失败')
    },
  })

  const latestRun = useMemo(() => {
    const cache = qc.getQueryData<Awaited<ReturnType<typeof runSystemHealthApi>>['data']['data']>(['system-health-latest-run'])
    return cache ?? null
  }, [qc, runHealthMut.status])

  const latestSummary = runsQ.data?.[0]
  const recentLogs = logsQ.data ?? []
  const latestIssues = latestRun?.issues ?? []
  const highCount = latestRun?.severity.high ?? latestSummary?.severity.high ?? 0
  const mediumCount = latestRun?.severity.medium ?? latestSummary?.severity.medium ?? 0
  const lowCount = latestRun?.severity.low ?? latestSummary?.severity.low ?? 0

  function openPath(path: string, title: string) {
    addTab({ key: path, title, path })
    navigate(path)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="异常工作台"
        description="集中查看系统巡检、自动修复、打印失败与仓库流程异常，并直接跳转处理。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => openPath('/settings/barcode-print-query', '条码打印查询')}
            >
              打开补打中心
            </Button>
            <Button
              variant="outline"
              onClick={() => openPath('/reports/pda-anomaly', 'PDA 异常分析')}
            >
              查看 PDA 异常
            </Button>
            <Button onClick={() => runHealthMut.mutate()} disabled={runHealthMut.isPending}>
              {runHealthMut.isPending ? '巡检中…' : '立即巡检'}
            </Button>
            <Button variant="secondary" onClick={() => autoFixMut.mutate()} disabled={autoFixMut.isPending}>
              {autoFixMut.isPending ? '修复中…' : '自动修复'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="高风险异常" value={highCount} hint="需优先处理" />
        <StatCard label="中风险异常" value={mediumCount} hint="建议尽快排查" />
        <StatCard label="低风险异常" value={lowCount} hint="可集中收口" />
        <StatCard
          label="最近巡检"
          value={latestSummary ? new Date(latestSummary.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '未执行'}
          hint={latestSummary ? `耗时 ${latestSummary.elapsedMs}ms` : '点击立即巡检'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-card-title">最新巡检结果</h2>
              <p className="text-muted-body">这里优先展示本次巡检发现的问题，并给出处理入口。</p>
            </div>
            {latestRun && (
              <Badge variant={latestRun.healthy ? 'outline' : latestRun.hasHigh ? 'destructive' : 'secondary'}>
                {latestRun.healthy ? '健康' : `异常 ${latestRun.totalIssues}`}
              </Badge>
            )}
          </div>

          {latestIssues.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-body">
              {runHealthMut.isPending ? '正在执行巡检…' : '暂无最新巡检结果，或最近一次巡检未发现异常'}
            </div>
          ) : (
            <div className="space-y-3">
              {latestIssues.map((issue, idx) => {
                const target = detectActionTarget(issue)
                return (
                  <div key={`${issue.checkType}-${issue.relatedId ?? idx}`} className="rounded-xl border border-border p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {severityBadge(issue.severity)}
                      <span className="font-medium text-foreground">{issue.checkType}</span>
                      {issue.relatedTable && (
                        <span className="text-helper">
                          {issue.relatedTable}{issue.relatedId ? ` #${issue.relatedId}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{issue.message}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openPath(target.path, target.title)}>
                        {target.actionLabel}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openPath('/reports/pda-anomaly', 'PDA 异常分析')}>
                        查看异常分析
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-card-title">自动修复范围</h2>
            <p className="text-muted-body">当前系统只会自动修复孤立资源类问题，不会直接改业务结果。</p>
          </div>
          <div className="space-y-3">
            {(autoFixTypesQ.data ?? []).map(item => (
              <div key={item.checkType} className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{item.checkType}</p>
                  <Badge variant={item.risk === 'medium' ? 'secondary' : 'outline'}>
                    风险 {item.risk}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-body">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-card-title">最近巡检批次</h2>
            <p className="text-muted-body">方便判断异常是新出现还是长期遗留。</p>
          </div>
          <div className="space-y-3">
            {(runsQ.data ?? []).map(run => (
              <div key={run.runId} className="rounded-xl border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={run.hasHigh ? 'destructive' : run.totalIssues > 0 ? 'secondary' : 'outline'}>
                    {run.totalIssues === 0 ? '正常' : `${run.totalIssues} 项`}
                  </Badge>
                  <span className="font-medium text-foreground">{new Date(run.checkedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  <span className="text-helper">来源：{run.triggeredBy}</span>
                </div>
                <p className="mt-1 text-muted-body">
                  高 {run.severity.high} / 中 {run.severity.medium} / 低 {run.severity.low}，耗时 {run.elapsedMs}ms
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">最近异常日志</h2>
              <p className="text-muted-body">包含巡检发现与自动修复记录，可直接跳到处理页。</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => openPath('/settings/barcode-print-query', '条码打印查询')}>
              打开补打查询
            </Button>
          </div>
          <div className="space-y-3">
            {recentLogs.map(log => {
              const target = detectActionTarget(log)
              return (
                <div key={log.id} className="rounded-xl border border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {severityBadge(log.severity)}
                    <span className="font-medium text-foreground">{log.check_type}</span>
                    <span className="text-helper">
                      {new Date(log.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-foreground">{log.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openPath(target.path, target.title)}>
                      {target.actionLabel}
                    </Button>
                    {log.check_type.includes('RESERVATION') && (
                      <Button size="sm" variant="ghost" onClick={() => autoFixMut.mutate()} disabled={autoFixMut.isPending}>
                        自动修复
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
