import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { useCategoryTree } from '@/hooks/useCategories'
import type { Category } from '@/types/categories'

export interface CategoryFinderProps {
  open: boolean
  onClose: () => void
  onConfirm: (category: { id: number; name: string }) => void
  value?: number | null
  leafOnly?: boolean
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
              <span className={cn('truncate', selected && 'font-medium')}>{cat.name}</span>
              {cat.status === 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">停用</span>}
            </button>
            {hasChildren && expanded && (
              <div className="ml-4 mt-1 rounded-lg border border-border/60 bg-background/80 p-2">
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

export function CategoryFinder({ open, onClose, onConfirm, value, leafOnly = true }: CategoryFinderProps) {
  const { data: categoryTree = [] } = useCategoryTree()
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
    onConfirm({ id: cat.id, name: cat.name })
    onClose()
  }

  function handleConfirm() {
    if (selectedId == null) return
    onConfirm({ id: selectedId, name: selectedName })
    onClose()
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="category-finder"
      title={<span className="flex items-center gap-2"><FolderTree className="h-4 w-4 text-primary" />选择分类</span>}
      defaultWidth={420}
      defaultHeight={480}
      minWidth={320}
      minHeight={300}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{selectedName || '未选择'}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleConfirm} disabled={selectedId == null}>确认</Button>
          </div>
        </div>
      }
    >
      {categoryTree.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无分类</p>
      ) : (
        <div className="h-full overflow-y-auto p-1">
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
