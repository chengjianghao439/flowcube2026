import { moveFinderFocus } from '@/lib/finderNavigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { payloadClient } from '@/api/client'
import { collectAllRecords } from '@/api/allRecords'
import { commercialReadConfig } from '@/api/sale-commercial'
import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from '@/hooks/useKits'
import type { CustomerAddressGuard } from '@/hooks/useCustomerAddresses'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permission-codes'
import { cn } from '@/lib/utils'
import type { KitDefinition } from '@/types/kits'
import type { Product, ProductFinderResult } from '@/types/products'
import type { Category } from '@/types/categories'
import type { PaginatedData } from '@/types'
import { AppDialog } from '@/components/shared/AppDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { CommercialDraftRow } from './commercialDraft'

interface SelectableKit extends KitDefinition {
  selectable: boolean
  disabledReasons: { message: string }[]
  standaloneCompleteSetsByCurrentStock: number
}
type PickerItem = SelectableKit | ProductFinderResult
const BATCH_SIZE = 100

function CategoryRows({ nodes, selectedId, onSelect, depth = 0 }: {
  nodes: Category[]
  selectedId: number | null
  onSelect: (id: number) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(new Set<number>())
  return <>{nodes.map(node => <div key={node.id}>
    <div className={cn('flex items-center rounded', selectedId === node.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60')} style={{ paddingLeft: depth * 12 }}>
      {node.children?.length ? <button type="button" className="shrink-0 rounded p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${expanded.has(node.id) ? '收起' : '展开'}${node.name}`} aria-expanded={expanded.has(node.id)} onClick={() => setExpanded(old => {
        const next = new Set(old)
        if (next.has(node.id)) next.delete(node.id); else next.add(node.id)
        return next
      })}>{expanded.has(node.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="w-[26px] shrink-0" />}
      <button type="button" className="min-w-0 flex-1 break-words py-2 pr-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-pressed={selectedId === node.id} title={node.name} onClick={() => onSelect(node.id)}>{node.name}</button>
    </div>
    {expanded.has(node.id) && !!node.children?.length && <CategoryRows nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />}
  </div>)}</>
}

function categoryIds(nodes: Category[], selectedId: number): Set<number> {
  for (const node of nodes) {
    if (node.id === selectedId) {
      const ids = new Set([node.id])
      const addChildren = (children: Category[]) => children.forEach(child => { ids.add(child.id); addChildren(child.children ?? []) })
      addChildren(node.children ?? [])
      return ids
    }
    const found = categoryIds(node.children ?? [], selectedId)
    if (found.size) return found
  }
  return new Set()
}

export default function CommercialPicker({ kind, warehouseId, owner, readGuard, onSelect, onClose }: {
  kind: 'kit' | 'ordinary'
  warehouseId: number
  owner: KitReadOwner
  readGuard?: CustomerAddressGuard
  onSelect: (row: CommercialDraftRow) => void
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState(''), [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null), [selectedId, setSelectedId] = useState<number | null>(null)
  const [result, setResult] = useState<PaginatedData<PickerItem> | null>(null), [error, setError] = useState(''), [selectionError, setSelectionError] = useState('')
  const [loading, setLoading] = useState(false), [selecting, setSelecting] = useState(false), [retry, setRetry] = useState(0)
  const [categories, setCategories] = useState<Category[]>([]), [categoryLoading, setCategoryLoading] = useState(false), [categoryError, setCategoryError] = useState(''), [categoryRetry, setCategoryRetry] = useState(0)
  const active = useSectionActive(), user = useAuthStore(state => state.user)
  const productPermission = hasPermission(user?.permissions, PERMISSIONS.PRODUCT_VIEW, user?.roleId)
  const categoryPermission = hasPermission(user?.permissions, PERMISSIONS.CATEGORY_VIEW, user?.roleId)
  const currentGuard = useRef(readGuard)
  currentGuard.current = readGuard
  const visible = active && productPermission && (!readGuard || readGuard.isCurrent())
  const selectedCategory = categoryPermission ? categoryId : null
  const queryCategory = selectedCategory
  const activity = useRef({ visible, epoch: readGuard?.epoch, kind, warehouseId, owner, search, queryCategory, retry, generation: 0 })
  if (activity.current.visible !== visible || activity.current.epoch !== readGuard?.epoch || activity.current.kind !== kind || activity.current.warehouseId !== warehouseId || activity.current.owner !== owner || activity.current.search !== search || activity.current.queryCategory !== queryCategory || activity.current.retry !== retry) {
    activity.current = { visible, epoch: readGuard?.epoch, kind, warehouseId, owner, search, queryCategory, retry, generation: activity.current.generation + 1 }
  }
  const generation = activity.current.generation
  const isCurrent = useCallback(() => {
    const auth = useAuthStore.getState()
    return activity.current.visible && activity.current.generation === generation && (!currentGuard.current || currentGuard.current.isCurrent()) && hasPermission(auth.user?.permissions, PERMISSIONS.PRODUCT_VIEW, auth.user?.roleId)
  }, [generation])
  const categoryActivity = useRef({ visible, epoch: readGuard?.epoch, owner, categoryPermission, categoryRetry, generation: 0 })
  if (categoryActivity.current.visible !== visible || categoryActivity.current.epoch !== readGuard?.epoch || categoryActivity.current.owner !== owner || categoryActivity.current.categoryPermission !== categoryPermission || categoryActivity.current.categoryRetry !== categoryRetry) {
    categoryActivity.current = { visible, epoch: readGuard?.epoch, owner, categoryPermission, categoryRetry, generation: categoryActivity.current.generation + 1 }
  }
  const categoryGeneration = categoryActivity.current.generation
  const listRead = useRef<AbortController | null>(null)
  const selection = useRef<{ generation: number; controller: AbortController; delivered: boolean } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    listRead.current = abort
    setResult(null); setError(''); setSelectionError(''); setSelecting(false)
    if (!isCurrent()) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      try {
        // The kit API accepts batches up to 100. Preserve the shared 5,000-row limit and integrity checks.
        const data = await collectAllRecords((page, pageSize) => {
          assertKitReadOwner(owner)
          if (!isCurrent()) throw new DOMException('加载已取消', 'AbortError')
          return payloadClient.get<PaginatedData<PickerItem>>(kind === 'kit' ? '/kits/finder' : '/products/finder', {
            ...commercialReadConfig(owner), signal: abort.signal, listMode: 'paged',
            params: { page, pageSize: pageSize ?? BATCH_SIZE, keyword: search, warehouseId, ...(queryCategory != null ? { categoryId: queryCategory } : {}) }
          }).then(value => { assertKitReadOwner(owner); if (!isCurrent()) throw new DOMException('加载已取消', 'AbortError'); return value })
        }, abort.signal)
        if (!abort.signal.aborted && isCurrent()) setResult(data)
      } catch (caught) {
        if (!abort.signal.aborted && isCurrent()) setError(caught instanceof Error ? caught.message : '读取失败')
      } finally {
        if (!abort.signal.aborted && isCurrent()) setLoading(false)
      }
    })()
    return () => {
      abort.abort()
      if (selection.current?.generation === generation) selection.current.controller.abort()
    }
  }, [generation, isCurrent, kind, owner, queryCategory, search, warehouseId])

  useEffect(() => {
    const abort = new AbortController()
    const current = () => {
      const auth = useAuthStore.getState()
      return categoryActivity.current.generation === categoryGeneration && activity.current.visible && (!currentGuard.current || currentGuard.current.isCurrent()) && hasPermission(auth.user?.permissions, PERMISSIONS.CATEGORY_VIEW, auth.user?.roleId)
    }
    setCategories([]); setCategoryError('')
    if (!visible || !categoryPermission) { setCategoryLoading(false); return }
    setCategoryLoading(true)
    void (async () => {
      try {
        assertKitReadOwner(owner)
        if (!current()) return
        const data = await payloadClient.get<Category[]>('/categories/tree', { ...commercialReadConfig(owner), signal: abort.signal })
        assertKitReadOwner(owner)
        if (!abort.signal.aborted && current()) setCategories(data)
      } catch (caught) {
        if (!abort.signal.aborted && current()) setCategoryError(caught instanceof Error ? caught.message : '分类读取失败')
      } finally {
        if (!abort.signal.aborted && current()) setCategoryLoading(false)
      }
    })()
    return () => abort.abort()
  }, [categoryGeneration, categoryPermission, owner, visible])

  const blockedCategory = kind === 'kit' && selectedCategory != null && (!!result?.truncated || categoryLoading || !!categoryError)
  const items = useMemo(() => {
    if (!visible || blockedCategory) return []
    const all = result?.list ?? []
    if (kind !== 'kit' || selectedCategory == null) return all
    const ids = categoryIds(categories, selectedCategory)
    return all.filter(item => item.categoryId != null && ids.has(item.categoryId))
  }, [blockedCategory, categories, kind, result, selectedCategory, visible])
  const pending = loading || selecting || keyword.trim() !== search
  const selected = selectedId == null ? null : items.find(item => item.id === selectedId) ?? null
  const interaction = useRef({ pending, items, blockedCategory })
  interaction.current = { pending, items, blockedCategory }
  const chooseCategory = (id: number | null) => {
    if (!isCurrent() || selecting) return
    const auth = useAuthStore.getState()
    if (id != null && !hasPermission(auth.user?.permissions, PERMISSIONS.CATEGORY_VIEW, auth.user?.roleId)) return
    setCategoryId(id); setSelectedId(null); setSelectionError('')
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }
  function close() {
    if (!isCurrent()) return
    listRead.current?.abort(); selection.current?.controller.abort(); onClose()
  }
  async function choose(candidate: PickerItem) {
    const item = interaction.current.items.find(row => row.id === candidate.id)
    if (!item || !isCurrent() || interaction.current.pending || interaction.current.blockedCategory || selection.current?.generation === generation) return
    const request = { generation, controller: new AbortController(), delivered: false }
    selection.current = request
    setSelecting(true); setSelectionError('')
    try {
      assertKitReadOwner(owner)
      const lineKey = crypto.randomUUID()
      if ('version' in item) {
        if (!item.selectable || !item.version) return
        onSelect({
          input: { kind: 'kit', lineKey, warehouseId, kitVersionId: item.currentVersionId, quantity: 1, priceSource: 'kit_default' },
          name: item.name, code: item.code, spec: item.spec, color: item.color, articleNumber: item.articleNumber, costPrice: item.costPrice,
          unit: item.unit || '套', quantity: '1', price: String(item.version.referenceUnitPrice), units: [], packagingExpressible: true,
          components: item.version.components.map(component => ({ ...component, productCode: component.productCode ?? '', productName: component.productName ?? '', unit: component.unit ?? '' }))
        })
      } else {
        const product = await payloadClient.get<Product>(`/products/${item.id}`, { ...commercialReadConfig(owner), signal: request.controller.signal })
        assertKitReadOwner(owner)
        if (!isCurrent() || request.controller.signal.aborted) return
        if (product.id !== item.id) throw new Error('商品资料已变化，请重新选择')
        onSelect({
          input: { kind: 'ordinary', lineKey, warehouseId, productId: item.id, entryUnit: item.unit, quantity: 1, priceSource: 'default' },
          name: item.name, code: item.code, spec: product.spec, color: product.color, articleNumber: product.articleNumber, costPrice: product.costPrice,
          unit: item.unit, quantity: '1', price: '', units: product.units ?? [], baseUnit: product.unit, allowDecimalQty: product.allowDecimalQty, packagingExpressible: true
        })
      }
      request.delivered = true
    } catch (caught) {
      if (!request.controller.signal.aborted && isCurrent()) setSelectionError(caught instanceof Error ? caught.message : '选择失败')
    } finally {
      // A delivered selection remains locked until close; old completion cannot unlock a newer request.
      if (isCurrent() && selection.current === request && !request.delivered) { selection.current = null; setSelecting(false) }
    }
  }

  const scrollToIndex = useRef<((index: number) => void) | null>(null)
  const registerScroll = useCallback((scroll: ((index: number) => void) | null) => { scrollToIndex.current = scroll }, [])
  const disabledItem = (item: PickerItem) => 'version' in item && (!item.selectable || !item.version)
  const renderRow = (item: PickerItem, index: number) => {
    const isKit = 'version' in item, disabled = disabledItem(item)
    const price = isKit ? item.version?.referenceUnitPrice : item.salePrice
    const stock = isKit ? item.standaloneCompleteSetsByCurrentStock : item.stock
    return <tr key={item.id} data-finder-key={item.id} aria-selected={selectedId === item.id} tabIndex={pending || disabled ? -1 : 0} className={cn('border-b align-top text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selectedId === item.id ? 'bg-primary/[0.07]' : 'hover:bg-muted/40', disabled && 'text-muted-foreground')} onClick={() => { if (isCurrent() && !pending && !disabled) setSelectedId(item.id) }} onDoubleClick={() => void choose(item)} onKeyDown={event => {
      if (event.key === ' ') { event.preventDefault(); if (isCurrent() && !pending && !disabled) setSelectedId(item.id) }
      if (event.key === 'Enter') { event.preventDefault(); void choose(item) }
      if (isCurrent() && !pending) moveFinderFocus(event, items, index, row => row.id, scrollToIndex.current, disabledItem)
    }}>
      <td className="break-words px-2 py-2 font-mono text-xs leading-5">{item.code}</td>
      <td className="break-words px-2 py-2 leading-5">{item.articleNumber || '—'}</td>
      <td className="break-words px-2 py-2 leading-5">{item.spec || '—'}</td>
      <td className="break-words px-2 py-2 leading-5">{item.name}{isKit && disabled && <p className="mt-1 text-xs text-destructive-ink">{item.disabledReasons.map(reason => reason.message).join('；')}</p>}</td>
      <td className="break-words px-2 py-2 leading-5">{item.color || '—'}</td>
      <td className="px-2 py-2 leading-5">{item.unit || (isKit ? '套' : '—')}</td>
      <td className="px-2 py-2 text-right tabular-nums leading-5">{stock ?? '—'}</td>
      <td className="px-2 py-2 text-right tabular-nums leading-5">{price == null ? '—' : Number(price).toFixed(4)}</td>
    </tr>
  }
  const virtualized = items.length >= VIRTUAL_TABLE_THRESHOLD
  const total = result?.pagination.total ?? 0
  const count = kind === 'kit' && selectedCategory != null && !blockedCategory ? items.length : total

  return <AppDialog captureFocusOnOpen open={visible} dialogId={`sale-commercial-picker-${kind}`} title={kind === 'kit' ? '选择成套配件' : '选择普通商品'} defaultWidth={1240} defaultHeight={660} minWidth={900} minHeight={480} onOpenChange={open => { if (!open) close() }} footer={<div className="flex items-center justify-between gap-4">
    <div className="min-w-0 text-sm">{selected && <span className="block whitespace-normal leading-5 [overflow-wrap:anywhere]"><span className="mr-2 text-muted-foreground">已选</span>{selected.code} · {selected.name}</span>}</div>
    <div className="flex shrink-0 gap-2"><Button variant="outline" onClick={close}>取消</Button><Button disabled={!selected || pending || !!error || blockedCategory || disabledItem(selected)} onClick={() => { if (selected) void choose(selected) }}>{selecting ? '读取资料…' : '确认选择'}</Button></div>
  </div>}>
    <div className="flex h-full flex-col overflow-hidden">
      <form className="flex shrink-0 gap-2 border-b px-4 py-3" onSubmit={event => { event.preventDefault(); if (!isCurrent() || selecting) return; setSelectedId(null); setSearch(keyword.trim()); if (keyword.trim() === search) setRetry(old => old + 1); if (scrollRef.current) scrollRef.current.scrollTop = 0 }}>
        <div className="relative min-w-0 max-w-xl flex-1"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus aria-label="搜索成交商品" placeholder={kind === 'kit' ? '搜索名称、编码、供应商型号、型号或颜色' : '搜索名称、编码、条码、供应商型号、型号或颜色'} value={keyword} maxLength={100} disabled={selecting} className="h-9 pl-8 pr-8" onChange={event => { if (isCurrent()) { setKeyword(event.target.value); setSelectedId(null) } }} />{keyword && <button type="button" aria-label="清空搜索" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" disabled={selecting} onClick={() => { if (isCurrent()) { setKeyword(''); setSearch(''); setSelectedId(null) } }}><X className="h-3.5 w-3.5" /></button>}</div>
        <Button type="submit" variant="outline" className="h-9" disabled={selecting}>查询</Button>
      </form>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="商品分类" className="w-44 shrink-0 overflow-auto border-r px-2 py-3">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">商品分类</p>
          <button type="button" aria-pressed={selectedCategory == null} className={cn('mb-1 w-full rounded px-3 py-2 text-left text-sm', selectedCategory == null ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60')} onClick={() => chooseCategory(null)}>全部分类</button>
          {!categoryPermission ? <p className="px-2 py-3 text-xs text-muted-foreground">当前没有分类查看权限</p> : categoryError ? <div className="px-2 text-xs text-destructive-ink">分类加载失败<Button size="sm" variant="ghost" onClick={() => { if (isCurrent()) setCategoryRetry(old => old + 1) }}>重试分类</Button></div> : categoryLoading ? <p className="px-2 py-3 text-xs text-muted-foreground">正在加载分类…</p> : categories.length ? <CategoryRows nodes={categories} selectedId={selectedCategory} onSelect={chooseCategory} /> : <p className="px-2 py-3 text-xs text-muted-foreground">暂无分类</p>}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 justify-end border-b px-3 py-2 text-xs text-muted-foreground" role="status">{loading ? '正在查询…' : error ? '查询失败' : blockedCategory ? '分类结果未完整读取' : result?.truncated ? `已显示 ${items.length.toLocaleString()} / 共 ${total.toLocaleString()} 条` : `共 ${count.toLocaleString()} 条`}</div>
          {result?.truncated && <div className="shrink-0 border-b bg-warning/10 px-3 py-2 text-xs text-warning-ink" role="status">{blockedCategory ? '匹配资料未读齐，暂不能按分类选择。' : `结果超过单次显示上限，已显示 ${result.list.length.toLocaleString()} / 共 ${total.toLocaleString()} 条。`}请缩小搜索范围。</div>}
          {selectionError && <p role="alert" className="shrink-0 border-b px-3 py-2 text-sm text-destructive-ink">{selectionError}</p>}
          <div ref={scrollRef} data-table-scroll className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
            {error ? <QueryErrorState error={error} onRetry={() => { if (isCurrent()) setRetry(old => old + 1) }} title="商品加载失败" compact /> : <table className="w-full min-w-[940px] table-fixed" aria-rowcount={virtualized ? items.length + 1 : undefined}>
              <colgroup>{[104, 132, 112, 232, 80, 56, 112, 112].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
              <thead className="sticky top-0 z-10 border-b data-table-header text-left text-xs font-medium"><tr>{['编码', '供应商型号', '型号', '商品名称', '颜色', '单位'].map(label => <th key={label} className="px-2 py-2.5 font-medium">{label}</th>)}<th className="px-2 py-2.5 text-right font-medium" title={kind === 'kit' ? '单套现货参考；共享组件按整单核对，不保证可拣或交期' : undefined}>{kind === 'kit' ? '独立现货参考' : '可用库存'}</th><th className="px-2 py-2.5 text-right font-medium" title="实际成交价以订单核对结果为准">价格 A 参考</th></tr></thead>
              {loading ? <tbody>{Array.from({ length: 6 }, (_, index) => <tr key={index} aria-hidden="true" className="border-b"><td colSpan={8} className="px-3 py-3"><div className="h-4 rounded bg-muted" /></td></tr>)}</tbody> : blockedCategory ? <tbody /> : !items.length ? <tbody><tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">没有匹配的商品</td></tr></tbody> : virtualized ? <VirtualTableBody data={items} columns={8} getRowKey={item => item.id} renderRow={renderRow} onScrollToIndexReady={registerScroll} /> : <tbody>{items.map(renderRow)}</tbody>}
            </table>}
          </div>
        </div>
      </div>
    </div>
  </AppDialog>
}
