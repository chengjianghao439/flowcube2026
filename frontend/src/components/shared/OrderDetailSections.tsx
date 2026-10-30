import { TabPathContext } from '@/components/layout/TabPathContext'
import { useContext, useEffect, useState, type ReactNode } from 'react'
import { Activity, ClipboardList, History, PackageCheck, Printer, ScanLine } from 'lucide-react'
import type { ActivityView, DocumentType } from '@/api/document-activity'
import { DocumentActivityPanel } from './DocumentActivityPanel'
import { ContentTabs } from './ContentTabs'
interface Props { type: DocumentType; id: number; children: ReactNode; progress?: ReactNode; printProgress?: ReactNode; initialView?: 'info' | ActivityView; compactTabs?: boolean }

/**
 * 各单据类型的「信息」页签名。
 * 原先所有类型一律叫「订单信息」，于是调拨单、盘点单、波次、退货单、报销单都被叫成「订单」——
 * 它们根本不是订单，用户按标签找内容时会以为点错了单据。按单据身份分别定名。
 */
const INFO_LABEL: Partial<Record<DocumentType, string>> = {
  sale: '订单信息', purchase: '订单信息',
  inbound: '收货信息', transfer: '调拨信息', wave: '批次信息', stockcheck: '盘点信息',
  'purchase-return': '退货信息', 'sale-return': '退货信息',
  credit: '申请信息', price: '申请信息', plan: '计划信息',
  expense: '报销信息', refund: '退款信息', disposal: '处置信息', logistics: '运单信息',
}
function receiveView(type: DocumentType, id: number, path: string): 'progress' | undefined {
  const [pathname, search = ''] = path.split('?')
  const ownPath = type === 'inbound' ? `/inbound-tasks/${id}` : `/purchase/${id}`
  const focus = new URLSearchParams(search).getAll('focus')
  return pathname === ownPath && focus.length === 1 && ['fulfillment', 'waiting-putaway', 'print'].includes(focus[0]) ? 'progress' : undefined
}
export function OrderDetailSections(props: Props) { return props.id > 0 ? <DetailSections key={`${props.type}-${props.id}`} {...props} /> : <>{props.children}</> }
function DetailSections({ type, id, children, progress, printProgress, initialView, compactTabs = false }: Props) {
  const tabPath = useContext(TabPathContext)
  const scoped = type === 'purchase' || type === 'inbound'
  const [selected, setSelected] = useState<'info' | ActivityView>(initialView || (scoped ? receiveView(type, id, tabPath || window.location.hash.slice(1)) || 'info' : (typeof window !== 'undefined' && /[?&]focus=/.test(window.location.hash) ? (/[?&]focus=print(?:&|$)/.test(window.location.hash) ? 'print' : 'progress') : 'info')))
  useEffect(() => { if (initialView) setSelected(initialView) }, [initialView])
  useEffect(() => {
    if (!scoped || !tabPath) return
    const view = receiveView(type, id, tabPath)
    if (view) setSelected(view)
  }, [type, id, tabPath, scoped])
  useEffect(() => {
    if (scoped && tabPath) return
    const path = type === 'inbound' ? '/inbound-tasks' : `/${type}`
    const focus = () => {
      const [pathname, search = ''] = window.location.hash.slice(1).split('?')
      if (pathname === `${path}/${id}` && new URLSearchParams(search).get('focus') === 'fulfillment') setSelected('progress')
    }
    window.addEventListener('hashchange', focus)
    return () => window.removeEventListener('hashchange', focus)
  }, [type, id, scoped, tabPath])
  const progressLabel = type === 'purchase' || type === 'inbound' ? '收货进度'
    : ['credit', 'price', 'expense'].includes(type) ? '审批进度'
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
  return <ContentTabs label="订单详情" value={selected} onValueChange={setSelected}
    className={compactTabs ? 'fc-content-tabs-compact' : undefined}
    tabs={tabs.map(tab => ({
      value: tab.key, label: tab.label, Icon: tab.Icon,
      content: tab.key === 'info' ? <div className="space-y-3">{children}</div>
        : <DocumentActivityPanel type={type} id={id} view={tab.key as ActivityView} extra={tab.key === 'progress' ? progress : tab.key === 'print' ? printProgress : undefined} />,
    }))} />
}
