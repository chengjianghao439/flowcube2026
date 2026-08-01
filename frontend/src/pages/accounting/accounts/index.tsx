/**
 * 会计科目表（文档 10 · Phase 0 科目地基）
 *
 * 树形维护会计科目：新增/编辑/停用/删除。规则以后端为准：
 *  - 编码 code 全表唯一、一经创建不可改（凭证按 code 快照，映射引擎按 code 引用）。
 *  - 预置科目（is_preset）不可删/不可停用/不可改分类方向，仅可改排序/备注。
 *  - 有下级的科目为汇总科目（不可直接记账）；最多 4 级。
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Power, BookOpen, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import PageHeader from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import {
  useAccountTree, useCreateAccount, useUpdateAccount, useDeleteAccount, useToggleAccountStatus,
} from '@/hooks/useAccounts'
import {
  ACCOUNT_CATEGORY_LABELS, BALANCE_DIR_LABELS, defaultBalanceDir,
  type Account, type CreateAccountParams, type UpdateAccountParams,
} from '@/types/accounting'

const MAX_LEVEL = 4
const CATEGORY_OPTIONS = [1, 2, 3, 4, 5, 6]

interface FormState {
  code: string
  name: string
  category: number
  balanceDir: number
  auxType: number
  sortOrder: number
  remark: string
}
const EMPTY_FORM: FormState = { code: '', name: '', category: 1, balanceDir: 1, auxType: 0, sortOrder: 0, remark: '' }

// ─── 科目表单弹窗 ─────────────────────────────────────────────────────────────

interface FormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  parentAcct?: Account | null
  editAcct?: Account | null
  onClose: () => void
}

function AccountFormDialog({ open, mode, parentAcct, editAcct, onClose }: FormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const { mutate: create, isPending: creating } = useCreateAccount()
  const { mutate: update, isPending: updating } = useUpdateAccount()
  const isPending = creating || updating
  const isPreset = mode === 'edit' && editAcct?.isPreset === 1

  function reset() {
    if (mode === 'edit' && editAcct) {
      setForm({
        code: editAcct.code,
        name: editAcct.name,
        category: editAcct.category,
        balanceDir: editAcct.balanceDir,
        auxType: editAcct.auxType,
        sortOrder: editAcct.sortOrder,
        remark: editAcct.remark ?? '',
      })
    } else {
      const cat = parentAcct?.category ?? 1
      setForm({ ...EMPTY_FORM, category: cat, balanceDir: defaultBalanceDir(cat) })
    }
  }

  // 依赖刻意只认 open/mode/父或编辑目标的 id，避免父组件每次渲染传新对象引用把表单在填写途中重置。
  useEffect(() => {
    if (open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, parentAcct?.id, editAcct?.id])

  function handleOpenChange(v: boolean) { if (!v) onClose() }
  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm(f => ({ ...f, [k]: v })) }

  // 新建时选分类，自动预填余额方向（用户仍可改）
  function onCategoryChange(v: number) {
    setForm(f => ({ ...f, category: v, balanceDir: mode === 'create' ? defaultBalanceDir(v) : f.balanceDir }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'create') {
      const d: CreateAccountParams = {
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category,
        balanceDir: form.balanceDir,
        parentId: parentAcct?.id ?? null,
        auxType: form.auxType,
        sortOrder: Number(form.sortOrder ?? 0),
        remark: form.remark || null,
      }
      create(d, { onSuccess: onClose })
    } else {
      if (!editAcct) return
      // 预置科目只提交排序/备注；普通科目提交全字段（code 不可改，不提交）
      const d: UpdateAccountParams = isPreset
        ? { sortOrder: Number(form.sortOrder ?? 0), remark: form.remark || null }
        : {
            name: form.name.trim(),
            category: form.category,
            balanceDir: form.balanceDir,
            auxType: form.auxType,
            sortOrder: Number(form.sortOrder ?? 0),
            remark: form.remark || null,
          }
      update({ id: editAcct.id, d }, { onSuccess: onClose })
    }
  }

  const targetLevel = mode === 'create' ? ((parentAcct?.level ?? 0) + 1) : (editAcct?.level ?? 1)
  const lockCore = isPreset // 预置科目锁定核心字段

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? `新增科目${parentAcct ? ` · 上级：${parentAcct.code} ${parentAcct.name}` : `（一级 L${targetLevel}）`}`
              : `编辑科目 · ${editAcct?.code} ${editAcct?.name}`}
          </DialogTitle>
        </DialogHeader>

        {lockCore && (
          <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            系统预置科目：编码/名称/分类/方向由映射引擎依赖，仅可修改排序与备注。
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>科目编码 *</Label>
              <Input
                value={form.code}
                onChange={e => set('code', e.target.value)}
                placeholder="如 1001 / 660101"
                disabled={isPending || mode === 'edit'}
                className="font-mono"
              />
              {mode === 'edit' && <p className="text-[11px] text-muted-foreground">编码创建后不可修改</p>}
            </div>
            <div className="space-y-1.5">
              <Label>科目名称 *</Label>
              <Input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="如 库存现金"
                disabled={isPending || lockCore}
              />
            </div>
            <div className="space-y-1.5">
              <Label>科目类别 *</Label>
              <Select
                value={String(form.category)}
                onValueChange={v => onCategoryChange(Number(v))}
                disabled={isPending || lockCore}
              >
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(c => (
                    <SelectItem key={c} value={String(c)}>{c} · {ACCOUNT_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>余额方向 *</Label>
              <Select
                value={String(form.balanceDir)}
                onValueChange={v => set('balanceDir', Number(v))}
                disabled={isPending || lockCore}
              >
                <SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">借</SelectItem>
                  <SelectItem value="2">贷</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>排序</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={e => set('sortOrder', Number(e.target.value))}
                placeholder="数字越小越靠前"
                disabled={isPending}
              />
            </div>
            <div className="flex items-end gap-2 pb-1.5">
              <input
                type="checkbox"
                id="acct-aux"
                checked={form.auxType === 1}
                onChange={e => set('auxType', e.target.checked ? 1 : 0)}
                disabled={isPending || lockCore}
                className="accent-primary"
              />
              <Label htmlFor="acct-aux" className={cn('cursor-pointer', (isPending || lockCore) && 'opacity-50')}>
                往来核算（挂客户/供应商）
              </Label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Input
              value={form.remark}
              onChange={e => set('remark', e.target.value)}
              placeholder="选填"
              disabled={isPending}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
            <Button type="submit" disabled={isPending || !form.code.trim() || !form.name.trim()}>
              {isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 单个科目节点 ─────────────────────────────────────────────────────────────

interface NodeProps {
  acct: Account
  canManage: boolean
  onAddChild: (a: Account) => void
  onEdit: (a: Account) => void
  onDelete: (a: Account) => void
  onToggle: (a: Account) => void
  expandedIds: Set<number>
  onExpand: (a: Account) => void
}

function AccountNode({ acct, canManage, onAddChild, onEdit, onDelete, onToggle, expandedIds, onExpand }: NodeProps) {
  const hasChildren = !!(acct.children && acct.children.length > 0)
  const expanded = expandedIds.has(acct.id)

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/5',
          acct.isActive === 0 && 'opacity-50',
          expanded && 'border-primary/30 bg-primary/5',
        )}
      >
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground"
          onClick={() => hasChildren && onExpand(acct)}
          tabIndex={-1}
        >
          {hasChildren
            ? expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
            : <span className="h-3.5 w-3.5" />}
        </button>

        <span className="w-20 shrink-0 font-mono text-sm text-doc-code-muted">{acct.code}</span>
        <span className="flex-1 truncate text-sm font-medium">{acct.name}</span>

        <SoftStatusLabel label={ACCOUNT_CATEGORY_LABELS[acct.category]} tone="info" className="shrink-0" />
        <span className="shrink-0 text-xs text-muted-foreground">{BALANCE_DIR_LABELS[acct.balanceDir]}方</span>
        {acct.auxType === 1 && <SoftStatusLabel label="往来" tone="info" className="shrink-0" />}
        {acct.isLeaf === 0 && <SoftStatusLabel label="汇总" tone="draft" className="shrink-0" />}
        {acct.isPreset === 1 && <SoftStatusLabel label="预置" tone="draft" className="shrink-0" />}
        <SoftStatusLabel label={acct.isActive ? '启用' : '停用'} tone={activeTone(acct.isActive)} className="shrink-0" />

        {canManage && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {acct.level < MAX_LEVEL && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                title="新增下级科目" onClick={() => onAddChild(acct)}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="编辑" onClick={() => onEdit(acct)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {acct.isPreset === 0 && (
              <>
                <Button size="sm" variant="ghost"
                  className={cn('h-7 w-7 p-0', acct.isActive ? 'text-muted-foreground hover:text-orange-500' : 'text-muted-foreground hover:text-green-600')}
                  title={acct.isActive ? '停用' : '启用'} onClick={() => onToggle(acct)}>
                  <Power className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  title="删除" onClick={() => onDelete(acct)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3">
          {acct.children!.map(child => (
            <AccountNode
              key={child.id}
              acct={child}
              canManage={canManage}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggle={onToggle}
              expandedIds={expandedIds}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function findPath(nodes: Account[], targetId: number, trail: number[] = []): number[] | null {
  for (const node of nodes) {
    const next = [...trail, node.id]
    if (node.id === targetId) return next
    if (node.children?.length) {
      const found = findPath(node.children, targetId, next)
      if (found) return found
    }
  }
  return null
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { data: tree = [], isLoading } = useAccountTree()
  const { mutate: del, isPending: deleting } = useDeleteAccount()
  const { mutate: toggle, isPending: toggling } = useToggleAccountStatus()
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.ACCOUNTING_ACCOUNT_MANAGE)

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [parentAcct, setParentAcct] = useState<Account | null>(null)
  const [editAcct, setEditAcct] = useState<Account | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [toggleTarget, setToggleTarget] = useState<Account | null>(null)
  const [expandedPath, setExpandedPath] = useState<number[]>([])
  const expandedIds = useMemo(() => new Set(expandedPath), [expandedPath])

  function handleAddRoot() { setFormMode('create'); setParentAcct(null); setEditAcct(null); setFormOpen(true) }
  function handleAddChild(a: Account) { setFormMode('create'); setParentAcct(a); setEditAcct(null); setFormOpen(true) }
  function handleEdit(a: Account) { setFormMode('edit'); setEditAcct(a); setParentAcct(null); setFormOpen(true) }

  function confirmDelete() {
    if (!deleteTarget) return
    del(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
  }
  function confirmToggle() {
    if (!toggleTarget) return
    toggle({ id: toggleTarget.id, isActive: toggleTarget.isActive === 0 }, { onSuccess: () => setToggleTarget(null) })
  }

  const flatCount = (nodes: Account[]): number => nodes.reduce((s, n) => s + 1 + flatCount(n.children ?? []), 0)
  const totalCount = flatCount(tree)

  return (
    <div>
      <PageHeader
        title="会计科目表"
        description={`会计核算的科目地基（企业会计准则口径）· 共 ${totalCount} 个科目`}
        actions={canManage && (
          <Button onClick={handleAddRoot}>
            <Plus className="mr-1.5 h-4 w-4" />
            新增一级科目
          </Button>
        )}
      />

      {/* 图例 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {CATEGORY_OPTIONS.map(c => (
          <span key={c} className="flex items-center gap-1">
            <SoftStatusLabel label={ACCOUNT_CATEGORY_LABELS[c]} tone="info" />
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <SoftStatusLabel label="汇总" tone="draft" />有下级不可记账
          <SoftStatusLabel label="预置" tone="draft" />系统预置不可删
        </span>
      </div>

      <div className="card-base p-2">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BookOpen className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">暂无科目</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tree.map(acct => (
              <AccountNode
                key={acct.id}
                acct={acct}
                canManage={canManage}
                onAddChild={handleAddChild}
                onEdit={handleEdit}
                onDelete={setDeleteTarget}
                onToggle={setToggleTarget}
                expandedIds={expandedIds}
                onExpand={(target) => {
                  const path = findPath(tree, target.id) ?? [target.id]
                  setExpandedPath(prev =>
                    prev.length === path.length && prev.every((v, i) => v === path[i])
                      ? prev.slice(0, -1)
                      : path,
                  )
                }}
              />
            ))}
          </div>
        )}
      </div>

      <AccountFormDialog
        open={formOpen}
        mode={formMode}
        parentAcct={parentAcct}
        editAcct={editAcct}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        variant="destructive"
        title={`删除科目「${deleteTarget?.code} ${deleteTarget?.name}」`}
        description="仅用于删除建错、从未使用的科目。若存在下级科目将无法删除。用过的科目请改为停用。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!toggleTarget}
        title={`${toggleTarget?.isActive ? '停用' : '启用'}科目「${toggleTarget?.code} ${toggleTarget?.name}」`}
        description={toggleTarget?.isActive
          ? '停用后该科目不可再用于新凭证，但不影响历史数据。'
          : '重新启用该科目。'}
        confirmText={toggleTarget?.isActive ? '确认停用' : '确认启用'}
        loading={toggling}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  )
}
