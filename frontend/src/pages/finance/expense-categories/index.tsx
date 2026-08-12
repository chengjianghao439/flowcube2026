import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import {
  getExpenseCategoriesApi, createExpenseCategoryApi, updateExpenseCategoryApi,
  deleteExpenseCategoryApi, type ExpenseCategory,
} from '@/api/finance'
import type { TableColumn } from '@/types'
import BaseCrudPage from '@/components/shared/BaseCrudPage'

const EMPTY = { name: '', sortOrder: '0', remark: '', isActive: true }

export default function ExpenseCategoriesPage() {
  const [form, setForm] = useState(EMPTY)

  const columns: TableColumn<ExpenseCategory>[] = [
    { key: 'code', title: '编码', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '类别名称', width: 180 },
    { key: 'sortOrder', title: '排序', width: 80 },
    { key: 'isActive', title: '状态', width: 90, render: (_, row) => {
      const c = row as ExpenseCategory
      return <SoftStatusLabel label={c.isActive ? '启用' : '停用'} tone={activeTone(c.isActive)} />
    }},
    { key: 'remark', title: '备注', render: v => (v as string) || <span className="text-muted-foreground">—</span> },
  ]

  return (
    <BaseCrudPage<ExpenseCategory>
      title="费用类别"
      description="报销单填写时可选的费用类别。已被报销单使用的类别不能删除，只能停用。"
      columns={columns}
      queryKey={['expense-categories', 'all']}
      listQuery={() => getExpenseCategoriesApi(false)}
      deleteApi={(id) => deleteExpenseCategoryApi(id)}
      deleteMessage="已被报销单使用的类别不能删除，请改为停用。"
      createLabel="新建类别"
      saveSuccessMessage={(editing) => editing ? '类别已保存' : '类别已创建'}
      canSubmit={() => !!form.name.trim()}
      renderForm={(editing) => (
        <>
          <div className="space-y-1">
            <Label>类别名称 *</Label>
            <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：差旅费" />
          </div>
          <div className="space-y-1">
            <Label>排序</Label>
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>备注</Label>
            <Input value={form.remark} onChange={(e) => setForm(f => ({ ...f, remark: e.target.value }))} />
          </div>
          {editing && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="cat-active" className="accent-primary" checked={form.isActive}
                onChange={(e) => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              <Label htmlFor="cat-active" className="cursor-pointer">启用（停用后新报销单不可再选）</Label>
            </div>
          )}
        </>
      )}
      submitForm={(editing) => {
        const payload = { name: form.name.trim(), sortOrder: Number(form.sortOrder) || 0, remark: form.remark || undefined }
        return editing
          ? updateExpenseCategoryApi(editing.id, { ...payload, isActive: form.isActive })
          : createExpenseCategoryApi(payload)
      }}
      formTitle={(editing) => editing ? '编辑类别' : '新建类别'}
    />
  )
}
