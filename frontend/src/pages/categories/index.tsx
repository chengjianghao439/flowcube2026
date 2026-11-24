/**
 * 商品分类管理页
 *
 * 支持 4 级树形结构，可展开/折叠、新增/编辑/删除/停用分类。
 * 操作规则：
 *  - 最多 4 级，第 4 级不能新增子节点
 *  - 有子分类时不能删除
 *  - 有绑定商品时不能删除（只能停用）
 */

import { useEffect, useId, useState } from 'react'
import { Plus } from 'lucide-react'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { EmptyState } from '@/components/shared/EmptyState'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { TreeTableFilters, TreeTableName } from '@/components/shared/TreeTable'
import { useTreeTable, type TreeTableRow } from '@/hooks/useTreeTable'
import type { TableColumn } from '@/types'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { EditModeBadge, UnsavedBadge } from '@/components/shared/EditModeBadge'
import { useDialogDraftGuard } from '@/hooks/useDialogDraftGuard'
import PageHeader  from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  useCategoryTree, useCreateCategory, useUpdateCategory,
  useDeleteCategory, useToggleCategoryStatus,
} from '@/hooks/useCategories'
import type { Category, CreateCategoryParams, UpdateCategoryParams } from '@/types/categories'

// ─── 常量 ────────────────────────────────────────────────────────────────────

const LEVEL_LABEL: Record<number, string> = { 1: '一级', 2: '二级', 3: '三级', 4: '四级' }

const EMPTY_FORM: CreateCategoryParams & { status?: boolean } = {
  name: '', parentId: null, sortOrder: 0, remark: '', status: true,
}

// ─── 分类表单弹窗 ─────────────────────────────────────────────────────────────

interface FormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  parentCat?: Category | null   // 新建子分类时的父节点
  editCat?: Category | null     // 编辑时的目标节点
  onClose: () => void
  onCreated: (parentId: number | null) => void
}

