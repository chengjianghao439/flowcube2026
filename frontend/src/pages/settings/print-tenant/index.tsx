/**
 * 多租户打印：配额、策略配置、监控看板
 * 路由：/settings/print-tenant
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  getPrintTenantDashboard,
  getPrintTenantSettings,
  putPrintTenantSettings,
  getPrintTenantsOverview,
  getPrintPolicyTemplates,
  applyPrintPolicyTemplate,
  getPrintTenantBilling,
  getPrintAlerts,
  ackPrintAlert,
  type TenantSettingsPayload,
  type PolicyTemplateItem,
} from '@/api/printTenant'
import { toast } from '@/lib/toast'

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function Panel({
  title,
  desc,
  children,
  className = '',
}: {
  title: string
  desc?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border bg-card p-6 shadow-sm ${className}`}>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function PrintTenantSettingsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.roleId === 1
  const qc = useQueryClient()

  const [editTenantId, setEditTenantId] = useState<string>(() => String(user?.tenantId ?? 0))

  const dashboardQ = useQuery({
    queryKey: ['print-tenant-dashboard', isAdmin ? editTenantId : user?.tenantId],
    queryFn: () =>
      getPrintTenantDashboard({
        ...(isAdmin && editTenantId !== '' ? { tenantId: Number(editTenantId) } : {}),
        windowDays: 7,
      }),
  })

  const settingsQ = useQuery({
    queryKey: ['print-tenant-settings', isAdmin ? editTenantId : user?.tenantId],
    queryFn: () =>
      getPrintTenantSettings(isAdmin && editTenantId !== '' ? { tenantId: Number(editTenantId) } : undefined),
  })

  const overviewQ = useQuery({
    queryKey: ['print-tenants-overview'],
    queryFn: () => getPrintTenantsOverview(7),
    enabled: isAdmin,
  })

  const templatesQ = useQuery({
    queryKey: ['print-policy-templates'],
    queryFn: getPrintPolicyTemplates,
  })

  const billingQ = useQuery({
    queryKey: ['print-tenant-billing', isAdmin ? editTenantId : user?.tenantId],
    queryFn: () =>
      getPrintTenantBilling(
        isAdmin && editTenantId !== '' ? { tenantId: Number(editTenantId), months: 18 } : { months: 18 },
      ),
  })

  const alertsQ = useQuery({
    queryKey: ['print-alerts', isAdmin ? editTenantId : user?.tenantId],
    queryFn: () =>
      getPrintAlerts({
        tenantId: isAdmin && editTenantId !== '' ? Number(editTenantId) : undefined,
        limit: 40,
        unackOnly: false,
      }),
  })

  const [form, setForm] = useState<TenantSettingsPayload>({})

  useEffect(() => {
    const s = settingsQ.data?.settings
    if (!s) return
    setForm({
      maxQueueJobs: s.maxQueueJobs ?? null,
      maxConcurrentPrinting: s.maxConcurrentPrinting ?? null,
      explorationMode: (s.explorationMode as 'adaptive' | 'fixed') || 'adaptive',
      explorationRate: s.explorationRate ?? null,
      explorationMin: s.explorationMin ?? null,
      explorationMax: s.explorationMax ?? null,
      explorationBase: s.explorationBase ?? null,
      explorationKErr: s.explorationKErr ?? null,
      explorationKLat: s.explorationKLat ?? null,
      explorationLatNormMs: s.explorationLatNormMs ?? null,
      weightErr: s.weightErr ?? null,
      weightLat: s.weightLat ?? null,
      weightHb: s.weightHb ?? null,
      latScoreScaleMs: s.latScoreScaleMs ?? null,
      monthlyPrintQuota: s.monthlyPrintQuota ?? null,
      policyTemplate: s.policyTemplate ?? null,
    })
  }, [settingsQ.data])

  const applyTplMut = useMutation({
    mutationFn: (template: PolicyTemplateItem['key']) =>
      applyPrintPolicyTemplate({
        template,
        tenantId: isAdmin ? Number(editTenantId) : undefined,
      }),
    onSuccess: () => {
      toast.success('已应用策略模板')
      void qc.invalidateQueries({ queryKey: ['print-tenant-settings'] })
      void qc.invalidateQueries({ queryKey: ['print-tenant-dashboard'] })
    },
  })

  const ackMut = useMutation({
    mutationFn: ackPrintAlert,
    onSuccess: () => {
      toast.success('已确认告警')
      void qc.invalidateQueries({ queryKey: ['print-alerts'] })
    },
  })

  const saveMut = useMutation({
    mutationFn: () =>
      putPrintTenantSettings({
        ...form,
        tenantId: isAdmin ? Number(editTenantId) : undefined,
      }),
    onSuccess: () => {
      toast.success('已保存')
      void qc.invalidateQueries({ queryKey: ['print-tenant-settings'] })
      void qc.invalidateQueries({ queryKey: ['print-tenant-dashboard'] })
      void qc.invalidateQueries({ queryKey: ['print-tenants-overview'] })
    },
  })

  const d = dashboardQ.data

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="打印租户运营" subtitle="队列配额、并发上限、探索率与调度权重、监控指标" />

      {isAdmin && (
        <Panel
          title="管理范围"
          desc="管理员可指定 tenantId 查看/编辑任意租户；与「用户管理」中的租户 ID 一致。"
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>租户 ID</Label>
              <Input
                className="w-40"
                value={editTenantId}
                onChange={(e) => setEditTenantId(e.target.value)}
                placeholder="0"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void dashboardQ.refetch()
                void settingsQ.refetch()
                void overviewQ.refetch()
                void billingQ.refetch()
                void alertsQ.refetch()
              }}
            >
              刷新
            </Button>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Panel title="队列长度">
          <div className="text-2xl font-semibold">{d?.queueLength ?? '—'}</div>
          <p className="text-xs text-muted-foreground mt-1">
            排队 {d?.pendingCount ?? 0} / 打印中 {d?.printingCount ?? 0}
          </p>
        </Panel>
        <Panel title={`成功率（${d?.windowDays ?? 7} 天）`}>
          <div className="text-2xl font-semibold">{pct(d?.successRate ?? null)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            完成 {d?.doneCount ?? 0} / 失败 {d?.failedCount ?? 0}
          </p>
        </Panel>
        <Panel title="平均延迟">
          <div className="text-2xl font-semibold">
            {d?.avgLatencyMs != null ? `${d.avgLatencyMs} ms` : '—'}
          </div>
          <p className="text-xs text-muted-foreground mt-1">下发 → 确认完成</p>
        </Panel>
        <Panel title="配额使用">
            <div className="text-sm">
              队列上限 {d?.quotas.maxQueueJobs ?? '∞'} · 并发上限 {d?.quotas.maxConcurrentPrinting ?? '∞'} ·
              月度印量 {d?.quotas.monthlyPrintQuota ?? '∞'}
            </div>
            {d?.quotas.policyTemplate && (
              <p className="text-xs text-muted-foreground mt-1">策略模板：{d.quotas.policyTemplate}</p>
            )}
          <p className="text-xs text-muted-foreground mt-2">
            队列占用 {pct(d?.quotas.queueUtilization ?? null)} · 并发占用{' '}
            {pct(d?.quotas.concurrentUtilization ?? null)}
          </p>
        </Panel>
      </div>

      {isAdmin && overviewQ.data && overviewQ.data.length > 0 && (
        <Panel title="全租户概览" desc="近 7 天有任务或已配置的租户">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">租户</th>
                  <th className="py-2 pr-4">队列</th>
                  <th className="py-2 pr-4">成功率</th>
                  <th className="py-2 pr-4">平均延迟</th>
                </tr>
              </thead>
              <tbody>
                {overviewQ.data.map((row) => (
                  <tr key={row.tenantId} className="border-b border-border/60">
                    <td className="py-2 pr-4">{row.tenantId}</td>
                    <td className="py-2 pr-4">{row.queueLength}</td>
                    <td className="py-2 pr-4">{pct(row.successRate)}</td>
                    <td className="py-2 pr-4">{row.avgLatencyMs != null ? `${row.avgLatencyMs} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {isAdmin && templatesQ.data && templatesQ.data.length > 0 && (
        <Panel
          title="策略模板"
          desc="一键写入探索率与调度权重；仍可在下方微调后保存。"
        >
          <div className="flex flex-wrap gap-2">
            {templatesQ.data.map((t) => (
              <Button
                key={t.key}
                type="button"
                variant="outline"
                size="sm"
                disabled={applyTplMut.isPending}
                title={t.description}
                onClick={() => applyTplMut.mutate(t.key)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="月度计费统计" desc="按成功完成打印任务累计（单数 + 份数 copies）">
        <p className="text-sm text-muted-foreground mb-2">
          当前账期：{billingQ.data?.currentYearMonth ?? '—'}
        </p>
        <div className="overflow-x-auto max-w-3xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">月份</th>
                <th className="py-2 pr-4">成功单数</th>
                <th className="py-2 pr-4">印量（份）</th>
              </tr>
            </thead>
            <tbody>
              {(billingQ.data?.months ?? []).map((row) => (
                <tr key={row.yearMonth} className="border-b border-border/60">
                  <td className="py-2 pr-4">{row.yearMonth}</td>
                  <td className="py-2 pr-4">{row.jobCount}</td>
                  <td className="py-2 pr-4">{row.copyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!billingQ.data?.months?.length && (
            <p className="text-sm text-muted-foreground py-2">暂无汇总数据（完成打印后自动生成）</p>
          )}
        </div>
      </Panel>

      <Panel title="运营告警" desc="成功率下降、队列积压、打印机异常率偏高（约每 7 分钟巡检）">
        <div className="overflow-x-auto max-w-4xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">时间</th>
                <th className="py-2 pr-4">级别</th>
                <th className="py-2 pr-4">类型</th>
                <th className="py-2 pr-4">说明</th>
                <th className="py-2 pr-4 w-24" />
              </tr>
            </thead>
            <tbody>
              {(alertsQ.data ?? []).map((a) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="py-2 pr-4 whitespace-nowrap">{String(a.createdAt).slice(0, 19)}</td>
                  <td className="py-2 pr-4">{a.severity}</td>
                  <td className="py-2 pr-4">{a.alertType}</td>
                  <td className="py-2 pr-4">{a.message}</td>
                  <td className="py-2 pr-4">
                    {!a.acknowledgedAt ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={ackMut.isPending}
                        onClick={() => ackMut.mutate(a.id)}
                      >
                        确认
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">已确认</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!alertsQ.data?.length && (
            <p className="text-sm text-muted-foreground py-2">暂无告警</p>
          )}
        </div>
      </Panel>

      <Panel
        title="策略与配额"
        desc={
          isAdmin
            ? '仅管理员可保存。空值表示不限制或继承环境变量默认。'
            : '仅管理员可修改策略；当前页可查看本租户监控。'
        }
      >
        <div className="space-y-4 max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>最大队列（排队+打印中）</Label>
              <Input
                type="number"
                min={1}
                placeholder="不限制"
                value={form.maxQueueJobs ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maxQueueJobs: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label>最大并发打印</Label>
              <Input
                type="number"
                min={1}
                placeholder="不限制"
                value={form.maxConcurrentPrinting ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maxConcurrentPrinting: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>月度印量上限（份数口径，含在途排队）</Label>
              <Input
                type="number"
                min={1}
                placeholder="不限制"
                value={form.monthlyPrintQuota ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    monthlyPrintQuota: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                disabled={!isAdmin}
              />
              <p className="text-xs text-muted-foreground">
                自然月内「已成功印量 + 本月创建且未完成的 copies」不得超过此值；429 时会返回剩余额度。
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>探索模式</Label>
              <Select
                value={form.explorationMode ?? 'adaptive'}
                onValueChange={v =>
                  setForm((f) => ({ ...f, explorationMode: v as 'adaptive' | 'fixed' }))
                }
                disabled={!isAdmin}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adaptive">自适应</SelectItem>
                  <SelectItem value="fixed">固定探索率</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>固定探索率（0~1）</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={1}
                placeholder="fixed 模式使用"
                value={form.explorationRate ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    explorationRate: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                disabled={!isAdmin}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">自适应参数（可空 = 继承环境变量 PRINT_EXPLORATION_*）</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['explorationMin', '下界'],
                ['explorationMax', '上界'],
                ['explorationBase', '基准'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form[k] ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [k]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  disabled={!isAdmin}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['explorationKErr', 'K_err'],
                ['explorationKLat', 'K_lat'],
                ['explorationLatNormMs', '延迟归一 ms'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  step={k === 'explorationLatNormMs' ? 1 : 0.01}
                  value={form[k] ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [k]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  disabled={!isAdmin}
                />
              </div>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">调度权重（可空 = 环境变量 PRINT_SCORE_W_*）</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['weightErr', '错误率权重'],
                ['weightLat', '延迟权重'],
                ['weightHb', '心跳权重'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-2">
                <Label>{label}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form[k] ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [k]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  disabled={!isAdmin}
                />
              </div>
            ))}
          </div>
          <div className="space-y-2 max-w-xs">
            <Label>延迟分衰减尺度（ms）</Label>
            <Input
              type="number"
              value={form.latScoreScaleMs ?? ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  latScoreScaleMs: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
              disabled={!isAdmin}
            />
          </div>

          {isAdmin && (
            <Button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? '保存中…' : '保存配置'}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}
