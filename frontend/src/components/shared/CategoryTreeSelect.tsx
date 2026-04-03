import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderTree } from 'lucide-react'
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

function getNodesAtPath(tree: Category[], pathIds: number[]) {
  let nodes = tree
  for (const id of pathIds) {
    const current = nodes.find(item => item.id === id)
    nodes = current?.children ?? []
  }
  return nodes
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
  const [browsePath, setBrowsePath] = useState<number[]>([])

  const breadcrumb = useMemo(() => {
    if (value == null) return []
    return findPathToCategory(categoryTree, value) ?? []
  }, [categoryTree, value])

  const browseNodes = useMemo(() => getNodesAtPath(categoryTree, browsePath), [categoryTree, browsePath])
  const browseBreadcrumb = useMemo(
    () => browsePath.map(id => categoryMap.get(id)).filter(Boolean) as Category[],
    [browsePath, categoryMap],
  )
  const currentParent = browseBreadcrumb[browseBreadcrumb.length - 1] ?? null

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
            setBrowsePath([])
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

        {browsePath.length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-3 py-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setBrowsePath(prev => prev.slice(0, -1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              返回上一级
            </button>
            <span className="truncate text-xs text-muted-foreground">
              {browseBreadcrumb.map(item => item.name).join(' / ')}
            </span>
          </div>
        )}

        {!leafOnly && currentParent && (
          <button
            type="button"
            className={cn(
              'mb-2 flex w-full items-center rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-1.5 text-left text-sm transition-colors hover:border-primary/30 hover:bg-primary/5',
              value === currentParent.id && 'border-primary/40 bg-primary/10 text-primary',
            )}
            onClick={() => {
              onChange(currentParent.id)
              setOpen(false)
            }}
          >
            选择当前分类：{currentParent.name}
          </button>
        )}

        <div className="max-h-80 overflow-y-auto">
          {categoryTree.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无分类</p>
          ) : (
            <div className="space-y-2">
              {browseNodes.map(cat => {
                const hasChildren = !!cat.children?.length
                const selectable = !leafOnly || !hasChildren
                const selectedCurrent = value === cat.id
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selectedCurrent
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/70 bg-muted/20 text-foreground hover:border-primary/30 hover:bg-primary/5',
                      !selectable && 'text-muted-foreground',
                    )}
                    onClick={() => {
                      if (hasChildren) {
                        setBrowsePath(prev => [...prev, cat.id])
                        return
                      }
                      if (!selectable) return
                      onChange(cat.id)
                      setOpen(false)
                    }}
                  >
                    {hasChildren ? <ChevronRight className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0" />}
                    <span className={cn('truncate', selectedCurrent && 'font-medium')}>{cat.name}</span>
                    {cat.status === 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">停用</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
