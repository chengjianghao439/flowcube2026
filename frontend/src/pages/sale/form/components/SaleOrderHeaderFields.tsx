import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input }  from '@/components/ui/input'
import { MapPin, MessageSquareText, Truck, UserRound } from 'lucide-react'
import { Label }  from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { FinderTrigger } from '@/components/finder'
import { SectionCard } from '@/components/shared/SectionCard'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { LimitedTextarea } from '@/components/shared/LimitedTextarea'
import AddressBookDialog from '@/pages/sale/components/AddressBookDialog'
import { cn } from '@/lib/utils'

export function SaleOrderHeaderFields({
  customerId, customerName, customerError, setCustomerFinderOpen,
  warehouseId, setWarehouseId, setWarehouseName, warehouseError, setWarehouseError,
  carrierId, setCarrierId, carrierOptions,
  freightType, setFreightType,
  receiverName, setReceiverName,
  receiverPhone, setReceiverPhone,
  receiverAddress, setReceiverAddress,
  remark, setRemark,
}: {
  customerId: string
  customerName: string; customerError: boolean; setCustomerFinderOpen: (v: boolean) => void
  warehouseId: string; setWarehouseId: (v: string) => void; setWarehouseName: (v: string) => void
  warehouseError: boolean; setWarehouseError: (v: boolean) => void
  carrierId: string; setCarrierId: (v: string) => void; carrierOptions: { id: number; name: string }[]
  freightType: string; setFreightType: (v: string) => void
  receiverName: string; setReceiverName: (v: string) => void
  receiverPhone: string; setReceiverPhone: (v: string) => void
  receiverAddress: string; setReceiverAddress: (v: string) => void
  remark: string; setRemark: (v: string) => void
}) {
  const navigate = useNavigate()
  const [addrOpen, setAddrOpen] = useState(false)
  const openAddrBook = () => {
    if (!customerId) { toast.warning('请先选择客户'); return }
    setAddrOpen(true)
  }
  return (
    <SectionCard title="订单信息" compact contentClassName="p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <UserRound className="h-3.5 w-3.5 text-primary" />客户与履约
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1">
          <Label>客户 *</Label>
          <FinderTrigger value={customerName} placeholder="点击选择客户…" onClick={() => setCustomerFinderOpen(true)} onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }} className={cn('h-9', customerError && 'border-destructive/60 bg-destructive/5')} />
        </div>
        <div className="space-y-1">
          <Label>出库仓库 *</Label>
          <WarehouseSelect
            value={warehouseId ? +warehouseId : null}
            onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
            placeholder="选择仓库"
            className={cn('h-9', warehouseError && 'border-destructive/60 bg-destructive/5')}
          />
        </div>
        <div className="space-y-1">
          <Label>承运商</Label>
          <Select value={carrierId || '__none__'} onValueChange={v => setCarrierId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder={carrierOptions.length === 0 ? '暂无承运商，请先创建' : '请选择承运商'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{carrierOptions.length === 0 ? '暂无承运商，请先创建' : '请选择承运商'}</SelectItem>
              {carrierOptions.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>运费方式</Label>
          <Select value={freightType || '__none__'} onValueChange={v => setFreightType(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder="请选择" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">请选择</SelectItem>
              <SelectItem value="1">寄付</SelectItem>
              <SelectItem value="2">到付</SelectItem>
              <SelectItem value="3">第三方付</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="my-2.5 border-t border-border" />
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><MapPin className="h-3.5 w-3.5 text-primary" />收货信息</div>
        <button type="button" onClick={openAddrBook} className="text-xs font-medium text-primary hover:underline">从地址簿选择</button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <div className="space-y-1 xl:col-span-2">
          <Label>收货人</Label>
          <LimitedInput maxLength={30} value={receiverName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverName(e.target.value)} placeholder="请输入收货人或部门" className="h-9" />
        </div>
        <div className="space-y-1 xl:col-span-2">
          <Label>联系电话</Label>
          <LimitedInput maxLength={30} value={receiverPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverPhone(e.target.value)} placeholder="手机、座机或国际号码" inputMode="tel" className="h-9" />
        </div>
        <div className="space-y-1 xl:col-span-5">
          <Label className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5 text-muted-foreground" />收货地址</Label>
          <LimitedTextarea maxLength={200} value={receiverAddress} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReceiverAddress(e.target.value)} placeholder="请输入详细收货地址" rows={1} className="h-9 min-h-0 py-1.5" singleLine />
        </div>
        <div className="space-y-1 xl:col-span-3">
          <Label className="inline-flex items-center gap-1.5"><MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />备注</Label>
          <Input maxLength={50} value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" className="h-9" />
        </div>
      </div>
      {customerId && (
        <AddressBookDialog
          open={addrOpen}
          onOpenChange={setAddrOpen}
          customerId={+customerId}
          customerName={customerName}
          onSelect={a => {
            setReceiverName(a.receiverName ?? '')
            setReceiverPhone(a.receiverPhone ?? '')
            setReceiverAddress(a.receiverAddress)
          }}
        />
      )}
    </SectionCard>
  )
}
