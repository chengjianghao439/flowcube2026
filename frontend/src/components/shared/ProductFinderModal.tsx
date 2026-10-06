import { money } from '@/lib/format'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronDown, ChevronRight, PackageSearch, Search, X } from 'lucide-react'
import { AppDialog } from '@/components/shared/AppDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
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

export interface ProductFinderModalProps {
  open: boolean
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
function CategoryTree({ nodes, selectedId, onSelect, depth = 0 }: {
  nodes: Category[]; selectedId: number | null; onSelect: (id: number, name: string) => void; depth?: number
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  return <div className="space-y-0.5">{nodes.map(node => <div key={node.id}>
    <div className={cn('flex items-center rounded-md pr-2', selectedId === node.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/70')} style={{ paddingLeft: depth * 14 }}>
      {node.children?.length ? <button type="button" aria-label={`${expanded.has(node.id) ? '收起' : '展开'}${node.name}`} aria-expanded={expanded.has(node.id)} className="shrink-0 rounded p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}>
        {expanded.has(node.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button> : <span className="w-[26px] shrink-0" />}
      <button type="button" aria-pressed={selectedId === node.id} title={node.name} className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere] rounded py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(node.id, node.name)}>{node.name}</button>
      {node.status === 0 && <span className="ml-1 text-[10px]">停用分类</span>}
    </div>
    {!!node.children?.length && expanded.has(node.id) && <CategoryTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />}
  </div>)}</div>
}

/** 全局商品选择：关闭即卸载草稿，仓库或场景变化同样清空选择。 */
export default function ProductFinderModal(props: ProductFinderModalProps) {
  const visited = useRef(false)
  if (props.open) visited.current = true
  if (props.readOwner) return visited.current ? <ProductFinderContent {...props} /> : null
  return props.open ? <ProductFinderContent key={`${props.mode ?? 'lookup'}-${props.warehouseId ?? 'none'}`} {...props} /> : null
}
const noSubscription = () => () => {}
function ProductFinderContent({ open, readOwner, readGuard, warehouseId, warehouseName, mode = 'lookup', onConfirm, onClose }: ProductFinderModalProps) {
  const active = useSectionActive()
  useSyncExternalStore(readOwner ? subscribeReorder : noSubscription, reorderEpoch)
  const readable = !readOwner || (open && active && reorderOwnerCurrent(readOwner) && mayReorder(PERMISSIONS.PRODUCT_VIEW) && (!readGuard || readGuard()))
  const scope = JSON.stringify([readOwner, warehouseId, mode])
  const context = useRef({ scope, readable, serial: 0 })
  if (readOwner && (context.current.scope !== scope || context.current.readable !== readable)) context.current = { scope, readable, serial: context.current.serial + 1 }
  const latest = useRef({ readGuard, open, active, readOwner })
  latest.current = { readGuard, open, active, readOwner }
  const serial = context.current.serial
  const current = () => !readOwner || (context.current.serial === serial && context.current.readable && latest.current.open && latest.current.active && latest.current.readOwner === readOwner
    && reorderOwnerCurrent(readOwner) && mayReorder(PERMISSIONS.PRODUCT_VIEW) && (!latest.current.readGuard || latest.current.readGuard()))
  const assertCurrent = () => { if (!current()) throw new Error('原选品读取已暂停，输入保留，请回原草稿核对') }
  const readContext = readOwner ? { key: ['repeat', scope, serial], config: { ...reorderConfig(readOwner), automaticReplay: false as const }, enabled: readable, assertCurrent } : undefined
  const [keyword, setKeyword] = useState('')
  const [searchText, setSearchText] = useState('')
  const [category, setCategory] = useState<{ id: number; name: string } | null>(null)
  // 只存 id，选中对象一律**从当前列表派生**：后台 refetch 后行已更新时，摘要/高亮/确认都跟着当前值，
  // 不会把"选中那一刻"的旧对象回传出去（原缺陷：页脚确认回传过期行）。
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const categoryReadable = !readOwner || (readable && mayReorder(PERMISSIONS.CATEGORY_VIEW))
  const categories = useCategoryTree(readContext ? { ...readContext, enabled: categoryReadable, assertCurrent: () => { assertCurrent(); if (!mayReorder(PERMISSIONS.CATEGORY_VIEW)) throw new Error('当前没有分类查看权限') } } : undefined)
  const query = useProductFinder({ page: 1, pageSize: PAGE_SIZE, keyword: searchText, categoryId: category?.id ?? null, warehouseId: warehouseId ?? null }, true, readContext)
  useEffect(() => { const timer = setTimeout(() => setSearchText(keyword.trim()), 300); return () => clearTimeout(timer) }, [keyword])
  const pending = keyword.trim() !== searchText || query.isFetching || query.isPlaceholderData
  const products = readable ? query.data?.list ?? [] : []
  const total = query.data?.pagination.total ?? 0
  const selected = selectedId != null ? products.find(p => p.id === selectedId) ?? null : null
  const canConfirm = selected != null && !pending && !query.isError
  const resetSelection = () => { setSelectedId(null) }
  const chooseCategory = (id: number, name: string) => { if (current()) { setCategory({ id, name }); resetSelection() } }
  const confirm = (product: ProductFinderResult) => {
    if (!current() || pending || query.isError) return
    const value = { ...product }
    delete value.searchMatch
    onConfirm(value); onClose()
  }
  const hasStock = warehouseId != null && warehouseId > 0
  const columnCount = 8 + (hasStock ? 1 : 0) + (mode === 'sale' ? 1 : 0)

  return <AppDialog open={readable} onOpenChange={value => { if (!value && current()) onClose() }} dialogId="product-finder-v2" defaultWidth={1200} defaultHeight={730} minWidth={960} minHeight={560}
    title={<span className="flex items-center gap-2"><PackageSearch className="h-4 w-4 text-primary" />选择商品</span>}
    footer={<div className="flex items-center justify-between gap-5"><p className="text-xs text-muted-foreground">单击选择 · 双击或选中后按 Enter 确认</p><div className="flex shrink-0 gap-2"><Button variant="outline" onClick={() => { if (current()) onClose() }}>取消</Button><Button disabled={!canConfirm} onClick={() => { if (selected) confirm(selected) }}>确认选择</Button></div></div>}>
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-4 border-b px-5 py-3">
        <div className="relative max-w-2xl flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus aria-label="搜索商品" value={keyword} onChange={e => { if (current()) { setKeyword(e.target.value); resetSelection() } }} placeholder="搜索名称、编码、条码、供应商型号、型号或颜色" className="h-10 pl-9 pr-9" />{keyword && <button aria-label="清空搜索" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { if (current()) { setKeyword(''); resetSelection() } }}><X className="h-4 w-4" /></button>}</div>
        <span className="text-xs text-muted-foreground">{hasStock ? `库存参考：${warehouseName || '未指定仓库'}` : '启用商品'}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="商品分类" className="w-52 shrink-0 overflow-y-auto border-r px-3 py-3">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">商品分类</p>
          <button aria-pressed={!category} className={cn('mb-1 w-full rounded-md px-3 py-2 text-left text-sm font-medium', !category ? 'bg-primary/10 text-primary' : 'hover:bg-muted')} onClick={() => { if (current()) { setCategory(null); resetSelection() } }}>全部分类</button>
          {!categoryReadable ? <p className="px-2 py-4 text-xs text-muted-foreground">当前没有分类查看权限</p> : categories.isError ? <div className="px-2 py-4 text-xs text-muted-foreground">分类加载失败<Button size="sm" variant="ghost" onClick={() => void categories.refetch()}>重试分类</Button></div> : categories.isLoading ? <p className="px-2 py-4 text-xs text-muted-foreground">正在加载分类…</p> : <CategoryTree nodes={categories.data ?? []} selectedId={category?.id ?? null} onSelect={chooseCategory} />}
          {categoryReadable && !categories.isLoading && !categories.isError && !categories.data?.length && <p className="px-2 py-4 text-xs text-muted-foreground">暂无分类</p>}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground"><span>{category ? `${category.name}（含子分类）` : '全部商品'}</span><span aria-live="polite">{pending ? '正在查询…' : query.isError ? '查询失败' : `共 ${total.toLocaleString()} 个匹配商品`}</span></div>
          <div className="min-h-0 flex-1 overflow-auto" aria-busy={!!pending}>
            {query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} title="商品加载失败" compact /> : <table className="w-full min-w-[1200px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground"><tr><th className="w-9 py-3"><span className="sr-only">选择</span></th><ProductIdentityHeaders /><th className="w-16 px-2 py-3 font-medium">单位</th><th className="px-3 py-3 font-medium">{mode === 'purchase' ? '供应商' : '分类'}</th>{hasStock && <th className="w-24 px-3 py-3 text-right font-medium">可用库存</th>}{mode === 'sale' && <th className="w-28 px-3 py-3 text-right font-medium">参考售价</th>}</tr></thead>
              <tbody className="divide-y divide-border">{query.isLoading ? <tr><td colSpan={columnCount} className="py-20 text-center text-muted-foreground">正在加载商品…</td></tr> : !products.length ? <tr><td colSpan={columnCount} className="py-16 text-center"><PackageSearch className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" /><p className="font-medium">没有匹配的商品</p><p className="mt-1 text-xs text-muted-foreground">试试其他关键词，或切换到全部分类。</p></td></tr> : products.map(product => <tr key={product.id} aria-selected={selectedId === product.id} tabIndex={pending ? -1 : 0} onClick={() => { if (current() && !pending) setSelectedId(product.id) }} onDoubleClick={() => confirm(product)} onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); if (current() && !pending) setSelectedId(product.id) } if (e.key === 'Enter') { e.preventDefault(); if (selectedId === product.id) confirm(product); else if (current() && !pending) setSelectedId(product.id) } }} className={cn('cursor-pointer align-top outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', pending ? 'opacity-50' : selectedId === product.id ? 'bg-primary/[0.07]' : 'hover:bg-muted/50')}>
                <td className="py-4 pl-3 text-primary">{selectedId === product.id && <Check className="h-4 w-4" />}</td>
                <ProductIdentityCells product={product} nameContent={<><span>{product.name}</span>{!pending && searchText && product.searchMatch && <span className="block text-xs leading-5 text-muted-foreground">命中：{product.searchMatch}</span>}</>} />
                <td className="px-2 py-3 text-muted-foreground"><span>{product.unit || '—'}</span>{product.allowDecimalQty === false && <span className="ml-1 rounded bg-warning/10 px-1 text-xs text-warning">只能整数</span>}</td><td className="break-words px-3 py-3 text-xs leading-5 text-muted-foreground">{mode === 'purchase' ? product.supplierName || '—' : product.categoryName || '未分类'}</td>
                {hasStock && <td className="px-3 py-3 text-right tabular-nums">{product.stock}</td>}{mode === 'sale' && <td className="px-3 py-3 text-right tabular-nums">{product.salePrice == null ? '—' : money(product.salePrice)}</td>}
              </tr>)}</tbody>
            </table>}
          </div>
        </div>
      </div>
      <div className="min-h-[94px] shrink-0 border-t bg-muted/20 px-5 py-3" aria-live="polite">
        {selected ? <><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-xs text-muted-foreground">已选商品</span><span className="font-medium">{selected.name}</span><span className="font-mono text-xs text-muted-foreground">{selected.code}</span></div><div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground"><span>分类：{selected.categoryPath || selected.categoryName || '未分类'}</span><span>供应商：{selected.supplierName || '—'}</span><span>条码：{selected.barcode || '—'}</span>{mode === 'sale' && <span>参考售价来自商品基础价格，实际成交价以订单为准。</span>}</div></> : <div className="flex items-center gap-3 py-3 text-sm text-muted-foreground"><PackageSearch className="h-5 w-5" />选择商品后，在这里核对完整分类、供应商和条码。</div>}
      </div>
    </div>
  </AppDialog>
}
