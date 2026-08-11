import { useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment } from '@/hooks/useDepartments'
import { useUsers } from '@/hooks/useUsers'
import type { Department } from '@/types/department'

interface DeptFormState {
  name: string
  parentId: number
  managerId: number | null
  sortOrder: number
  remark: string
}
const emptyForm = (): DeptFormState => ({ name: '', parentId: 0, managerId: null, sortOrder: 0, remark: '' })

export default function DepartmentsPage() {
  const { data: departments = [], isLoading } = useDepartments()
  const { data: usersData } = useUsers({ pageSize: 99999, keyword: '' })
  const users = usersData?.list ?? []
  const { mutate: createDept } = useCreateDepartment()
  const { mutate: updateDept } = useUpdateDepartment()
  const { mutate: deleteDept } = useDeleteDepartment()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [form, setForm] = useState<DeptFormState>(emptyForm())
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)

  /** 部门树（parentId → children） */
  const tree = useMemo(() => {
    const map = new Map<number, Department & { children: Array<Department & { children: never }> }>()
    const roots: Array<Department & { children: [] }> = []
    for (const d of departments) {
      map.set(d.id, { ...d, children: [] })
    }
    for (const d of departments) {
      const node = map.get(d.id)!
      if (d.parentId && map.has(d.parentId)) map.get(d.parentId)!.children.push(node as never)
      else roots.push(node as never)
    }
    return roots
  }, [departments])

  const renderTree = (nodes: Array<Department & { children: [] }>, depth = 0) => (
    nodes.map((d) => (
      <div key={d.id}>
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
          style={{ paddingLeft: `${depth * 24 + 8}px` }}
        >
          <span className="font-medium">{d.name}</span>
          <span className="text-xs text-muted-foreground">
            {d.managerName ? `负责人 ${d.managerName}` : '未设负责人'} · {d.memberCount} 人
          </span>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>编辑</Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(d)}>删除</Button>
          </div>
        </div>
        {d.children.length > 0 && renderTree(d.children as never, depth + 1)}
      </div>
    ))
  )

  function openCreate(parentId = 0) {
    setEditing(null)
    setForm({ ...emptyForm(), parentId })
    setFormOpen(true)
  }
  function openEdit(d: Department) {
    setEditing(d)
    setForm({ name: d.name, parentId: d.parentId, managerId: d.managerId, sortOrder: d.sortOrder, remark: d.remark ?? '' })
    setFormOpen(true)
  }

  function handleSave() {
    if (!form.name.trim()) return toast.error('请填写部门名称')
    const payload = { ...form, managerId: form.managerId || null }
    if (editing) {
      updateDept({ id: editing.id, data: payload }, {
        onSuccess: () => { setFormOpen(false); toast.success('已保存') },
        onError: (e: Error) => toast.error(e.message),
      })
    } else {
      createDept(payload, {
        onSuccess: () => { setFormOpen(false); toast.success('已创建') },
        onError: (e: Error) => toast.error(e.message),
      })
    }
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteDept(deleteTarget.id, {
      onSuccess: () => { setDeleteTarget(null); toast.success('已删除') },
      onError: (e: Error) => toast.error(e.message),
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="部门管理"
        description="维护组织部门与负责人，审批流可按部门负责人寻人"
        actions={
          <Button onClick={() => openCreate()}>
            新增部门
          </Button>
        }
      />

      <div className="rounded-lg border bg-card p-4">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : departments.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无部门，点击右上角「新增部门」创建第一个部门</div>
        ) : (
          renderTree(tree)
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={(v) => !v && setFormOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑部门' : '新增部门'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>部门名称</Label>
              <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} placeholder="如：采购部" />
            </div>
            <div className="space-y-2">
              <Label>上级部门</Label>
              <select
                value={form.parentId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, parentId: Number(e.target.value) })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value={0}>无（顶级部门）</option>
                {departments.filter(d => d.id !== editing?.id).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>部门负责人</Label>
              <select
                value={form.managerId ?? ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, managerId: e.target.value ? Number(e.target.value) : null })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">未设置</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.realName}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>排序</Label>
              <Input type="number" min={0} value={form.sortOrder} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input value={form.remark} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={`确定删除部门「${deleteTarget?.name}」吗？部门下有子部门或用户时无法删除。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
