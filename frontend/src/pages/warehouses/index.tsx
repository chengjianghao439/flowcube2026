import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { getWarehousesApi, createWarehouseApi, updateWarehouseApi, deleteWarehouseApi } from '@/api/warehouses'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { WAREHOUSE_TYPES, type Warehouse } from '@/types/warehouses'
import type { TableColumn } from '@/types'
import BaseCrudPage from '@/components/shared/BaseCrudPage'

const defaultForm = {
  name: '', type: 1,
  manager: '', phone: '', address: '', remark: '', isActive: true,
}

export default function WarehousesPage() {
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const page = 1
  const [form, setForm] = useState(defaultForm)

  function set(field: string, value: string | number | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // 打开弹窗时回填表单（新建=默认值，编辑=行数据）
  function handleOpen(editing: Warehouse | null) {
    if (editing) {
      setForm({
        name: editing.name,
        type: editing.type,
        manager: editing.manager ?? '',
        phone: editing.phone ?? '',
        address: editing.address ?? '',
        remark: editing.remark ?? '',
        isActive: editing.isActive,
      })
    } else {
      setForm(defaultForm)
    }
  }

  const columns: TableColumn<Warehouse>[] = [
    { key: 'code', title: '仓库编码', width: 120 },
    { key: 'name', title: '仓库名称', width: 180 },
    {
      key: 'typeName', title: '类型', width: 90,
      render: (_, row) => (
        <SoftStatusLabel label={row.typeName} tone="info" />
      ),
    },
    { key: 'manager', title: '负责人', width: 100, render: (v) => (v as string) || '-' },
    { key: 'phone', title: '联系电话', width: 130, render: (v) => (v as string) || '-' },
    { key: 'address', title: '地址', render: (v) => (v as string) || '-' },
    {
      key: 'isActive', title: '状态', width: 80,
      render: (_, row) => (
        <SoftStatusLabel label={row.isActive ? '启用' : '停用'} tone={activeTone(row.isActive)} />
      ),
    },
  ]

  return (
    <BaseCrudPage<Warehouse>
      title="仓库管理"
      description="管理仓库档案信息"
      columns={columns}
      queryKey={['warehouses', { page, pageSize: 20, keyword }]}
      listQuery={() => getWarehousesApi({ page, pageSize: 20, keyword })}
      recordUnit="个"
      deleteApi={(id) => deleteWarehouseApi(id, { skipGlobalError: true })}
      deleteMessage="仅未被库位、库存、任务或业务单据引用的仓库允许删除；若已被引用，请改为编辑后停用。"
      createLabel="新增仓库"
      saveSuccessMessage={(editing) => editing ? '仓库已保存' : '仓库已创建'}
      formWidthClass="sm:max-w-2xl"
      canSubmit={() => !!form.name}
      onOpen={handleOpen}
      renderToolbar={
        <FilterCard>
          <Input placeholder="搜索编码或名称" value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { setKeyword(search) } }}
            className="h-9 w-60" />
          <Button size="sm" variant="outline" onClick={() => { setKeyword(search) }}>搜索</Button>
          {keyword && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>重置</Button>
          )}
        </FilterCard>
      }
      renderForm={(editing) => {
        const isEdit = !!editing
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {isEdit && (
                <div className="space-y-2">
                  <Label>仓库编码</Label>
                  <Input value={editing.code} disabled className="bg-muted/50 font-mono text-sm" />
                </div>
              )}
              <div className="space-y-2">
                <Label>仓库名称 *</Label>
                <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('name', e.target.value)}
                  placeholder="仓库名称" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>仓库类型 *</Label>
              <div className="flex flex-wrap gap-4">
                {WAREHOUSE_TYPES.map((t) => (
                  <label key={t.value} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="type" value={t.value}
                      checked={form.type === t.value}
                      onChange={() => set('type', t.value)}
                      className="accent-primary" />
                    <span className="text-sm">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>负责人</Label>
                <Input value={form.manager} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('manager', e.target.value)}
                  placeholder="负责人姓名" />
              </div>
              <div className="space-y-2">
                <Label>联系电话</Label>
                <Input value={form.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('phone', e.target.value)}
                  placeholder="联系电话" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>仓库地址</Label>
              <Input value={form.address} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('address', e.target.value)}
                placeholder="详细地址" />
            </div>

            <div className="space-y-2">
              <Label>备注</Label>
              <Input value={form.remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('remark', e.target.value)}
                placeholder="备注信息" />
            </div>

            {isEdit && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="wh-active" checked={form.isActive}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('isActive', e.target.checked)}
                  className="accent-primary" />
                <Label htmlFor="wh-active" className="cursor-pointer">启用仓库</Label>
              </div>
            )}
          </div>
        )
      }}
      submitForm={(editing) => {
        const payload = {
          name: form.name, type: form.type,
          manager: form.manager || undefined,
          phone: form.phone || undefined,
          address: form.address || undefined,
          remark: form.remark || undefined,
        }
        return editing
          ? updateWarehouseApi(editing.id, { ...payload, isActive: form.isActive })
          : createWarehouseApi(payload)
      }}
    />
  )
}
