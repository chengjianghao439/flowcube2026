import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { ExecutionBridgePanel } from '@/components/shared/ExecutionBridgePanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSettingsApi, updateSettingsApi } from '@/api/settings'
import { toast } from '@/lib/toast'

const LEVELS = [
  { key: 'price_rate_a', code: 'A', color: 'text-blue-600' },
  { key: 'price_rate_b', code: 'B', color: 'text-emerald-600' },
  { key: 'price_rate_c', code: 'C', color: 'text-orange-600' },
  { key: 'price_rate_d', code: 'D', color: 'text-rose-600' },
] as const

export default function PriceListsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => getSettingsApi().then(r => r.data.data!) })
  const save = useMutation({
    mutationFn: updateSettingsApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('价格等级比例已保存')
    },
  })

  const [form, setForm] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!data?.list) return
    const next: Record<string, string> = {}
    for (const item of data.list) {
      if (item.key_name.startsWith('price_rate_')) next[item.key_name] = item.value ?? ''
    }
    setForm(next)
  }, [data])

  const previewCost = Number(form.preview_cost || 100)
  const previews = useMemo(() => {
    return LEVELS.map(level => {
      const rate = Number(form[level.key] || 0)
      const price = Number.isFinite(rate) ? (previewCost * (1 + rate / 100)).toFixed(2) : '0.00'
      return { ...level, rate, price }
    })
  }, [form, previewCost])

  const payload = useMemo(() => {
    const next: Record<string, string> = {}
    for (const level of LEVELS) next[level.key] = form[level.key] ?? ''
    return next
  }, [form])

  return (
    <div className="space-y-4">
      <PageHeader
        title="价格管理"
        description="商品默认生成 4 个价格，客户绑定价格 A / B / C / D，销售单自动带入对应价格。"
        actions={<Button onClick={() => save.mutate(payload)} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存比例'}</Button>}
      />

      <FocusModePanel
        badge="主数据闭环"
        title="价格页负责维护四档价规则，并把应用动作交给客户、销售和利润分析"
        description="这页最适合先确认 A / B / C / D 的默认比例，再去客户管理绑定价格等级，最后回销售单和利润分析验证价格策略是否落地。"
        summary="当前焦点：四档价默认比例"
        steps={[
          '先维护四档价比例，保证商品按进价生成的默认等级价口径一致。',
          '再到客户管理绑定默认价格等级，确保销售建单能自动带入正确价格。',
          '最后回销售单和利润分析，确认实际成交价和毛利结果符合预期。',
        ]}
        actions={[
          { label: '打开客户管理', variant: 'default', onClick: () => navigate('/customers') },
          { label: '打开销售单', onClick: () => navigate('/sale') },
          { label: '打开利润分析', onClick: () => navigate('/reports/profit-analysis') },
        ]}
      />

      <ExecutionBridgePanel
        badge="ERP / 处理执行桥接"
        title="价格页统一承接价格策略判断与经营落地动作"
        description="ERP 在这里负责判断四档价比例、默认策略和毛利目标是否合理；实际落地则通过客户绑定、销售建单和利润分析验证完成，避免价格页只停在配置层。"
        erpTitle="先在 ERP 判断价格规则、等级策略和毛利目标"
        erpItems={[
          '先确认 A / B / C / D 四档价比例是否符合当前经营策略和毛利目标。',
          '变更比例前，优先评估对客户等级绑定和销售成交价的影响。',
          '保存后再决定回客户管理、销售单还是利润分析验证实际效果。',
        ]}
        pdaTitle="再通过经营处理入口验证价格是否真正落地"
        pdaItems={[
          '先到客户管理绑定默认价格等级，让客户进入正确价格体系。',
          '再回销售单验证价格自动带入是否正确，避免现场临时改价。',
          '最后通过利润分析确认成交价格和毛利结果是否与策略一致。',
        ]}
        actions={[
          { label: '打开客户管理', variant: 'default', onClick: () => navigate('/customers') },
          { label: '打开销售单', onClick: () => navigate('/sale') },
          { label: '打开利润分析', onClick: () => navigate('/reports/profit-analysis') },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="card-base space-y-4 p-5">
          <div className="border-b border-border/50 pb-3">
            <h3 className="text-card-title">默认价格比例</h3>
            <p className="text-helper mt-1">按商品进价自动生成价格 A / B / C / D。</p>
          </div>

          {LEVELS.map(level => (
            <div key={level.key} className="grid grid-cols-[72px_1fr_44px] items-center gap-3">
              <Label className={`font-semibold ${level.color}`}>价格{level.code}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form[level.key] ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, [level.key]: e.target.value }))}
                disabled={isLoading || save.isPending}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ))}
        </div>

        <div className="card-base space-y-4 p-5">
          <div className="border-b border-border/50 pb-3">
            <h3 className="text-card-title">价格预览</h3>
            <p className="text-helper mt-1">输入一个进价，实时预览 4 个默认价格。</p>
          </div>

          <div className="max-w-xs space-y-1.5">
            <Label>预览进价</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.preview_cost ?? '100'}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, preview_cost: e.target.value }))}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {previews.map(item => (
              <div key={item.key} className="rounded-xl border border-border bg-muted/20 p-4">
                <p className={`text-sm font-semibold ${item.color}`}>价格{item.code}</p>
                <p className="mt-2 text-2xl font-bold">¥{item.price}</p>
                <p className="mt-1 text-xs text-muted-foreground">进价 + {Number.isFinite(item.rate) ? item.rate : 0}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
