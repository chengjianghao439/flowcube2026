/**
 * ProductFinderModal — 商品选择中心（单选模式）
 *
 * 布局：
 *   ┌──────────── 顶部搜索栏（sticky） ──────────────┐
 *   │ 左侧分类树 │ 右侧商品分页表格                   │
 *   └───────── 底部已选 + 确认按钮 ──────────────────┘
 *
 * 基于 AppDialog，支持右下角拖拽 resize 和尺寸持久化。
 *
 * Props（与迁移前完全一致）：
 *   open, warehouseId, onConfirm, onClose
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, ChevronDown, ChevronRight, PackageSearch, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppDialog } from '@/components/shared/AppDialog'
import CategoryPathDisplay from '@/components/shared/CategoryPathDisplay'
import { FinderTable } from '@/components/finder/FinderTable'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Badge }  from '@/components/ui/badge'
import { useCategoryTree } from '@/hooks/useCategories'
import { useProductFinder } from '@/hooks/useProducts'
import type { Category } from '@/types/categories'
import type { FinderColumn } from '@/types/finder'
import type { ProductFinderResult } from '@/types/products'

type ProductRow = ProductFinderResult & Record<string, unknown>

/** 分类树用法提示是否已被用户关闭（跨会话记忆，避免熟手每次打开都看到同一行字） */
const CATEGORY_HINT_DISMISSED_KEY = 'flowcube-product-finder-category-hint-dismissed'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProductFinderModalProps {
  open: boolean
  warehouseId?: number | null
  onConfirm: (product: ProductFinderResult) => void
  onClose: () => void
}

// ─── 左侧分类树节点 ────────────────────────────────────────────────────────────

function findPathToCategory(nodes: Category[], targetId: number, trail: Category[] = []): Category[] | null {
  for (const node of nodes) {
    const next = [...trail, node]
    if (node.id === targetId) return next
    if (node.children?.length) {
      const found = findPathToCategory(node.children, targetId, next)
      if (found) return found
    }
  }
  return null
}

