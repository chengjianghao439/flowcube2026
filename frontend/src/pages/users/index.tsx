import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { FilterCard } from '@/components/shared/FilterCard'
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

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const { can } = usePermission()

  const canCreate = can(PERMISSIONS.USER_CREATE)
  const canUpdate = can(PERMISSIONS.USER_UPDATE)
  const canResetPwd = can(PERMISSIONS.USER_RESET_PASSWORD)
  const canDelete = can(PERMISSIONS.USER_DELETE)

  const [keyword, setKeyword] = useState('')
  const [scopeTarget, setScopeTarget] = useState<{ id: number; name: string } | null>(null)
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editUser, setEditUser] = useState<SysUser | null>(null)

  const [resetOpen, setResetOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<SysUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SysUser | null>(null)

  const { data, isLoading, isError, error, refetch } = useUsers({ page: 1, pageSize: 20, keyword })
  const total = data?.pagination?.total ?? 0
  const { mutate: deleteUser } = useDeleteUser()

  function handleSearch() {
    setKeyword(search);
  }

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
        const items: TableActionItem[] = []
        if (canResetPwd) items.push({ label: '重置密码', onClick: () => handleResetPassword(row) })
        if (canUpdate) items.push({ label: '仓库访问范围', onClick: () => setScopeTarget({ id: row.id, name: row.realName || row.username }) })
        if (canDelete && row.id !== currentUser?.id) items.push({ label: '删除', destructive: true, separatorBefore: true, onClick: () => handleDelete(row) })
        if (!canUpdate && items.length === 0) return null
        return (
          <TableActionsMenu
            primaryLabel={canUpdate ? '编辑' : items[0].label}
            primaryVariant="outline"
            onPrimaryClick={() => (canUpdate ? handleEdit(row) : items[0].onClick())}
            items={canUpdate ? items : items.slice(1)}
          />
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户管理"
        description="管理系统登录账号与角色权限"
        actions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/users').catch(e => toast.error((e as Error).message))}>导出</Button>
            {canCreate && (
              <Button onClick={() => { setEditUser(null); setFormOpen(true) }}>
                新增用户
              </Button>
            )}
          </>
        }
      />

      <FilterCard>
        <Input
          placeholder="搜索账号或姓名"
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
          className="h-9 w-60"
        />
        <Button size="sm" variant="outline" onClick={handleSearch}>搜索</Button>
        {keyword && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setKeyword(''); }}>
            重置
          </Button>
        )}
      </FilterCard>

      {isError ? (
        <QueryErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data?.list ?? []}
            loading={isLoading}
            rowKey="id"
          />
          <ListSummary total={total} unit="个" />
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
        onConfirm={() => { deleteUser(deleteTarget!.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
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
