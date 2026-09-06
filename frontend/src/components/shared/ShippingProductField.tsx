import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

import { DEPPON_PRODUCT_OPTIONS, shippingProductLabel } from '@/lib/shippingProducts'

export function ShippingProductField({ platform, value, onChange, defaultCode, disabled = false, id }: {
  platform?: string | null; value: string; onChange: (value: string) => void; defaultCode?: string | null; disabled?: boolean; id?: string
}) {
  const placeholder = defaultCode ? `默认：${shippingProductLabel(platform, defaultCode)}` : '选择合同已开通的产品'
  if (platform === 'sf') return <Input id={id} aria-label="顺丰发货产品编码" value={value} onChange={e => onChange(e.target.value)} inputMode="numeric" maxLength={5} disabled={disabled} placeholder={defaultCode ? placeholder : '填写顺丰合同产品编码'} />
  return <Select value={value || '__default__'} onValueChange={v => onChange(v === '__default__' ? '' : v)} disabled={disabled}>
    <SelectTrigger id={id} aria-label="发货产品"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="__default__">{placeholder}</SelectItem>{DEPPON_PRODUCT_OPTIONS.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent>
  </Select>
}
