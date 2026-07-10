import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductFinder } from '@/components/finder'
import { DatePicker } from '@/components/shared/DatePicker'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { getUserOptionsApi } from '@/api/users'
import { useAuthStore } from '@/store/authStore'
import { INBOUND_STATUS_LABEL, type InboundTaskStatus } from '@/types/inbound-tasks'

/** 收货订单查询弹窗对外的筛选值（与 URL 参数一一对应） */
export interface InboundTaskQueryValues {
  keyword: string
  remark: string
  operatorId: number | null
  operatorName: string
  status: string
  productId: number | null
  productCode: string
  productName: string
  warehouseId: number | null
  warehouseName: string
  startDate: string
  endDate: string
}

const EMPTY: InboundTaskQueryValues = {
  keyword: '', remark: '', operatorId: null, operatorName: '', status: '',
  productId: null, productCode: '', productName: '',
  warehouseId: null, warehouseName: '',
  startDate: '', endDate: '',
}

interface Props {
  open: boolean
  initial: InboundTaskQueryValues
  onClose: () => void
  onApply: (values: InboundTaskQueryValues) => void
}

/** 一行「弹窗选择器」：显示已选项 + 清除，点击打开对应 Finder */
function PickerField({ label, value, placeholder, onOpen, onClear }: {
  label: string
  value: string
  placeholder: string
  onOpen: () => void
  onClear: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" className="h-9 flex-1 justify-start font-normal" onClick={onOpen}>
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClear} aria-label={`清除${label}`}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </label>
  )
}

export default function InboundTaskQueryDialog({ open, initial, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<InboundTaskQueryValues>(EMPTY)
  const [productOpen, setProductOpen] = useState(false)

  const currentUserId = useAuthStore(s => s.user?.id)

  const { data: userOptions } = useQuery({
    queryKey: ['user-options'],
    queryFn: getUserOptionsApi,
    staleTime: 1000 * 60 * 5,
    enabled: open,
  })

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof InboundTaskQueryValues>(key: K, value: InboundTaskQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={v => { if (!v) onClose() }}
        dialogId="inbound-task-query"
        title="查询收货订单"
        resizable={false}
        defaultWidth={520}
        defaultHeight={480}
        minWidth={420}
        minHeight={420}
        footer={
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setDraft(EMPTY)}>重置</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button onClick={() => onApply(draft)}>查询</Button>
            </div>
          </div>
        }
      >
        <div className="grid h-full grid-cols-2 gap-4 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">单号 / 供应商</span>
            <Input
              placeholder="任务单号 / 采购单号 / 供应商..."
              value={draft.keyword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">状态</span>
            <Select value={draft.status || '__all__'} onValueChange={v => set('status', v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                {([1, 2, 3, 4, 5] as InboundTaskStatus[]).map(s => (
                  <SelectItem key={s} value={String(s)}>{INBOUND_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">仓库</span>
            <WarehouseSelect
              value={draft.warehouseId}
              onChange={(id, name) => setDraft(d => ({ ...d, warehouseId: id, warehouseName: name }))}
              allowClear
              clearLabel="全部仓库"
              placeholder="全部仓库"
              className="h-9"
            />
          </label>

          <PickerField
            label="产品"
            placeholder="选择产品"
            value={draft.productName ? `${draft.productName}${draft.productCode ? ` (${draft.productCode})` : ''}` : ''}
            onOpen={() => setProductOpen(true)}
            onClear={() => setDraft(d => ({ ...d, productId: null, productCode: '', productName: '' }))}
          />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">经办人</span>
            <Select
              value={draft.operatorId ? String(draft.operatorId) : '__all__'}
              onValueChange={v => {
                if (v === '__all__') { setDraft(d => ({ ...d, operatorId: null, operatorName: '' })); return }
                const id = Number(v)
                const name = userOptions?.find(u => u.id === id)?.realName || ''
                setDraft(d => ({ ...d, operatorId: id, operatorName: name }))
              }}
            >
              <SelectTrigger className="h-9"><SelectValue placeholder="全部经办人" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部经办人</SelectItem>
                {userOptions?.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.realName}
                    {u.id === currentUserId ? '（我）' : ''}
                    {!u.isActive ? '（已禁用）' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">创建日期（起）</span>
            <DatePicker value={draft.startDate} max={draft.endDate || undefined}
              onChange={v => set('startDate', v)} className="h-9" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">创建日期（止）</span>
            <DatePicker value={draft.endDate} min={draft.startDate || undefined}
              onChange={v => set('endDate', v)} className="h-9" />
          </label>

          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs font-medium text-muted-foreground">备注</span>
            <Input
              placeholder="按收货订单备注内容查询..."
              value={draft.remark}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('remark', e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
              className="h-9"
            />
          </label>
        </div>
      </AppDialog>

      <ProductFinder
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onConfirm={r => setDraft(d => ({ ...d, productId: r.id, productCode: r.code ?? '', productName: r.name }))}
      />
    </>
  )
}
