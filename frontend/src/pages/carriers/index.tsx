/**
 * 承运商管理页
 * 路由：/carriers
 */
import { useState } from 'react'
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
  platformCode: '', platformCarrier: '', monthlyAccount: '', netSiteCode: '', credentialRef: '', waybillEnabled: false,
}

// 建/改承运商时提交的对接字段（密钥不在前端）
function platformPayload(f: FormState) {
  return {
    platformCode: f.waybillEnabled ? f.platformCode : '',
    platformCarrier: f.platformCarrier,
    monthlyAccount: f.monthlyAccount,
    netSiteCode: f.netSiteCode,
    credentialRef: f.credentialRef,
    waybillEnabled: f.waybillEnabled,
  }
}

export default function CarriersPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const set = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  // 打开弹窗时回填表单（新建=默认值，编辑=行数据）
  function handleOpen(editing: Carrier | null) {
    if (editing) {
      setForm({
        name: editing.name, type: editing.type, contact: editing.contact ?? '', phone: editing.phone ?? '', remark: editing.remark ?? '', isActive: editing.isActive,
        platformCode: editing.platformCode ?? '', platformCarrier: editing.platformCarrier ?? '', monthlyAccount: editing.monthlyAccount ?? '',
        netSiteCode: editing.netSiteCode ?? '', credentialRef: editing.credentialRef ?? '', waybillEnabled: editing.waybillEnabled,
      })
    } else {
      setForm(EMPTY_FORM)
    }
  }

  const columns: TableColumn<Carrier>[] = [
    { key: 'code',     title: '编号', width: 120,
      render: v => <span className="text-doc-code">{v as string}</span> },
    { key: 'name',     title: '名称', width: 180 },
    { key: 'type',     title: '类型', width: 80,
      render: v => CARRIER_TYPE_LABELS[v as CarrierType] },
    { key: 'contact',  title: '联系人',
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
    { key: 'phone',    title: '电话',
      render: v => (v as string | null) ?? <span className="text-muted-foreground">—</span> },
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
      pagination={{ page, pageSize: 20, unit: '个', onPageChange: setPage }}
      deleteApi={(id) => deleteCarrierApi(id, { skipGlobalError: true })}
      deleteMessage="确认删除该承运商？删除后不可恢复。"
      createLabel="+ 新建承运商"
      saveSuccessMessage={(editing) => editing ? '承运商已保存' : '承运商已创建'}
      formWidthClass="max-w-md"
      headerActions={
        <Button variant="outline" onClick={() => downloadExport('/export/carriers').catch(e => toast.error((e as Error).message))}>导出</Button>
      }
      onOpen={handleOpen}
      canSubmit={() => !!form.name}
      renderToolbar={
        <FilterCard>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <Input placeholder="名称 / 编号" value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>
          </div>
        </FilterCard>
      }
      renderForm={(editing) => (
        <div className="space-y-3 py-2">
          <div><Label>名称</Label><Input className="mt-1" placeholder="承运商名称" value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div>
            <Label>类型</Label>
            <Select value={form.type} onValueChange={v => set('type', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CARRIER_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>联系人</Label><Input className="mt-1" placeholder="可选" value={form.contact} onChange={e => set('contact', e.target.value)} /></div>
          <div><Label>电话</Label><Input className="mt-1" placeholder="可选" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><Label>备注</Label><Input className="mt-1" placeholder="可选" value={form.remark} onChange={e => set('remark', e.target.value)} /></div>

          {/* 电子面单对接（文档 06）。密钥走服务端 env，前端只填非敏感对接项。 */}
          <div className="border-t border-border pt-3 mt-1 space-y-3">
            <div className="flex items-center justify-between">
              <Label>电子面单取号</Label>
              <Select value={form.waybillEnabled ? '1' : '0'} onValueChange={v => set('waybillEnabled', v === '1')}>
                <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">未开通</SelectItem>
                  <SelectItem value="1">已开通</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.waybillEnabled && (
              <div className="space-y-3">
                <div>
                  <Label>对接平台</Label>
                  <Select value={form.platformCode || ''} onValueChange={v => set('platformCode', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="选择平台" /></SelectTrigger>
                    <SelectContent>
                      {WAYBILL_PLATFORM_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>快递公司编码</Label><Input className="mt-1" placeholder="如 SF / YTO / ZTO" value={form.platformCarrier} onChange={e => set('platformCarrier', e.target.value)} /></div>
                <div><Label>月结账号</Label><Input className="mt-1" placeholder="可选" value={form.monthlyAccount} onChange={e => set('monthlyAccount', e.target.value)} /></div>
                <div><Label>网点编码</Label><Input className="mt-1" placeholder="可选" value={form.netSiteCode} onChange={e => set('netSiteCode', e.target.value)} /></div>
                <div>
                  <Label>凭据引用名</Label>
                  <Input className="mt-1" placeholder="指向 env 中的密钥组，如 kdniao_main" value={form.credentialRef} onChange={e => set('credentialRef', e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">密钥（app_key/secret）配置在服务端环境变量，不在此填写。</p>
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
