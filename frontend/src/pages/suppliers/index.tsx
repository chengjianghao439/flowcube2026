import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { SettlementTypeField } from '@/components/shared/SettlementTypeField'
import { activeTone, type StatusTone } from '@/lib/statusTone'
import { SETTLEMENT_TYPE, SETTLEMENT_TYPE_TONE, type SettlementType } from '@/generated/status'
import { Label } from '@/components/ui/label'
import { LimitedInput } from '@/components/shared/LimitedInput'
import { getSuppliersApi, createSupplierApi, updateSupplierApi, deleteSupplierApi } from '@/api/suppliers'
import type { Supplier } from '@/types/suppliers'
import type { TableColumn } from '@/types'
import BaseCrudPage from '@/components/shared/BaseCrudPage'
import { Button } from '@/components/ui/button'
import { FilterCard } from '@/components/shared/FilterCard'

const PHONE_RE = /^1\d{10}$/

const empty = {
  name:'', contact:'', phone:'', email:'', address:'', remark:'',
  settlementType: SETTLEMENT_TYPE.MONTHLY as SettlementType,
  paymentTermsDays: 30,
  leadTimeDays: 0,
  isActive: true,
}

export default function SuppliersPage() {
  const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('')
  const [form, setForm] = useState(empty)
  const set = (k:string, v:string|boolean) => setForm(f=>({...f,[k]:v}))

  // 打开弹窗时回填表单（新建=默认值，编辑=行数据）
  function handleOpen(editing: Supplier | null) {
    if (editing) {
      setForm({
        name:editing.name, contact:editing.contact??'', phone:editing.phone??'', email:editing.email??'',
        address:editing.address??'', remark:editing.remark??'',
        settlementType: editing.settlementType ?? SETTLEMENT_TYPE.MONTHLY,
        paymentTermsDays: editing.paymentTermsDays ?? 30,
        leadTimeDays: editing.leadTimeDays ?? 0,
        isActive: editing.isActive,
      })
    } else {
      setForm(empty)
    }
  }

  const cols:TableColumn<Supplier>[] = [
    { key:'code', title:'编码', width:120 },
    { key:'name', title:'名称', width:180 },
    { key:'contact', title:'联系人', width:100, render:v=>(v as string)||'-' },
    { key:'phone', title:'电话', width:130, render:v=>(v as string)||'-' },
    { key:'email', title:'邮箱', render:v=>(v as string)||'-' },
    { key:'settlementType', title:'结算方式', width:110, render:(_,r)=>(
      <SoftStatusLabel
        label={r.settlementType === SETTLEMENT_TYPE.MONTHLY ? `月结 ${r.paymentTermsDays} 天` : r.settlementTypeName}
        tone={(SETTLEMENT_TYPE_TONE[String(r.settlementType) as keyof typeof SETTLEMENT_TYPE_TONE] ?? 'info') as StatusTone}
      />
    ) },
    { key:'isActive', title:'状态', width:80, render:(_,r)=><SoftStatusLabel label={r.isActive?'启用':'停用'} tone={activeTone(r.isActive)} /> },
  ]

  return (
    <BaseCrudPage<Supplier>
      title="供应商管理"
      description="管理采购供应商档案"
      columns={cols}
      queryKey={['suppliers', { pageSize: 99999, keyword }]}
      listQuery={() => getSuppliersApi({ pageSize: 99999, keyword })}
      deleteApi={(id) => deleteSupplierApi(id, { skipGlobalError: true })}
      deleteMessage="仅未被采购、退货或库存流水引用的供应商允许删除；若已被引用，请改为编辑后停用。"
      createLabel="新增供应商"
      saveSuccessMessage={(editing) => editing ? '供应商已保存' : '供应商已创建'}
      formWidthClass="sm:max-w-lg"
      canSubmit={() => !!form.name}
      onOpen={handleOpen}
      renderToolbar={
        <FilterCard>
          <Input placeholder="搜索编码或名称" value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>e.key==='Enter'&&setKeyword(search)} className="h-9 w-60" />
          <Button size="sm" variant="outline" onClick={()=>{setKeyword(search)}}>搜索</Button>
          {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('')}}>重置</Button>}
        </FilterCard>
      }
      renderForm={(editing) => {
        const isEdit = !!editing
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {isEdit && (
                <div className="space-y-1">
                  <Label>供应商编码</Label>
                  <Input value={editing.code} disabled className="bg-muted/50 font-mono text-sm" />
                </div>
              )}
              <div className="space-y-1"><Label>名称 *</Label><LimitedInput maxLength={20} value={form.name} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('name',e.target.value)} placeholder="供应商名称"/></div>
              <div className="space-y-1"><Label>联系人</Label><LimitedInput maxLength={5} value={form.contact} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('contact',e.target.value)}/></div>
              <div className="space-y-1"><Label>电话</Label><LimitedInput maxLength={11} value={form.phone} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('phone',e.target.value)} placeholder="11位手机号" inputMode="numeric"/></div>
            </div>
            <div className="space-y-1"><Label>邮箱</Label><Input value={form.email} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('email',e.target.value)} placeholder="选填"/></div>
            <div className="space-y-1"><Label>地址</Label><LimitedInput maxLength={30} value={form.address} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('address',e.target.value)}/></div>
            <div className="space-y-1"><Label>备注</Label><LimitedInput maxLength={30} value={form.remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('remark',e.target.value)}/></div>
            <SettlementTypeField
              side="payable"
              settlementType={form.settlementType}
              paymentTermsDays={form.paymentTermsDays}
              onChange={next => setForm(f => ({ ...f, ...next }))}
            />
            <div className="space-y-1">
              <Label>采购提前期（天）</Label>
              <Input type="number" min="0" max="365" value={String(form.leadTimeDays)}
                onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setForm(f=>({...f, leadTimeDays: Number(e.target.value) || 0}))}
                placeholder="下单到到货天数，用于采购计划预测" />
            </div>
            {isEdit && <div className="flex items-center gap-2"><input type="checkbox" id="sp-active" checked={form.isActive} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('isActive',e.target.checked)} className="accent-primary"/><Label htmlFor="sp-active" className="cursor-pointer">启用</Label></div>}
          </div>
        )
      }}
      submitForm={(editing) => {
        if (form.phone && !PHONE_RE.test(form.phone)) throw { response: { data: { message: '请输入正确的手机号' } } }
        const p = { name:form.name, contact:form.contact||undefined, phone:form.phone||undefined, email:form.email||undefined, address:form.address||undefined, remark:form.remark||undefined, settlementType:form.settlementType, paymentTermsDays:form.paymentTermsDays, leadTimeDays:form.leadTimeDays }
        return editing
          ? updateSupplierApi(editing.id, {...p, isActive: form.isActive})
          : createSupplierApi(p)
      }}
    />
  )
}
