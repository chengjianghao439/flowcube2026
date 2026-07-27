import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/shared/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getMonthDateRange, getRelativeDateRange } from '@/lib/dateRange'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 账款 / 汇款单 / 对账单三类列表共用的查询条件；用不到的字段由开关关掉 */
export interface PaymentQueryValues {
  /** 单据编号（账款=关联单号，汇款单=收付款单号，对账单=对账单号） */
  docNo: string
  /** 往来方名称（供应商 / 客户） */
  partyName: string
  status: string
  /** 仅应付账款：0待确认 1已确认 */
  confirmStatus: string
  /** 主日期区间：账款=创建日，汇款单=汇款日，对账单=创建日 */
  startDate: string
  endDate: string
  /** 仅账款：到期日区间 */
  dueStart: string
  dueEnd: string
  minAmount: string
  maxAmount: string
}

export const EMPTY_PAYMENT_QUERY: PaymentQueryValues = {
  docNo: '', partyName: '', status: '', confirmStatus: '',
  startDate: '', endDate: '', dueStart: '', dueEnd: '',
  minAmount: '', maxAmount: '',
}

/** 判断是否有生效的筛选条件 */
export function hasActiveQuery(v: PaymentQueryValues): boolean {
  return Object.values(v).some(x => String(x || '').trim() !== '')
}

interface FieldLabels {
  /** 单号字段的名称，如「关联单号」「收款单号」「对账单号」 */
  docLabel: string
  /** 往来方字段的名称，如「供应商」「客户」 */
  partyLabel: string
  statusText: (value: string) => string
  dateLabel: string
  amountLabel: string
}

/**
 * 查询入口栏：一个「查询」按钮 + 已生效条件的标签。
 *
 * 查询条件全部收在弹窗里，页面上不再放第二套筛选控件；但条件必须在页面上看得见，
 * 否则用户看着一屏数据不知道是筛过的。每个标签可单独移除。
 */
