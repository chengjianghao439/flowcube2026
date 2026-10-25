import { Activity, CalendarClock, ClipboardList, History, PackageCheck, ScanLine } from 'lucide-react'
import { DetailViewTabsList, DetailViewTabsTrigger } from '@/components/shared/DetailViewTabs'

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
  return <DetailViewTabsList className="fc-detail-view-tabs-wide">
    {tabs.map(([key, label, Icon]) => <DetailViewTabsTrigger key={key} aria-pressed={value === key} onClick={() => onChange(key)}>
      <Icon className="h-4 w-4" aria-hidden />{label}
    </DetailViewTabsTrigger>)}
  </DetailViewTabsList>
}
