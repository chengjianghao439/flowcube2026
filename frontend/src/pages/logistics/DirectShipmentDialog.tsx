import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShippingProductField } from '@/components/shared/ShippingProductField'
import { updateWaybillShipmentApi } from '@/api/logistics'
import { toast } from '@/lib/toast'
import type { LogisticsWaybill, ShipmentContact } from '@/types/logistics'

function ContactFields({ title, value, onChange }: { title: string; value: ShipmentContact; onChange: (value: ShipmentContact) => void }) {
  const fields: [keyof ShipmentContact, string, number][] = [['name', '姓名', 32], ['phone', '电话', 20], ['province', '省份', 32], ['city', '城市', 32], ['county', '区县', 32], ['address', '详细地址', 200]]
  return <fieldset className="space-y-3"><legend className="text-sm font-medium">{title}</legend><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    {fields.map(([key, label, max]) => <div key={key} className={key === 'address' ? 'col-span-2 sm:col-span-3' : ''}>
      <Label htmlFor={`${title}-${key}`} className="text-xs text-muted-foreground">{label}</Label>
      <Input id={`${title}-${key}`} className="mt-1" value={value[key]} maxLength={max} onChange={e => onChange({ ...value, [key]: e.target.value })} />
    </div>)}
  </div></fieldset>
}
export function DirectShipmentDialog({ waybill, onClose, onSaved }: { waybill: LogisticsWaybill; onClose: () => void; onSaved: () => void }) {
  const emptyContact: ShipmentContact = { name: '', phone: '', province: '', city: '', county: '', address: '' }
  const [sender, setSender] = useState(waybill.shipment?.sender || emptyContact)
  const [receiver, setReceiver] = useState(waybill.shipment?.receiver || emptyContact)
  const [productCode, setProductCode] = useState(waybill.shipment?.productCode || '')
  const [deliveryType, setDeliveryType] = useState(waybill.shipment?.deliveryType || '')
  const [cargoName, setCargoName] = useState(waybill.shipment?.cargoName || '')
  const [freightType, setFreightType] = useState(waybill.freightType ? String(waybill.freightType) : '')
  const mutation = useMutation({
    mutationFn: () => updateWaybillShipmentApi(waybill.id, { sender, receiver, productCode, deliveryType, cargoName, freightType: Number(freightType) as 1 | 2 }, { skipGlobalError: true }),
    onSuccess: () => { toast.success('寄件资料已保存，等待自动下单'); onSaved(); onClose() },
    onError: (e: Error) => toast.error(e.message || '保存失败'),
  })
  return <Dialog open onOpenChange={v => { if (!v && !mutation.isPending) onClose() }}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>补充寄件资料</DialogTitle><DialogDescription>本批 {waybill.shipment?.packages.length || 0} 件，按实际打包箱数自动填写。重量由快递员称重确认。</DialogDescription></DialogHeader>
    <div className="space-y-5 py-2">
      <ContactFields title="寄件人" value={sender} onChange={setSender} />
      <ContactFields title="收件人" value={receiver} onChange={setReceiver} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="shipment-product">发货产品</Label><ShippingProductField id="shipment-product" platform={waybill.platformCode} value={productCode} onChange={setProductCode} /></div>
        <div><Label htmlFor="shipment-cargo">托寄物名称</Label><Input id="shipment-cargo" value={cargoName} maxLength={20} onChange={e => setCargoName(e.target.value)} /></div>
        <div><Label>运费方式</Label><Select value={freightType} onValueChange={setFreightType}><SelectTrigger aria-label="运费方式"><SelectValue placeholder="选择寄付或到付" /></SelectTrigger><SelectContent><SelectItem value="1">寄付（月结）</SelectItem><SelectItem value="2">到付</SelectItem></SelectContent></Select></div>
        {waybill.platformCode === 'deppon' && <div><Label>送货方式</Label><Select value={deliveryType} onValueChange={setDeliveryType}><SelectTrigger aria-label="送货方式"><SelectValue placeholder="选择送货方式" /></SelectTrigger><SelectContent><SelectItem value="1">自提</SelectItem><SelectItem value="3">送货不上楼</SelectItem><SelectItem value="4">送货上楼</SelectItem></SelectContent></Select></div>}
      </div>
    </div>
    <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>取消</Button><Button disabled={mutation.isPending || !productCode || !cargoName || !['1', '2'].includes(freightType)} onClick={() => mutation.mutate()}>保存并提交下单</Button></DialogFooter>
  </DialogContent></Dialog>
}
