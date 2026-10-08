import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { useCategoryTree } from '@/hooks/useCategories'
import type { Category } from '@/types/categories'
import type { ProductFinderReadContext } from '@/hooks/useProducts'
import { QueryErrorState } from '@/components/shared/QueryErrorState'

const EMPTY_CATEGORIES: Category[] = []

export interface CategoryFinderProps {
  open: boolean
  onClose: () => void
  onConfirm: (category: { id: number; name: string }) => void
  value?: number | null
  leafOnly?: boolean
  context?: ProductFinderReadContext
}

function CategoryTree({
  nodes,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  leafOnly,
}: {
  nodes: Category[]
  selectedId: number | null
  expandedIds: Set<number>
  onToggle: (id: number) => void
  onSelect: (cat: Category) => void
  leafOnly: boolean
}) {
  return (
    <div className="space-y-1">
      {nodes.map(cat => {
        const hasChildren = !!cat.children?.length
        const selectable = !leafOnly || !hasChildren
        const selected = selectedId === cat.id
        const expanded = expandedIds.has(cat.id)
        return (
          <div key={cat.id}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                selected
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/70 bg-muted/20 text-foreground hover:border-primary/30 hover:bg-primary/5',
                !selectable && 'text-muted-foreground',
                expanded && hasChildren && 'border-primary/30 bg-primary/5',
              )}
              onClick={() => {
                if (hasChildren) {
                  onToggle(cat.id)
                  return
                }
                if (!selectable) return
                onSelect(cat)
              }}
            >
              {hasChildren
                ? expanded
                  ? <ChevronDown className="h-4 w-4 shrink-0" />
                  : <ChevronRight className="h-4 w-4 shrink-0" />
                : <span className="h-4 w-4 shrink-0" />}
              <span className={cn('min-w-0 break-words leading-5', selected && 'font-medium')}>{cat.name}</span>
              {cat.status === 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">停用</span>}
            </button>
            {hasChildren && expanded && (
              <div className="ml-5 mt-1 border-l border-border pl-3">
                <CategoryTree
                  nodes={cat.children!}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  leafOnly={leafOnly}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function CategoryFinder({ open, onClose, onConfirm, value, leafOnly = true, context }: CategoryFinderProps) {
  const query = useCategoryTree(context ? { ...context, enabled: open && context.enabled } : undefined)
  function current() {
    if (!context) return true
    if (!open || !context.enabled) return false
    try { context.assertCurrent(); return true } catch { return false }
  }
  const readable = current()
  const categoryTree = readable ? query.data ?? EMPTY_CATEGORIES : EMPTY_CATEGORIES
  const ready = !context || (readable && !query.isFetching && !query.isError)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedId(value ?? null)
      setExpandedIds(new Set())
    }
  }, [open, value])

  const selectedName = useMemo(() => {
    if (selectedId == null) return ''
    const find = (nodes: Category[]): string | null => {
      for (const n of nodes) {
        if (n.id === selectedId) return n.name
        if (n.children?.length) {
          const r = find(n.children)
          if (r) return r
        }
      }
      return null
    }
    return find(categoryTree) ?? ''
  }, [selectedId, categoryTree])

  function handleToggle(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelect(cat: Category) {
    if (!ready || !current()) return
    onConfirm({ id: cat.id, name: cat.name })
    onClose()
  }

  function handleConfirm() {
    if (selectedId == null || !ready || !current() || (context && !selectedName)) return
    onConfirm({ id: selectedId, name: selectedName })
    onClose()
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="category-finder"
      title={<span className="flex items-center gap-2"><FolderTree className="h-4 w-4 text-primary" />选择分类</span>}
      defaultWidth={640}
      defaultHeight={560}
      minWidth={320}
      minHeight={300}
      footer={
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">{selectedName ? `当前分类：${selectedName}` : '展开分类后点击末级分类填入'}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleConfirm} disabled={selectedId == null || !ready || (!!context && !selectedName)}>确认</Button>
          </div>
        </div>
      }
    >
      {context && !readable ? <p role="status" className="p-5 text-sm text-muted-foreground">资料读取已暂停，当前草稿仍保留。</p> : context && query.isError ? <QueryErrorState error={query.error} title="分类加载失败" onRetry={() => { if (current()) void query.refetch() }} /> : context && query.isFetching ? <p role="status" className="p-5 text-sm text-muted-foreground">正在加载分类…</p> : categoryTree.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无分类</p>
      ) : (
        <div className="h-full overflow-y-auto p-4">
          <CategoryTree
            nodes={categoryTree}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onToggle={handleToggle}
            onSelect={handleSelect}
            leafOnly={leafOnly}
          />
        </div>
      )}
    </AppDialog>
  )
}
