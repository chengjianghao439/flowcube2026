import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import {
  getExpenseCategoriesApi, createExpenseCategoryApi, updateExpenseCategoryApi,
  deleteExpenseCategoryApi, type ExpenseCategory,
} from '@/api/finance'
import type { TableColumn } from '@/types'

const EMPTY = { name: '', sortOrder: '0', remark: '', isActive: true }

export default function ExpenseCategoriesPage() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseCategory | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategory | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['expense-categories', 'all'],
    queryFn: () => getExpenseCategoriesApi(false),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-categories'] })

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), sortOrder: Number(form.sortOrder) || 0, remark: form.remark || undefined }
      return editing
        ? updateExpenseCategoryApi(editing.id, { ...payload, isActive: form.isActive })
        : createExpenseCategoryApi(payload)
    },
    onSuccess: () => { invalidate(); setFormOpen(false); toast.success(editing ? '类别已保存' : '类别已创建') },
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteExpenseCategoryApi(id),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast.success('类别已删除') },
  })

  const columns: TableColumn<ExpenseCategory>[] = [
    { key: 'code', title: '编码', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'name', title: '类别名称', width: 180 },
    { key: 'sortOrder', title: '排序', width: 80 },
    { key: 'isActive', title: '状态', width: 90, render: (_, row) => {
      const c = row as ExpenseCategory
      return <SoftStatusLabel label={c.isActive ? '启用' : '停用'} tone={activeTone(c.isActive)} />
    }},
    { key: 'remark', title: '备注', render: v => (v as string) || <span className="text-muted-foreground">—</span> },
    { key: 'id', title: '操作', width: 120, render: (_, row) => {
      const c = row as ExpenseCategory
      return (
        <TableActionsMenu
          primaryLabel="编辑"
          primaryVariant="outline"
          onPrimaryClick={() => {
            setEditing(c)
            setForm({ name: c.name, sortOrder: String(c.sortOrder), remark: c.remark ?? '', isActive: c.isActive })
            setFormOpen(true)
          }}
          items={[{ label: '删除', onClick: () => setDeleteTarget(c) }]}
        />
      )
    }},
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="费用类别"
        description="报销单填写时可选的费用类别。已被报销单使用的类别不能删除，只能停用。"
        actions={<Button onClick={() => { setEditing(null); setForm(EMPTY); setFormOpen(true) }}>新建类别</Button>}
      />

      <DataTable columns={columns} data={data || []} loading={isLoading} rowKey="id" />

      <Dialog open={formOpen} onOpenChange={v => !v && setFormOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? '编辑类别' : '新建类别'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>类别名称 *</Label>
              <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：差旅费" />
            </div>
            <div className="space-y-1">
              <Label>排序</Label>
              <Input type="number" value={form.sortOrder} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Input value={form.remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, remark: e.target.value }))} />
            </div>
            {editing && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="cat-active" className="accent-primary" checked={form.isActive}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                <Label htmlFor="cat-active" className="cursor-pointer">启用（停用后新报销单不可再选）</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button disabled={!form.name.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除费用类别"
        description={`确定删除「${deleteTarget?.name}」？已被报销单使用的类别不能删除，请改为停用。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </div>
  )
}
