/**
 * 商品分类管理页
 *
 * 支持 4 级树形结构，可展开/折叠、新增/编辑/删除/停用分类。
 * 操作规则：
 *  - 最多 4 级，第 4 级不能新增子节点
 *  - 有子分类时不能删除
 *  - 有绑定商品时不能删除（只能停用）
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Power, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Badge }   from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import PageHeader  from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  useCategoryTree, useCreateCategory, useUpdateCategory,
  useDeleteCategory, useToggleCategoryStatus,
} from '@/hooks/useCategories'
import type { Category, CreateCategoryParams, UpdateCategoryParams } from '@/types/categories'

// ─── 常量 ────────────────────────────────────────────────────────────────────

const LEVEL_BADGE: Record<number, string> = {
  1: 'bg-blue-100 text-blue-700',
  2: 'bg-emerald-100 text-emerald-700',
  3: 'bg-orange-100 text-orange-700',
  4: 'bg-purple-100 text-purple-700',
}

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
}

function CategoryFormDialog({ open, mode, parentCat, editCat, onClose }: FormDialogProps) {
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM)
  const { mutate: create, isPending: creating } = useCreateCategory()
  const { mutate: update, isPending: updating } = useUpdateCategory()
  const isPending = creating || updating

  function reset() {
    if (mode === 'edit' && editCat) {
      setForm({
        name:      editCat.name,
        parentId:  editCat.parentId,
        sortOrder: editCat.sortOrder,
        remark:    editCat.remark ?? '',
        status:    editCat.status === 1,
      })
    } else {
      setForm({ ...EMPTY_FORM, parentId: parentCat?.id ?? null })
    }
  }

  // 弹窗打开时初始化
  function handleOpenChange(v: boolean) {
    if (v) reset()
    else onClose()
  }

  function set(k: string, v: unknown) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'create') {
      const d: CreateCategoryParams = {
        name:      form.name!,
        parentId:  form.parentId ?? null,
        sortOrder: Number(form.sortOrder ?? 0),
        remark:    form.remark || null,
      }
      create(d, { onSuccess: onClose })
    } else {
      if (!editCat) return
      const d: UpdateCategoryParams = {
        name:      form.name!,
        sortOrder: Number(form.sortOrder ?? 0),
        status:    form.status,
        remark:    form.remark || null,
      }
      update({ id: editCat.id, d }, { onSuccess: onClose })
    }
  }

  const targetLevel = mode === 'create'
    ? (parentCat ? parentCat.level + 1 : 1)
    : (editCat?.level ?? 1)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? `新增${LEVEL_LABEL[targetLevel] ?? ''}分类${parentCat ? ` · 父级：${parentCat.name}` : ''}`
              : `编辑分类 · ${editCat?.name}`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>分类名称 *</Label>
              <Input
                value={form.name ?? ''}
                onChange={e => set('name', e.target.value)}
                placeholder="请输入分类名称"
                disabled={isPending}
              />
            </div>
            {mode === 'edit' && editCat?.code && (
              <div className="space-y-1.5">
                <Label>分类编码</Label>
                <Input value={editCat.code} disabled className="bg-muted/50 font-mono text-sm" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>排序</Label>
              <Input
                type="number"
                value={form.sortOrder ?? 0}
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
            <Label>备注</Label>
            <Input
              value={form.remark ?? ''}
              onChange={e => set('remark', e.target.value)}
              placeholder="选填"
              disabled={isPending}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
            <Button type="submit" disabled={isPending || !form.name}>{isPending ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 单个分类节点 ─────────────────────────────────────────────────────────────

interface NodeProps {
  cat: Category
  onAddChild:     (cat: Category) => void
  onEdit:         (cat: Category) => void
  onDelete:       (cat: Category) => void
  onToggleStatus: (cat: Category) => void
  onEnter: (cat: Category) => void
}

function findPathToCategory(nodes: Category[], targetId: number, trail: Category[] = []): Category[] | null {
  for (const node of nodes) {
    const next = [...trail, node]
    if (node.id === targetId) return next
    if (node.children?.length) {
      const found = findPathToCategory(node.children, targetId, next)
      if (found) return found
    }
  }
  return null
}

function getNodesAtPath(tree: Category[], pathIds: number[]) {
  let nodes = tree
  for (const id of pathIds) {
    const current = nodes.find(item => item.id === id)
    nodes = current?.children ?? []
  }
  return nodes
}

function CategoryNode({ cat, onAddChild, onEdit, onDelete, onToggleStatus, onEnter }: NodeProps) {
  const hasChildren = !!(cat.children && cat.children.length > 0)

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-primary/5',
        cat.status === 0 && 'opacity-50',
      )}
    >
      <button
        type="button"
        className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
        onClick={() => hasChildren && onEnter(cat)}
        tabIndex={-1}
      >
        {hasChildren ? <ChevronRight className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
      </button>

      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold', LEVEL_BADGE[cat.level] ?? LEVEL_BADGE[4])}>
        L{cat.level}
      </span>

      {cat.code && (
        <span className="shrink-0 text-doc-code-muted">{cat.code}</span>
      )}

      <span className="flex-1 truncate text-sm font-medium">{cat.name}</span>

      {hasChildren && (
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onEnter(cat)}
        >
          {cat.children!.length} 个子分类
        </button>
      )}

      <Badge variant={cat.status ? 'default' : 'secondary'} className="shrink-0 text-xs">
        {cat.status ? '启用' : '停用'}
      </Badge>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {cat.level < 4 && (
          <Button
            size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="新增子分类"
            onClick={() => onAddChild(cat)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          size="sm" variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          title="编辑"
          onClick={() => onEdit(cat)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost"
          className={cn(
            'h-7 w-7 p-0',
            cat.status
              ? 'text-muted-foreground hover:text-orange-500'
              : 'text-muted-foreground hover:text-green-600',
          )}
          title={cat.status ? '停用' : '启用'}
          onClick={() => onToggleStatus(cat)}
        >
          <Power className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm" variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          title="删除"
          onClick={() => onDelete(cat)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const { data: tree = [], isLoading } = useCategoryTree()
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
  const [browsePath, setBrowsePath] = useState<number[]>([])

  function handleAddRoot() {
    setFormMode('create')
    setParentCat(null)
    setEditCat(null)
    setFormOpen(true)
  }

  function handleAddChild(cat: Category) {
    setFormMode('create')
    setParentCat(cat)
    setEditCat(null)
    setFormOpen(true)
  }

  function handleEdit(cat: Category) {
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
    if (!deleteTarget) return
    del(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
  }

  function confirmToggle() {
    if (!toggleTarget) return
    toggle(
      { id: toggleTarget.id, status: toggleTarget.status === 0 },
      { onSuccess: () => setToggleTarget(null) },
    )
  }

  // 统计
  const flatCount = (nodes: Category[]): number =>
    nodes.reduce((s, n) => s + 1 + flatCount(n.children ?? []), 0)
  const totalCount = flatCount(tree)
  const browseNodes = useMemo(() => getNodesAtPath(tree, browsePath), [tree, browsePath])
  const browseBreadcrumb = useMemo(
    () => browsePath.map(id => findPathToCategory(tree, id)?.slice(-1)[0]).filter(Boolean) as Category[],
    [browsePath, tree],
  )
  const currentParent = browseBreadcrumb[browseBreadcrumb.length - 1] ?? null

  return (
    <div>
      <PageHeader
        title="商品分类管理"
        description={`树形结构，最多 4 级 · 共 ${totalCount} 个分类`}
        actions={
          <Button onClick={currentParent ? () => handleAddChild(currentParent) : handleAddRoot}>
            <Plus className="mr-1.5 h-4 w-4" />
            {currentParent ? '新增当前层子分类' : '新增一级分类'}
          </Button>
        }
      />

      {/* 图例说明 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {[1, 2, 3, 4].map(l => (
          <span key={l} className="flex items-center gap-1">
            <span className={cn('rounded px-1.5 py-0.5 font-semibold', LEVEL_BADGE[l])}>L{l}</span>
            {LEVEL_LABEL[l]}分类
            {l === 4 && <span className="text-purple-600">（可绑定商品）</span>}
          </span>
        ))}
        {browsePath.length > 0 ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setBrowsePath(prev => prev.slice(0, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            返回上一级
          </button>
        ) : (
          <span className="ml-auto">默认显示一级分类，点击分类进入下一级</span>
        )}
      </div>

      {/* 树形列表 */}
      <div className="card-base p-2">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FolderOpen className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">暂无分类，点击右上角「新增一级分类」开始</p>
          </div>
        ) : (
          <div className="space-y-2">
            {browsePath.length > 0 && (
              <div className="rounded-md border border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                当前层级：{browseBreadcrumb.map(item => item.name).join(' / ')}
              </div>
            )}
            {browseNodes.map(cat => (
              <CategoryNode
                key={cat.id}
                cat={cat}
                onAddChild={handleAddChild}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleStatus={handleToggleStatus}
                onEnter={(target) => setBrowsePath(prev => [...prev, target.id])}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      <CategoryFormDialog
        open={formOpen}
        mode={formMode}
        parentCat={parentCat}
        editCat={editCat}
        onClose={() => setFormOpen(false)}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
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
        open={!!toggleTarget}
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
