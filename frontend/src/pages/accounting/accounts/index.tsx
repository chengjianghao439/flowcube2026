/**
 * 会计科目表（文档 10 · Phase 0 科目地基）
 *
 * 树形维护会计科目：新增/编辑/停用/删除。规则以后端为准：
 *  - 编码 code 全表唯一、一经创建不可改（凭证按 code 快照，映射引擎按 code 引用）。
 *  - 预置科目（is_preset）不可删/不可停用/不可改分类方向，仅可改排序/备注。
 *  - 有下级的科目为汇总科目（不可直接记账）；最多 4 级。
 */

import { useEffect, useState } from 'react'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { TreeTableFilters, TreeTableName } from '@/components/shared/TreeTable'
import { useTreeTable, type TreeTableRow } from '@/hooks/useTreeTable'
import type { TableColumn } from '@/types'
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
      <DialogContent className="fc-form-dialog sm:max-w-3xl">
        <DialogHeader description={lockCore ? "系统预置科目：编码、名称、分类与方向不可修改，仅可调整排序与备注。" : ("填写科目编码、名称、分类与记账方向。")}>
          <DialogTitle>
            {mode === 'create'
              ? `新增科目${parentAcct ? ` · 上级：${parentAcct.code} ${parentAcct.name}` : `（一级 L${targetLevel}）`}`
              : `编辑科目 · ${editAcct?.code} ${editAcct?.name}`}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="fc-form-dialog-body space-y-4">
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
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>取消</Button>
            <Button type="submit" disabled={isPending || !form.code.trim() || !form.name.trim()}>
              {isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function AccountsPage() {
  const { data: tree = [], isLoading, isError, error, refetch } = useAccountTree()
  const hierarchy = useTreeTable(tree)
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

  function handleAddRoot() { setFormMode('create'); setParentAcct(null); setEditAcct(null); setFormOpen(true) }
  function handleAddChild(a: Account) { setFormMode('create'); setParentAcct(a); setEditAcct(null); setFormOpen(true) }
  function handleEdit(a: Account) { setFormMode('edit'); setEditAcct(a); setParentAcct(null); setFormOpen(true) }

  function confirmDelete() {
    if (!canManage || !deleteTarget) return
    del(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
  }
  function confirmToggle() {
    if (!canManage || !toggleTarget) return
    toggle({ id: toggleTarget.id, isActive: toggleTarget.isActive === 0 }, { onSuccess: () => setToggleTarget(null) })
  }

  const columns: TableColumn<TreeTableRow<Account>>[] = [
    { key: 'code', title: '科目编码', width: 112, render: (_, { node }) => <span className="text-doc-code">{node.code}</span> },
    { key: 'name', title: '科目名称', width: 242, render: (_, row) => <TreeTableName {...row} searching={hierarchy.searching}
      label={`${row.node.code} ${row.node.name}`} onToggle={() => hierarchy.toggle(row.id)}>{row.node.name}</TreeTableName> },
    { key: 'category', title: '科目类别', width: 82, render: (_, { node }) => ACCOUNT_CATEGORY_LABELS[node.category] },
    { key: 'balanceDir', title: '余额方向', width: 84, render: (_, { node }) => BALANCE_DIR_LABELS[node.balanceDir] },
    { key: 'auxType', title: '辅助核算', width: 84, render: (_, { node }) => node.auxType === 1 ? '往来' : '—' },
    { key: 'isLeaf', title: '记账属性', width: 84, render: (_, { node }) => node.isLeaf === 0
      ? <span title="有下级科目，不可直接记账">汇总</span> : '明细' },
    { key: 'isPreset', title: '来源', width: 92, render: (_, { node }) => node.isPreset === 1 ? '系统预置' : '自定义' },
    { key: 'isActive', title: '状态', width: 76, render: (_, { node }) => <SoftStatusLabel
      label={node.isActive ? '启用' : '停用'} tone={activeTone(node.isActive)} /> },
  ]
  if (canManage) {
    columns.push({
      key: 'actions', title: '操作', width: 112, render: (_, { node }) => <TableActionsMenu
        primaryLabel="编辑"
        rowLabel={`${node.code} ${node.name}`}
        primaryVariant="outline"
        onPrimaryClick={() => handleEdit(node)}
        items={[
          ...(node.level < MAX_LEVEL ? [{ label: '新增下级科目', afterMenuClose: true, onClick: () => handleAddChild(node) }] : []),
          ...(node.isPreset === 0 ? [
            { label: node.isActive ? '停用' : '启用', afterMenuClose: true, onClick: () => setToggleTarget(node) },
            { label: '删除', destructive: true, separatorBefore: true, afterMenuClose: true, onClick: () => setDeleteTarget(node) },
          ] : []),
        ]}
      />,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="会计科目表"
        description="查看企业会计准则下的科目层级与记账属性。"
        actions={canManage && (
          <Button onClick={handleAddRoot}>
            新增一级科目
          </Button>
        )}
      />

      <TreeTableFilters label="搜索科目编码或名称" value={hierarchy.search} onChange={hierarchy.setSearch}
        searching={hierarchy.searching} expandAll={hierarchy.expandAll} collapseAll={hierarchy.collapseAll} />

      {isError ? <QueryErrorState title="会计科目加载失败" error={error} onRetry={() => void refetch()} /> : (
        <DataTable columns={columns} data={hierarchy.rows} loading={isLoading} virtualized preserveFocus retainFocusedRow
          scrollLabel="会计科目表格" emptyText={hierarchy.searching ? '没有匹配的科目' : '暂无科目'} />
      )}
      {!isError && !isLoading && <ListSummary total={hierarchy.searching ? hierarchy.rows.length : hierarchy.total}
        unit={hierarchy.searching ? '个可见科目' : '个科目'} />}

      <AccountFormDialog
        open={formOpen && canManage}
        mode={formMode}
        parentAcct={parentAcct}
        editAcct={editAcct}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={!!deleteTarget && canManage}
        variant="destructive"
        title={`删除科目「${deleteTarget?.code} ${deleteTarget?.name}」`}
        description="仅用于删除建错、从未使用的科目。若存在下级科目将无法删除。用过的科目请改为停用。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!toggleTarget && canManage}
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
