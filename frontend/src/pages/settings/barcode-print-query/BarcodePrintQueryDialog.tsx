import { QueryFormLayout } from '@/components/shared/QueryFormLayout'
import { useEffect, useRef, useState } from 'react'
import { QueryDialog } from '@/components/shared/QueryDialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BARCODE_PRINT_STATUS_OPTIONS } from './constants'

/** 条码打印查询弹窗对外的筛选值（类别固定走页面工具栏，不进弹窗） */
export interface BarcodePrintQueryValues {
  keyword: string
  status: string
}

const EMPTY: BarcodePrintQueryValues = {
  keyword: '', status: '__all__',
}

interface Props {
  open: boolean
  initial: BarcodePrintQueryValues
  onClose: () => void
  onApply: (values: BarcodePrintQueryValues) => void
  onAfterClose: () => void
}

export default function BarcodePrintQueryDialog({ open, initial, onClose, onApply, onAfterClose }: Props) {
  const [draft, setDraft] = useState<BarcodePrintQueryValues>(EMPTY)
  const keywordRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) setDraft(initial) }, [open, initial])

  function set<K extends keyof BarcodePrintQueryValues>(key: K, value: BarcodePrintQueryValues[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  return (
    <QueryDialog
      open={open}
      dialogId="barcode-print-query"
      title="查询条码打印记录"
      width={520}
      onClose={onClose}
      onReset={() => setDraft(EMPTY)}
      onApply={() => onApply(draft)}
      onOpenAutoFocus={event => { event.preventDefault(); keywordRef.current?.focus() }}
      onCloseAutoFocus={event => { event.preventDefault(); onAfterClose() }}
    >
      <QueryFormLayout>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">条码 / 单号 / 关键字</span>
          <Input
            ref={keywordRef}
            placeholder="请输入关键字…"
            value={draft.keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('keyword', e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onApply(draft) }}
            className="h-9"
          />
        </label>

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs font-medium text-muted-foreground">打印状态</span>
          <Select value={draft.status} onValueChange={v => set('status', v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              {BARCODE_PRINT_STATUS_OPTIONS.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </QueryFormLayout>
    </QueryDialog>
  )
}
