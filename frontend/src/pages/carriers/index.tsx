/**
 * 承运商管理页
 * 路由：/carriers
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getCarriersApi, createCarrierApi, updateCarrierApi, deleteCarrierApi } from '@/api/carriers'
import { CARRIER_TYPE_OPTIONS, CARRIER_TYPE_LABELS, WAYBILL_PLATFORM_OPTIONS, type Carrier, type CarrierType, type CreateCarrierParams } from '@/types/carriers'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'

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
  const qc = useQueryClient()
  const [keyword, setKeyword]           = useState('')
  const [search, setSearch]             = useState('')
  const [dialogOpen, setDialogOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Carrier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Carrier | null>(null)
  const [form, setForm]                 = useState<FormState>(EMPTY_FORM)

  const { data, isLoading } = useQuery({
    queryKey: ['carriers', keyword],
    queryFn: () => getCarriersApi({ keyword, pageSize: 99999 }),
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['carriers'] }) }

  const createMut = useMutation({
    mutationFn: () => createCarrierApi({ name: form.name, type: form.type, contact: form.contact, phone: form.phone, remark: form.remark, ...platformPayload(form) }),
    onSuccess: () => { toast.success('承运商已创建'); invalidate(); closeDialog() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
  })

  const updateMut = useMutation({
    mutationFn: () => updateCarrierApi(editTarget!.id, { name: form.name, type: form.type, contact: form.contact, phone: form.phone, remark: form.remark, isActive: form.isActive, ...platformPayload(form) }),
    onSuccess: () => { toast.success('已更新'); invalidate(); closeDialog() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '更新失败'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteCarrierApi(id),
    onSuccess: () => { toast.success('已删除'); invalidate() },
    onError: () => toast.error('删除失败'),
  })

  function openCreate() { setEditTarget(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  function openEdit(c: Carrier) {
    setEditTarget(c)
    setForm({
      name: c.name, type: c.type, contact: c.contact ?? '', phone: c.phone ?? '', remark: c.remark ?? '', isActive: c.isActive,
      platformCode: c.platformCode ?? '', platformCarrier: c.platformCarrier ?? '', monthlyAccount: c.monthlyAccount ?? '',
      netSiteCode: c.netSiteCode ?? '', credentialRef: c.credentialRef ?? '', waybillEnabled: c.waybillEnabled,
    })
    setDialogOpen(true)
  }
  function closeDialog() { setDialogOpen(false); setEditTarget(null); setForm(EMPTY_FORM) }

  const set = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

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
    {
      key: 'id', title: '操作', width: 120,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="编辑"
          primaryVariant="outline"
          onPrimaryClick={() => openEdit(row)}
          items={[
            { label: '删除', destructive: true, onClick: () => setDeleteTarget(row) },
          ]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="承运商管理"
        description="管理物流、快递等承运商信息"
        actions={<Button onClick={openCreate}>+ 新建承运商</Button>}
      />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="名称 / 编号" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search) } }}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
      />

      <Dialog open={dialogOpen} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editTarget ? '编辑承运商' : '新建承运商'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
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

            {editTarget && (
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
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button
              disabled={!form.name || createMut.isPending || updateMut.isPending}
              onClick={() => editTarget ? updateMut.mutate() : createMut.mutate()}
            >
              {editTarget ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除承运商"
        description={`确认删除承运商 ${deleteTarget?.name}？`}
        variant="destructive"
        confirmText="确认删除"
        onConfirm={() => { deleteMut.mutate(deleteTarget!.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
