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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment } from '@/hooks/useDepartments'
import { useUserOptions, userOptionLabel } from '@/hooks/useUserOptions'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { EditModeBadge } from '@/components/shared/EditModeBadge'
import { isElectronRuntime } from '@/lib/platform'
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
type Row = { id: number; dept: DeptNode; depth: number; path: string }
type FormErrors = Partial<Record<'name' | 'managerId' | 'sortOrder' | 'remark', string>>

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
  const { mutate: createDept, isPending: createPending } = useCreateDepartment()
  const { mutate: updateDept, isPending: updatePending } = useUpdateDepartment()
  const { mutate: deleteDept, isPending: deletePending } = useDeleteDepartment()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [form, setForm] = useState<DeptFormState>(emptyForm())
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
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
    const walk = (nodes: DeptNode[], depth: number, parentPath = '') => {
      for (const n of nodes) {
        if (kw !== '' && !hit(n)) continue
        const path = parentPath ? `${parentPath} / ${n.name}` : n.name
        out.push({ id: n.id, dept: n, depth, path })
        const open = kw !== '' || expanded.has(n.id)
        if (open && n.children.length) walk(n.children, depth + 1, path)
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
  const canManageFlows = can(PERMISSIONS.APPROVAL_FLOW_MANAGE)
  const savePending = saving || createPending || updatePending
  const selectedManager = userOptions.find((u) => u.id === form.managerId)
  const managerInvalid = form.managerId != null && (
    editing?.managerId === form.managerId
      ? editing.managerIsActive === false || editing.managerIsDevelopment
      : !selectedManager?.isActive
  )

  function openCreate(parentId = 0) {
    setEditing(null)
    setForm({ ...emptyForm(), parentId })
    setErrors({})
    setFormOpen(true)
  }
  function openEdit(d: Department) {
    setEditing(d)
    setForm({ name: d.name, parentId: d.parentId, managerId: d.managerId, sortOrder: d.sortOrder, remark: d.remark ?? '' })
    setErrors({})
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
    if (savingRef.current || savePending) return
    const nextErrors: FormErrors = {}
    const name = form.name.trim()
    if (!name) nextErrors.name = '请填写部门名称'
    else if (name.length > 50) nextErrors.name = '部门名称最多 50 字'
    if (managerInvalid) nextErrors.managerId = '请更换为启用中的负责人，或清空负责人'
    if (!Number.isInteger(form.sortOrder) || form.sortOrder < 0) nextErrors.sortOrder = '排序须为非负整数'
    if (form.remark.length > 200) nextErrors.remark = '备注最多 200 字'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    const payload = { ...form, name, managerId: form.managerId || null }
    savingRef.current = true
    setSaving(true)
    const done = (message: string) => { setFormOpen(false); toast.success(message) }
    const fail = (e: Error) => toast.error(e.message)
    const settled = () => { savingRef.current = false; setSaving(false) }
    if (editing) {
      updateDept({ id: editing.id, data: payload }, {
        onSuccess: () => done('部门已保存'), onError: fail, onSettled: settled,
      })
    } else {
      createDept(payload, {
        onSuccess: () => done('部门已创建'), onError: fail, onSettled: settled,
      })
    }
  }

  function handleDelete() {
    if (!deleteTarget || deletingRef.current || deletePending) return
    if (deleteTarget.approvalFlowCount > 0) { setDeleteTarget(null); return }
    deletingRef.current = true
    deleteDept(deleteTarget.id, {
      onSuccess: () => { setDeleteTarget(null); toast.success('部门已删除') },
      onError: (e: Error) => { if (isElectronRuntime()) setDeleteTarget(null); toast.error(e.message) },
      onSettled: () => { deletingRef.current = false },
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
              aria-label={kw ? '搜索时子部门已展开' : expanded.has(row.id) ? '收起子部门' : '展开子部门'}
              aria-expanded={!!kw || expanded.has(row.id)}
              disabled={!!kw}
              title={kw ? '搜索结果自动展开匹配路径' : undefined}
              onClick={() => toggleExpand(row.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' && !expanded.has(row.id)) { e.preventDefault(); toggleExpand(row.id) }
                if (e.key === 'ArrowLeft' && expanded.has(row.id)) { e.preventDefault(); toggleExpand(row.id) }
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {kw || expanded.has(row.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
            <span className="block font-medium">{row.dept.name}</span>
            {kw && row.depth > 0 && <span className="block text-xs text-muted-foreground">{row.path}</span>}
            {row.dept.approvalFlowCount > 0 && (canManageFlows
              ? <a href="#/approvals/flows" className="block text-xs text-primary underline-offset-2 hover:underline">{row.dept.approvalFlowCount} 条审批流引用</a>
              : <span className="block text-xs text-muted-foreground">{row.dept.approvalFlowCount} 条审批流引用</span>)}
          </span>
        </div>
      ),
    },
    {
      key: 'managerName',
      title: '负责人',
      width: 140,
      render: (_v, row) => (
        <span>
          <span className="block">{row.dept.managerName || <span className="text-muted-foreground">—</span>}</span>
          {row.dept.managerIsActive === false && !row.dept.managerIsDevelopment && <span className="block text-xs text-destructive">{row.dept.managerName ? '负责人已禁用' : '负责人已删除'}</span>}
        </span>
      ),
    },
    {
      key: 'memberCount',
      title: '直属成员',
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
    { key: 'createdAt', title: '创建时间', render: (_v, row) => formatDisplayDateTime(row.dept.createdAt) },
    {
      key: 'actions',
      title: '操作',
      width: 260,
      render: (_v, row) => {
        if (!canCreate && !canUpdate && !canDelete) return null
        return (
          <div className="flex items-center gap-2">
            {canCreate && <Button size="sm" variant="outline" onClick={() => openCreate(row.id)}>新增子部门</Button>}
            {(canUpdate || canDelete) && <TableActionsMenu
              primaryLabel={canUpdate ? '编辑' : '删除'}
              primaryVariant="outline"
              onPrimaryClick={() => (canUpdate ? openEdit(row.dept) : setDeleteTarget(row.dept))}
              items={canDelete
                ? [{ label: '删除', destructive: true, separatorBefore: canUpdate, onClick: () => setDeleteTarget(row.dept) }]
                : []}
            />}
          </div>
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
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(departments.map((d) => d.id)))} disabled={!!kw}>全部展开</Button>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())} disabled={!!kw}>全部收起</Button>
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

      <Dialog open={formOpen} onOpenChange={(v) => !v && !savePending && setFormOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            {/* 编辑态与默认（新增）态一眼可分 */}
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {editing ? '编辑部门' : '新增部门'}
              {editing && <EditModeBadge />}
            </DialogTitle>
            {editing && (
              <p className="text-helper mt-1">
                正在编辑：<span className="font-medium text-foreground">{editing.name}</span>
              </p>
            )}
          </DialogHeader>
          <DialogDescription className="sr-only">设置部门名称、上级部门、负责人及排序</DialogDescription>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="department-name">部门名称</Label>
              <Input id="department-name" value={form.name} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'department-name-error' : undefined} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, name: e.target.value }); setErrors(prev => ({ ...prev, name: undefined })) }} placeholder="如：采购部" />
              {errors.name && <p id="department-name-error" className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="department-parentId">上级部门</Label>
              <Select value={String(form.parentId)} onValueChange={(v) => setForm({ ...form, parentId: Number(v) })}>
                <SelectTrigger id="department-parentId" className="w-full">
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
              <Label htmlFor="department-managerId">部门负责人</Label>
              <Select value={form.managerId ? String(form.managerId) : '0'} onValueChange={(v) => { setForm({ ...form, managerId: v === '0' ? null : Number(v) }); setErrors(prev => ({ ...prev, managerId: undefined })) }}>
                <SelectTrigger id="department-managerId" className="w-full" aria-invalid={!!errors.managerId} aria-describedby={errors.managerId ? 'department-managerId-error' : undefined}>
                  <SelectValue placeholder="未设置" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">未设置</SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)} disabled={!u.isActive}>{userOptionLabel(u, currentUserId)}</SelectItem>
                  ))}
                  {form.managerId && !selectedManager && <SelectItem value={String(form.managerId)} disabled>{editing?.managerIsDevelopment ? '负责人不可用' : `${editing?.managerName || '原负责人'}（已删除）`}</SelectItem>}
                </SelectContent>
              </Select>
              {managerInvalid && <p className="text-xs text-destructive">{editing?.managerIsDevelopment && editing.managerId === form.managerId ? '负责人不可用，请更换或清空' : editing?.managerId === form.managerId && !editing.managerName ? '原负责人已删除，请更换或清空' : '当前负责人已禁用，请更换或清空'}</p>}
              {errors.managerId && <p id="department-managerId-error" className="text-xs text-destructive">{errors.managerId}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="department-sortOrder">排序</Label>
              <Input type="number" min={0} step={1} id="department-sortOrder" value={form.sortOrder} aria-invalid={!!errors.sortOrder} aria-describedby={errors.sortOrder ? 'department-sortOrder-error' : undefined} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, sortOrder: Number(e.target.value) }); setErrors(prev => ({ ...prev, sortOrder: undefined })) }} />
              {errors.sortOrder && <p id="department-sortOrder-error" className="text-xs text-destructive">{errors.sortOrder}</p>}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="department-remark">备注</Label>
              <Input id="department-remark" value={form.remark} aria-invalid={!!errors.remark} aria-describedby={errors.remark ? 'department-remark-error' : undefined} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, remark: e.target.value }); setErrors(prev => ({ ...prev, remark: undefined })) }} />
              {errors.remark && <p id="department-remark-error" className="text-xs text-destructive">{errors.remark}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={savePending}>取消</Button>
            <Button onClick={handleSave} disabled={savePending}>{savePending ? '保存中…' : editing ? '保存修改' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={deleteTarget?.approvalFlowCount
          ? `部门「${deleteTarget.name}」被 ${deleteTarget.approvalFlowCount} 条审批流引用，请先到「审批流配置」调整后再删除。`
          : `确定删除部门「${deleteTarget?.name}」吗？部门下有子部门或用户时无法删除。`}
        variant="destructive"
        confirmText={deleteTarget?.approvalFlowCount ? '知道了' : '删除'}
        loading={deletePending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
