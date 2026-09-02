import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment } from '@/hooks/useDepartments'
import { useUserOptions, userOptionLabel } from '@/hooks/useUserOptions'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { Department } from '@/types/department'
import type { TableColumn } from '@/types'

interface DeptFormState {
  name: string
  parentId: number
  managerId: number | null
  sortOrder: number
  remark: string
}
const emptyForm = (): DeptFormState => ({ name: '', parentId: 0, managerId: null, sortOrder: 0, remark: '' })

/** 部门树节点（parentId → children） */
type DeptNode = Department & { children: DeptNode[] }

/** DataTable 行：拍平后的可见节点 + 层级深度 */
type Row = { id: number; dept: DeptNode; depth: number }

/** 在树中按 id 找到节点（供防环统计子孙） */
function findNode(nodes: DeptNode[], id: number): DeptNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNode(n.children, id)
    if (found) return found
  }
  return null
}

/** 收集节点自身及全部子孙 id（用于编辑时排除可选父级，防成环） */
function collectSubtreeIds(n: DeptNode): number[] {
  return [n.id, ...n.children.flatMap(collectSubtreeIds)]
}

export default function DepartmentsPage() {
  const { data: departments = [], isLoading, isError, error, refetch } = useDepartments()
  const { options: userOptions, currentUserId } = useUserOptions()
  const { can } = usePermission()
  const { mutate: createDept } = useCreateDepartment()
  const { mutate: updateDept } = useUpdateDepartment()
  const { mutate: deleteDept } = useDeleteDepartment()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [form, setForm] = useState<DeptFormState>(emptyForm())
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')

  // 展开状态：首次有数据时全部展开（还原原树全展开行为），此后保留用户手动收起/展开
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const expandedInited = useRef(false)
  useEffect(() => {
    if (!expandedInited.current && departments.length) {
      setExpanded(new Set(departments.map((d) => d.id)))
      expandedInited.current = true
    }
  }, [departments])

  /** 部门树 */
  const tree = useMemo<DeptNode[]>(() => {
    const map = new Map<number, DeptNode>()
    const roots: DeptNode[] = []
    for (const d of departments) map.set(d.id, { ...d, children: [] })
    for (const d of departments) {
      const node = map.get(d.id)!
      if (d.parentId && map.has(d.parentId)) map.get(d.parentId)!.children.push(node)
      else roots.push(node)
    }
    return roots
  }, [departments])

  const kw = keyword.trim()

  /** 拍平：无关键字按 expanded 展开可见后代；有关键字强制展开、只保留命中项及其祖先 */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    // 节点自身或其子孙名称含 kw
    const hit = (n: DeptNode): boolean => kw !== '' && (n.name.includes(kw) || n.children.some(hit))
    const walk = (nodes: DeptNode[], depth: number) => {
      for (const n of nodes) {
        if (kw !== '' && !hit(n)) continue
        out.push({ id: n.id, dept: n, depth })
        const open = kw !== '' || expanded.has(n.id)
        if (open && n.children.length) walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }, [tree, expanded, kw])

  /** 编辑时排除自身及子孙作为可选父级（后端已防环，前端不把不可选项暴露出来） */
  const forbiddenParentIds = useMemo(() => {
    if (!editing) return new Set<number>()
    const node = findNode(tree, editing.id)
    return new Set(node ? collectSubtreeIds(node) : [editing.id])
  }, [editing, tree])
  const selectableParents = departments.filter((d) => !forbiddenParentIds.has(d.id))

  const canCreate = can(PERMISSIONS.DEPARTMENT_CREATE)
  const canUpdate = can(PERMISSIONS.DEPARTMENT_UPDATE)
  const canDelete = can(PERMISSIONS.DEPARTMENT_DELETE)

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

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSearch() {
    setKeyword(search)
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

  const columns: TableColumn<Row>[] = [
    {
      key: 'name',
      title: '部门名称',
      width: 260,
      render: (_v, row) => (
        <div className="flex items-center gap-1" style={{ paddingLeft: row.depth * 20 }}>
          {row.dept.children.length > 0 ? (
            <button
              type="button"
              aria-label={expanded.has(row.id) ? '收起子部门' : '展开子部门'}
              onClick={() => toggleExpand(row.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {expanded.has(row.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <span className="truncate font-medium">{row.dept.name}</span>
        </div>
      ),
    },
    {
      key: 'managerName',
      title: '负责人',
      width: 140,
      render: (v) => (v ? String(v) : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'memberCount',
      title: '成员数',
      width: 100,
      align: 'right',
      render: (_v, row) => `${row.dept.memberCount} 人`,
    },
    {
      key: 'sortOrder',
      title: '排序',
      width: 80,
      align: 'right',
      render: (_v, row) => row.dept.sortOrder,
    },
    { key: 'createdAt', title: '创建时间', render: (v) => formatDisplayDateTime(String(v)) },
    {
      key: 'actions',
      title: '操作',
      width: 180,
      render: (_v, row) => {
        if (!canUpdate && !canDelete) return null
        return (
          <TableActionsMenu
            primaryLabel={canUpdate ? '编辑' : '删除'}
            primaryVariant="outline"
            onPrimaryClick={() => (canUpdate ? openEdit(row.dept) : setDeleteTarget(row.dept))}
            items={canDelete
              ? [{ label: '删除', destructive: true, separatorBefore: canUpdate, onClick: () => setDeleteTarget(row.dept) }]
              : []}
          />
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="部门管理"
        description="维护组织部门与负责人；审批流可按部门负责人匹配审批人"
        actions={canCreate ? <Button onClick={() => openCreate()}>新增部门</Button> : null}
      />

      <FilterCard>
        <Input
          placeholder="搜索部门名称"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
          className="h-9 w-60"
        />
        <Button size="sm" variant="outline" onClick={handleSearch}>搜索</Button>
        {keyword && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword('') }}>
            重置
          </Button>
        )}
      </FilterCard>

      {isError ? (
        <QueryErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={isLoading}
          rowKey="id"
          emptyText={kw ? '没有匹配的部门' : '暂无部门，点击右上角「新增部门」创建第一个部门'}
        />
      )}

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
              <Select value={String(form.parentId)} onValueChange={(v) => setForm({ ...form, parentId: Number(v) })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="无（顶级部门）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">无（顶级部门）</SelectItem>
                  {selectableParents.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>部门负责人</Label>
              <Select value={form.managerId ? String(form.managerId) : '0'} onValueChange={(v) => setForm({ ...form, managerId: v === '0' ? null : Number(v) })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="未设置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">未设置</SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{userOptionLabel(u, currentUserId)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
