import { SectionCard } from '@/components/shared/SectionCard'
/**
 * ProductFormPage — 商品新建 / 编辑页面（独立路由）
 *
 * 路由：
 *   /products/new    → 新建模式
 *   /products/:id    → 编辑模式
 */

import { useState, useContext, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { toast } from '@/lib/toast'
import { qtyStep } from '@/lib/qtyStep'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { ActionBar } from '@/components/shared/ActionBar'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { useProduct, useCreateProduct, useUpdateProduct } from '@/hooks/useProducts'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { getSettingsApi } from '@/api/settings'
import { CategoryFinder, SupplierFinder } from '@/components/finder'
import { PickerField } from '@/components/shared/PickerField'
import type { FinderResult } from '@/types/finder'

const DEFAULT_RATES = { A: 10, B: 20, C: 30, D: 40 }
type AuxUnit = { unitName: string; conversionRate: string }
const EMPTY_FORM = { name: '', categoryId: null as number | null, supplierId: null as number | null, unit: '', spec: '', color: '', costPrice: '' as string, salePriceA: '' as string, salePriceB: '' as string, salePriceC: '' as string, salePriceD: '' as string, remark: '', articleNumber: '', batchManaged: false, allowDecimalQty: true, shelfLifeDays: '' as string, safetyStock: '' as string, reorderPoint: '' as string, isActive: true, units: [] as AuxUnit[] }

function profitRate(cost: number, sale: number): number | null {
  if (sale <= 0 || !Number.isFinite(cost) || !Number.isFinite(sale)) return null
  return Math.round((sale - cost) / sale * 10000) / 100
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <SectionCard title={title} compact>{children}</SectionCard>
}

export default function ProductFormPage() {
  const tabPath = useContext(TabPathContext) || ''
  const isNew = tabPath === '/products/new'
  const editId = isNew ? null : Number(tabPath.split('/').pop())
  const isEdit = !!editId

  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  // 编辑页每次真正打开都取一次服务端最新数据（不靠 5min 内的 fresh 缓存，否则关闭重开拿旧 revision）。
  // `isFetchedAfterMount` 用于判断「本次挂载后的取数是否已完成」：在它之前不得用缓存旧值初始化表单。
  const { data: product, isError, refetch, isFetchedAfterMount } =
    useProduct(editId || 0, { refetchOnMount: 'always' })

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

  // 表单初始值 =「本次打开（挂载后首次取数**成功**返回）时的服务端数据」快照。
  // 它与提交基线 revision 同源，并且**不随后台 refetch 变化**：
  //  - 后台刷新不会抹掉未保存草稿；
  //  - 也不会把「服务端数据变了」误判成「用户改过」（原缺陷：拿随 product 重算的初始值比较 isDirty）。
  type FormState = typeof EMPTY_FORM
  const [form, setForm] = useState<FormState>(() => (isEdit ? { ...EMPTY_FORM } : EMPTY_FORM))
  const [baseline, setBaseline] = useState<FormState | null>(isEdit ? null : EMPTY_FORM)
  const formRef = useRef(form)
  formRef.current = form

  // 以「商品 id + 本次取数完成」为界初始化一次。后台 refetch（同一 id）不再进入 ⇒ 草稿与 dirty 基线都保住。
  // 编辑页必须等本次新数据返回后才初始化：不能用 fresh 缓存旧值抢先渲染（否则会拿旧 revision 提交）。
  const initedProductIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isEdit) return
    if (!product || isError || !isFetchedAfterMount) return
    if (initedProductIdRef.current === product.id) return
    const snapshot: FormState = {
      name: product.name,
      categoryId: product.categoryId,
      supplierId: product.supplierId,
      unit: product.unit,
      spec: product.spec ?? '',
      color: product.color ?? '',
      costPrice: product.costPrice != null ? String(product.costPrice) : '',
      batchManaged: !!product.batchManaged,
      allowDecimalQty: product.allowDecimalQty !== false,
      shelfLifeDays: product.shelfLifeDays != null ? String(product.shelfLifeDays) : '',
      safetyStock: product.safetyStock != null ? String(product.safetyStock) : '',
      reorderPoint: product.reorderPoint != null ? String(product.reorderPoint) : '',
      salePriceA: product.salePriceA != null ? String(product.salePriceA) : '',
      salePriceB: product.salePriceB != null ? String(product.salePriceB) : '',
      salePriceC: product.salePriceC != null ? String(product.salePriceC) : '',
      salePriceD: product.salePriceD != null ? String(product.salePriceD) : '',
      remark: product.remark ?? '',
      articleNumber: product.articleNumber ?? '',
      isActive: product.isActive,
      units: (product.units ?? []).filter(u => !u.isBase).map(u => ({ unitName: u.unitName, conversionRate: String(u.conversionRate) })),
    }
    setForm(snapshot)
    setBaseline(snapshot)
    formRevisionRef.current = product.revision   // 与表单初始值同源（见 formRevisionRef 注释）
    setCategoryName(product.categoryName || '')
    setSupplierName(product.supplierName || '')
    initedProductIdRef.current = product.id
  }, [product, isEdit, isError, isFetchedAfterMount])

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  // 辅助计量单位（文档 03）：基本单位即 form.unit（率恒 1），此处维护辅助单位列表
  const addUnit = () => setForm(f => ({ ...f, units: [...f.units, { unitName: '', conversionRate: '' }] }))
  const removeUnit = (i: number) => setForm(f => ({ ...f, units: f.units.filter((_, idx) => idx !== i) }))
  const setUnit = (i: number, k: keyof AuxUnit, v: string) => setForm(f => ({ ...f, units: f.units.map((u, idx) => idx === i ? { ...u, [k]: v } : u) }))

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
  // 版本冲突（迁移 264）：只标记状态，提示条 + 保留草稿；**不**自动刷新详情（会抹草稿）
  const [conflict, setConflict] = useState(false)
  // 编辑基线（迁移 264）：提交用的 revision 必须与 `form` 的初始值**同源**。
  // 若直接用 render 时最新的 `product?.revision`，会出现「query 已后台更新（新 revision）但
  // useEffect 尚未重置表单」的窗口 ⇒ 用**新 revision + 旧草稿值**提交，绕过 CAS。
  // 故把它与 `setForm(initialForm)` 放在同一处设置，提交时读基线而非实时数据。
  const formRevisionRef = useRef<number | undefined>(undefined)

  // 是否改过：与**本次打开时的快照基线**比较；后台 refetch 不改基线，故不会误报「未保存」
  const isDirty = baseline ? JSON.stringify(formRef.current) !== JSON.stringify(baseline) : false
  useDirtyGuard(tabPath, isDirty)

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
      batchManaged: form.batchManaged,
      allowDecimalQty: form.allowDecimalQty,
      shelfLifeDays: form.shelfLifeDays !== '' ? Number(form.shelfLifeDays) : null,
      safetyStock: form.safetyStock !== '' ? Number(form.safetyStock) : null,
      reorderPoint: form.reorderPoint !== '' ? Number(form.reorderPoint) : null,
      salePriceA: toPrice(form.salePriceA),
      salePriceB: toPrice(form.salePriceB),
      salePriceC: toPrice(form.salePriceC),
      salePriceD: toPrice(form.salePriceD),
      remark: form.remark || undefined,
      articleNumber: form.articleNumber || undefined,
      units: form.units.filter(u => u.unitName.trim() !== '').map(u => ({ unitName: u.unitName.trim(), conversionRate: Number(u.conversionRate) })),
    }
    // 编辑乐观锁（迁移 264）：基线未就绪（本次取数尚未成功返回）时**不允许提交**——
    // 类型上 `revision` 必填，运行时若拿到 undefined 会发出错误版本；也不能拿缓存旧值提交。
    if (editId && (!Number.isInteger(formRevisionRef.current) || baseline === null)) {
      toast.warning('商品数据尚未加载完成，请稍候再保存')
      return
    }
    setSubmitting(true)
    try {
      if (editId) {
        // 用**基线 revision**（与表单初始值同源），而不是 render 时的 `product.revision`——
        // 否则「query 后台更新但表单还没重置」时会用新版本提交旧草稿而绕过 CAS。
        await update({ id: editId, data: { ...d, isActive: form.isActive, revision: formRevisionRef.current as number } })
        toast.success('商品已更新')
      } else {
        await create(d)
        toast.success('商品已创建')
      }
      closeTab()
    } catch (e: unknown) {
      // 提示**只由一个入口发**：全局拦截器已按后端 message 统一 `toast.error`
      // （含 409 `PRODUCT_VERSION_CONFLICT` 的「该商品已被他人修改，请刷新后重新编辑」），
      // 这里**不再重复 toast**，否则会双重报错。
      const code = (e as { code?: string } | null)?.code
      if (code === 'PRODUCT_VERSION_CONFLICT') {
        // 版本冲突：**保留草稿**——不关闭页面、**不** invalidate 详情。
        // （刷新详情会让下面的 useEffect 用 initialForm 覆盖未保存的输入。）
        // 只把冲突显式呈现给用户，由他决定复制内容后关闭重开。
        setConflict(true)
        return
      }
      // 其它错误同样交给全局提示，避免双重报错
    } finally {
      setSubmitting(false)
    }
  }

  function closeTab() {
    const { removeTab: rmTab } = useWorkspaceStore.getState()
    rmTab(tabPath)
    navigate('/products')
  }

  // 编辑页：**本次取数成功返回前**不渲染表单——不用 fresh 缓存旧值冒充"最新数据"，
  // 否则用户会以为看到的就是最新价，直接保存又反复 409、无从恢复。
  // 注意 `isFetchedAfterMount` 在**失败后也会变 true**，故必须叠加 `isError` 才拦住错误快照初始化；
  // 且整页错误态只在**尚未拿到基线**时使用——已初始化后后台刷新失败要保持草稿（见下方提示条）。
  if (isEdit && isError && baseline === null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>最新商品信息加载失败，请重试。</p>
        <Button variant="outline" onClick={() => { void refetch() }}>重试</Button>
      </div>
    )
  }
  // 本次取数已完成但仍无数据（接口成功返回空）⇒ 商品不存在；否则视为仍在加载
  if (isEdit && isFetchedAfterMount && !product) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        商品不存在
      </div>
    )
  }
  if (isEdit && (!product || !isFetchedAfterMount)) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />正在加载最新商品数据…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {conflict && (
        // 冲突提示：**保留草稿**（不自动刷新详情，否则会抹掉未保存输入）
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <p className="font-medium text-destructive">该商品已被他人修改，本次修改未保存</p>
          <p className="mt-1 text-xs text-muted-foreground">
            当前填写内容仍在。请先复制需要保留的内容，关闭本页重新打开，核对最新价格后再编辑。
          </p>
        </div>
      )}
      {isEdit && isError && baseline !== null && (
        // 已初始化后的后台刷新失败：**保留当前表单与草稿**，只提示"看到的可能不是最新"，并提供重试。
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <p className="font-medium text-destructive">最新数据刷新失败</p>
          <p className="mt-1 text-xs text-muted-foreground">
            当前填写内容仍在。保存时若提示已被修改，请复制需要保留的内容后关闭重开核对。
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => { void refetch() }}>重试</Button>
        </div>
      )}
      <ActionBar
        title={isNew ? '新增商品' : '编辑商品'}
        subtitle={isEdit || isDirty ? (
          <>
            {isEdit && <EditModeBadge />}
            {isEdit && product
              ? <span className="text-sm text-muted-foreground">编码：<code className="font-mono">{product.code}</code></span>
              : null}
            <UnsavedBadge show={isDirty} />
          </>
        ) : undefined}
        rightActions={
          <>

            <Button onClick={handleSubmit} disabled={submitting || !form.name} className="gap-1.5">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" />保存中…</>
                : <><Save className="h-4 w-4" />{isEdit ? '保存修改' : '保存'}</>}
            </Button>
          </>
        }
      />

      <Section title="基本信息">
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <Label>名称 *</Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label>分类 *</Label>
            <PickerField
              value={categoryName}
              placeholder="点击选择分类…"
              onOpen={() => setCategoryFinderOpen(true)}
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
            <PickerField
              value={supplierName}
              placeholder="点击选择供应商…"
              onOpen={() => setSupplierFinderOpen(true)}
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
            <Input value={form.spec} onChange={e => set('spec', e.target.value)} disabled={submitting} maxLength={100} placeholder="商品型号" />
          </div>
          <div className="space-y-1.5">
            <Label>颜色 *</Label>
            <Input value={form.color} onChange={e => set('color', e.target.value)} disabled={submitting} maxLength={30} placeholder="商品颜色" />
          </div>
          <div className="space-y-1.5">
            <Label>供应商型号</Label>
            <Input value={form.articleNumber} onChange={e => set('articleNumber', e.target.value)} disabled={submitting} maxLength={100} placeholder="供应商给的商品型号（选填）" />
          </div>
          <div className="space-y-1.5">
            <Label>进价 *</Label>
            <Input type="number" step="0.01" min="0.01" value={form.costPrice} onChange={e => set('costPrice', e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label>数量小数</Label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={form.allowDecimalQty}
                onChange={e => set('allowDecimalQty', e.target.checked)} disabled={submitting} />
              <span className="text-muted-foreground">{form.allowDecimalQty ? '最多两位小数（如 1.25 公斤）' : '只能整数（如 3 个、2 台）'}</span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label>批次管理</Label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={form.batchManaged}
                onChange={e => set('batchManaged', e.target.checked)} disabled={submitting} />
              <span className="text-muted-foreground">收货强制录入批次/效期，出库先到期先出</span>
            </label>
          </div>
          {form.batchManaged && (
            <div className="space-y-1.5">
              <Label>保质期天数</Label>
              <Input type="number" min="1" max="3650" value={form.shelfLifeDays}
                onChange={e => set('shelfLifeDays', e.target.value)} disabled={submitting}
                placeholder="效期=生产日期+保质期，留空则收货须直接录效期" />
            </div>
          )}
        </div>
      </Section>

      <Section title="计量单位">
        <p className="mb-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{form.unit.trim() || '（先填基本单位）'}</span> 为基本单位——库存、收货、出库、结算一律按它记数。
          辅助单位仅用于采购/销售<span className="text-foreground">按箱/托便捷录入与展示</span>，换算为大于 1 的正整数（如 1 箱 = 12 {form.unit.trim() || '件'}），不影响库存记账。
        </p>
        <div className="space-y-2">
          {form.units.length === 0 && <p className="text-sm text-muted-foreground">未配置辅助单位（默认只按基本单位记数）。</p>}
          {form.units.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={u.unitName} onChange={e => setUnit(i, 'unitName', e.target.value)} disabled={submitting} maxLength={20} placeholder="单位名，如 箱" className="w-32" />
              <span className="text-sm text-muted-foreground">1 {u.unitName.trim() || '箱'} =</span>
              <Input type="number" min="2" step="1" value={u.conversionRate} onChange={e => setUnit(i, 'conversionRate', e.target.value)} disabled={submitting} placeholder="12" className="w-24 text-right tabular-nums" />
              <span className="text-sm text-muted-foreground">{form.unit.trim() || '基本单位'}</span>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeUnit(i)} disabled={submitting}>删除</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addUnit} disabled={submitting || !form.unit.trim()}>+ 增加辅助单位</Button>
        </div>
      </Section>

      <Section title="销售价格">
        <p className="mb-3 text-xs text-muted-foreground">留空则按系统加价比例自动生成（价格A +{priceRates.A}%  B +{priceRates.B}%  C +{priceRates.C}%  D +{priceRates.D}%）。</p>
        <div className="grid grid-cols-4 gap-x-6 gap-y-4">
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
        {isEdit && (
          // §18 可见性修复（2026-09-27）：只读展示标签使用的原始 sale_price（labelSalePrice）。
          // 不提供任何写入入口。写入面的准确表述（勿简写成「只由审批写」）：
          //   **新建时按价格A初始化 → 普通商品编辑不写它 → 改价审批可把它调成与 A 不同的值**。
          // 订单报价按客户等级价或该客户的专属价目表，与本值无关。
          <div className="mt-4 border-t pt-3">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="text-muted-foreground">销售价（标签使用，改价审批维护）</span>
              <span className="font-medium tabular-nums">
                {product?.labelSalePrice != null ? Number(product.labelSalePrice).toFixed(2) : '—'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              只读：该价印在商品标签上，由改价审批维护，不在此处修改。订单报价按客户等级价（上方「价格A~D」）或该客户的专属价目表，与这里的标签销售价无关。
            </p>
          </div>
        )}
      </Section>

      <Section title="库存策略">
        <p className="mb-3 text-xs text-muted-foreground">通用默认补货基准（对该商品所有仓库生效）。留空表示不启用；某仓需单独设置可在「报表 → 补货建议」页按仓覆盖。</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <Label>安全库存</Label>
            <Input quantity type="number" step={qtyStep(form.allowDecimalQty)} min="0" value={form.safetyStock}
              onChange={e => set('safetyStock', e.target.value)} disabled={submitting}
              placeholder="低于此为紧急缺货风险" />
          </div>
          <div className="space-y-1.5">
            <Label>补货点</Label>
            <Input quantity type="number" step={qtyStep(form.allowDecimalQty)} min="0" value={form.reorderPoint}
              onChange={e => set('reorderPoint', e.target.value)} disabled={submitting}
              placeholder="可用+在途 低于此即出现在补货建议" />
          </div>
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
