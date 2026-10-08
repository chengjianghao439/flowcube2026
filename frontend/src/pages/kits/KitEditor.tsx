import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { CategoryFinder } from '@/components/finder/CategoryFinder'
import { SupplierFinder } from '@/components/finder/SupplierFinder'
import { PickerField } from '@/components/shared/PickerField'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { KitReadOwner } from '@/api/kits'
import { getSettingsApi } from '@/api/settings'
import { assertKitReadOwner, captureKitReadOwner, readKitOwned, useKit, useKitBackup, useKitWrite } from '@/hooks/useKits'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import type { ProductFinderReadContext } from '@/hooks/useProducts'
import { PERMISSIONS } from '@/lib/permission-codes'
import { qtyStep } from '@/lib/qtyStep'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { reorderEpoch, subscribeReorder } from '@/lib/saleReorder'
import type { KitDefinition } from '@/types/kits'
import type { ProductFinderResult } from '@/types/products'
import type { FinderResult } from '@/types/finder'
import { buildKitPayload, compositionChanged, draftFromKit, emptyKitDraft, type KitDraft } from './kitDraft'

const DEFAULT_RATES = { A: 10, B: 20, C: 30, D: 40 }
const PRICE_FIELDS = [['A', 'price'], ['B', 'priceB'], ['C', 'priceC'], ['D', 'priceD']] as const

export default function KitEditor({ id, source, onClose }: { id: number | 'new'; source?: KitReadOwner; onClose: () => void }) {
  const [readOwner] = useState(() => source ?? captureKitReadOwner())
  const query = useKit(id === 'new' ? 0 : id, readOwner)
  const [sourceError, setSourceError] = useState('')
  const [loaded, setLoaded] = useState<KitDefinition | null>(null)
  useEffect(() => {
    if (!loaded && query.isFetchedAfterMount && query.data && !query.isFetching && !query.isError) {
      try { assertKitReadOwner(readOwner); setLoaded(query.data) } catch (error) { setSourceError(error instanceof Error ? error.message : '资料来源已变化') }
    }
  }, [loaded, query.data, query.isFetchedAfterMount, query.isFetching, query.isError, readOwner])
  if (id === 'new') return <KitEditorContent readOwner={readOwner} onClose={onClose} />
  if (!loaded) {
    return <AppDialog open dialogId="kit-editor" title="成套配件" onOpenChange={v => { if (!v) onClose() }}>
      <div className="p-5">{(query.isError || sourceError) ? <QueryErrorState error={sourceError || query.error} onRetry={() => void query.refetch()} title="资料读取失败" /> : <p role="status">正在加载最新资料…</p>}</div>
    </AppDialog>
  }
  // 初次最新读取后初始化独立草稿。后台列表失效不替换已打开的编辑基线。
  return <KitEditorContent initial={loaded} readOwner={readOwner} onClose={onClose} />
}

