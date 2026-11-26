import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { ListQueryDialog } from '@/components/shared/ListQueryDialog'
import { QueryChips } from '@/components/shared/QueryChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { useUsers, useDeleteUser } from '@/hooks/useUsers'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import UserFormDialog from './components/UserFormDialog'
import WarehouseScopeDialog from './components/WarehouseScopeDialog'
import ResetPasswordDialog from './components/ResetPasswordDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import TableActionsMenu, { type TableActionItem } from '@/components/shared/TableActionsMenu'
import type { SysUser } from '@/types/users'
import type { TableColumn } from '@/types'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import { isElectronRuntime } from '@/lib/platform'

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const { can, roleId: operatorRoleId } = usePermission()

  const canCreate = can(PERMISSIONS.USER_CREATE)
  const canUpdate = can(PERMISSIONS.USER_UPDATE)
  const canResetPwd = can(PERMISSIONS.USER_RESET_PASSWORD)
  const canDelete = can(PERMISSIONS.USER_DELETE)

  const [filters, setFilters] = useState({ keyword: '', showDevelopment: false })
  const { keyword, showDevelopment } = filters
  const [queryOpen, setQueryOpen] = useState(false)
  const [scopeTarget, setScopeTarget] = useState<{ id: number; name: string } | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editUser, setEditUser] = useState<SysUser | null>(null)

  const [resetOpen, setResetOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<SysUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SysUser | null>(null)

  const desktop = isElectronRuntime()
  const hideDevelopment = showDevelopment && operatorRoleId === 1 ? '0' : '1'
  const { data, isLoading, isError, error, refetch } = useUsers({ page: 1, pageSize: 200, keyword, hideDevelopment }, 'all')
  const total = data?.pagination?.total ?? 0
  const { mutate: deleteUser, isPending: deleting } = useDeleteUser()

  const chips = [
    ...(keyword ? [{ key: 'keyword', text: `关键词：${keyword}`, onClear: () => setFilters(prev => ({ ...prev, keyword: '' })) }] : []),
    ...(hideDevelopment === '0' ? [{ key: 'development', text: '显示开发账号', onClear: () => setFilters(prev => ({ ...prev, showDevelopment: false })) }] : []),
  ]

  function handleEdit(user: SysUser) {
    setEditUser(user)
    setFormOpen(true)
  }

  function handleResetPassword(user: SysUser) {
    setResetTarget(user)
    setResetOpen(true)
  }

  function handleDelete(user: SysUser) {
    setDeleteTarget(user)
  }

  const columns: TableColumn<SysUser>[] = [
    { key: 'username', title: '账号', width: 140 },
    { key: 'realName', title: '姓名', width: 120 },
    {
      key: 'roleName',
      title: '角色',
      width: 100,
      render: (_, row) => (
        <SoftStatusLabel label={row.roleName} tone={row.roleId === 1 ? 'active' : 'info'} />
      ),
    },
    {
      key: 'departmentName',
      title: '部门',
      width: 120,
      render: (v) => (v ? String(v) : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'isActive',
      title: '状态',
      width: 80,
      render: (_, row) => (
        <SoftStatusLabel label={row.isActive ? '启用' : '禁用'} tone={activeTone(row.isActive)} />
      ),
    },
    {
      key: 'allowSelfApprove',
      title: '自行审批',
      width: 90,
      // 只标出被豁免的账号（默认关闭的不占视觉重量）
      render: (_, row) => (row.allowSelfApprove
        ? <SoftStatusLabel label="已开启" tone="warning" />
        : <span className="text-muted-foreground">—</span>),
    },
    { key: 'createdAt', title: '创建时间', render: (v) => formatDisplayDateTime(v) },
    {
      key: 'id',
      title: '操作',
      width: 200,
      render: (_, row) => {
        const targetProtected = row.roleId === 1 && operatorRoleId !== 1
        const items: TableActionItem[] = []
        if (canResetPwd && !targetProtected) items.push({ label: '重置密码', afterMenuClose: true, onClick: () => handleResetPassword(row) })
        if (canUpdate && !targetProtected) items.push({ label: '仓库访问范围', afterMenuClose: true, onClick: () => setScopeTarget({ id: row.id, name: row.realName || row.username }) })
        if (canDelete && !targetProtected && row.id !== currentUser?.id) items.push({ label: '删除', afterMenuClose: true, destructive: true, separatorBefore: true, onClick: () => handleDelete(row) })
        if ((!canUpdate || targetProtected) && items.length === 0) return null
        return (
          <TableActionsMenu
            primaryLabel={canUpdate && !targetProtected ? '编辑' : items[0].label}
            primaryVariant="outline"
            onPrimaryClick={() => (canUpdate && !targetProtected ? handleEdit(row) : items[0].onClick())}
            items={canUpdate && !targetProtected ? items : items.slice(1)}
          />
        )
      },
    },
  ]

  return (
    <div className="desktop-record-page space-y-4">
      <PageHeader
        title="用户管理"
        description={!isError && !isLoading && data?.truncated ? <><span role="status">已读取 {data.list.length.toLocaleString()} / 总匹配 {total.toLocaleString()} 个，请缩小查询范围。</span>{operatorRoleId === 1 && ' 可编辑登录账号；原密码无法查看，需要更换时请使用“重置密码”。'}</> : operatorRoleId === 1 ? '可编辑登录账号；原密码无法查看，需要更换时请使用“重置密码”。' : '维护登录账号、角色与启用状态。'}
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/users', { keyword, hideDevelopment }).catch(e => toast.error((e as Error).message))}>导出 Excel</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            {canCreate && (
              <Button onClick={() => { setEditUser(null); setFormOpen(true) }}>
                新增用户
              </Button>
            )}
          </>
        }
      />

      <QueryChips chips={chips} onClearAll={() => setFilters({ keyword: '', showDevelopment: false })} />
      <ListQueryDialog open={queryOpen} dialogId="users-query" title="查询用户" initial={filters}
        empty={{ keyword: '', showDevelopment: false }} onClose={() => setQueryOpen(false)} onApply={setFilters}>
        {(draft, setDraft) => <>
          <label className="col-span-full flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">账号或姓名</span>
            <Input className="h-9" placeholder="搜索账号或姓名" value={draft.keyword}
              onChange={event => setDraft({ ...draft, keyword: event.target.value })} />
          </label>
          {operatorRoleId === 1 && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={draft.showDevelopment} className="size-4 accent-primary"
                onChange={event => setDraft({ ...draft, showDevelopment: event.target.checked })} />
              显示开发账号
            </label>
          )}
        </>}
      </ListQueryDialog>

      {isError ? (
        <QueryErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data?.list ?? []}
            loading={isLoading}
            rowKey="id"
            virtualized fluid scrollLabel="用户表格" columnStorageKey="users:v1"
            preserveFocus
            retainFocusedRow={formOpen || resetOpen || !!deleteTarget || !!scopeTarget}
          />
          {!isLoading && data && !data.truncated && <ListSummary total={total} unit="个" />}
        </>
      )}

      <UserFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditUser(null) }}
        editUser={editUser}
      />

      {resetTarget && (
        <ResetPasswordDialog
          open={resetOpen}
          onClose={() => { setResetOpen(false); setResetTarget(null) }}
          userId={resetTarget.id}
          username={resetTarget.username}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={`确定删除用户「${deleteTarget?.realName}」吗？此操作不可恢复。`}
        variant="destructive"
        confirmText="删除"
        loading={deleting}
        onConfirm={() => { if (deleteTarget && !deleting) deleteUser(deleteTarget.id, {
          onSuccess: () => setDeleteTarget(null),
          // 桌面原生确认框在点击后已关闭，失败时释放目标，允许从列表重新发起。
          onError: () => { if (desktop) setDeleteTarget(null) },
        }) }}
        onCancel={() => { if (!deleting) setDeleteTarget(null) }}
      />
      <WarehouseScopeDialog
        open={!!scopeTarget}
        onClose={() => setScopeTarget(null)}
        userId={scopeTarget?.id ?? null}
        userName={scopeTarget?.name}
      />
    </div>
  )
}
