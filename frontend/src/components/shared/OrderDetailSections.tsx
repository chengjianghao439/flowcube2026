import { useEffect, useId, useState, type ReactNode } from 'react'
import { Activity, ClipboardList, History, PackageCheck, Printer, ScanLine } from 'lucide-react'
import type { ActivityView, DocumentType } from '@/api/document-activity'
import { DocumentActivityPanel } from './DocumentActivityPanel'
interface Props { type: DocumentType; id: number; children: ReactNode; progress?: ReactNode; printProgress?: ReactNode; initialView?: 'info' | ActivityView }
export function OrderDetailSections(props: Props) { return props.id > 0 ? <DetailSections key={`${props.type}-${props.id}-${props.initialView || 'info'}`} {...props} /> : <>{props.children}</> }
function DetailSections({ type, id, children, progress, printProgress, initialView }: Props) {
  const prefix = useId()
  const [selected, setSelected] = useState<'info' | ActivityView>(initialView || (typeof window !== 'undefined' && /[?&]focus=/.test(window.location.hash) ? (/[?&]focus=print(?:&|$)/.test(window.location.hash) ? 'print' : 'progress') : 'info'))
  useEffect(() => {
    const path = type === 'inbound' ? '/inbound-tasks' : `/${type}`
    const focus = () => {
      const [pathname, search = ''] = window.location.hash.slice(1).split('?')
      if (pathname === `${path}/${id}` && new URLSearchParams(search).get('focus') === 'fulfillment') setSelected('progress')
    }
    window.addEventListener('hashchange', focus)
    return () => window.removeEventListener('hashchange', focus)
  }, [type, id])
  const progressLabel = type === 'purchase' ? '收货进度' : ['requisition', 'credit', 'price', 'expense'].includes(type) ? '审批进度' : type === 'logistics' ? '物流进度' : '作业进度'
  const tabs = [{ key: 'info' as const, label: '订单信息', Icon: ClipboardList }, { key: 'progress' as const, label: progressLabel, Icon: Activity },
    ...(['purchase-return', 'wave', 'transfer', 'stockcheck'].includes(type) ? [{ key: 'scan' as const, label: type === 'transfer' ? '调拨明细' : type === 'stockcheck' ? '盘点扫码' : '取货明细', Icon: ScanLine }] : []),
    ...(['inbound', 'sale-return'].includes(type) ? [{ key: 'containers' as const, label: '条码明细', Icon: PackageCheck }] : []),
    ...(['inbound', 'sale-return', 'wave'].includes(type) ? [{ key: 'print' as const, label: type === 'wave' ? '装箱／打印进度' : '条码打印', Icon: Printer }] : []),
    { key: 'log' as const, label: '操作记录', Icon: History }]
  return <div className="space-y-3">
    <div role="tablist" aria-label="订单详情" className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1">
      {tabs.map(({ key, label, Icon }, index) => <button key={key} id={`${prefix}-${key}-tab`} type="button" role="tab" aria-selected={selected === key} aria-controls={`${prefix}-${key}-panel`} tabIndex={selected === key ? 0 : -1}
        onClick={() => setSelected(key)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
          if (next < 0) return
          event.preventDefault(); setSelected(tabs[next].key); document.getElementById(`${prefix}-${tabs[next].key}-tab`)?.focus()
        }} className={`flex min-w-28 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}><Icon className="h-4 w-4" />{label}</button>)}
    </div>
    <div role="tabpanel" id={`${prefix}-info-panel`} aria-labelledby={`${prefix}-info-tab`} hidden={selected !== 'info'}><div className="space-y-3">{children}</div></div>
    {selected !== 'info' && <div role="tabpanel" id={`${prefix}-${selected}-panel`} aria-labelledby={`${prefix}-${selected}-tab`}><DocumentActivityPanel type={type} id={id} view={selected} extra={selected === 'progress' ? progress : selected === 'print' ? printProgress : undefined} /></div>}
  </div>
}
