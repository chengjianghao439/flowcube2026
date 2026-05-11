/**
 * ProductFormPage — 商品新建 / 编辑页面（独立路由）
 *
 * 路由：
 *   /products/new    → 新建模式
 *   /products/:id    → 编辑模式
 */

import { useState, useContext, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar } from '@/components/shared/ActionBar'
import { useProduct, useCreateProduct, useUpdateProduct } from '@/hooks/useProducts'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { getSettingsApi } from '@/api/settings'
import { CategoryFinder, SupplierFinder, FinderTrigger } from '@/components/finder'
import type { FinderResult } from '@/types/finder'

const DEFAULT_RATES = { A: 10, B: 20, C: 30, D: 40 }
const EMPTY_FORM = { name: '', categoryId: null as number | null, supplierId: null as number | null, unit: '', spec: '', color: '', costPrice: '' as string, salePriceA: '' as string, salePriceB: '' as string, salePriceC: '' as string, salePriceD: '' as string, remark: '', articleNumber: '', isActive: true }

function profitRate(cost: number, sale: number): number | null {
  if (sale <= 0 || !Number.isFinite(cost) || !Number.isFinite(sale)) return null
  return Math.round((sale - cost) / sale * 10000) / 100
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5">
      <h3 className="text-section-title mb-4 pb-2 border-b border-border/50">{title}</h3>
      {children}
    </div>
  )
}

