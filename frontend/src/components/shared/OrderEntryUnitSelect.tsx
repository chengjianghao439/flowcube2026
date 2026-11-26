import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function OrderEntryUnitSelect({ label, value, units, onChange }: {
  label: string
  value: string
  units: { unitName: string }[]
  onChange: (value: string) => void
}) {
  const names = [...new Set(units.map(unit => unit.unitName).filter(Boolean))]
  if (value && !names.includes(value)) names.unshift(value)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 px-2"><SelectValue placeholder="请选择单位" /></SelectTrigger>
      <SelectContent>{names.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
    </Select>
  )
}
