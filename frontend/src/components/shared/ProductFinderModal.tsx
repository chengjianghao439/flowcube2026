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

import { useState, useEffect, useRef } from 'react'
import { Search, ChevronRight, ChevronDown, PackageSearch, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppDialog } from '@/components/shared/AppDialog'
import CategoryPathDisplay from '@/components/shared/CategoryPathDisplay'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Badge }  from '@/components/ui/badge'
import { useCategoryTree } from '@/hooks/useCategories'
import { useProductFinder } from '@/hooks/useProducts'
import type { Category } from '@/types/categories'
import type { ProductFinderResult } from '@/types/products'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ProductFinderModalProps {
  open: boolean
  warehouseId?: number | null
  onConfirm: (product: ProductFinderResult) => void
  onClose: () => void
}

// ─── 左侧分类树节点 ────────────────────────────────────────────────────────────

interface TreeNodeProps {
  cat: Category
  depth: number
  selectedId: number | null
  onSelect: (id: number | null) => void
}

function TreeNode({ cat, depth, selectedId, onSelect }: TreeNodeProps) {
  const hasChildren = !!(cat.children && cat.children.length > 0)
  // 前两层默认展开
  const [expanded, setExpanded] = useState(depth < 2)
  const isSelected = selectedId === cat.id

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors select-none',
          isSelected
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-foreground hover:bg-muted/60',
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => onSelect(cat.id)}
        onKeyDown={e => e.key === 'Enter' && onSelect(cat.id)}
      >
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); hasChildren && setExpanded(v => !v) }}
        >
          {hasChildren
            ? (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)
            : <span className="h-3 w-3" />}
        </button>
        <span className="truncate">{cat.name}</span>
        {cat.status === 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">停用</span>}
      </div>

      {hasChildren && expanded && cat.children!.map(child => (
        <TreeNode
          key={child.id}
          cat={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export default function ProductFinderModal({ open, warehouseId, onConfirm, onClose }: ProductFinderModalProps) {
  // ── 状态 ──
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')  // 防抖后的实际查询值
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [page,       setPage]       = useState(1)
  const [selected,   setSelected]   = useState<ProductFinderResult | null>(null)

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>()

  // 关闭时重置所有状态
  useEffect(() => {
    if (!open) {
      setKeyword('');  setSearchText('');  setCategoryId(null)
      setPage(1);      setSelected(null)
    }
  }, [open])

  // 分类切换时回第一页
  useEffect(() => { setPage(1) }, [categoryId, searchText])

  // ── 数据 ──
  const { data: categoryTree = [] } = useCategoryTree()
  const { data: finderData, isFetching } = useProductFinder(
    { page, pageSize: 15, keyword: searchText, categoryId, warehouseId: warehouseId ?? null },
    open,
  )

  const products   = finderData?.list ?? []
  const pagination = finderData?.pagination

  // ── 搜索防抖（300ms） ──
  function handleKeywordChange(val: string) {
    setKeyword(val)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setSearchText(val)
      setPage(1)
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

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 1

  return (
    <AppDialog
      open={open}
      onOpenChange={v => !v && onClose()}
      dialogId="product-finder"
      defaultWidth={900}
      defaultHeight={600}
      minWidth={640}
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
                  'flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors select-none',
                  categoryId === null
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground hover:bg-muted/60',
                )}
                onClick={() => setCategoryId(null)}
                onKeyDown={e => e.key === 'Enter' && setCategoryId(null)}
              >
                全部分类
              </div>

              {categoryTree.map(cat => (
                <TreeNode
                  key={cat.id}
                  cat={cat}
                  depth={0}
                  selectedId={categoryId}
                  onSelect={handleCategorySelect}
                />
              ))}

              {categoryTree.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无分类</p>
              )}
            </div>
          </aside>

          {/* 右侧商品列表 */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* 表头 */}
            <div className="grid shrink-0 grid-cols-[120px_1fr_180px_60px_80px] gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>编码</span>
              <span>商品名称</span>
              <span>分类路径</span>
              <span className="text-center">单位</span>
              <span className="text-right">{warehouseId ? '可用库存' : '库存'}</span>
            </div>

            {/* 表格内容（可滚动） */}
            <div className="flex-1 overflow-y-auto">
              {isFetching && products.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  <svg className="mr-2 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  加载中...
                </div>
              ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Inbox className="mb-2 h-8 w-8 opacity-30" />
                  <p className="text-sm">无匹配商品</p>
                </div>
              ) : (
                products.map(product => {
                  const isSelected = selected?.id === product.id
                  return (
                    <div
                      key={product.id}
                      role="row"
                      tabIndex={0}
                      onClick={() => setSelected(product)}
                      onDoubleClick={() => { onConfirm(product); onClose() }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') setSelected(product)
                        if (e.key === ' ') { onConfirm(product); onClose() }
                      }}
                      className={cn(
                        'grid cursor-pointer grid-cols-[120px_1fr_180px_60px_80px] gap-2 border-b px-4 py-2.5 text-sm transition-colors',
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted/40',
                      )}
                    >
                      <span className="truncate font-mono text-xs leading-5">{product.code}</span>
                      <span className="truncate font-medium leading-5">{product.name}</span>
                      <CategoryPathDisplay
                        path={product.categoryPath}
                        fallback={product.categoryName}
                        className="text-xs leading-5 text-muted-foreground"
                      />
                      <span className="text-center leading-5 text-muted-foreground">{product.unit}</span>
                      <span className={cn(
                        'text-right leading-5',
                        warehouseId && product.stock === 0 ? 'text-destructive' : '',
                        warehouseId && product.stock > 0  ? 'text-emerald-600'  : '',
                      )}>
                        {warehouseId ? product.stock : '—'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>

          </div>
        </div>
      </div>
    </AppDialog>
  )
}
