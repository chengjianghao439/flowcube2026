import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRolesApi } from '@/api/settings'
import { toast } from '@/lib/toast'
import client from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/hooks/usePermission'
import type { ApiResponse } from '@/types'

const ALL_PERMS: { code: string; label: string; group: string }[] = [
  { group:'页面', code:'page:dashboard',  label:'仪表盘' },
  { group:'页面', code:'page:warehouses', label:'仓库管理' },
  { group:'页面', code:'page:suppliers',  label:'供应商管理' },
  { group:'页面', code:'page:products',   label:'商品管理' },
  { group:'页面', code:'page:inventory',  label:'库存管理' },
  { group:'页面', code:'page:stockcheck', label:'库存盘点' },
  { group:'页面', code:'page:transfer',   label:'库存调拨' },
  { group:'页面', code:'page:purchase',   label:'采购管理' },
  { group:'页面', code:'page:returns',    label:'退货管理' },
  { group:'页面', code:'page:customers',  label:'客户管理' },
  { group:'页面', code:'page:sale',       label:'销售管理' },
  { group:'页面', code:'page:payments',   label:'账款管理' },
  { group:'页面', code:'page:reports',    label:'报表中心' },
  { group:'页面', code:'page:settings',   label:'系统设置' },
  { group:'页面', code:'page:users',      label:'用户管理' },
  { group:'操作', code:'action:purchase:confirm', label:'采购确认' },
  { group:'操作', code:'action:purchase:receive', label:'采购收货' },
  { group:'操作', code:'action:sale:confirm',     label:'销售确认' },
  { group:'操作', code:'action:sale:ship',        label:'销售出库' },
  { group:'操作', code:'action:inventory:inbound',  label:'库存入库' },
  { group:'操作', code:'action:inventory:outbound', label:'库存出库' },
  { group:'操作', code:'action:inventory:adjust',   label:'库存调整' },
  { group:'操作', code:'action:stockcheck:submit',  label:'提交盘点' },
  { group:'操作', code:'action:import',  label:'批量导入' },
  { group:'操作', code:'action:export',  label:'导出Excel' },
]

export default function PermissionsPage() {
  const { roleId } = usePermission()
  const isAdmin = roleId === 1
  const qc = useQueryClient()
  const [selectedRole, setSelectedRole] = useState<number>(2)
  const [perms, setPerms] = useState<Set<string>>(new Set())

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => getRolesApi().then(r => r.data.data || []) })
  const { data: rolePerms, isLoading } = useQuery({ queryKey: ['role-perms', selectedRole], queryFn: () => client.get<ApiResponse<string[]>>(`/roles/${selectedRole}/permissions`).then(r => r.data.data || []), enabled: !!selectedRole })

  useEffect(() => { if (rolePerms) setPerms(new Set(rolePerms)) }, [rolePerms])

  const save = useMutation({
    mutationFn: () => client.put(`/roles/${selectedRole}/permissions`, { permissions: Array.from(perms) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['role-perms'] }); toast.success('权限已更新，用户下次登录生效') }
  })

  const toggle = (code: string) => {
    if (!isAdmin) return
    setPerms(p => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n })
  }

  const groups = [...new Set(ALL_PERMS.map(p => p.group))]

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
          {groups.map(group => (
            <div key={group}>
              <h3 className="font-semibold text-sm text-muted-foreground mb-3 uppercase">{group}</h3>
              <div className="flex flex-wrap gap-2">
                {ALL_PERMS.filter(p => p.group === group).map(p => {
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
