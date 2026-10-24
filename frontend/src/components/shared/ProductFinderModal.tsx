import { ResizableTable } from './ResizableTable'
import { productIdentityColumns } from './productIdentityColumns'
import { money, unitPrice } from '@/lib/format'
import { ProductIdentityCells } from '@/components/shared/ProductIdentityCells'
import { moveFinderFocus } from '@/lib/finderNavigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, ChevronRight, PackageSearch, Search, X } from 'lucide-react'
import { AppDialog } from '@/components/shared/AppDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { VirtualTableBody, VIRTUAL_TABLE_THRESHOLD } from '@/components/shared/VirtualTableBody'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCategoryTree } from '@/hooks/useCategories'
import { useProductFinder } from '@/hooks/useProducts'
import { cn } from '@/lib/utils'
import type { Category } from '@/types/categories'
import type { ProductFinderResult } from '@/types/products'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import { mayReorder, reorderConfig, reorderEpoch, reorderOwnerCurrent, subscribeReorder, type ReorderOwner } from '@/lib/saleReorder'
import { PERMISSIONS } from '@/lib/permission-codes'
import { assertKitReadOwner, captureKitReadOwner } from '@/hooks/useKits'
import { commercialReadConfig } from '@/api/sale-commercial'
import { saleEntryEpoch, subscribeSaleEntry } from '@/lib/saleEntryOwner'
import type { ProductFinderReadContext } from '@/hooks/useProducts'
import { useFinderReadContext } from '@/hooks/useFinderReadContext'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'

export interface ProductFinderModalProps {
  open: boolean
  /** 销售录入样板：紧凑布局与有界完整查询的虚拟呈现，其他场景保留原布局。 */
  compact?: boolean
  /** 采购显式使用中性读取归属；不进入销售商业上下文。 */
  context?: 'purchase' | ProductFinderReadContext
  dialogId?: string
  /** 仅重复开单：保留请求打开状态和输入，归属变化/隐藏/未知保存时暂停读取及回填。 */
  readOwner?: ReorderOwner
  readGuard?: () => boolean
  warehouseId?: number | null
  warehouseName?: string | null
  /** 控制辅助信息，不影响商品选择与回填。 */
  mode?: 'lookup' | 'sale' | 'purchase'
  onConfirm: (product: ProductFinderResult) => void
  onClose: () => void
}

