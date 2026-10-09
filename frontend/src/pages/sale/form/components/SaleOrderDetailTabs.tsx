import { Activity, CalendarClock, ClipboardList, History, PackageCheck, ScanLine } from 'lucide-react'

export type SaleDetailTab = 'info' | 'fulfillment' | 'progress' | 'scan' | 'pack' | 'log'

const tabs = [
  ['info', '订单信息', ClipboardList],
  ['fulfillment', '发货安排', CalendarClock],
  ['progress', '作业进度', Activity],
  ['scan', '拣货明细', ScanLine],
  ['pack', '装箱进度', PackageCheck],
  ['log', '操作记录', History],
] as const

export function SaleOrderDetailTabs({ value, onChange }: { value: SaleDetailTab; onChange: (tab: SaleDetailTab) => void }) {
  return <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1">
    {tabs.map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
      className={`flex min-w-28 flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] ${value === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      <Icon className="h-4 w-4" />{label}
    </button>)}
  </div>
}
