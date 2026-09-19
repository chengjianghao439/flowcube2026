import { useEffect, useId, useState, type ReactNode } from 'react'
import { Activity, ClipboardList, History, PackageCheck, Printer, ScanLine } from 'lucide-react'
import type { ActivityView, DocumentType } from '@/api/document-activity'
import { DocumentActivityPanel } from './DocumentActivityPanel'
import KeepAliveSection from './KeepAliveSection'
interface Props { type: DocumentType; id: number; children: ReactNode; progress?: ReactNode; printProgress?: ReactNode; initialView?: 'info' | ActivityView }

/**
 * 各单据类型的「信息」页签名。
 * 原先所有类型一律叫「订单信息」，于是调拨单、盘点单、波次、退货单、报销单都被叫成「订单」——
 * 它们根本不是订单，用户按标签找内容时会以为点错了单据。按单据身份分别定名。
 */
const INFO_LABEL: Partial<Record<DocumentType, string>> = {
  sale: '订单信息', purchase: '订单信息',
  inbound: '收货信息', transfer: '调拨信息', wave: '批次信息', stockcheck: '盘点信息',
  'purchase-return': '退货信息', 'sale-return': '退货信息',
  requisition: '申请信息', credit: '申请信息', price: '申请信息', plan: '计划信息',
  expense: '报销信息', refund: '退款信息', disposal: '处置信息', logistics: '运单信息',
}
export function OrderDetailSections(props: Props) { return props.id > 0 ? <DetailSections key={`${props.type}-${props.id}`} {...props} /> : <>{props.children}</> }
function DetailSections({ type, id, children, progress, printProgress, initialView }: Props) {
  const prefix = useId()
  const [selected, setSelected] = useState<'info' | ActivityView>(initialView || (typeof window !== 'undefined' && /[?&]focus=/.test(window.location.hash) ? (/[?&]focus=print(?:&|$)/.test(window.location.hash) ? 'print' : 'progress') : 'info'))
  useEffect(() => { if (initialView) setSelected(initialView) }, [initialView])
  useEffect(() => {
    const path = type === 'inbound' ? '/inbound-tasks' : `/${type}`
    const focus = () => {
      const [pathname, search = ''] = window.location.hash.slice(1).split('?')
      if (pathname === `${path}/${id}` && new URLSearchParams(search).get('focus') === 'fulfillment') setSelected('progress')
    }
    window.addEventListener('hashchange', focus)
    return () => window.removeEventListener('hashchange', focus)
  }, [type, id])
  const progressLabel = type === 'purchase' || type === 'inbound' ? '收货进度'
    : ['requisition', 'credit', 'price', 'expense'].includes(type) ? '审批进度'
    : type === 'logistics' ? '物流进度'
    : type === 'wave' ? '拣货进度'
    : type === 'stockcheck' ? '盘点进度'
    : ['purchase-return', 'sale-return'].includes(type) ? '退货进度'
    : type === 'transfer' ? '出入库进度'
    : '作业进度'
  // 「取货明细」原先同时用在波次拣货与采购退货上——同名不同物，按单据类型各自定名
  const scanLabel = type === 'transfer' ? '调拨明细' : type === 'stockcheck' ? '盘点明细' : type === 'wave' ? '拣货明细' : '退货明细'
  const tabs = [{ key: 'info' as const, label: INFO_LABEL[type] ?? '单据信息', Icon: ClipboardList }, { key: 'progress' as const, label: progressLabel, Icon: Activity },
    ...(['purchase-return', 'wave', 'transfer', 'stockcheck'].includes(type) ? [{ key: 'scan' as const, label: scanLabel, Icon: ScanLine }] : []),
    ...(['inbound', 'sale-return'].includes(type) ? [{ key: 'containers' as const, label: '库存条码', Icon: PackageCheck }] : []),
    // 2026-09-14 用户决定：收货订单只显示任务进度，不展示打印记录（补打只在打印记录页）。
    ...(['sale-return', 'wave'].includes(type) ? [{ key: 'print' as const, label: type === 'wave' ? '装箱与打印' : '标签打印', Icon: Printer }] : []),
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
    <KeepAliveSection active={selected === 'info'} role="tabpanel" id={`${prefix}-info-panel`} aria-labelledby={`${prefix}-info-tab`}><div className="space-y-3">{children}</div></KeepAliveSection>
    {tabs.filter(tab => tab.key !== 'info').map(tab => <KeepAliveSection key={tab.key} active={selected === tab.key} role="tabpanel" id={`${prefix}-${tab.key}-panel`} aria-labelledby={`${prefix}-${tab.key}-tab`}><DocumentActivityPanel type={type} id={id} view={tab.key as ActivityView} extra={tab.key === 'progress' ? progress : tab.key === 'print' ? printProgress : undefined} /></KeepAliveSection>)}
  </div>
}
