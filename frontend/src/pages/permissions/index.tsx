import { useState, useEffect } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import {
  useRoles, useRolePermissions, useSaveRolePermissions, useDuplicateRole, useCreateRole, useDeleteRole,
  type Role,
} from '@/hooks/usePermissions'
import { PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permission-codes'

/** 复制角色弹窗：输入新角色编码/名称/备注，成功后角色列表自动刷新 */
function DuplicateRoleDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [remark, setRemark] = useState('')
  const dup = useDuplicateRole()

  useEffect(() => {
    if (role) {
      setCode(`${role.code}_copy`)
      setName(`${role.name}（副本）`)
      setRemark('')
    }
  }, [role])

  const submit = () => {
    if (!role) return
    dup.mutate(
      { roleId: role.id, code: code.trim(), name: name.trim(), remark: remark.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`已复制为「${name.trim()}」`)
          onClose()
        },
        onError: (e: unknown) =>
          toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '复制失败'),
      },
    )
  }

  return (
    <Dialog open={!!role} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>复制角色</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>源角色</Label>
            <Input value={role?.name ?? ''} disabled className="mt-1 bg-muted/50" />
          </div>
          <div>
            <Label>角色编码 *</Label>
            <Input className="mt-1" value={code} onChange={e => setCode(e.target.value)} placeholder="如 warehouse_manager_copy" maxLength={50} />
          </div>
          <div>
            <Label>角色名称 *</Label>
            <Input className="mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="如 仓库管理员（副本）" maxLength={50} />
          </div>
          <div>
            <Label>备注</Label>
            <Input className="mt-1" value={remark} onChange={e => setRemark(e.target.value)} maxLength={255} />
          </div>
          <p className="text-xs text-muted-foreground">复制会连同该角色的全部权限一起带入新角色，之后可在本页单独调整。</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={dup.isPending || !code.trim() || !name.trim()}>
            {dup.isPending ? '复制中…' : '确认复制'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 新增角色弹窗：编码/名称/备注 */
function CreateRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [remark, setRemark] = useState('')
  const createRole = useCreateRole()

  useEffect(() => { if (!open) { setCode(''); setName(''); setRemark('') } }, [open])

  const submit = () => {
    createRole.mutate(
      { code: code.trim(), name: name.trim(), remark: remark.trim() || undefined },
      { onSuccess: () => { onClose(); toast.success('角色已创建') }, onError: (e) => toast.error((e as Error).message) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增角色</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>角色编码 *</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="如 warehouse_manager" maxLength={50} />
          </div>
          <div>
            <Label>角色名称 *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="如 仓库管理员" maxLength={50} />
          </div>
          <div>
            <Label>备注</Label>
            <Input value={remark} onChange={e => setRemark(e.target.value)} maxLength={255} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={createRole.isPending || !code.trim() || !name.trim()}>
            {createRole.isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function PermissionsPage() {
  const { can } = usePermission()
  const isSuperAdmin = can(PERMISSIONS.ROLE_ASSIGN)
  const [selectedRole, setSelectedRole] = useState<number>(2)
  const [dupTarget, setDupTarget] = useState<Role | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [delTarget, setDelTarget] = useState<Role | null>(null)
  const [perms, setPerms] = useState<Set<string>>(new Set())

  const { data: roles } = useRoles()
  const { data: rolePerms, isLoading, isError, error, refetch } = useRolePermissions(selectedRole)
  const { mutate: deleteRole } = useDeleteRole()

  useEffect(() => { if (rolePerms) setPerms(new Set(rolePerms)) }, [rolePerms])

  const save = useSaveRolePermissions()

  const toggle = (code: string) => {
    if (!isSuperAdmin) return
    setPerms(p => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n })
  }

  const handleSave = () => save.mutate({ roleId: selectedRole, permissions: Array.from(perms) }, {
    onSuccess: () => toast.success('权限已更新，用户下次登录生效'),
  })

  const roleList = roles ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="权限管理"
        description="动态配置各角色可访问的功能"
        actions={isSuperAdmin ? <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中…' : '保存权限配置'}</Button> : null}
      />

      <div className="flex flex-col gap-6 items-start lg:flex-row">
        {/* 左栏：角色列表（选中高亮，hover 显示复制/删除） */}
        <aside className="w-full shrink-0 rounded-lg border bg-card p-3 lg:w-60">
          <div className="mb-2 flex items-center justify-between px-2">
            <h2 className="text-sm font-semibold text-muted-foreground">角色</h2>
            {isSuperAdmin && (
              <button type="button" title="新增角色" onClick={() => setCreateOpen(true)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="space-y-1">
            {roleList.map(r => {
              const active = selectedRole === r.id
              const canDelete = isSuperAdmin && r.is_system !== 1
              return (
                <div
                  key={r.id}
                  className={`group flex items-center rounded-md transition-colors ${active ? 'bg-accent' : 'hover:bg-accent/50'}`}
                >
                  <button
                    onClick={() => setSelectedRole(r.id)}
                    aria-pressed={active}
                    className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm font-medium transition-colors"
                  >
                    <span className={active ? 'text-foreground' : 'text-muted-foreground'}>{r.name}</span>
                  </button>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      title={`复制「${r.name}」`}
                      onClick={() => setDupTarget(r)}
                      className="mr-1 rounded-md p-1 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      title={`删除「${r.name}」`}
                      onClick={() => setDelTarget(r)}
                      className="mr-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </aside>

        {/* 右栏：权限配置 */}
        <section className="min-w-0 flex-1 space-y-4">
          {isError ? (
            <QueryErrorState error={error} onRetry={refetch} />
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {PERMISSION_GROUPS.map(group => (
                <div key={group.group} className="rounded-lg border bg-card p-4">
                  <h3 className="mb-3 text-sm font-medium text-muted-foreground">{group.group}</h3>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map(p => {
                      const active = perms.has(p.code)
                      return (
                        <button
                          key={p.code}
                          onClick={() => toggle(p.code)}
                          disabled={!isSuperAdmin}
                          aria-pressed={active}
                          className={`inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors ${active ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'} ${!isSuperAdmin ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border border-warning/20 bg-warning/5 rounded-lg p-4 text-sm text-warning">
            提示：修改权限后，用户需要重新登录才能生效。管理员（admin）角色权限固定，不可修改；系统内置角色不可删除。
          </div>
        </section>
      </div>

      <CreateRoleDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <DuplicateRoleDialog role={dupTarget} onClose={() => setDupTarget(null)} />

      <ConfirmDialog
        open={!!delTarget}
        title="确认删除"
        description={`确定删除角色「${delTarget?.name}」吗？有用户使用的角色无法删除。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => deleteRole(delTarget!.id, {
          onSuccess: () => { setDelTarget(null); toast.success('角色已删除') },
          onError: (e: unknown) => toast.error((e as Error).message),
        })}
        onCancel={() => setDelTarget(null)}
      />
    </div>
  )
}
