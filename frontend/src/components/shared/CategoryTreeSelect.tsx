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

interface TreeNodeProps {
  cat: Category
  depth: number
  selectedId: number | null
  onSelect: (id: number) => void
  leafOnly: boolean
}

function flattenTree(nodes: Category[], map = new Map<number, Category>()) {
  for (const node of nodes) {
    map.set(node.id, node)
    if (node.children?.length) flattenTree(node.children, map)
  }
  return map
}

function TreeNode({ cat, depth, selectedId, onSelect, leafOnly }: TreeNodeProps) {
  const hasChildren = !!cat.children?.length
  const [expanded, setExpanded] = useState(depth < 1)
  const selectable = !leafOnly || !hasChildren
  const selected = selectedId === cat.id

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm transition-colors',
          selectable ? 'cursor-pointer border-border/70 bg-muted/20 hover:border-primary/30 hover:bg-primary/5' : 'cursor-default border-border/50 bg-muted/10',
          selected && 'border-primary/40 bg-primary/10 text-primary',
          !selectable && 'text-muted-foreground',
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => selectable && onSelect(cat.id)}
      >
        <button
          type="button"
          tabIndex={-1}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          onClick={e => {
            e.stopPropagation()
            if (hasChildren) setExpanded(v => !v)
          }}
        >
          {hasChildren
            ? expanded
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />
            : <span className="h-3.5 w-3.5" />}
        </button>
        <span className={cn('truncate', selected && 'font-medium')}>{cat.name}</span>
        {cat.status === 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">停用</span>}
      </div>

      {hasChildren && expanded && cat.children!.map(child => (
        <TreeNode
          key={child.id}
          cat={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          leafOnly={leafOnly}
        />
      ))}
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
              setOpen(false)
            }}
            disabled={disabled}
          >
            {emptyLabel}
          </button>
        )}

        <div className="max-h-80 overflow-y-auto">
          {categoryTree.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无分类</p>
          ) : (
            categoryTree.map(cat => (
              <TreeNode
                key={cat.id}
                cat={cat}
                depth={0}
                selectedId={value}
                leafOnly={leafOnly}
                onSelect={(id) => {
                  onChange(id)
                  setOpen(false)
                }}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