const PAGE_SIZE = 30
function CategoryTree({ nodes, selectedId, onSelect, depth = 0, compact = false }: {
  nodes: Category[]; selectedId: number | null; onSelect: (id: number, name: string) => void; depth?: number; compact?: boolean
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  return <div className="space-y-0.5">{nodes.map(node => <div key={node.id}>
    <div className={cn('flex items-center rounded-md pr-2', selectedId === node.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/70')} style={{ paddingLeft: depth * 14 }}>
      {node.children?.length ? <button type="button" aria-label={`${expanded.has(node.id) ? '收起' : '展开'}${node.name}`} aria-expanded={expanded.has(node.id)} className="shrink-0 rounded p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}>
        {expanded.has(node.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button> : <span className="w-[26px] shrink-0" />}
      <button type="button" aria-pressed={selectedId === node.id} title={node.name} className={cn('min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere] rounded text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'py-1.5' : 'py-2')} onClick={() => onSelect(node.id, node.name)}>{node.name}</button>
      {node.status === 0 && <span className="ml-1 text-[10px]">停用分类</span>}
    </div>
    {!!node.children?.length && expanded.has(node.id) && <CategoryTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} compact={compact} />}
  </div>)}</div>
}

/** 全局商品选择：关闭即卸载草稿，仓库或场景变化同样清空选择。 */
export default function ProductFinderModal(props: ProductFinderModalProps) {
  const purchaseContext = useFinderReadContext(props.context === 'purchase', props.open, PERMISSIONS.PRODUCT_VIEW, 'product')
  const context = props.context === 'purchase' ? purchaseContext : props.context
  const resolved = { ...props, context, onClose: props.context === 'purchase' ? () => { purchaseContext?.cancel(); props.onClose() } : props.onClose }
  const visited = useRef(false)
  if (props.open) visited.current = true
  if (props.readOwner) return visited.current ? <ProductFinderContent {...resolved} /> : null
  return props.open ? <ProductFinderContent key={`${props.mode ?? 'lookup'}-${props.warehouseId ?? 'none'}`} {...resolved} /> : null
}
const noSubscription = () => () => {}
const zeroEpoch = () => 0
function ProductFinderContent({ open, compact = false, context: suppliedContext, dialogId, readOwner: suppliedOwner, readGuard, warehouseId, warehouseName, mode = 'lookup', onConfirm, onClose }: ProductFinderModalProps) {
  const searchInput = useRef<HTMLInputElement>(null)
  const explicitContext = typeof suppliedContext === 'object' ? suppliedContext : undefined
  // 普通编辑的 compact 选择器没有上层 owner，本次打开仍绑定当前归属；默认调用沿用原读取规则。
  const compactOwner = useRef<{ owner: ReturnType<typeof captureKitReadOwner>; epoch: number } | null>(null)
  if (compact && !explicitContext && !suppliedOwner && !compactOwner.current) compactOwner.current = { owner: captureKitReadOwner(), epoch: saleEntryEpoch() }
  const readOwner = explicitContext ? undefined : suppliedOwner ?? (compact ? compactOwner.current?.owner : undefined)
  const active = useSectionActive()
  useSyncExternalStore(explicitContext ? noSubscription : suppliedOwner ? subscribeReorder : compact ? subscribeSaleEntry : noSubscription, explicitContext ? zeroEpoch : suppliedOwner || !compact ? reorderEpoch : saleEntryEpoch)
  const ownerCurrent = () => {
    if (suppliedOwner) return reorderOwnerCurrent(suppliedOwner)
    if (!compactOwner.current || !compact) return true
    try { assertKitReadOwner(compactOwner.current.owner); return compactOwner.current.epoch === saleEntryEpoch() } catch { return false }
  }
  const contextCurrent = (value = explicitContext) => {
    if (!value?.enabled) return false
    try { value.assertCurrent(); return true } catch { return false }
  }
  const permission = (code: typeof PERMISSIONS.PRODUCT_VIEW | typeof PERMISSIONS.CATEGORY_VIEW) => {
    const auth = useAuthStore.getState()
    return hasPermission(auth.user?.permissions, code, auth.user?.roleId)
  }
  const readable = explicitContext ? open && active && contextCurrent() && permission(PERMISSIONS.PRODUCT_VIEW)
    : !readOwner || (open && active && ownerCurrent() && mayReorder(PERMISSIONS.PRODUCT_VIEW) && (!readGuard || readGuard()))
  const localPaused = explicitContext ? open && active && !readable : compact && !suppliedOwner && open && active && !ownerCurrent()
  const scope = JSON.stringify([explicitContext?.key ?? readOwner, warehouseId, mode])
  const context = useRef({ scope, readable, serial: 0 })
  if ((readOwner || explicitContext) && (context.current.scope !== scope || context.current.readable !== readable)) context.current = { scope, readable, serial: context.current.serial + 1 }
  const latest = useRef({ readGuard, open, active, readOwner, explicitContext })
  latest.current = { readGuard, open, active, readOwner, explicitContext }
  const serial = context.current.serial
  const delivery = useRef({ scope, serial, open, closed: false })
  if (delivery.current.scope !== scope || delivery.current.serial !== serial || delivery.current.open !== open) delivery.current = { scope, serial, open, closed: false }
  const current = () => explicitContext ? !delivery.current.closed && context.current.serial === serial && context.current.readable && latest.current.open && latest.current.active
    && contextCurrent(latest.current.explicitContext) && permission(PERMISSIONS.PRODUCT_VIEW)
    : !readOwner || (context.current.serial === serial && context.current.readable && latest.current.open && latest.current.active && latest.current.readOwner === readOwner
      && ownerCurrent() && mayReorder(PERMISSIONS.PRODUCT_VIEW) && (!latest.current.readGuard || latest.current.readGuard()))
  const assertCurrent = () => { if (!current()) throw new Error('原选品读取已暂停，输入保留，请回原草稿核对') }
  const readContext = explicitContext ? { ...explicitContext, key: [...explicitContext.key, scope, serial], enabled: readable, assertCurrent }
    : readOwner ? { key: [suppliedOwner ? 'repeat' : 'sale-entry', scope, serial], config: { ...(suppliedOwner ? reorderConfig(suppliedOwner) : commercialReadConfig(readOwner)), automaticReplay: false as const }, enabled: readable, assertCurrent } : undefined
  const [keyword, setKeyword] = useState('')
  const [searchText, setSearchText] = useState('')
  const [category, setCategory] = useState<{ id: number; name: string } | null>(null)
  // 只存 id，选中对象一律**从当前列表派生**：后台 refetch 后行已更新时，摘要/高亮/确认都跟着当前值，
  // 不会把"选中那一刻"的旧对象回传出去（原缺陷：页脚确认回传过期行）。
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const categoryPermission = () => explicitContext ? permission(PERMISSIONS.CATEGORY_VIEW) : mayReorder(PERMISSIONS.CATEGORY_VIEW)
  const categoryReadable = explicitContext ? readable && categoryPermission() : !readOwner || (readable && categoryPermission())
  const categories = useCategoryTree(readContext ? { ...readContext, enabled: categoryReadable, assertCurrent: () => { assertCurrent(); if (!categoryPermission()) throw new Error('当前没有分类查看权限') } } : undefined)
  const query = useProductFinder({ page: 1, pageSize: PAGE_SIZE, keyword: searchText, categoryId: category?.id ?? null, warehouseId: warehouseId ?? null }, true, readContext)
  useEffect(() => { const timer = setTimeout(() => setSearchText(keyword.trim()), 300); return () => clearTimeout(timer) }, [keyword])
  const pending = keyword.trim() !== searchText || query.isFetching || query.isPlaceholderData
  const products = readable ? query.data?.list ?? [] : []
  const total = query.data?.pagination.total ?? 0
  const errorStatus = query.error as { status?: number; response?: { status?: number } } | null
  const forbidden = (errorStatus?.status ?? errorStatus?.response?.status) === 403
  const incomplete = compact && query.data?.truncated === true
  const allowIncompleteSelection = compact && mode === 'purchase' && !!explicitContext
  const blockedIncomplete = incomplete && !allowIncompleteSelection
  const selected = selectedId != null ? products.find(p => p.id === selectedId) ?? null : null
  const canConfirm = selected != null && !pending && !query.isError && !blockedIncomplete && (!compact || !delivery.current.closed)
  const displayed = useRef({ products, pending, isError: query.isError, blockedIncomplete })
  displayed.current = { products, pending, isError: query.isError, blockedIncomplete }
  const resetSelection = () => { setSelectedId(null) }
  const chooseCategory = (id: number, name: string) => { if (current()) { setCategory({ id, name }); resetSelection() } }
  const confirm = (product: ProductFinderResult) => {
    if (!current() || pending || query.isError) return
    const currentProduct = compact ? displayed.current.products.find(row => row.id === product.id) : product
    if (compact && (delivery.current.closed || displayed.current.pending || displayed.current.isError || displayed.current.blockedIncomplete || !currentProduct)) return
    if (compact) delivery.current.closed = true
    const value = { ...currentProduct! }
    delete value.searchMatch
    onConfirm(value); onClose()
  }
  const close = () => {
    // 来源失效不重建草稿；仅本地 compact 允许在活动页主动退出，重新打开才重新捕获归属。
    if ((current() || ((explicitContext || (compact && !suppliedOwner)) && latest.current.open && latest.current.active)) && (!compact || !delivery.current.closed)) {
      if (compact) delivery.current.closed = true
      onClose()
    }
  }
  const hasStock = warehouseId != null && warehouseId > 0
  const purchaseLayout = compact && mode === 'purchase' && !!explicitContext
  const compactWidths = purchaseLayout ? [104, 132, 112, 232, 80, 56, 140] : [104, 132, 116, 208, 84, 74, 114]
  const columnCount = 7 + (hasStock ? 1 : 0) + (mode === 'sale' ? 1 : 0)
  const scrollToIndex = useRef<((index: number) => void) | null>(null)
  const registerScroll = useCallback((scroll: ((index: number) => void) | null) => { scrollToIndex.current = scroll }, [])
  const renderRow = (product: ProductFinderResult, index: number) => <tr key={product.id} data-finder-key={product.id} aria-selected={selectedId === product.id} tabIndex={pending ? -1 : 0} onClick={() => { if (current() && !pending) setSelectedId(product.id) }} onDoubleClick={() => confirm(product)} onKeyDown={e => {
    if (!current() || pending) return
    if (e.key === ' ') { e.preventDefault(); setSelectedId(product.id) }
    if (e.key === 'Enter') { e.preventDefault(); if (compact || selectedId === product.id) confirm(product); else setSelectedId(product.id) }
    if (compact) moveFinderFocus(e, products, index, row => row.id, scrollToIndex.current)
  }} className={cn('cursor-pointer align-top outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', compact && 'border-b', pending ? 'opacity-50' : selectedId === product.id ? 'bg-primary/[0.07]' : 'hover:bg-muted/50')}>
    <ProductIdentityCells product={product} nameContent={<><span>{product.name}</span>{!pending && searchText && product.searchMatch && <span className="block text-xs leading-5 text-muted-foreground">命中：{product.searchMatch}</span>}</>} />
    <td className="px-2 py-3 text-muted-foreground"><span>{product.unit || '—'}</span>{product.allowDecimalQty === false && <span className={cn('rounded bg-warning/10 px-1 text-xs text-warning-ink', compact ? 'mt-0.5 inline-block' : 'ml-1')}>只能整数</span>}</td><td className="break-words px-3 py-3 text-xs leading-5 text-muted-foreground">{mode === 'purchase' ? product.supplierName || '—' : product.categoryName || '未分类'}</td>
    {hasStock && <td className="px-3 py-3 text-right tabular-nums">{product.stock}</td>}{mode === 'sale' && <td className="px-3 py-3 text-right tabular-nums">{product.salePrice == null ? '—' : compact ? unitPrice(product.salePrice) : money(product.salePrice)}</td>}
  </tr>

  return <AppDialog descriptionInHeader description={localPaused ? <span role="status">{explicitContext ? permission(PERMISSIONS.PRODUCT_VIEW) ? '读取已暂停，输入已保留。请关闭后重新选择商品。' : '当前没有商品查看权限，输入已保留。' : '读取来源已变化，输入已保留。请关闭后重新选择商品。'}</span> : incomplete && !pending && !query.isError ? <span role="status">已读取 {products.length.toLocaleString()} / {total.toLocaleString()} 个匹配商品。{allowIncompleteSelection ? '请缩小搜索范围以查看其余匹配商品。' : '请缩小搜索范围后再确认选择。'}</span> : compact ? '按商品资料查找，确认所需商品。' : '按商品资料查找；单击选择，双击或选中后按 Enter 确认。'} captureFocusOnOpen open={readable || localPaused} onOpenChange={value => { if (!value) close() }} dialogId={dialogId ?? (compact ? 'sale-product-finder' : 'product-finder-v2')} defaultWidth={compact ? 1240 : 1200} defaultHeight={compact ? 660 : 730} minWidth={compact ? 900 : 960} minHeight={compact ? 480 : 560}
    onOpenAutoFocus={event => {
      if (!searchInput.current || searchInput.current.disabled) return
      event.preventDefault()
      searchInput.current.focus({ preventScroll: true })
    }}
    title={<span className="flex items-center gap-2"><PackageSearch className="h-4 w-4 text-primary" />选择商品</span>}
    footer={<div className={cn('flex items-center gap-5', compact ? 'justify-end' : 'justify-between')}><div className="flex shrink-0 gap-2"><Button size={compact ? 'sm' : 'default'} variant="outline" onClick={close}>取消</Button><Button size={compact ? 'sm' : 'default'} disabled={!canConfirm} onClick={() => { if (selected) confirm(selected) }}>确认选择</Button></div></div>}>
    <div className="flex h-full flex-col overflow-hidden">
      <div className={cn('flex shrink-0 items-center border-b', compact ? 'gap-3 px-4 py-2.5' : 'gap-4 px-5 py-3')}>
        <div className="relative max-w-2xl flex-1"><Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input ref={searchInput} disabled={localPaused} aria-label="搜索商品" value={keyword} onChange={e => { if (current()) { setKeyword(e.target.value); resetSelection() } }} placeholder="搜索名称、编码、条码、供应商型号、型号或颜色" className={cn('pl-9 pr-9', compact ? 'h-9' : 'h-10')} />{keyword && !localPaused && <button aria-label="清空搜索" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { if (current()) { setKeyword(''); resetSelection() } }}><X className="h-4 w-4" /></button>}</div>
        <span className="text-xs text-muted-foreground">{hasStock ? `库存参考：${warehouseName || '未指定仓库'}` : '启用商品'}</span>
      </div>
      {localPaused ? null : <div className="flex min-h-0 flex-1">
        <aside aria-label="商品分类" className={cn('shrink-0 overflow-y-auto border-r', compact ? 'w-44 px-2 py-2' : 'w-52 px-3 py-3')}>
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">商品分类</p>
          <button aria-pressed={!category} className={cn('mb-1 w-full rounded-md px-3 py-2 text-left text-sm font-medium', !category ? 'bg-primary/10 text-primary' : 'hover:bg-muted')} onClick={() => { if (current()) { setCategory(null); resetSelection() } }}>全部分类</button>
          {!categoryReadable ? <p className="px-2 py-4 text-xs text-muted-foreground">当前没有分类查看权限</p> : categories.isError ? <div className="px-2 py-4 text-xs text-muted-foreground">分类加载失败<Button size="sm" variant="ghost" onClick={() => void categories.refetch()}>重试分类</Button></div> : categories.isLoading ? <p className="px-2 py-4 text-xs text-muted-foreground">正在加载分类…</p> : <CategoryTree nodes={categories.data ?? []} selectedId={category?.id ?? null} onSelect={chooseCategory} compact={compact} />}
          {categoryReadable && !categories.isLoading && !categories.isError && !categories.data?.length && <p className="px-2 py-4 text-xs text-muted-foreground">暂无分类</p>}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn('flex shrink-0 items-center justify-between gap-3 px-4 text-xs text-muted-foreground', compact ? 'py-2' : 'py-2.5')}><span>{category ? `${category.name}（含子分类）` : '全部商品'}</span><span aria-live="polite">{pending ? '正在查询…' : query.isError ? '查询失败' : `共 ${total.toLocaleString()} 个匹配商品`}</span></div>
          <div className="min-h-0 flex-1 overflow-auto" data-table-scroll={compact ? '' : undefined} aria-busy={!!pending}>
            {query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} title={explicitContext && forbidden ? '没有商品查看权限' : '商品加载失败'} compact /> : <ResizableTable columns={[
              ...productIdentityColumns({ code: 'code', name: 'name' }).map((column, index) => ({ ...column, width: compact ? compactWidths[index] : column.width })),
              { key: 'unit', title: '单位', width: compact ? compactWidths[5] : 80 },
              { key: 'source', title: mode === 'purchase' ? '供应商' : '分类', width: compact ? compactWidths[6] : 180 },
              ...(hasStock ? [{ key: 'stock', title: '可用库存', width: 86, align: 'right' as const }] : []),
              ...(mode === 'sale' ? [{ key: 'salePrice', title: compact ? '价格 A 参考' : '参考售价', width: 106, align: 'right' as const }] : []),
            ]} columnStorageKey={`product-finder:${compact ? purchaseLayout ? 'compact-purchase' : 'compact' : 'full'}:${mode}:${hasStock ? 'stock' : 'plain'}`}
              minWidth={compact ? purchaseLayout ? hasStock ? 940 : 860 : 1024 : 1200} stickyHeader className={purchaseLayout ? 'text-[13px]' : 'text-sm'}>
              {compact && !query.isLoading && products.length >= VIRTUAL_TABLE_THRESHOLD ? <VirtualTableBody data={products} columns={columnCount} getRowKey={product => product.id} renderRow={renderRow} onScrollToIndexReady={registerScroll} /> : <tbody className="divide-y divide-border">{query.isLoading ? <tr><td colSpan={columnCount} className="py-20 text-center text-muted-foreground">正在加载商品…</td></tr> : !products.length ? <tr><td colSpan={columnCount} className="py-16 text-center"><PackageSearch className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" /><p className="font-medium">没有匹配的商品</p>{!compact && <p className="mt-1 text-xs text-muted-foreground">试试其他关键词，或切换到全部分类。</p>}</td></tr> : products.map(renderRow)}</tbody>}
            </ResizableTable>}
          </div>
        </div>
      </div>}
      {(!compact || selected) && <div className={cn('shrink-0 border-t bg-muted/20', compact ? 'px-4 py-2 whitespace-normal [overflow-wrap:anywhere]' : 'min-h-[94px] px-5 py-3')} aria-live="polite">
        {selected ? <><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-xs text-muted-foreground">已选商品</span><span className="font-medium">{selected.name}</span><span className="font-mono text-xs text-muted-foreground">{selected.code}</span></div><div className={cn('flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground', compact ? 'mt-1' : 'mt-2')}><span>分类：{selected.categoryPath || selected.categoryName || '未分类'}</span><span>供应商：{selected.supplierName || '—'}</span><span>条码：{selected.barcode || '—'}</span>{mode === 'sale' && !compact && <span>参考售价来自商品基础价格，实际成交价以订单为准。</span>}</div></> : <div className="flex items-center gap-3 py-3 text-sm text-muted-foreground"><PackageSearch className="h-5 w-5" />选择商品后，在这里核对完整分类、供应商和条码。</div>}
      </div>}
    </div>
  </AppDialog>
}