export default function ProductFormPage() {
  const tabPath = useContext(TabPathContext) || ''
  const isNew = tabPath === '/products/new'
  const editId = isNew ? null : Number(tabPath.split('/').pop())
  const isEdit = !!editId

  const navigate = useNavigate()
  const { removeTab } = useWorkspaceStore()
  const [submitting, setSubmitting] = useState(false)

  const { data: product, isLoading } = useProduct(editId || 0)

  const [categoryFinderOpen, setCategoryFinderOpen] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [priceRates, setPriceRates] = useState(DEFAULT_RATES)

  useEffect(() => {
    getSettingsApi().then(r => {
      const map = r?.map ?? {}
      setPriceRates({
        A: Number(map.price_rate_a?.value ?? DEFAULT_RATES.A),
        B: Number(map.price_rate_b?.value ?? DEFAULT_RATES.B),
        C: Number(map.price_rate_c?.value ?? DEFAULT_RATES.C),
        D: Number(map.price_rate_d?.value ?? DEFAULT_RATES.D),
      })
    }).catch(() => {})
  }, [])

  const initialForm = useMemo(() => {
    if (product && isEdit) {
      return {
        name: product.name,
        categoryId: product.categoryId,
        supplierId: product.supplierId,
        unit: product.unit,
        spec: product.spec ?? '',
        color: product.color ?? '',
        costPrice: product.costPrice != null ? String(product.costPrice) : '',
        salePriceA: product.salePriceA != null ? String(product.salePriceA) : '',
        salePriceB: product.salePriceB != null ? String(product.salePriceB) : '',
        salePriceC: product.salePriceC != null ? String(product.salePriceC) : '',
        salePriceD: product.salePriceD != null ? String(product.salePriceD) : '',
        remark: product.remark ?? '',
        articleNumber: product.articleNumber ?? '',
        isActive: product.isActive,
      }
    }
    return EMPTY_FORM
  }, [product, isEdit])

  const [form, setForm] = useState(initialForm)
  const formRef = useRef(form)
  formRef.current = form

  useEffect(() => {
    if (product && isEdit) {
      setForm(initialForm)
      setCategoryName(product.categoryName || '')
      setSupplierName(product.supplierName || '')
    }
  }, [product, isEdit, initialForm])

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  function handleCategoryConfirm(cat: { id: number; name: string }) {
    set('categoryId', cat.id)
    setCategoryName(cat.name)
  }

  function handleSupplierConfirm(result: FinderResult) {
    set('supplierId', result.id)
    setSupplierName(result.name)
    setSupplierFinderOpen(false)
  }

  const { mutateAsync: create } = useCreateProduct()
  const { mutateAsync: update } = useUpdateProduct()

  useDirtyGuard(
    () => JSON.stringify(formRef.current) !== JSON.stringify(initialForm),
  )

  const priceLevels = [
    { key: 'A', field: 'salePriceA' as const, rate: priceRates.A, color: 'text-blue-600' },
    { key: 'B', field: 'salePriceB' as const, rate: priceRates.B, color: 'text-emerald-600' },
    { key: 'C', field: 'salePriceC' as const, rate: priceRates.C, color: 'text-orange-600' },
    { key: 'D', field: 'salePriceD' as const, rate: priceRates.D, color: 'text-rose-600' },
  ] as const

  async function handleSubmit() {
    if (!form.categoryId) { toast.warning('请选择商品分类'); return }
    if (!form.supplierId) { toast.warning('请选择供应商'); return }
    if (!form.unit.trim()) { toast.warning('请输入单位'); return }
    if (!form.spec.trim()) { toast.warning('请输入型号'); return }
    if (!form.color.trim()) { toast.warning('请输入颜色'); return }
    if (form.costPrice === '' || Number(form.costPrice) <= 0) { toast.warning('请输入大于 0 的进价'); return }
    const toPrice = (v: string) => v !== '' ? Number(v) : undefined
    const d = {
      name: form.name,
      categoryId: form.categoryId || undefined,
      supplierId: form.supplierId!,
      unit: form.unit,
      spec: form.spec,
      color: form.color,
      costPrice: Number(form.costPrice),
      salePriceA: toPrice(form.salePriceA),
      salePriceB: toPrice(form.salePriceB),
      salePriceC: toPrice(form.salePriceC),
      salePriceD: toPrice(form.salePriceD),
      remark: form.remark || undefined,
      articleNumber: form.articleNumber || undefined,
    }
    setSubmitting(true)
    try {
      if (editId) {
        await update({ id: editId, data: { ...d, isActive: form.isActive } })
        toast.success('商品已更新')
      } else {
        await create(d)
        toast.success('商品已创建')
      }
      closeTab()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  function closeTab() {
    const { removeTab: rmTab } = useWorkspaceStore.getState()
    rmTab(tabPath)
    navigate('/products')
  }

  if (isEdit && !product && !isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        商品不存在
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title={isNew ? '新增商品' : '编辑商品'}
        subtitle={isEdit && product ? <span className="text-sm text-muted-foreground">编码：<code className="font-mono">{product.code}</code></span> : undefined}
        rightActions={
          <>

            <Button onClick={handleSubmit} disabled={submitting || !form.name} className="gap-1.5">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />保存中...</> : <><Save className="h-4 w-4" />保存</>}
            </Button>
          </>
        }
      />

      <Section title="基本信息">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>名称 *</Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label>分类 *</Label>
            <FinderTrigger
              value={categoryName}
              placeholder="点击选择分类..."
              onClick={() => setCategoryFinderOpen(true)}
              onDoubleClick={() => { setCategoryFinderOpen(false); navigate('/categories') }}
            />
            <CategoryFinder
              open={categoryFinderOpen}
              onClose={() => setCategoryFinderOpen(false)}
              onConfirm={handleCategoryConfirm}
              value={form.categoryId}
              leafOnly
            />
          </div>
          <div className="space-y-1.5">
            <Label>供应商 *</Label>
            <FinderTrigger
              value={supplierName}
              placeholder="点击选择供应商..."
              onClick={() => setSupplierFinderOpen(true)}
              onDoubleClick={() => { setSupplierFinderOpen(false); navigate('/suppliers') }}
            />
            <SupplierFinder
              open={supplierFinderOpen}
              onClose={() => setSupplierFinderOpen(false)}
              onConfirm={handleSupplierConfirm}
            />
          </div>
          <div className="space-y-1.5">
            <Label>单位 *</Label>
            <Input value={form.unit} onChange={e => set('unit', e.target.value)} disabled={submitting} placeholder="例如：个、箱、kg" />
          </div>
          <div className="space-y-1.5">
            <Label>型号 *</Label>
            <Input value={form.spec} onChange={e => set('spec', e.target.value)} disabled={submitting} maxLength={100} placeholder="产品型号" />
          </div>
          <div className="space-y-1.5">
            <Label>颜色 *</Label>
            <Input value={form.color} onChange={e => set('color', e.target.value)} disabled={submitting} maxLength={30} placeholder="产品颜色" />
          </div>
          <div className="space-y-1.5">
            <Label>货号</Label>
            <Input value={form.articleNumber} onChange={e => set('articleNumber', e.target.value)} disabled={submitting} maxLength={50} placeholder="留空则自动生成6位随机数" />
          </div>
          <div className="space-y-1.5">
            <Label>进价 *</Label>
            <Input type="number" step="0.01" min="0.01" value={form.costPrice} onChange={e => set('costPrice', e.target.value)} disabled={submitting} />
          </div>
        </div>
      </Section>

      <Section title="销售价格">
        <p className="mb-3 text-xs text-muted-foreground">留空则按系统加价比例自动生成（价格A +{priceRates.A}%  B +{priceRates.B}%  C +{priceRates.C}%  D +{priceRates.D}%）。</p>
        <div className="grid grid-cols-2 gap-4">
          {priceLevels.map(item => {
            const cost = Number(form.costPrice || 0)
            const sale = Number(form[item.field] || 0)
            const margin = profitRate(cost, sale)
            return (
              <div key={item.key} className="space-y-1.5">
                <Label className={item.color}>价格{item.key}</Label>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={form[item.field]}
                  onChange={e => set(item.field, e.target.value)}
                  disabled={submitting}
                  placeholder={Number.isFinite(cost) ? (cost * (1 + item.rate / 100)).toFixed(2) : '0.00'}
                />
                {margin != null && (
                  <p className={`text-xs ${margin >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                    利润率 {margin}%
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="其他">
        <div className="space-y-1.5">
          <Label>备注</Label>
          <LimitedInput maxLength={30} value={form.remark} onChange={e => set('remark', e.target.value)} disabled={submitting} />
        </div>
        {isEdit && (
          <div className="mt-4 flex items-center gap-2">
            <input type="checkbox" id="pd-active" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="accent-primary" />
            <Label htmlFor="pd-active" className="cursor-pointer">启用</Label>
          </div>
        )}
      </Section>
    </div>
  )
}
