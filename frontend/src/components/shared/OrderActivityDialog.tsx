import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DocumentType } from '@/api/document-activity'
import { OrderDetailSections } from './OrderDetailSections'
export function OrderActivityDialog({ type, id, title, fields, open: controlledOpen, onOpenChange, hideTrigger = false }: { type: DocumentType; id: number; title: string; fields: [string, string | number | null | undefined][]; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean }) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const unmountState = useRef({ uncontrolled: controlledOpen === undefined, open: localOpen, notify: onOpenChange })
  useLayoutEffect(() => {
    unmountState.current = { uncontrolled: controlledOpen === undefined, open: localOpen, notify: onOpenChange }
  }, [controlledOpen, localOpen, onOpenChange])
  useEffect(() => () => {
    // 列表筛选/刷新移除行时Radix不会通知关闭，仅释放实际打开的普通详情。
    const state = unmountState.current
    if (state.uncontrolled && state.open) state.notify?.(false)
  }, [])
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next)
    onOpenChange?.(next)
  }
  return <>{!hideTrigger && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>详情 / 记录</Button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="fc-order-activity max-w-6xl max-h-[90dvh]"><DialogHeader description={"核对申请内容、处理进度与操作记录。"}><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="fc-order-activity-body min-h-0 min-w-0 overflow-y-auto">
        <OrderDetailSections type={type} id={id} compactTabs><dl className="fc-order-facts grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0" data-long={typeof value === 'string' && (value.includes('\n') || value.length > 120) || undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{value ?? '—'}</dd></div>)}</dl></OrderDetailSections>
      </div>
    </DialogContent></Dialog>
  </>
}
