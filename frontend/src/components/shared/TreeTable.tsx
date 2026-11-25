import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilterCard } from './FilterCard'

export function TreeTableFilters({ label, value, onChange, searching, expandAll, collapseAll }: {
  label: string
  value: string
  onChange: (value: string) => void
  searching: boolean
  expandAll: () => void
  collapseAll: () => void
}) {
  return <FilterCard>
    <Input type="search" aria-label={label} placeholder={label} value={value}
      onChange={event => onChange(event.target.value)} className="h-9 w-60 max-w-full" />
    {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}>重置</Button>}
    <div role="group" aria-label="层级显示" className="ml-auto flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={searching} onClick={expandAll}>
        <ChevronsUpDown aria-hidden />全部展开
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={searching} onClick={collapseAll}>
        <ChevronsDownUp aria-hidden />全部收起
      </Button>
    </div>
  </FilterCard>
}

export function TreeTableName({ depth, expandable, expanded, searching, label, onToggle, children }: {
  depth: number
  expandable: boolean
  expanded: boolean
  searching: boolean
  label: string
  onToggle: () => void
  children: ReactNode
}) {
  return <div className="flex items-center gap-1" style={{ paddingInlineStart: depth * 16 }}>
    {expandable ? <button type="button" aria-expanded={expanded}
      aria-label={searching ? `搜索结果已展开 ${label}` : `${expanded ? '收起' : '展开'} ${label}`}
      disabled={searching}
      title={searching ? '搜索结果自动展开匹配路径' : undefined}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
      onClick={onToggle}
      onKeyDown={event => {
        if ((event.key === 'ArrowRight' && !expanded) || (event.key === 'ArrowLeft' && expanded)) {
          event.preventDefault()
          onToggle()
        }
      }}>
      {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
    </button> : <span className="size-6 shrink-0" aria-hidden />}
    <span className="min-w-0 whitespace-normal font-medium [overflow-wrap:anywhere]">{children}</span>
  </div>
}
