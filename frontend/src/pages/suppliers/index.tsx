import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import { payloadClient as client } from '@/api/client'

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
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(empty)
  const set = (k:string, v:string|boolean) => setForm(f=>({...f,[k]:v}))
  const qc = useQueryClient()

  // ── 批量导入（参照客户/商品导入范式） ──
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 供应商批量导入：模板列 = 编码/名称/联系人/电话/结算方式(1现结/2月结)/账期/提前期/地址
  // 后端逐行返回回执；编码、结算方式等与 suppliers.service.create 口径一致。
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await client.post<{ success: number; errors: string[] }>('/import/suppliers', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setImportResult({ success: r.success ?? 0, errors: r.errors ?? [] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    } catch (err: unknown) {
      toast.error((err as { message?: string }).message || '导入失败')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

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
    { key:'name', title:'供应商 / 编码', width:260, render:(_,r)=><RecordIdentity title={r.name} code={r.code} /> },
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
      queryKey={['suppliers', { page, pageSize: 20, keyword }]}
      listQuery={() => getSuppliersApi({ page, pageSize: 20, keyword })}
      pagination={{ page, pageSize: 20, unit: '个', onPageChange: setPage }}
      deleteApi={(id) => deleteSupplierApi(id, { skipGlobalError: true })}
      deleteMessage="仅未被采购、退货或库存流水引用的供应商允许删除；若已被引用，请改为编辑后停用。"
      createLabel="新增供应商"
      headerActions={
        <>
          <Button variant="outline" onClick={() => downloadExport('/export/suppliers').catch(e => toast.error((e as Error).message))}>导出</Button>
          <Button variant="outline" onClick={() => setImportOpen(v => !v)}>批量导入</Button>
        </>
      }
      saveSuccessMessage={(editing) => editing ? '供应商已保存' : '供应商已创建'}
      formWidthClass="sm:max-w-3xl"
      canSubmit={() => !!form.name}
      onOpen={handleOpen}
      renderToolbar={
        <>
          {importOpen && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                请先下载模板，按格式填写后上传。列：供应商编码（可空，留空自动生成）、供应商名称*、联系人、电话、结算方式（填 1=现结 / 2=月结）、账期（天，仅月结有效）、采购提前期（天）、地址。名称或编码重复的行会跳过并留痕。
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadExport('/import/suppliers/template').catch(e => toast.error((e as Error).message))}>下载导入模板</Button>
                <div className="flex items-center gap-2">
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importing}>
                    {importing ? '导入中…' : '选择文件并上传'}
                  </Button>
                </div>
              </div>
              {importResult && (
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="text-success font-medium">导入成功：{importResult.success} 条</p>
                  {importResult.errors.length > 0 && (
                    <div className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                      {importResult.errors.map((err, i) => <p key={i}>{err}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <FilterCard>
            <Input placeholder="搜索编码或名称" value={search} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} onKeyDown={(e:React.KeyboardEvent)=>{ if(e.key==='Enter'){ setKeyword(search); setPage(1) } }} className="h-9 w-60" />
            <Button size="sm" variant="outline" onClick={()=>{setKeyword(search);setPage(1)}}>搜索</Button>
            {keyword && <Button size="sm" variant="ghost" onClick={()=>{setSearch('');setKeyword('');setPage(1)}}>重置</Button>}
          </FilterCard>
        </>
      }
      renderForm={(editing) => {
        const isEdit = !!editing
        return (
          <div className="space-y-5">
            <h3 className="text-sm font-medium">供应商与联系方式</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {isEdit && (
                <div className="space-y-1">
                  <Label>供应商编码</Label>
                  <Input value={editing.code} disabled className="bg-muted/50 font-mono text-sm" />
                </div>
              )}
              <div className="space-y-1"><Label>名称 *</Label><LimitedInput maxLength={20} value={form.name} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('name',e.target.value)} placeholder="供应商名称"/></div>
              <div className="space-y-1"><Label>联系人</Label><LimitedInput maxLength={5} value={form.contact} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('contact',e.target.value)}/></div>
              <div className="space-y-1"><Label>电话</Label><LimitedInput maxLength={11} value={form.phone} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('phone',e.target.value)} placeholder="11位手机号" inputMode="numeric"/></div>
              <div className="space-y-1"><Label>邮箱</Label><Input value={form.email} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('email',e.target.value)} placeholder="选填"/></div>
            </div>
            <div className="space-y-1"><Label>地址</Label><LimitedInput maxLength={30} value={form.address} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('address',e.target.value)}/></div>
            <div className="space-y-1"><Label>备注</Label><LimitedInput maxLength={30} value={form.remark} onChange={(e:React.ChangeEvent<HTMLInputElement>)=>set('remark',e.target.value)}/></div>
            <h3 className="border-t pt-4 text-sm font-medium">结算与供货</h3>
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
