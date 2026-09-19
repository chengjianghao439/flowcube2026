import { useEffect, useMemo, useState } from 'react'
import { money } from '@/lib/format'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { createStatementApi, getStatementCandidatesApi, type StatementItem } from '@/api/payments'
import { getRelativeDateRange } from '@/lib/dateRange'
import { toast } from '@/lib/toast'
import { formatDisplayDate } from '@/lib/dateTime'


interface Props {
  open: boolean
  onClose: () => void
  /** 1=供应商对账（应付）2=客户对账（应收） */
  type: 1 | 2
  /** 生成成功后由调用方刷新列表并关闭 */
  onCreated: () => void
}

/**
 * 新建对账单：选往来方 + 期间 → 勾选待对账的月结账款 → 生成对账单。
 *
 * 候选账款可能几十笔，故用可拖拽的 AppDialog 工作区弹窗，候选区占满剩余高度自行滚动
 * （2026-09-18 弹窗重构，原先内联在 StatementPanel.tsx 里）。
 */
export function CreateStatementDialog({ open, onClose, type, onCreated }: Props) {
  const active = useActiveWorkspaceTab()
  const partyLabel = type === 1 ? '供应商' : '客户'
  const recent30d = getRelativeDateRange(30)
  const [partyName, setPartyName] = useState('')
  const [startDate, setStartDate] = useState(recent30d.startDate)
  const [endDate, setEndDate] = useState(recent30d.endDate)
  const [applied, setApplied] = useState<{ partyName:string; startDate:string; endDate:string } | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [remark, setRemark] = useState('')

  // 依赖刻意只认 open：recent30d 是 getRelativeDateRange(30) 每次渲染新建的对象，
  // 整体入依赖会在用户选好往来单位/日期后于填写途中被反复重置。
  useEffect(() => {
    if (!open) return
    setPartyName(''); setStartDate(recent30d.startDate); setEndDate(recent30d.endDate)
    setApplied(null); setPicked(new Set()); setRemark('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const { data: candidates, isFetching } = useQuery({
    queryKey: ['statement-candidates', applied],
    queryFn: () => getStatementCandidatesApi({ type, partyName: applied!.partyName, startDate: applied!.startDate, endDate: applied!.endDate }),
    enabled: active && open && !!applied,
  })

  // 必须 useMemo：`candidates ?? []` 每次渲染都是新数组引用，会让下面依赖 list 的
  // useMemo 每次都重算（等于没缓存）
  const list = useMemo(() => (candidates ?? []) as StatementItem[], [candidates])
  const pickedTotal = useMemo(
    () => list.filter(x => picked.has(x.recordId)).reduce((s, x) => s + x.totalAmount, 0),
    [list, picked],
  )

  const mut = useMutation({
    mutationFn: () => createStatementApi({
      type, partyName: applied!.partyName, periodStart: applied!.startDate, periodEnd: applied!.endDate,
      recordIds: [...picked], remark: remark || undefined,
    }),
    onSuccess: (res) => { toast.success(`对账单 ${res.statementNo} 已生成`); onCreated() },
  })

  return (
    <AppDialog
      open={open}
      onOpenChange={v => { if (!v) onClose() }}
      dialogId="payment-statement-create"
      title="新建对账单"
      defaultWidth={1120}
      defaultHeight={700}
      minWidth={880}
      minHeight={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={!picked.size || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? '生成中…' : `生成对账单（${picked.size} 笔 / ${money(pickedTotal)}）`}
          </Button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-4 p-5">
        <div className="grid grid-cols-[minmax(240px,2fr)_1fr_1fr_auto] items-end gap-4">
          <div className="space-y-1 col-span-2">
            <Label>{partyLabel} *</Label>
            <Input value={partyName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPartyName(e.target.value)} placeholder={`输入${partyLabel}名称`} />
          </div>
          <div className="space-y-1"><Label>期间起</Label><DatePicker value={startDate} onChange={setStartDate} max={endDate} /></div>
          <div className="space-y-1"><Label>期间止</Label><DatePicker value={endDate} onChange={setEndDate} min={startDate} /></div>
        </div>
        <Button
          size="sm"
          className="w-32"
          disabled={!partyName.trim()}
          onClick={() => { setPicked(new Set()); setApplied({ partyName: partyName.trim(), startDate, endDate }) }}
        >
          查待对账账款
        </Button>

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">待对账账款{applied ? `（${list.length} 笔）` : ''}</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">已选 {picked.size} 笔 · 合计 <span className="tabular-nums font-medium text-foreground">{money(pickedTotal)}</span></span>
              <Button size="sm" variant="outline" disabled={!list.length}
                onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map(x => x.recordId)))}>
                {picked.size === list.length && list.length > 0 ? '取消全选' : '全选'}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!applied && <p className="px-3 py-6 text-center text-sm text-muted-foreground">填写{partyLabel}与期间后点「查待对账账款」</p>}
            {applied && isFetching && <p className="px-3 py-6 text-center text-sm text-muted-foreground">加载中…</p>}
            {applied && !isFetching && !list.length && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">该期间内没有未对账的月结账款</p>
            )}
            {list.map(it => (
              <label key={it.recordId} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30">
                <input
                  type="checkbox" className="accent-primary"
                  checked={picked.has(it.recordId)}
                  onChange={e => setPicked(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(it.recordId); else next.delete(it.recordId)
                    return next
                  })}
                />
                <span className="text-doc-code flex-1">{it.orderNo}</span>
                <span className="text-xs text-muted-foreground">
                  {it.dueDate ? `到期 ${formatDisplayDate(it.dueDate)}` : ''}
                </span>
                <span className="tabular-nums text-sm font-medium">{money(it.totalAmount)}</span>
                {it.paidAmount > 0 && <span className="text-xs text-success">已{type === 1 ? '付' : '收'} {money(it.paidAmount)}</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label>备注</Label>
          <Input value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
        </div>
      </div>
    </AppDialog>
  )
}