function CategoryFormDialog({ open, mode, parentCat, editCat, onClose, onCreated }: FormDialogProps) {
  const { can } = usePermission()
  const formId = useId()
  const canSave = can(mode === 'create' ? PERMISSIONS.CATEGORY_CREATE : PERMISSIONS.CATEGORY_UPDATE)
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM)
  const [baseline, setBaseline] = useState(EMPTY_FORM)
  const { mutate: create, isPending: creating } = useCreateCategory()
  const { mutate: update, isPending: updating } = useUpdateCategory()
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const draft = useDialogDraftGuard({ open, identity: `${mode}:${editCat?.id ?? parentCat?.id ?? 'root'}`, dirty, pending: creating || updating, onClose })
  const isPending = draft.locked

  function reset() {
    const next = mode === 'edit' && editCat
      ? { name: editCat.name, parentId: editCat.parentId, sortOrder: editCat.sortOrder, remark: editCat.remark ?? '', status: editCat.status === 1 }
      : { ...EMPTY_FORM, parentId: parentCat?.id ?? null }
    setBaseline(next)
    setForm(next)
  }

  // 依赖刻意写成 parentCat?.id / editCat?.id 而不是对象本身，也刻意不把 reset 列进去：
  // 父组件每次渲染都会传新的 parentCat / editCat 对象引用，按对象依赖会让表单在用户
  // 填写过程中被反复重置。只有「打开」「模式变了」「换了另一条分类」才该重置。
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, parentCat?.id, editCat?.id])

  function set(k: string, v: unknown) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave || !form.name || (mode === 'edit' && !editCat)) return
    const submission = draft.beginSubmit()
    if (!submission) return
    if (mode === 'create') {
      const d: CreateCategoryParams = {
        name:      form.name!,
        parentId:  form.parentId ?? null,
        sortOrder: Number(form.sortOrder ?? 0),
        remark:    form.remark || null,
      }
      create(d, {
        onSuccess: () => { submission.finish(); onCreated(d.parentId ?? null); onClose() },
        onError: submission.finish,
      })
    } else if (editCat) {
      const d: UpdateCategoryParams = {
        name:      form.name!,
        sortOrder: Number(form.sortOrder ?? 0),
        status:    form.status,
        remark:    form.remark || null,
      }
      update({ id: editCat.id, d }, {
        onSuccess: () => { submission.finish(); onClose() },
        onError: submission.finish,
      })
    }
  }

  const targetLevel = mode === 'create'
    ? (parentCat ? parentCat.level + 1 : 1)
    : (editCat?.level ?? 1)

  return (
    <>
    <Dialog open={open} onOpenChange={value => { if (!value) draft.requestClose() }}>
      <DialogContent ref={draft.contentRef} onFocusCapture={draft.rememberFocus} className="fc-form-dialog sm:max-w-2xl">
        <DialogHeader description={mode === 'edit' && editCat ? <>
              正在编辑：<span className="font-medium text-foreground">{editCat.code ? `${editCat.code} · ` : ''}{editCat.name}</span>
            </> : ("填写分类名称、上级与排序。")}>
          {/* 编辑态与默认（新增）态一眼可分 */}
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {mode === 'create'
              ? `新增${LEVEL_LABEL[targetLevel] ?? ''}分类${parentCat ? ` · 父级：${parentCat.name}` : ''}`
              : `编辑${LEVEL_LABEL[editCat?.level ?? 1] ?? ''}分类`}
            {mode === 'edit' && <EditModeBadge />}
            <UnsavedBadge show={dirty} />
          </DialogTitle>

        </DialogHeader>

        <form id={formId} onSubmit={handleSubmit} className="fc-form-dialog-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="category-name">分类名称 *</Label>
              <Input
                id="category-name" value={form.name ?? ''}
                onChange={e => set('name', e.target.value)}
                placeholder="请输入分类名称"
                disabled={isPending}
              />
            </div>
            {mode === 'edit' && editCat?.code && (
              <div className="space-y-1.5">
                <Label htmlFor="category-code">分类编码</Label>
                <Input id="category-code" value={editCat.code} disabled className="bg-muted/50 font-mono text-sm" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="category-sortOrder">排序</Label>
              <Input
                type="number"
                id="category-sortOrder" value={form.sortOrder ?? 0}
                onChange={e => set('sortOrder', e.target.value)}
                placeholder="数字越小越靠前"
                disabled={isPending}
              />
            </div>
            {mode === 'edit' && (
              <div className="flex items-end gap-2 pb-0.5">
                <input
                  type="checkbox"
                  id="cat-status"
                  checked={!!form.status}
                  onChange={e => set('status', e.target.checked)}
                  className="accent-primary"
                />
                <Label htmlFor="cat-status" className="cursor-pointer">启用</Label>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-remark">备注</Label>
            <Input
              id="category-remark" value={form.remark ?? ''}
              onChange={e => set('remark', e.target.value)}
              placeholder="选填"
              disabled={isPending}
            />
          </div>

        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={draft.requestClose} disabled={isPending}>取消</Button>
          {canSave && <Button type="submit" form={formId} disabled={isPending || !form.name}>{isPending ? '保存中…' : (mode === 'edit' ? '保存修改' : '保存')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog {...draft.discardProps} confirmText="放弃本次修改" />
    </>
  )
}

export default function CategoriesPage() {
  const { can } = usePermission()
  const { data: tree = [], isLoading, isError, error, refetch } = useCategoryTree()
  const hierarchy = useTreeTable(tree)
  const canCreate = can(PERMISSIONS.CATEGORY_CREATE)
  const canUpdate = can(PERMISSIONS.CATEGORY_UPDATE)
  const canDelete = can(PERMISSIONS.CATEGORY_DELETE)
  const { mutate: del,    isPending: deleting  } = useDeleteCategory()
  const { mutate: toggle, isPending: toggling  } = useToggleCategoryStatus()

  // 弹窗状态
  const [formOpen,  setFormOpen]  = useState(false)
  const [formMode,  setFormMode]  = useState<'create' | 'edit'>('create')
  const [parentCat, setParentCat] = useState<Category | null>(null)
  const [editCat,   setEditCat]   = useState<Category | null>(null)

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  // 停用/启用确认
  const [toggleTarget, setToggleTarget] = useState<Category | null>(null)

  function handleAddRoot() {
    if (!canCreate) return
    setFormMode('create')
    setParentCat(null)
    setEditCat(null)
    setFormOpen(true)
  }

  function handleAddChild(cat: Category) {
    if (!canCreate) return
    setFormMode('create')
    setParentCat(cat)
    setEditCat(null)
    setFormOpen(true)
  }

  function handleEdit(cat: Category) {
    if (!canUpdate) return
    setFormMode('edit')
    setEditCat(cat)
    setParentCat(null)
    setFormOpen(true)
  }

  function handleDelete(cat: Category) {
    setDeleteTarget(cat)
  }

  function handleToggleStatus(cat: Category) {
    setToggleTarget(cat)
  }

  function confirmDelete() {
    if (!deleteTarget || !canDelete) return
    del(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
  }

  function confirmToggle() {
    if (!toggleTarget || !canUpdate) return
    toggle(
      { id: toggleTarget.id, status: toggleTarget.status === 0 },
      { onSuccess: () => setToggleTarget(null) },
    )
  }

  const columns: TableColumn<TreeTableRow<Category>>[] = [
    { key: 'name', title: '分类名称', width: 270, render: (_, row) => <TreeTableName {...row} searching={hierarchy.searching}
      label={row.node.name} onToggle={() => hierarchy.toggle(row.id)}>{row.node.name}</TreeTableName> },
    { key: 'code', title: '分类编码', width: 150, render: (_, { node }) => node.code ? <span className="text-doc-code">{node.code}</span> : '—' },
    { key: 'level', title: '层级', width: 90, render: (_, { node }) => LEVEL_LABEL[node.level] },
    { key: 'status', title: '状态', width: 88, render: (_, { node }) => <SoftStatusLabel
      label={node.status ? '启用' : '停用'} tone={activeTone(node.status)} /> },
  ]
  if (canCreate || canUpdate || canDelete) {
    columns.push({
      key: 'actions', title: '操作', width: 214, render: (_, { node }) => (
        <div className="flex items-center gap-2">
          {canCreate && node.level < 4 && <Button type="button" size="sm" variant="ghost" title="新增子分类"
            className="h-8 px-2 text-xs text-primary hover:text-primary" onClick={() => handleAddChild(node)}>
            <Plus aria-hidden />新增子分类
          </Button>}
          {(canUpdate || canDelete) && <TableActionsMenu
            primaryLabel={canUpdate ? '编辑' : '删除'}
            primaryVariant={canUpdate ? 'outline' : 'destructive'}
            onPrimaryClick={() => canUpdate ? handleEdit(node) : handleDelete(node)}
            items={canUpdate ? [
              { label: node.status ? '停用' : '启用', afterMenuClose: true, onClick: () => handleToggleStatus(node) },
              ...(canDelete ? [{ label: '删除', destructive: true, separatorBefore: true, afterMenuClose: true, onClick: () => handleDelete(node) }] : []),
            ] : []}
          />}
        </div>
      ),
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="商品分类"
        description="维护商品分类层级，商品可绑定四级分类。"
        actions={
          canCreate && <Button onClick={handleAddRoot}>
            <Plus className="mr-1.5 h-4 w-4" />
            新增一级分类
          </Button>
        }
      />

      <TreeTableFilters label="搜索分类编码或名称" value={hierarchy.search} onChange={hierarchy.setSearch}
        searching={hierarchy.searching} expandAll={hierarchy.expandAll} collapseAll={hierarchy.collapseAll} />

      {isError ? <QueryErrorState title="商品分类加载失败" error={error} onRetry={() => void refetch()} /> : (
        <DataTable columns={columns} data={hierarchy.rows} loading={isLoading} virtualized preserveFocus retainFocusedRow
          scrollLabel="商品分类表格" emptyText="没有匹配的分类"
          emptyState={hierarchy.searching ? undefined : <EmptyState variant="empty-folder" title="暂无分类"
            description={canCreate ? '点击右上角「新增一级分类」开始' : '当前账号没有新增分类权限'} />} />
      )}
      {!isError && !isLoading && <ListSummary total={hierarchy.searching ? hierarchy.rows.length : hierarchy.total}
        unit={hierarchy.searching ? '个可见分类' : '个分类'} />}

      {/* 新增/编辑弹窗 */}
      <CategoryFormDialog
        open={formOpen}
        mode={formMode}
        parentCat={parentCat}
        editCat={editCat}
        onCreated={parentId => {
          if (parentId != null) hierarchy.revealChildren(parentId)
        }}
        onClose={() => setFormOpen(false)}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget && canDelete}
        variant="destructive"
        title={`删除分类「${deleteTarget?.name}」`}
        description="删除后不可恢复。若该分类下存在子分类或已绑定商品，将无法删除。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 停用/启用确认 */}
      <ConfirmDialog
        open={!!toggleTarget && canUpdate}
        title={`${toggleTarget?.status ? '停用' : '启用'}分类「${toggleTarget?.name}」`}
        description={
          toggleTarget?.status
            ? '停用后该分类将不可用于商品绑定，但不影响已有数据。'
            : '重新启用该分类，使其可再次用于商品绑定。'
        }
        confirmText={toggleTarget?.status ? '确认停用' : '确认启用'}
        loading={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  )
}