function FinderCategoryAccordion({
  nodes,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
}: {
  nodes: Category[]
  selectedId: number | null
  expandedIds: Set<number>
  onToggle: (cat: Category) => void
  onSelect: (id: number | null) => void
}) {
  return (
    <div className="space-y-2">
      {nodes.map(cat => {
        const hasChildren = !!cat.children?.length
        const selected = selectedId === cat.id
        const expanded = expandedIds.has(cat.id)
        return (
          <div key={cat.id} className="space-y-2">
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                selected
                  ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                  : 'border-border/70 bg-muted/20 text-foreground hover:border-primary/30 hover:bg-primary/5',
                expanded && hasChildren && 'border-primary/30 bg-primary/5',
              )}
              onClick={() => (hasChildren ? onToggle(cat) : onSelect(cat.id))}
            >
              {hasChildren
                ? expanded
                  ? <ChevronDown className="h-4 w-4 shrink-0" />
                  : <ChevronRight className="h-4 w-4 shrink-0" />
                : <span className="h-4 w-4 shrink-0" />}
              <span className="truncate">{cat.name}</span>
              {cat.status === 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">停用</span>}
            </button>

            {hasChildren && expanded && (
              <div className="rounded-lg border border-border/60 bg-background/80 p-2">
                <FinderCategoryAccordion
                  nodes={cat.children!}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function ProductFinderModal({ open, warehouseId, onConfirm, onClose }: ProductFinderModalProps) {
  // ── 状态 ──
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')  // 防抖后的实际查询值
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [selected,   setSelected]   = useState<ProductFinderResult | null>(null)
  const [categoryHintDismissed, setCategoryHintDismissed] = useState(
    () => localStorage.getItem(CATEGORY_HINT_DISMISSED_KEY) === '1',
  )

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // 关闭时重置所有状态
  useEffect(() => {
    if (!open) {
      setKeyword('');  setSearchText('');  setCategoryId(null)
      setSelected(null); setExpandedPath([])
    }
  }, [open])


  // ── 数据 ──
  const { data: categoryTree = [] } = useCategoryTree()
  const { data: finderData, isFetching } = useProductFinder(
    { pageSize: 99999, keyword: searchText, categoryId, warehouseId: warehouseId ?? null },
    open,
  )

  const products   = finderData?.list ?? []
  const pagination = finderData?.pagination
  const [expandedPath, setExpandedPath] = useState<number[]>([])

  const columns: FinderColumn<ProductRow>[] = useMemo(() => [
    { key: 'code', title: '编码', width: 96, render: v => <span className="font-mono text-xs">{v as string}</span> },
    { key: 'articleNumber', title: '货号', width: 96, render: v => <span className="text-xs text-muted-foreground">{(v as string) || '—'}</span> },
    { key: 'spec', title: '型号', width: 110, render: v => <span className="text-xs text-muted-foreground">{(v as string) || '—'}</span> },
    { key: 'name', title: '商品名称', render: v => <span className="font-medium">{v as string}</span> },
    { key: 'color', title: '颜色', width: 70, render: v => <span className="text-muted-foreground">{(v as string) || '—'}</span> },
    { key: 'unit', title: '单位', width: 56, align: 'center', render: v => <span className="text-muted-foreground">{v as string}</span> },
    {
      key: 'categoryPath', title: '分类路径', width: 140,
      render: (_, row) => (
        <CategoryPathDisplay path={row.categoryPath} fallback={row.categoryName} className="text-xs text-muted-foreground" />
      ),
    },
    {
      key: 'stock', title: warehouseId ? '可用库存' : '库存', width: 72, align: 'right',
      render: (_, row) => (
        <span className={cn(
          warehouseId && row.stock === 0 ? 'text-destructive' : '',
          warehouseId && row.stock > 0  ? 'text-emerald-600'  : '',
        )}>
          {warehouseId ? row.stock : '—'}
        </span>
      ),
    },
  ], [warehouseId])
  const expandedIds = useMemo(() => new Set(expandedPath), [expandedPath])
  const breadcrumb = useMemo(() => {
    if (categoryId == null) return []
    return findPathToCategory(categoryTree, categoryId) ?? []
  }, [categoryId, categoryTree])

  // ── 搜索防抖（300ms） ──
  function handleKeywordChange(val: string) {
    setKeyword(val)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setSearchText(val)
    }, 300)
  }

  function handleCategorySelect(id: number | null) {
    setCategoryId(prev => prev === id ? null : id)
  }

  function handleConfirm() {
    if (!selected) return
    onConfirm(selected)
    onClose()
  }


  return (
    <AppDialog
      open={open}
      onOpenChange={v => !v && onClose()}
      dialogId="product-finder"
      defaultWidth={1080}
      defaultHeight={600}
      minWidth={880}
      minHeight={440}
      title={
        <span className="flex items-center gap-2">
          <PackageSearch className="h-4 w-4 text-primary" />
          选择商品
        </span>
      }
      footer={
        <div className="flex items-center justify-between">
          {/* 已选商品信息 */}
          <div className="text-sm text-muted-foreground">
            {selected ? (
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">已选：</span>
                <span>{selected.name}</span>
                <span className="font-mono text-xs">({selected.code})</span>
                {selected.salePrice !== null && (
                  <span className="text-xs">· 售价 ¥{selected.salePrice}</span>
                )}
              </span>
            ) : (
              '点击行选择商品'
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!selected} onClick={handleConfirm}>确认选择</Button>
          </div>
        </div>
      }
    >
      {/*
        children 填充 AppDialog 的 Body（flex-1 overflow-hidden）
        内部用 flex-col 布局，自行控制搜索栏固定 + 内容区滚动
      */}
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── 搜索栏（固定在 Body 顶部） ── */}
        <div className="flex shrink-0 items-center gap-4 border-b px-5 py-2.5">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-sm"
              placeholder="搜索编码 / 名称 / 条码..."
              value={keyword}
              onChange={e => handleKeywordChange(e.target.value)}
            />
          </div>
          {warehouseId && (
            <Badge variant="outline" className="shrink-0 text-xs">
              含库存信息
            </Badge>
          )}
        </div>

        {/* ── 主体：左侧分类树 + 右侧商品列表 ── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* 左侧分类树 */}
          <aside className="flex w-48 shrink-0 flex-col overflow-y-auto border-r">
            <div className="p-2">
              {/* 全部分类 */}
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 px-3 py-1.5 text-sm transition-colors select-none',
                  categoryId === null
                    ? 'border-primary/40 bg-primary/10 font-medium text-primary'
                    : 'text-foreground hover:border-primary/30 hover:bg-primary/5',
                )}
                onClick={() => setCategoryId(null)}
                onKeyDown={e => e.key === 'Enter' && setCategoryId(null)}
              >
                全部分类
              </div>

              {breadcrumb.length > 0 && (
                <div className="mb-2 rounded-md border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                  当前路径：{breadcrumb.map(item => item.name).join(' / ')}
                </div>
              )}

              {!categoryHintDismissed && (
                <div className="relative mb-2 rounded-md border border-border/60 bg-muted/20 py-2 pl-3 pr-7 text-xs text-muted-foreground">
                  默认显示一级分类，点击当前分类展开或收起下一级
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryHintDismissed(true)
                      localStorage.setItem(CATEGORY_HINT_DISMISSED_KEY, '1')
                    }}
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="不再显示此提示"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <FinderCategoryAccordion
                nodes={categoryTree}
                selectedId={categoryId}
                expandedIds={expandedIds}
                onToggle={(cat) => {
                  const path = findPathToCategory(categoryTree, cat.id)?.map(item => item.id) ?? [cat.id]
                  setExpandedPath(prev =>
                    prev.length === path.length && prev.every((item, index) => item === path[index])
                      ? prev.slice(0, -1)
                      : path,
                  )
                }}
                onSelect={(id) => {
                  handleCategorySelect(id)
                }}
              />

              {categoryTree.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无分类</p>
              )}
            </div>
          </aside>

          {/* 右侧商品列表：复用通用 FinderTable（行渲染/键盘导航/加载与空状态与其他 Finder 保持一致） */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <FinderTable
                columns={columns}
                data={products as ProductRow[]}
                selected={selected as ProductRow | null}
                onSelect={setSelected}
                onDoubleClickRow={p => { onConfirm(p); onClose() }}
                getRowKey={p => p.id}
                isLoading={isFetching}
                emptyText="无匹配商品"
              />
            </div>
          </div>
        </div>
      </div>
    </AppDialog>
  )
}
