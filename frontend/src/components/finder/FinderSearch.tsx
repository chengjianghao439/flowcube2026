import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface FinderSearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}

export function FinderSearch({ value, onChange, placeholder = '搜索...', autoFocus }: FinderSearchProps) {
  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-8 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </div>
  )
}
