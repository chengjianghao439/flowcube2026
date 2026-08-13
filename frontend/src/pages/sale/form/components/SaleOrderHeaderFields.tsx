import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input }  from '@/components/ui/input'
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
    <SectionCard title="订单信息" compact>
      {/* 第一行：客户/仓库/承运商/运费方式——选择类字段，按可用宽度均分，不留死区 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <div className="space-y-1.5">
          <Label>客户 *</Label>
          <FinderTrigger value={customerName} placeholder="点击选择客户…" onClick={() => setCustomerFinderOpen(true)} onDoubleClick={() => { setCustomerFinderOpen(false); navigate('/customers') }} className={cn(customerError && 'border-destructive/60 bg-destructive/5')} />
        </div>
        <div className="space-y-1.5">
          <Label>出库仓库 *</Label>
          <WarehouseSelect
            value={warehouseId ? +warehouseId : null}
            onChange={(id, name) => { setWarehouseId(id ? String(id) : ''); setWarehouseName(name); setWarehouseError(false) }}
            placeholder="选择仓库"
            className={cn(warehouseError && 'border-destructive/60 bg-destructive/5')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>承运商</Label>
          <Select value={carrierId || '__none__'} onValueChange={v => setCarrierId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-10 w-full">
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
        <div className="space-y-1.5">
          <Label>运费方式</Label>
          <Select value={freightType || '__none__'} onValueChange={v => setFreightType(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-10 w-full">
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
      {/* 第二行：收货人/联系电话给够宽度装下字符计数角标，收货地址/备注均分剩余宽度 */}
      <div className="mt-4 flex items-start gap-4">
        <div className="w-40 shrink-0 space-y-1.5">
          <Label>收货人</Label>
          <LimitedInput maxLength={5} value={receiverName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverName(e.target.value)} placeholder="请输入收货人" />
        </div>
        <div className="w-48 shrink-0 space-y-1.5">
          <Label>联系电话</Label>
          <LimitedInput maxLength={11} value={receiverPhone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiverPhone(e.target.value)} placeholder="11位手机号" inputMode="numeric" />
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>收货地址</Label>
            <button type="button" onClick={openAddrBook} className="text-xs font-medium text-primary hover:underline">地址簿</button>
          </div>
          <LimitedTextarea maxLength={30} value={receiverAddress} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReceiverAddress(e.target.value)} placeholder="请输入详细收货地址" rows={1} className="h-10 min-h-0 py-2" singleLine />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>备注</Label>
          <Input maxLength={50} value={remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemark(e.target.value)} placeholder="选填" />
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
