import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useEffect, useState } from 'react'
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

export interface ProductFinderModalProps {
  open: boolean
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
      <button type="button" aria-pressed={selectedId === node.id} title={node.name} className="min-w-0 flex-1 truncate rounded py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSelect(node.id, node.name)}>{node.name}</button>
      {node.status === 0 && <span className="ml-1 text-[10px]">停用分类</span>}
    </div>
    {!!node.children?.length && expanded.has(node.id) && <CategoryTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />}
  </div>)}</div>
}

/** 全局商品选择：关闭即卸载草稿，仓库或场景变化同样清空选择。 */
export default function ProductFinderModal(props: ProductFinderModalProps) {
  return props.open ? <ProductFinderContent key={`${props.mode ?? 'lookup'}-${props.warehouseId ?? 'none'}`} {...props} /> : null
}
function ProductFinderContent({ warehouseId, warehouseName, mode = 'lookup', onConfirm, onClose }: ProductFinderModalProps) {
  const [keyword, setKeyword] = useState('')
  const [searchText, setSearchText] = useState('')
  const [category, setCategory] = useState<{ id: number; name: string } | null>(null)
  const [selected, setSelected] = useState<ProductFinderResult | null>(null)
  const categories = useCategoryTree()
  const query = useProductFinder({ page: 1, pageSize: PAGE_SIZE, keyword: searchText, categoryId: category?.id ?? null, warehouseId: warehouseId ?? null })
  useEffect(() => { const timer = setTimeout(() => setSearchText(keyword.trim()), 300); return () => clearTimeout(timer) }, [keyword])
  const pending = keyword.trim() !== searchText || query.isFetching || query.isPlaceholderData
  const products = query.data?.list ?? []
  const total = query.data?.pagination.total ?? 0
  const canConfirm = selected && !pending && !query.isError && products.some(p => p.id === selected.id)
  const resetSelection = () => { setSelected(null) }
  const chooseCategory = (id: number, name: string) => { setCategory({ id, name }); resetSelection() }
  const confirm = (product: ProductFinderResult) => { if (pending || query.isError) return; onConfirm(product); onClose() }
  const hasStock = warehouseId != null && warehouseId > 0
  const columnCount = 8 + (hasStock ? 1 : 0) + (mode === 'sale' ? 1 : 0)

  return <AppDialog open onOpenChange={value => { if (!value) onClose() }} dialogId="product-finder-v2" defaultWidth={1200} defaultHeight={730} minWidth={960} minHeight={560}
    title={<span className="flex items-center gap-2"><PackageSearch className="h-4 w-4 text-primary" />选择商品</span>}
    footer={<div className="flex items-center justify-between gap-5"><p className="text-xs text-muted-foreground">单击选择 · 双击或选中后按 Enter 确认</p><div className="flex shrink-0 gap-2"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!canConfirm} onClick={() => { if (selected) confirm(selected) }}>确认选择</Button></div></div>}>
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-4 border-b px-5 py-3">
        <div className="relative max-w-2xl flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus aria-label="搜索商品" value={keyword} onChange={e => { setKeyword(e.target.value); resetSelection() }} placeholder="搜索名称、编码、条码、供应商型号、型号或颜色" className="h-10 pl-9 pr-9" />{keyword && <button aria-label="清空搜索" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { setKeyword(''); resetSelection() }}><X className="h-4 w-4" /></button>}</div>
        <span className="text-xs text-muted-foreground">{hasStock ? `库存参考：${warehouseName || `仓库 #${warehouseId}`}` : '启用商品'}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="商品分类" className="w-52 shrink-0 overflow-y-auto border-r px-3 py-3">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">商品分类</p>
          <button aria-pressed={!category} className={cn('mb-1 w-full rounded-md px-3 py-2 text-left text-sm font-medium', !category ? 'bg-primary/10 text-primary' : 'hover:bg-muted')} onClick={() => { setCategory(null); resetSelection() }}>全部分类</button>
          {categories.isError ? <div className="px-2 py-4 text-xs text-muted-foreground">分类加载失败<Button size="sm" variant="ghost" onClick={() => void categories.refetch()}>重试分类</Button></div> : categories.isLoading ? <p className="px-2 py-4 text-xs text-muted-foreground">加载分类…</p> : <CategoryTree nodes={categories.data ?? []} selectedId={category?.id ?? null} onSelect={chooseCategory} />}
          {!categories.isLoading && !categories.isError && !categories.data?.length && <p className="px-2 py-4 text-xs text-muted-foreground">暂无分类</p>}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground"><span>{category ? `${category.name}（含子分类）` : '全部商品'}</span><span aria-live="polite">{pending ? '正在查询…' : query.isError ? '查询失败' : `共 ${total.toLocaleString()} 个匹配商品`}</span></div>
          <div className="min-h-0 flex-1 overflow-auto" aria-busy={!!pending}>
            {query.isError ? <QueryErrorState error={query.error} onRetry={() => void query.refetch()} title="商品加载失败" compact /> : <table className="w-full min-w-[1200px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground"><tr><th className="w-9 py-3"><span className="sr-only">选择</span></th><ProductIdentityHeaders /><th className="w-16 px-2 py-3 font-medium">单位</th><th className="px-3 py-3 font-medium">{mode === 'purchase' ? '供应商' : '分类'}</th>{hasStock && <th className="w-24 px-3 py-3 text-right font-medium">可用库存</th>}{mode === 'sale' && <th className="w-28 px-3 py-3 text-right font-medium">参考售价</th>}</tr></thead>
              <tbody className="divide-y divide-border">{query.isLoading ? <tr><td colSpan={columnCount} className="py-20 text-center text-muted-foreground">加载商品…</td></tr> : !products.length ? <tr><td colSpan={columnCount} className="py-16 text-center"><PackageSearch className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" /><p className="font-medium">没有匹配的商品</p><p className="mt-1 text-xs text-muted-foreground">试试其他关键词，或切换到全部分类。</p></td></tr> : products.map(product => <tr key={product.id} aria-selected={selected?.id === product.id} tabIndex={pending ? -1 : 0} onClick={() => { if (!pending) setSelected(product) }} onDoubleClick={() => confirm(product)} onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); if (!pending) setSelected(product) } if (e.key === 'Enter') { e.preventDefault(); if (selected?.id === product.id) confirm(product); else if (!pending) setSelected(product) } }} className={cn('cursor-pointer align-top outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', pending ? 'opacity-50' : selected?.id === product.id ? 'bg-primary/[0.07]' : 'hover:bg-muted/50')}>
                <td className="py-4 pl-3 text-primary">{selected?.id === product.id && <Check className="h-4 w-4" />}</td>
                <ProductIdentityCells product={product} />
                <td className="px-2 py-3 text-muted-foreground">{product.unit || '—'}</td><td className="break-words px-3 py-3 text-xs leading-5 text-muted-foreground">{mode === 'purchase' ? product.supplierName || '—' : product.categoryName || '未分类'}</td>
                {hasStock && <td className="px-3 py-3 text-right tabular-nums">{product.stock}</td>}{mode === 'sale' && <td className="px-3 py-3 text-right tabular-nums">{product.salePrice == null ? '—' : `¥${product.salePrice.toFixed(2)}`}</td>}
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
