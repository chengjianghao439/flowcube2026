import { useState, useEffect } from 'react'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { usePermission } from '@/hooks/usePermission'
import { useRoles, useRolePermissions, useSaveRolePermissions, useDuplicateRole, type Role } from '@/hooks/usePermissions'
import { PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permission-codes'

/** 复制角色弹窗：输入新角色编码/名称/备注，成功后角色栏自动刷新 */
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

export default function PermissionsPage() {
  const { can } = usePermission()
  const isAdmin = can(PERMISSIONS.ROLE_ASSIGN)
  const [selectedRole, setSelectedRole] = useState<number>(2)
  const [dupTarget, setDupTarget] = useState<Role | null>(null)
  const [perms, setPerms] = useState<Set<string>>(new Set())

  const { data: roles } = useRoles()
  const { data: rolePerms, isLoading } = useRolePermissions(selectedRole)

  useEffect(() => { if (rolePerms) setPerms(new Set(rolePerms)) }, [rolePerms])

  const save = useSaveRolePermissions()

  const toggle = (code: string) => {
    if (!isAdmin) return
    setPerms(p => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n })
  }

  const handleSave = () => save.mutate({ roleId: selectedRole, permissions: Array.from(perms) }, {
    onSuccess: () => toast.success('权限已更新，用户下次登录生效'),
  })

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="权限管理" description="动态配置各角色可访问的功能" />

      <div className="flex gap-2 flex-wrap">
        {roles?.filter(r => r.id !== 1).map(r => (
          <div key={r.id} className="flex items-center gap-1">
            <button onClick={() => setSelectedRole(r.id)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${selectedRole === r.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
              {r.name}
            </button>
            {isAdmin && (
              <button
                type="button"
                title={`复制「${r.name}」`}
                onClick={() => setDupTarget(r)}
                className="px-2 py-2 rounded-lg border text-xs text-muted-foreground hover:bg-accent transition-colors"
              >
                复制
              </button>
            )}
          </div>
        ))}
      </div>

      {isLoading ? <p className="text-muted-foreground text-sm">加载中…</p> : (
        <div className="bg-white rounded-lg border p-5 space-y-6">
          {PERMISSION_GROUPS.map(group => (
            <div key={group.group}>
              <h3 className="font-semibold text-sm text-muted-foreground mb-3">{group.group}</h3>
              <div className="flex flex-wrap gap-2">
                {group.items.map(p => {
                  const active = perms.has(p.code)
                  return (
                    <button key={p.code} onClick={() => toggle(p.code)} disabled={!isAdmin}
                      className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'hover:border-primary text-muted-foreground'} ${!isAdmin ? 'cursor-default' : 'cursor-pointer'}`}>
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {isAdmin && (
            <div className="pt-2 border-t flex items-center justify-between">
              <p className="text-xs text-muted-foreground">已选 {perms.size} 项权限</p>
              <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中…' : '保存权限配置'}</Button>
            </div>
          )}
          {!isAdmin && <p className="text-sm text-muted-foreground pt-2 border-t">仅管理员可修改权限</p>}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        提示：修改权限后，用户需要重新登录才能生效。管理员（admin）角色权限固定，不可修改。
      </div>

      <DuplicateRoleDialog role={dupTarget} onClose={() => setDupTarget(null)} />
    </div>
  )
}
