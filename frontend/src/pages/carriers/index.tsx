import { ShippingProductField } from '@/components/shared/ShippingProductField'
import { RecordIdentity } from '@/components/shared/RecordIdentity'
/**
 * 承运商管理页
 * 路由：/carriers
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getCarriersApi, createCarrierApi, updateCarrierApi, deleteCarrierApi } from '@/api/carriers'
import { CARRIER_TYPE_OPTIONS, CARRIER_TYPE_LABELS, WAYBILL_PLATFORM_OPTIONS, type Carrier, type CarrierType, type CreateCarrierParams } from '@/types/carriers'
import type { TableColumn } from '@/types'
import BaseCrudPage from '@/components/shared/BaseCrudPage'
import { Button } from '@/components/ui/button'
import { FilterCard } from '@/components/shared/FilterCard'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'

type FormState = CreateCarrierParams & { isActive: boolean }
const EMPTY_FORM: FormState = {
  name: '', type: 'express', contact: '', phone: '', remark: '', isActive: true,
  shippingProduct: '', shippingDeliveryType: '', platformCode: '', platformCarrier: '', monthlyAccount: '', netSiteCode: '', credentialRef: '', waybillEnabled: false,
}

// 建/改承运商时提交的对接字段（密钥不在前端）
function platformPayload(f: FormState) {
  return {
    platformCode: f.platformCode,
    shippingProduct: f.shippingProduct,
    shippingDeliveryType: f.shippingDeliveryType,
    platformCarrier: f.platformCarrier,
    monthlyAccount: f.monthlyAccount,
    netSiteCode: f.netSiteCode,
    credentialRef: f.credentialRef,
    waybillEnabled: f.waybillEnabled,
  }
}

export default function CarriersPage() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const page = 1
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const set = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  // 打开弹窗时回填表单（新建=默认值，编辑=行数据）
  function handleOpen(editing: Carrier | null) {
    if (editing) {
      setForm({
        name: editing.name, type: editing.type, contact: editing.contact ?? '', phone: editing.phone ?? '', remark: editing.remark ?? '', isActive: editing.isActive,
        shippingProduct: editing.shippingProduct ?? '', shippingDeliveryType: editing.shippingDeliveryType ?? '',
        platformCode: editing.platformCode ?? '', platformCarrier: editing.platformCarrier ?? '', monthlyAccount: editing.monthlyAccount ?? '',
        netSiteCode: editing.netSiteCode ?? '', credentialRef: editing.credentialRef ?? '', waybillEnabled: editing.waybillEnabled,
      })
    } else {
      setForm(EMPTY_FORM)
    }
  }

  const columns: TableColumn<Carrier>[] = [
    { key: 'name', title: '承运商 / 编号', width: 260, render: (_, row) => <RecordIdentity title={row.name} code={row.code} /> },
    { key: 'type',     title: '类型', width: 80,
      render: v => CARRIER_TYPE_LABELS[v as CarrierType] },
    { key: 'contact',  title: '联系人',
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'phone',    title: '电话',
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'waybillEnabled', title: '电子面单', width: 130, render: v => <span className="text-sm text-muted-foreground">{v ? '取号已启用' : '取号未启用'}</span> },
    { key: 'isActive', title: '状态', width: 80,
      render: v => <SoftStatusLabel label={v ? '启用' : '停用'} tone={activeTone(v as boolean)} /> },
  ]

  return (
    <BaseCrudPage<Carrier>
      title="承运商管理"
      description="管理物流、快递等承运商信息"
      columns={columns}
      queryKey={['carriers', { page, pageSize: 20, keyword }]}
      listQuery={() => getCarriersApi({ keyword, page, pageSize: 20 })}
      recordUnit="个"
      deleteApi={(id) => deleteCarrierApi(id, { skipGlobalError: true })}
      deleteMessage="确认删除该承运商？删除后不可恢复。"
      createLabel="新建承运商"
      saveSuccessMessage={(editing) => editing ? '承运商已保存' : '承运商已创建'}
      formWidthClass="max-w-3xl"
      headerActions={<>
        <Button variant="outline" onClick={() => navigate('/carrier-accounts')}>绑定快递账号</Button>
        <Button variant="outline" onClick={() => downloadExport('/export/carriers').catch(e => toast.error((e as Error).message))}>导出</Button>
      </>}
      onOpen={handleOpen}
      canSubmit={() => !!form.name}
      renderToolbar={
        <FilterCard>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <Input aria-label="搜索承运商名称或编号" placeholder="搜索承运商名称或编号" value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search) } }}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>
          </div>
        </FilterCard>
      }
      renderForm={(editing) => (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-2">
          <h3 className="col-span-2 text-sm font-medium">基本资料</h3>
          <div><Label htmlFor="carrier-name">名称</Label><Input className="mt-1" placeholder="承运商名称" id="carrier-name" value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div>
            <Label>类型</Label>
            <Select value={form.type} onValueChange={v => set('type', v)}>
              <SelectTrigger aria-label="承运商类型" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CARRIER_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="carrier-contact">联系人</Label><Input className="mt-1" placeholder="可选" id="carrier-contact" value={form.contact} onChange={e => set('contact', e.target.value)} /></div>
          <div><Label htmlFor="carrier-phone">电话</Label><Input className="mt-1" placeholder="可选" id="carrier-phone" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><Label htmlFor="carrier-remark">备注</Label><Input className="mt-1" placeholder="可选" id="carrier-remark" value={form.remark} onChange={e => set('remark', e.target.value)} /></div>

          {/* 电子面单对接（文档 06）。密钥走服务端 env，前端只填非敏感对接项。 */}
          <div className="col-span-2 border-t border-border pt-4 mt-1 space-y-4">
            <div className="flex items-center justify-between">
              <Label>电子面单取号</Label>
              <Select value={form.waybillEnabled ? '1' : '0'} onValueChange={v => set('waybillEnabled', v === '1')}>
                <SelectTrigger aria-label="电子面单取号状态" className="h-8 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">未开通</SelectItem>
                  <SelectItem value="1">已开通</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.waybillEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>对接平台</Label>
                  <Select value={form.platformCode || ''} onValueChange={v => setForm(f => ({ ...f, platformCode: v, shippingProduct: '', shippingDeliveryType: '' }))}>
                    <SelectTrigger aria-label="对接平台" className="mt-1"><SelectValue placeholder="选择平台" /></SelectTrigger>
                    <SelectContent>
                      {WAYBILL_PLATFORM_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {['sf', 'deppon'].includes(form.platformCode || '') && <>
                  <div><Label htmlFor="carrier-product">默认发货产品</Label><div className="mt-1"><ShippingProductField id="carrier-product" platform={form.platformCode} value={form.shippingProduct || ''} onChange={v => set('shippingProduct', v)} /></div>
                    <p className="mt-1 text-xs text-muted-foreground">按月结合同填写，销售单可单独指定；顺丰航空服务以合同产品为准。</p></div>
                  {form.platformCode === 'deppon' && <div><Label>德邦送货方式</Label><Select value={form.shippingDeliveryType || ''} onValueChange={v => set('shippingDeliveryType', v)}><SelectTrigger aria-label="德邦送货方式" className="mt-1"><SelectValue placeholder="选择送货方式" /></SelectTrigger><SelectContent><SelectItem value="1">自提</SelectItem><SelectItem value="3">送货不上楼</SelectItem><SelectItem value="4">送货上楼</SelectItem></SelectContent></Select></div>}
                  <p className="col-span-2 text-xs text-muted-foreground">打包完成后自动按实际箱数下单，重量由快递员称重确认。启用前须完成官方接口联调。</p>
                </>}
                <div><Label htmlFor="carrier-platformCarrier">快递公司编码</Label><Input className="mt-1" placeholder="如 SF / YTO / ZTO" id="carrier-platformCarrier" value={form.platformCarrier} onChange={e => set('platformCarrier', e.target.value)} /></div>
                <div><Label htmlFor="carrier-monthlyAccount">月结账号</Label><Input className="mt-1" placeholder="可选" id="carrier-monthlyAccount" value={form.monthlyAccount} onChange={e => set('monthlyAccount', e.target.value)} /></div>
                <div><Label htmlFor="carrier-netSiteCode">网点编码</Label><Input className="mt-1" placeholder="可选" id="carrier-netSiteCode" value={form.netSiteCode} onChange={e => set('netSiteCode', e.target.value)} /></div>
                <div>
                  <Label htmlFor="carrier-credentialRef">凭据引用名</Label>
                  <Input className="mt-1" placeholder="由系统管理员提供的凭据引用名" id="carrier-credentialRef" value={form.credentialRef} onChange={e => set('credentialRef', e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">填写已配置的凭据引用名，无需填写密钥。</p>
                </div>
              </div>
            )}
          </div>

          {editing && (
            <div>
              <Label>状态</Label>
              <Select value={form.isActive ? '1' : '0'} onValueChange={v => set('isActive', v === '1')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">启用</SelectItem>
                  <SelectItem value="0">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
      submitForm={(editing) => {
        const base = { name: form.name, type: form.type, contact: form.contact, phone: form.phone, remark: form.remark, ...platformPayload(form) }
        return editing
          ? updateCarrierApi(editing.id, { ...base, isActive: form.isActive }, { skipGlobalError: true })
          : createCarrierApi(base, { skipGlobalError: true })
      }}
    />
  )
}
