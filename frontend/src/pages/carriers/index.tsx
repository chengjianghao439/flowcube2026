/**
 * 承运商管理页
 * 路由：/carriers
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { FilterCard } from '@/components/shared/FilterCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { getCarriersApi, createCarrierApi, updateCarrierApi, deleteCarrierApi } from '@/api/carriers'
import { CARRIER_TYPE_OPTIONS, CARRIER_TYPE_LABELS, type Carrier, type CarrierType, type CreateCarrierParams } from '@/types/carriers'
import DataTable from '@/components/shared/DataTable'
import type { TableColumn } from '@/types'

type FormState = CreateCarrierParams & { isActive: boolean }
const EMPTY_FORM: FormState = { name: '', type: 'express', contact: '', phone: '', remark: '', isActive: true }

export default function CarriersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [keyword, setKeyword]           = useState('')
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(1)
  const [dialogOpen, setDialogOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Carrier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Carrier | null>(null)
  const [form, setForm]                 = useState<FormState>(EMPTY_FORM)

  const { data, isLoading } = useQuery({
    queryKey: ['carriers', keyword, page],
    queryFn: () => getCarriersApi({ keyword, page, pageSize: 20 }).then(r => r.data.data),
  })

  function invalidate() { qc.invalidateQueries({ queryKey: ['carriers'] }) }

  const createMut = useMutation({
    mutationFn: () => createCarrierApi({ name: form.name, type: form.type, contact: form.contact, phone: form.phone, remark: form.remark }),
    onSuccess: () => { toast.success('承运商已创建'); invalidate(); closeDialog() },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'),
  })

  const updateMut = useMutation({
    mutationFn: () => updateCarrierApi(editTarget!.id, { name: form.name, type: form.type, contact: form.contact, phone: form.phone, remark: form.remark, isActive: form.isActive }),
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
    setForm({ name: c.name, type: c.type, contact: c.contact ?? '', phone: c.phone ?? '', remark: c.remark ?? '', isActive: c.isActive })
    setDialogOpen(true)
  }
  function closeDialog() { setDialogOpen(false); setEditTarget(null); setForm(EMPTY_FORM) }

  const set = (k: keyof FormState, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const columns: TableColumn<Carrier>[] = [
    { key: 'code',     title: '编号', width: 120,
      render: v => <span className="text-doc-code">{v as string}</span> },
    { key: 'name',     title: '名称' },
    { key: 'type',     title: '类型', width: 80,
      render: v => CARRIER_TYPE_LABELS[v as CarrierType] },
    { key: 'contact',  title: '联系人',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'phone',    title: '电话',
      render: v => v ?? <span className="text-muted-foreground">—</span> },
    { key: 'isActive', title: '状态', width: 80,
      render: v => <Badge variant={v ? 'default' : 'outline'}>{v ? '启用' : '停用'}</Badge> },
    {
      key: 'id', title: '操作', width: 120,
      render: (_, row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>编辑</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(row)}>删除</Button>
        </div>
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

      <FocusModePanel
        badge="主数据闭环"
        title="承运商页负责维护物流基础资料，并把执行动作交给销售、仓库任务和物流标签处理链"
        description="这页最适合先确认承运商档案、类型和启停状态，再去销售单、仓库任务和打印查询处理物流标签、出库和现场执行。"
        summary={editTarget ? `当前操作：编辑承运商 - ${editTarget.name}` : '当前焦点：承运商资料维护'}
        steps={[
          '先维护承运商资料，保证销售单和仓库执行不会选择失效或错误的物流渠道。',
          '再到销售单和仓库任务确认现场使用的承运商与物流动作是否一致。',
          '遇到物流标签打印异常时，回打印查询和异常工作台继续处理。',
        ]}
        actions={[
          { label: '打开销售单', variant: 'default', onClick: () => navigate('/sale') },
          { label: '打开仓库任务', onClick: () => navigate('/warehouse-tasks') },
          { label: '打开打印查询', onClick: () => navigate('/settings/barcode-print-query?category=logistics&status=failed') },
        ]}
      />

      <FilterCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <Input placeholder="名称 / 编号" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }}
            />
          </div>
          <Button onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
          <Button variant="outline" onClick={() => { setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>
        </div>
      </FilterCard>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
      />

      <Dialog open={dialogOpen} onOpenChange={v => !v && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editTarget ? '编辑承运商' : '新建承运商'}</DialogTitle></DialogHeader>
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
