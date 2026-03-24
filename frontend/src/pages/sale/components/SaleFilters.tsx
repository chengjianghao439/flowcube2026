import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'

interface SaleFiltersProps {
  search: string
  onSearchChange: (v: string) => void
  onSearch: () => void
  onReset: () => void
  statusFilter: string
  onStatusFilterChange: (v: string) => void
}

const STATUS_OPTIONS = [
  { value: '',  label: '全部状态' },
  { value: '1', label: '草稿'   },
  { value: '2', label: '已占库' },
  { value: '3', label: '拣货中' },
  { value: '4', label: '已出库' },
  { value: '5', label: '已取消' },
]

export function SaleFilters({
  search,
  onSearchChange,
  onSearch,
  onReset,
  statusFilter,
  onStatusFilterChange,
}: SaleFiltersProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="搜索单号 / 客户..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && onSearch()}
            className="h-9 w-56 pl-8 text-sm"
          />
        </div>

        {/* 状态筛选 */}
        <select
          value={statusFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onStatusFilterChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <Button size="sm" variant="outline" onClick={onSearch}>搜索</Button>
        <Button size="sm" variant="ghost"   onClick={onReset}>重置</Button>
      </div>
    </div>
  )
}
