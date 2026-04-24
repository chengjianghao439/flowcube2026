import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRolesApi } from '@/api/settings'
import { toast } from '@/lib/toast'
import { payloadClient as client } from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permission-codes'

export default function PermissionsPage() {
  const { can } = usePermission()
  const isAdmin = can(PERMISSIONS.ROLE_ASSIGN)
  const qc = useQueryClient()
  const [selectedRole, setSelectedRole] = useState<number>(2)
  const [perms, setPerms] = useState<Set<string>>(new Set())

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => getRolesApi().then(r => r || []) })
  const { data: rolePerms, isLoading } = useQuery({ queryKey: ['role-perms', selectedRole], queryFn: () => client.get<string[]>(`/roles/${selectedRole}/permissions`).then(r => r || []), enabled: !!selectedRole })

  useEffect(() => { if (rolePerms) setPerms(new Set(rolePerms)) }, [rolePerms])

  const save = useMutation({
    mutationFn: () => client.put(`/roles/${selectedRole}/permissions`, { permissions: Array.from(perms) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['role-perms'] }); toast.success('权限已更新，用户下次登录生效') }
  })

  const toggle = (code: string) => {
    if (!isAdmin) return
    setPerms(p => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n })
  }

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

      {isLoading ? <p className="text-muted-foreground text-sm">加载中...</p> : (
        <div className="bg-white rounded-xl border p-5 space-y-6">
          {PERMISSION_GROUPS.map(group => (
            <div key={group.group}>
              <h3 className="font-semibold text-sm text-muted-foreground mb-3 uppercase">{group.group}</h3>
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
              <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存权限配置'}</Button>
            </div>
          )}
          {!isAdmin && <p className="text-sm text-muted-foreground pt-2 border-t">仅管理员可修改权限</p>}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        注意：修改权限后，用户需要重新登录才能生效。管理员（admin）角色权限固定，不可修改。
      </div>
    </div>
  )
}