function KitEditorContent({ initial, readOwner, onClose }: { initial?: KitDefinition; readOwner: KitReadOwner; onClose: () => void }) {
  const { can } = usePermission()
  const [baseline, setBaseline] = useState(initial)
  const [draft, setDraft] = useState<KitDraft>(() => initial ? draftFromKit(initial) : emptyKitDraft())
  const [finderOpen, setFinderOpen] = useState(false), [closeConfirm, setCloseConfirm] = useState(false)
  const [categoryFinderOpen, setCategoryFinderOpen] = useState(false), [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [priceRates, setPriceRates] = useState<typeof DEFAULT_RATES | null>(null)
  const [localError, setLocalError] = useState(''), [success, setSuccess] = useState('')
  const [reloading, setReloading] = useState(false), [reloaded, setReloaded] = useState(false)
  const backup = useKitBackup(JSON.stringify({ baseline: baseline ?? null, draft, readOwner }), readOwner)
  const mounted = useRef(true)
  const sourceEpoch = useSyncExternalStore(subscribeReorder, reorderEpoch)
  const productReadOwner = useMemo(() => ({ ...readOwner, epoch: sourceEpoch }), [readOwner, sourceEpoch])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let current = true
    try {
      assertKitReadOwner(readOwner)
      void getSettingsApi({ baseURL: readOwner.baseURL, _authSessionGeneration: readOwner.sessionGeneration, _erpApiFallbackTried: true, automaticReplay: false, skipGlobalError: true }).then(result => {
        if (!current) return
        assertKitReadOwner(readOwner)
        const map = result?.map ?? {}
        const rate = (level: keyof typeof DEFAULT_RATES) => {
          const value = Number(map[`price_rate_${level.toLowerCase()}`]?.value ?? DEFAULT_RATES[level])
          return Number.isFinite(value) ? value : DEFAULT_RATES[level]
        }
        setPriceRates({ A: rate('A'), B: rate('B'), C: rate('C'), D: rate('D') })
      }).catch(() => {})
    } catch { /* 来源变化时保留草稿，售价仍以原提交端点的计算结果为准。 */ }
    return () => { current = false }
  }, [readOwner, sourceEpoch])
  const write = useKitWrite(readOwner)
  const writable = can(baseline ? PERMISSIONS.PRODUCT_UPDATE : PERMISSIONS.PRODUCT_CREATE) && !baseline?.deletedAt
  const locked = write.busy || !!write.pendingRecord || reloading
  let readSourceError = ''
  try { assertKitReadOwner(readOwner) } catch (error) { readSourceError = error instanceof Error ? error.message : '资料来源已变化，当前草稿已保留' }
  const selectionReadable = writable && !locked && !readSourceError
  const selectionScope = JSON.stringify([sourceEpoch, selectionReadable, categoryFinderOpen, supplierFinderOpen, finderOpen])
  const selectionState = useRef({ scope: selectionScope, readable: selectionReadable, serial: 0 })
  if (selectionState.current.scope !== selectionScope) selectionState.current = { scope: selectionScope, readable: selectionReadable, serial: selectionState.current.serial + 1 }
  const selectionSerial = selectionState.current.serial
  const assertSelectionRead = () => {
    assertKitReadOwner(readOwner)
    if (sourceEpoch !== reorderEpoch() || !selectionState.current.readable || selectionState.current.serial !== selectionSerial) throw new Error('原查找读取已暂停，当前草稿仍保留，请重新核对选择')
  }
  const selectionContext = (open: boolean): ProductFinderReadContext => ({
    key: ['kit-profile', readOwner.baseURL, readOwner.userId, readOwner.sessionGeneration, sourceEpoch, selectionSerial],
    enabled: open && selectionReadable,
    config: { baseURL: readOwner.baseURL, _authSessionGeneration: readOwner.sessionGeneration, _erpApiFallbackTried: true, automaticReplay: false, skipGlobalError: true },
    assertCurrent: assertSelectionRead,
  })
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline ? draftFromKit(baseline) : emptyKitDraft())
  const tabPath = useContext(TabPathContext)
  useDirtyGuard(tabPath || '/kits', dirty || locked)
  const change = (next: KitDraft) => { setDraft(next); backup.invalidate(); setLocalError(''); setSuccess('') }
  function close() {
    if (locked) return
    if (dirty) setCloseConfirm(true)
    else onClose()
  }
  function accept(result: KitDefinition | null) {
    if (!result) return
    setBaseline(result); setDraft(draftFromKit(result)); backup.invalidate(); setLocalError(''); setReloaded(false)
    setSuccess(`已保存：当前版本 ${result.version?.versionNo ?? '—'} · 资料修订 ${result.revision}`)
  }
  async function save() {
    setLocalError(''); setSuccess(''); setReloaded(false)
    try {
      accept(baseline ? await write.submit({ kind: 'update', id: baseline.id, data: buildKitPayload(draft, baseline) }) : await write.submit({ kind: 'create', data: buildKitPayload(draft) }))
    } catch (error) { setLocalError(error instanceof Error ? error.message : '请核对输入') }
  }
  async function copyDraft() {
    const text = JSON.stringify({ kitId: baseline?.id ?? null, originalRevision: baseline?.revision ?? null, originalVersion: baseline?.currentVersionId ?? null, draft }, null, 2)
    await backup.copy(text)
  }
  async function reload() {
    if (!baseline || !backup.canReload() || locked) return
    setReloading(true); setLocalError('')
    try {
      const latest = await readKitOwned(baseline.id, readOwner)
      if (!mounted.current) return
      assertKitReadOwner(readOwner)
      setBaseline(latest); setDraft(draftFromKit(latest)); backup.invalidate(); setReloaded(true); setSuccess('已重载最新资料，请对照已复制的草稿逐项核对后再修改。')
    } catch (error) { if (mounted.current) setLocalError(error instanceof Error ? error.message : '重载失败，当前草稿已保留') }
    finally { if (mounted.current) setReloading(false) }
  }
  function addProduct(product: ProductFinderResult) {
    if (locked || !writable) return
    try { assertSelectionRead() } catch { return }
    if (draft.components.some(c => c.productId === product.id)) { setLocalError('组成不能重复选择同一个商品'); return }
    change({ ...draft, components: [...draft.components, { productId: product.id, code: product.code, name: product.name, unit: product.unit, allowDecimal: product.allowDecimalQty !== false, active: true, quantity: '1', weight: '' }] })
  }
  function acceptProfileSelection(kind: 'category' | 'supplier', result: { id: number; name: string }) {
    if (locked || !writable) return
    try {
      assertSelectionRead()
      change(kind === 'category' ? { ...draft, categoryId: result.id, categoryName: result.name } : { ...draft, supplierId: result.id, supplierName: result.name })
    } catch (error) { setLocalError(error instanceof Error ? error.message : '资料来源已变化，当前草稿已保留') }
  }
  const changed = compositionChanged(draft, baseline)
  const originalVersion = baseline?.version
  return <>
    <AppDialog open dialogId="kit-editor" title={<span className="flex flex-wrap items-center gap-2">{baseline ? `${writable ? '维护' : '查看'}成套配件 · ${baseline.code}` : '新增成套配件'}{baseline && writable && <EditModeBadge />}<UnsavedBadge show={dirty} /></span>}
      defaultWidth={1100} defaultHeight={740} minWidth={650} minHeight={500} onOpenChange={v => { if (!v) close() }}
      footer={<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copyDraft()}>复制草稿内容</Button>{write.conflict && !reloaded && <Button variant="outline" disabled={!backup.copied || locked} onClick={() => void reload()}>重载最新资料</Button>}</div><div className="flex gap-2"><Button variant="outline" disabled={locked} onClick={close}>关闭</Button>{writable && (write.pendingRecord ? <Button disabled={write.busy} onClick={() => void write.retry().then(accept)}>按原请求重试</Button> : <Button disabled={locked || (baseline != null && !dirty)} onClick={() => void save()}>{write.busy ? '正在保存…' : baseline ? '保存修改' : '创建配件'}</Button>)}</div></div>}>
      <div className="h-full space-y-5 overflow-y-auto p-5">
        {!writable && <p className="text-sm text-muted-foreground">{baseline?.deletedAt ? '资料已删除，保留版本供核对。' : '当前账号可查看资料；维护需要对应的商品新增或修改权限。'}</p>}
        <div aria-live="polite">{success && <p className="rounded-md border bg-primary/5 p-3 text-sm">{success}</p>}{(localError || backup.error || (!reloaded && write.error) || readSourceError) && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-ink">{localError || backup.error || write.error || readSourceError}{write.conflict && !reloaded && ' 本次输入已保留。先复制草稿内容，再显式重载核对。'}</p>}</div>
        {backup.text && <div className="space-y-2"><textarea aria-label="完整草稿内容" readOnly value={backup.text} className="h-36 w-full rounded-md border bg-background p-2 font-mono text-xs" /><Button variant="outline" onClick={() => backup.acknowledge(backup.text)}>已备份草稿</Button></div>}
        {originalVersion && <dl className="flex flex-wrap gap-x-6 gap-y-2 border-b pb-3 text-xs text-muted-foreground"><div>当前版本 {originalVersion.versionNo}</div><div>资料修订 {baseline!.revision}</div><div>版本创建时间：{formatDisplayDateTime(originalVersion.createdAt)}</div><div>参考采样：{originalVersion.referenceSnapshotAt ? formatDisplayDateTime(originalVersion.referenceSnapshotAt) : '采样时间未单独保存'}</div></dl>}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">基本信息</h2>
          <fieldset disabled={!writable || locked} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="kit-code">配件编码</Label><Input id="kit-code" aria-label="配件编码" readOnly value={draft.code} placeholder="保存时自动生成" /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-name">配件名称 *</Label><Input id="kit-name" aria-label="配件名称" maxLength={150} value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-category">分类 *</Label><PickerField id="kit-category" value={draft.categoryName} placeholder="点击选择分类…" disabled={!writable || locked} onOpen={() => setCategoryFinderOpen(true)} /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-supplier">供应商 *</Label><PickerField id="kit-supplier" value={draft.supplierName} placeholder="点击选择供应商…" disabled={!writable || locked} onOpen={() => setSupplierFinderOpen(true)} /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-unit">单位 *</Label><Input id="kit-unit" aria-label="单位" maxLength={20} value={draft.unit} onChange={e => change({ ...draft, unit: e.target.value })} /><p className="text-xs text-muted-foreground">成交单位名称；成套数量只能填写整数。</p></div>
            <div className="space-y-1.5"><Label htmlFor="kit-spec">型号 *</Label><Input id="kit-spec" aria-label="型号" maxLength={100} value={draft.spec} onChange={e => change({ ...draft, spec: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-color">颜色 *</Label><Input id="kit-color" aria-label="颜色" maxLength={30} value={draft.color} onChange={e => change({ ...draft, color: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-article-number">供应商型号</Label><Input id="kit-article-number" aria-label="供应商型号" maxLength={100} value={draft.articleNumber} onChange={e => change({ ...draft, articleNumber: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="kit-cost">进价 *</Label><Input id="kit-cost" aria-label="进价" type="number" min="0.0001" step="0.0001" value={draft.costPrice} onChange={e => change({ ...draft, costPrice: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="kit-remark">备注</Label><Input id="kit-remark" aria-label="备注" maxLength={30} value={draft.remark} onChange={e => change({ ...draft, remark: e.target.value })} /></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => change({ ...draft, isActive: e.target.checked })} />启用，供新订单选择</label>
          </fieldset>
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">销售价格</h2>
          <p className="text-xs text-muted-foreground">留空则按系统加价比例自动生成{priceRates ? `（价格A +${priceRates.A}%  B +${priceRates.B}%  C +${priceRates.C}%  D +${priceRates.D}%）` : '，以保存时的系统设置为准'}。明确填写 0 会保留为零售价。</p>
          <fieldset disabled={!writable || locked} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {PRICE_FIELDS.map(([level, field]) => {
              const cost = Number(draft.costPrice)
              const placeholder = priceRates && draft.costPrice.trim() && Number.isFinite(cost) && cost > 0 ? (cost * (1 + priceRates[level] / 100)).toFixed(2) : '留空自动生成'
              return <div key={level} className="space-y-1.5"><Label htmlFor={`kit-price-${level}`}>价格{level}</Label><Input id={`kit-price-${level}`} aria-label={`价格${level}`} type="number" min="0" step="0.0001" inputMode="decimal" value={draft[field]} placeholder={placeholder} onChange={e => change({ ...draft, [field]: e.target.value })} /></div>
            })}
          </fieldset>
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">固定组成 · {draft.components.length} 个组件</h2>{writable && <Button size="sm" variant="outline" disabled={locked || draft.components.length >= 50} onClick={() => setFinderOpen(true)}>添加组件</Button>}</div>
          <p className="max-w-4xl text-xs leading-5 text-muted-foreground">每套量按商品基本单位填写，最多 50 个真实商品；整数组件仅可填整数。不配置套内包装或替代件。资料变更供后续新选择使用，已保存订单保留原组成和分摊。</p>
          <fieldset disabled={!writable || locked} className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="kit-weight-mode" value="product_a" checked={draft.mode === 'product_a'} onChange={() => change({ ...draft, mode: 'product_a' })} />按组件 A 价分摊</label>
            <label className="flex items-center gap-2"><input type="radio" name="kit-weight-mode" value="explicit" checked={draft.mode === 'explicit'} onChange={() => change({ ...draft, mode: 'explicit', components: draft.components.map(c => ({ ...c, weight: '' })) })} />指定全部组件分摊比例</label>
          </fieldset>
          <p className="max-w-4xl text-xs leading-5 text-muted-foreground">{draft.mode === 'product_a' ? '默认按组成保存时的组件 A 价 × 每套基本量分摊。以后商品改价不追改原参考；只改套报价、名称或启停也沿用原参考。' : '为全部组件填写非负比例，例如 80 与 20 或 4 与 1；最多4位小数，个别可为零，合计须大于零。不会自动把原 A 价参考转换成手工比例。'}</p>
          {changed && baseline && <p className="text-xs text-warning-ink">组成、每套量或分摊比例已修改：保存时提交全部组成并生成新版本；默认模式将重新取商品当时 A 价。</p>}
          <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted text-left text-xs text-muted-foreground"><tr><th className="p-3">组件商品</th><th className="p-3">基本单位</th><th className="w-32 p-3">每套基本量</th><th className="p-3">原版本 A 价</th><th className="p-3">原分摊参考 / 来源</th>{draft.mode === 'explicit' && <th className="w-36 p-3">分摊比例</th>}{writable && <th className="w-20 p-3">操作</th>}</tr></thead>
            <tbody className="divide-y">{draft.components.map((c, index) => {
              const original = originalVersion?.components.find(old => old.productId === c.productId)
              return <tr key={c.productId} className="align-top"><td className="p-3"><div>{c.name}</div><div className="text-xs text-muted-foreground">{c.code}{!c.active && ' · 商品已停用或删除'}</div></td><td className="p-3">{c.unit}{!c.allowDecimal && <span className="block text-xs text-warning-ink">只能整数</span>}</td>
                <td className="p-2"><Input quantity type="number" min={c.allowDecimal ? 0.01 : 1} step={qtyStep(c.allowDecimal)} aria-label={`${c.name}每套基本量`} inputMode="decimal" disabled={!writable || locked} value={c.quantity} onChange={e => change({ ...draft, components: draft.components.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row) })} /></td>
                <td className="p-3 tabular-nums">{original ? String(original.referencePrice) : '保存时采样'}</td><td className="p-3 tabular-nums"><span>{original?.amountWeight ?? '保存时生成'}</span><span className="block text-xs text-muted-foreground">{original ? original.weightSource === 'product_a' ? '当时 A 价 × 基本量' : '原显式比例' : '新组件'}</span></td>
                {draft.mode === 'explicit' && <td className="p-2"><Input aria-label={`${c.name}分摊比例`} inputMode="decimal" placeholder="主动填写" disabled={!writable || locked} value={c.weight} onChange={e => change({ ...draft, components: draft.components.map((row, i) => i === index ? { ...row, weight: e.target.value } : row) })} /></td>}
                {writable && <td className="p-2"><Button size="sm" variant="ghost" disabled={locked} aria-label={`移除${c.name}`} onClick={() => change({ ...draft, components: draft.components.filter((_, i) => i !== index) })}>移除</Button></td>}
              </tr>
            })}{!draft.components.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">添加真实商品，填写每套使用的基本量。</td></tr>}</tbody></table></div>
        </section>
      </div>
    </AppDialog>
    <CategoryFinder open={categoryFinderOpen} context={selectionContext(categoryFinderOpen)} value={draft.categoryId} leafOnly onClose={() => setCategoryFinderOpen(false)} onConfirm={result => acceptProfileSelection('category', result)} />
    <SupplierFinder open={supplierFinderOpen} context={selectionContext(supplierFinderOpen)} onClose={() => setSupplierFinderOpen(false)} onConfirm={(result: FinderResult) => acceptProfileSelection('supplier', result)} />
    <ProductFinderModal open={finderOpen} mode="lookup" readOwner={productReadOwner} readGuard={() => { try { assertSelectionRead(); return true } catch { return false } }} onConfirm={addProduct} onClose={() => setFinderOpen(false)} />
    <ConfirmDialog open={closeConfirm} title="关闭维护" description="当前有未保存修改。关闭前可先取消并复制草稿内容。" confirmText="放弃修改并关闭" onConfirm={onClose} onCancel={() => setCloseConfirm(false)} />
  </>
}
