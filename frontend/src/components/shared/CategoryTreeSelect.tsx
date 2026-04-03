import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCategoryTree } from '@/hooks/useCategories'
import type { Category } from '@/types/categories'

interface CategoryTreeSelectProps {
  value: number | null
  onChange: (value: number | null) => void
  placeholder?: string
  emptyLabel?: string
  className?: string
  contentClassName?: string
  allowClear?: boolean
  leafOnly?: boolean
  disabled?: boolean
}

function flattenTree(nodes: Category[], map = new Map<number, Category>()) {
  for (const node of nodes) {
    map.set(node.id, node)
    if (node.children?.length) flattenTree(node.children, map)
  }
  return map
}

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

function CategoryAccordionLevel({
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
  onToggle: (cat: Category) => void
  onSelect: (cat: Category) => void
  leafOnly: boolean
}) {
  return (
    <div className="space-y-2">
      {nodes.map(cat => {
        const hasChildren = !!cat.children?.length
        const selectable = !leafOnly || !hasChildren
        const selected = selectedId === cat.id
        const expanded = expandedIds.has(cat.id)
        return (
          <div key={cat.id} className="space-y-2">
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                selected
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/70 bg-muted/20 text-foreground hover:border-primary/30 hover:bg-primary/5',
                !selectable && 'text-muted-foreground',
                expanded && hasChildren && 'border-primary/30 bg-primary/5',
              )}
              onClick={() => {
                if (hasChildren) {
                  onToggle(cat)
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
              <div className="rounded-xl border border-border/60 bg-background/80 p-2">
                <CategoryAccordionLevel
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

export default function CategoryTreeSelect({
  value,
  onChange,
  placeholder = '请选择分类',
  emptyLabel = '全部分类',
  className,
  contentClassName,
  allowClear = true,
  leafOnly = false,
  disabled = false,
}: CategoryTreeSelectProps) {
  const [open, setOpen] = useState(false)
  const { data: categoryTree = [] } = useCategoryTree()

  const categoryMap = useMemo(() => flattenTree(categoryTree), [categoryTree])
  const selected = value == null ? null : categoryMap.get(value) ?? null
  const [expandedPath, setExpandedPath] = useState<number[]>([])
  const expandedIds = useMemo(() => new Set(expandedPath), [expandedPath])

  const breadcrumb = useMemo(() => {
    if (value == null) return []
    return findPathToCategory(categoryTree, value) ?? []
  }, [categoryTree, value])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('h-9 w-56 justify-between border-border/80 bg-background font-normal', className)}
          disabled={disabled}
        >
          <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
            {selected?.name ?? (value == null ? emptyLabel : placeholder)}
          </span>
          <FolderTree className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className={cn('w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 p-2', contentClassName)}
      >
        {allowClear && (
          <button
            type="button"
            className={cn(
              'mb-1 flex w-full items-center rounded-md border border-border/70 bg-muted/20 px-3 py-1.5 text-left text-sm transition-colors hover:border-primary/30 hover:bg-primary/5',
              value == null && 'border-primary/40 bg-primary/10 text-primary',
            )}
            onClick={() => {
              onChange(null)
              setExpandedPath([])
              setOpen(false)
            }}
            disabled={disabled}
          >
            {emptyLabel}
          </button>
        )}

        {breadcrumb.length > 0 && (
          <div className="mb-2 rounded-md border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
            当前路径：{breadcrumb.map(item => item.name).join(' / ')}
          </div>
        )}

        <div className="mb-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          默认显示一级分类，点击当前分类展开或收起下一级
        </div>

        <div className="max-h-80 overflow-y-auto">
          {categoryTree.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无分类</p>
          ) : (
            <CategoryAccordionLevel
              nodes={categoryTree}
              selectedId={value}
              leafOnly={leafOnly}
              expandedIds={expandedIds}
              onToggle={(cat) => {
                const path = findPathToCategory(categoryTree, cat.id)?.map(item => item.id) ?? [cat.id]
                setExpandedPath(prev =>
                  prev.length === path.length && prev.every((item, index) => item === path[index])
                    ? prev.slice(0, -1)
                    : path,
                )
              }}
              onSelect={(cat) => {
                onChange(cat.id)
                setOpen(false)
              }}
            />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
