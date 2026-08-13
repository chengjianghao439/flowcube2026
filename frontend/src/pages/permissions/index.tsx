import { useState, useEffect } from 'react'
import { toast } from '@/lib/toast'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { useRoles, useRolePermissions, useSaveRolePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permission-codes'

export default function PermissionsPage() {
  const { can } = usePermission()
  const isAdmin = can(PERMISSIONS.ROLE_ASSIGN)
  const [selectedRole, setSelectedRole] = useState<number>(2)
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
          <button key={r.id} onClick={() => setSelectedRole(r.id)}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${selectedRole === r.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
            {r.name}
          </button>
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
    </div>
  )
}