export function PaymentQueryBar({ query, onChange, onOpen, labels }: {
  query: PaymentQueryValues
  onChange: (next: PaymentQueryValues) => void
  onOpen: () => void
  labels: FieldLabels
}) {
  const chips: Array<{ key: string; text: string; clear: () => void }> = []
  const drop = (...keys: (keyof PaymentQueryValues)[]) =>
    () => onChange(keys.reduce((acc, k) => ({ ...acc, [k]: '' }), { ...query }))

  if (query.docNo) chips.push({ key: 'docNo', text: `${labels.docLabel}：${query.docNo}`, clear: drop('docNo') })
  if (query.partyName) chips.push({ key: 'partyName', text: `${labels.partyLabel}：${query.partyName}`, clear: drop('partyName') })
  if (query.status) chips.push({ key: 'status', text: `状态：${labels.statusText(query.status)}`, clear: drop('status') })
  if (query.confirmStatus) {
    chips.push({ key: 'confirmStatus', text: `结算确认：${query.confirmStatus === '0' ? '待确认' : '已确认'}`, clear: drop('confirmStatus') })
  }
  if (query.startDate || query.endDate) {
    const sameDay = query.startDate && query.startDate === query.endDate
    chips.push({
      key: 'date',
      text: sameDay
        ? `${labels.dateLabel}：${query.startDate}`
        : `${labels.dateLabel}：${query.startDate || '…'} ~ ${query.endDate || '…'}`,
      clear: drop('startDate', 'endDate'),
    })
  }
  if (query.dueStart || query.dueEnd) {
    chips.push({ key: 'due', text: `到期日：${query.dueStart || '…'} ~ ${query.dueEnd || '…'}`, clear: drop('dueStart', 'dueEnd') })
  }
  if (query.minAmount || query.maxAmount) {
    chips.push({ key: 'amount', text: `${labels.amountLabel}：${query.minAmount || '0'} ~ ${query.maxAmount || '不限'}`, clear: drop('minAmount', 'maxAmount') })
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={onOpen}>查询</Button>
      {chips.map(c => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-sm border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {c.text}
          <button type="button" onClick={c.clear} className="hover:opacity-70" aria-label={`移除 ${c.text}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_PAYMENT_QUERY)}>清空</Button>
      )}
    </>
  )
}

interface Props {
  open: boolean
  initial: PaymentQueryValues
  onClose: () => void
  onApply: (values: PaymentQueryValues) => void
  labels: FieldLabels
  /** 状态下拉选项 [值, 文案] */
  statusOptions: ReadonlyArray<readonly [string, string]>
  /** 显示到期日区间（仅账款列表有意义） */
  showDueDate?: boolean
  /** 显示结算确认筛选（仅应付账款有意义） */
  showConfirmStatus?: boolean
  /**
   * 日期条件用单个日期而非区间（现结：当天下单当天到期，按天查就够）。
   * 内部仍写 startDate/endDate 两个字段（取同一天），后端与导出无需区分。
   */
  singleDate?: boolean
}

/**
 * 账款类列表的查询弹窗——列表页上唯一的查询入口，页面不再放第二套筛选控件。
 *
 * 用高度自适应的 Dialog 而非可拖拽的 AppDialog：条件是固定的几行，
 * 固定高度会在底部留一大片空白。
 */
export function PaymentQueryDialog({
  open, initial, onClose, onApply, labels, statusOptions,
  showDueDate = false, showConfirmStatus = false, singleDate = false,
}: Props) {
  const [v, setV] = useState<PaymentQueryValues>(initial)
  useEffect(() => { if (open) setV(initial) }, [open, initial])

  const set = <K extends keyof PaymentQueryValues>(k: K, val: PaymentQueryValues[K]) =>
    setV(prev => ({ ...prev, [k]: val }))

  return (
    <Dialog open={open} onOpenChange={x => !x && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>查询</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{labels.docLabel}</Label>
              <Input value={v.docNo} className="h-9" placeholder={`输入${labels.docLabel}`}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('docNo', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{labels.partyLabel}</Label>
              <Input value={v.partyName} className="h-9" placeholder={`输入${labels.partyLabel}名称`}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('partyName', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>状态</Label>
              <Select value={v.status || '__all__'} onValueChange={x => set('status', x === '__all__' ? '' : x)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  {statusOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showConfirmStatus && (
              <div className="space-y-1">
                <Label>结算确认</Label>
                <Select value={v.confirmStatus || '__all__'} onValueChange={x => set('confirmStatus', x === '__all__' ? '' : x)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="全部" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部</SelectItem>
                    <SelectItem value="0">待确认</SelectItem>
                    <SelectItem value="1">已确认</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>{labels.dateLabel}</Label>
              <div className="flex gap-1">
                {(singleDate
                  ? ([['今天', () => { const t = todayStr(); return { startDate: t, endDate: t } }]] as const)
                  : ([
                      ['近 30 天', () => getRelativeDateRange(30)],
                      ['近 90 天', () => getRelativeDateRange(90)],
                      ['本月', () => getMonthDateRange()],
                    ] as const)
                ).map(([label, range]) => (
                  <Button key={label} size="sm" variant="ghost" className="h-6 px-2 text-xs"
                    onClick={() => { const r = range(); setV(prev => ({ ...prev, startDate: r.startDate, endDate: r.endDate })) }}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            {singleDate ? (
              /* 单日模式：选中的日期同时写进 start/end，后端仍按区间查，等价于「就这一天」 */
              <DatePicker value={v.startDate} className="h-9 w-full"
                onChange={x => setV(prev => ({ ...prev, startDate: x, endDate: x }))} />
            ) : (
              <div className="flex items-center gap-2">
                <DatePicker value={v.startDate} onChange={x => set('startDate', x)} max={v.endDate || undefined} className="h-9 flex-1" />
                <span className="text-muted-foreground">至</span>
                <DatePicker value={v.endDate} onChange={x => set('endDate', x)} min={v.startDate || undefined} className="h-9 flex-1" />
              </div>
            )}
          </div>

          {showDueDate && (
            <div className="space-y-1">
              <Label>到期日</Label>
              <div className="flex items-center gap-2">
                <DatePicker value={v.dueStart} onChange={x => set('dueStart', x)} max={v.dueEnd || undefined} className="h-9 flex-1" />
                <span className="text-muted-foreground">至</span>
                <DatePicker value={v.dueEnd} onChange={x => set('dueEnd', x)} min={v.dueStart || undefined} className="h-9 flex-1" />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>{labels.amountLabel}</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="0.01" placeholder="最小金额" className="h-9 flex-1"
                value={v.minAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('minAmount', e.target.value)} />
              <span className="text-muted-foreground">至</span>
              <Input type="number" min="0" step="0.01" placeholder="最大金额" className="h-9 flex-1"
                value={v.maxAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('maxAmount', e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setV(EMPTY_PAYMENT_QUERY)}>清空</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => { onApply(v); onClose() }}>查询</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
