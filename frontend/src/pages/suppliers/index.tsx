import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { ExecutionBridgePanel } from '@/components/shared/ExecutionBridgePanel'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { useSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier } from '@/hooks/useSuppliers'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import type { Supplier } from '@/types/suppliers'
import type { TableColumn } from '@/types'

const PHONE_RE = /^1\d{10}$/

const empty = { name:'', contact:'', phone:'', email:'', address:'', remark:'', isActive:true }

export default function SuppliersPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false); const [edit, setEdit] = useState<Supplier|null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Supplier|null>(null)
  const [form, setForm] = useState(empty)
  const { data, isLoading } = useSuppliers({ page, pageSize:20, keyword })
  const { mutate: create, isPending: creating } = useCreateSupplier()
  const { mutate: update, isPending: updating } = useUpdateSupplier()
  const { mutate: del } = useDeleteSupplier()
  const isPending = creating || updating
  const set = (k:string, v:string|boolean) => setForm(f=>({...f,[k]:v}))

  function openCreate() { setEdit(null); setForm(empty); setOpen(true) }
  function openEdit(s:Supplier) { setEdit(s); setForm({name:s.name,contact:s.contact??'',phone:s.phone??'',email:s.email??'',address:s.address??'',remark:s.remark??'',isActive:s.isActive}); setOpen(true) }
  function handleSubmit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (form.phone && !PHONE_RE.test(form.phone)) { toast.error('请输入正确的手机号'); return }
    const p = { name:form.name, contact:form.contact||undefined, phone:form.phone||undefined, email:form.email||undefined, address:form.address||undefined, remark:form.remark||undefined }
    if (edit) update({ id:edit.id, data:{...p,isActive:form.isActive} }, { onSuccess:()=>setOpen(false) })
    else create(p, { onSuccess:()=>setOpen(false) })
  }

  const cols:TableColumn<Supplier>[] = [
    { key:'code', title:'编码', width:120 },
    { key:'name', title:'名称' },
    { key:'contact', title:'联系人', width:100, render:v=>(v as string)||'-' },
    { key:'phone', title:'电话', width:130, render:v=>(v as string)||'-' },
    { key:'email', title:'邮箱', render:v=>(v as string)||'-' },
    { key:'isActive', title:'状态', width:80, render:(_,r)=><Badge variant={r.isActive?'default':'destructive'}>{r.isActive?'启用':'停用'}</Badge> },
    { key:'id', title:'操作', width:140, render:(_,r)=>(
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={()=>openEdit(r)}>编辑</Button>
        <Button size="sm" variant="destructive" onClick={()=> setConfirmTarget(r)}>删除</Button>
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="供应商管理" description="管理采购供应商档案" actions={<Button onClick={openCreate}>新增供应商</Button>} />
      <FocusModePanel
        badge="经营侧闭环"
        title="供应商页负责维护采购前置资料，并把后续处理交给采购、收货和对账入口"
        description="这页最适合先确认供应商档案、联系人和启停状态，再进入采购单、收货订单或对账基础版继续处理。供应商页承担的是主数据准确性，而不是现场执行。"
        summary={edit ? `当前操作：编辑供应商 - ${edit.name}` : '当前焦点：供应商资料维护'}
        steps={[
          '先维护供应商基础资料，确保采购建单和到货跟踪不会带错对象。',
          '需要继续推进采购或收货时，切到采购单和收货订单主链。',
          '需要核对应付款或到货异常时，切到对账基础版、应付账款和异常工作台继续处理。',
        ]}
        actions={[
          { label: '打开采购单', variant: 'default', onClick: () => navigate('/purchase') },
          { label: '打开收货订单', onClick: () => navigate('/inbound-tasks') },
          { label: '打开对账基础版', onClick: () => navigate('/reports/reconciliation?type=1') },
        ]}
      />
      <ExecutionBridgePanel
        badge="ERP / 处理执行桥接"
        title="供应商页统一承接采购判断与后续到货处理动作"
        description="ERP 在这里负责判断供应商资料、启停状态和采购前置条件是否完整；实际处理动作则通过采购单、收货订单、对账和应付账款继续推进，避免供应商页只停在资料维护。"
        erpTitle="先在 ERP 判断供应商资料、可用状态和采购风险"
        erpItems={[
          '先确认供应商名称、联系人、启停状态和基础资料是否适合继续承接采购。',
          '如果供应商存在到货异常、账款风险或资料缺失，优先在 ERP 层先收口判断再继续下游动作。',
          '资料确认后，再决定回采购单、收货订单或对账页继续推进。',
        ]}
        pdaTitle="再通过采购、收货和对账入口完成真实业务推进"
        pdaItems={[
          '需要继续采购时，回采购单建立计划并提交到收货主链。',
          '已经到货时，继续通过收货订单、PDA 收货和上架链路完成现场执行。',
          '需要核对应付款和到货异常时，回对账基础版、应付账款和异常工作台继续收口。',
        ]}
        actions={[
          { label: '打开采购单', variant: 'default', onClick: () => navigate('/purchase') },
          { label: '打开收货订单', onClick: () => navigate('/inbound-tasks') },
          { label: '打开应付/应收账款', onClick: () => navigate('/payments') },
        ]}
      />
      <FilterCard>
        <Input placeholder="搜索编码或名称" value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&(setPage(1),setKeyword(search))} className="h-9 w-60" />
        <Button size="sm" variant="outline" onClick={()=>{setPage(1);setKeyword(search)}}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('');setPage(1)}}>重置</Button>}
      </FilterCard>
      <DataTable columns={cols} data={data?.list??[]} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} rowKey="id" />

      <ConfirmDialog
        open={!!confirmTarget}
        title="确认删除"
        description={`删除供应商「${confirmTarget?.name}」？该操作不可撤销。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { del(confirmTarget!.id); setConfirmTarget(null) }}
        onCancel={() => setConfirmTarget(null)}
      />
      <Dialog open={open} onOpenChange={v=>!v&&setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{edit?'编辑供应商':'新增供应商'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              {edit && (
                <div className="space-y-1">
                  <Label>供应商编码</Label>
                  <Input value={edit.code} disabled className="bg-muted/50 font-mono text-sm" />
                </div>
              )}
              <div className="space-y-1"><Label>名称 *</Label><LimitedInput maxLength={20} value={form.name} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('name',e.target.value)} disabled={isPending} placeholder="供应商名称"/></div>
              <div className="space-y-1"><Label>联系人</Label><LimitedInput maxLength={5} value={form.contact} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('contact',e.target.value)} disabled={isPending}/></div>
              <div className="space-y-1"><Label>电话</Label><LimitedInput maxLength={11} value={form.phone} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('phone',e.target.value)} disabled={isPending} placeholder="11位手机号" inputMode="numeric"/></div>
            </div>
            <div className="space-y-1"><Label>邮箱</Label><Input value={form.email} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('email',e.target.value)} disabled={isPending} placeholder="选填"/></div>
            <div className="space-y-1"><Label>地址</Label><LimitedInput maxLength={30} value={form.address} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('address',e.target.value)} disabled={isPending}/></div>
            <div className="space-y-1"><Label>备注</Label><LimitedInput maxLength={30} value={form.remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('remark',e.target.value)} disabled={isPending}/></div>
            {edit && <div className="flex items-center gap-2"><input type="checkbox" id="sp-active" checked={form.isActive} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('isActive',e.target.checked)} className="accent-primary"/><Label htmlFor="sp-active" className="cursor-pointer">启用</Label></div>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setOpen(false)} disabled={isPending}>取消</Button>
              <Button type="submit" disabled={isPending||!form.name}>{isPending?'保存中...':'保存'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
