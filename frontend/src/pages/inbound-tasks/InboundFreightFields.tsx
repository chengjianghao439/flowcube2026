import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import type { InboundFreightType } from './inboundFreight'

export function InboundFreightFields({ prefix, freightType, freightAmount, onTypeChange, onAmountChange, disabled = false }: {
  prefix: string; freightType: InboundFreightType; freightAmount: string; onTypeChange: (value: InboundFreightType) => void; onAmountChange: (value: string) => void; disabled?: boolean
}) {
  return <>
    <div className="space-y-1.5 [&_label]:text-xs [&_label]:text-muted-foreground">
      <label htmlFor={`${prefix}-freight-type`}>运费方式</label>
      <Select value={freightType == null ? '__none__' : String(freightType)} onValueChange={value => onTypeChange(value === '__none__' ? null : Number(value) as 1 | 2 | 3)} disabled={disabled}>
        <SelectTrigger id={`${prefix}-freight-type`} className="h-9 w-full"><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent><SelectItem value="__none__">请选择</SelectItem><SelectItem value="1">寄付</SelectItem><SelectItem value="2">到付</SelectItem><SelectItem value="3">第三方付</SelectItem></SelectContent>
      </Select>
    </div>
    <div className="space-y-1.5 [&_label]:text-xs [&_label]:text-muted-foreground">
      <label htmlFor={`${prefix}-freight-amount`}>运费金额</label>
      <Input id={`${prefix}-freight-amount`} className="h-9 tabular-nums" inputMode="decimal" value={freightAmount} onChange={event => onAmountChange(event.target.value)} disabled={disabled} placeholder="选填" />
    </div>
  </>
}
