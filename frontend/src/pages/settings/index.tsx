import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSettingsApi, updateSettingsApi, getRolesApi } from '@/api/settings'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { usePermission } from '@/hooks/usePermission'

export default function SettingsPage() {
  const { roleId } = usePermission()
  const isAdmin = roleId === 1
  const qc = useQueryClient()

  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => getSettingsApi().then(r => r.data.data!) })
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => getRolesApi().then(r => r.data.data || []) })
  const save = useMutation({ mutationFn: updateSettingsApi, onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('保存成功') } })

  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => {
    if (data?.list) {
      const m: Record<string, string> = {}
      data.list.forEach(s => { m[s.key_name] = s.value ?? '' })
      setForm(m)
    }
  }, [data])

  const handleSave = () => save.mutate(form)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">系统设置</h1>
        <p className="text-sm text-muted-foreground mt-1">全局参数配置，仅管理员可修改</p>
      </div>

      {/* 基础参数 */}
      <div className="bg-white rounded-xl border p-6 space-y-5">
        <h2 className="font-semibold text-base border-b pb-3">基础参数</h2>
        {data?.list.map(s => (
          <div key={s.key_name} className="grid grid-cols-3 gap-4 items-start">
            <div>
              <Label className="font-medium">{s.label}</Label>
              {s.remark && <p className="text-xs text-muted-foreground mt-0.5">{s.remark}</p>}
            </div>
            <div className="col-span-2">
              <Input
                value={form[s.key_name] ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [s.key_name]: e.target.value }))}
                type={s.type === 'number' ? 'number' : 'text'}
                disabled={!isAdmin}
              />
            </div>
          </div>
        ))}
        {isAdmin && (
          <div className="pt-2">
            <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? '保存中...' : '保存设置'}</Button>
          </div>
        )}
        {!isAdmin && <p className="text-sm text-muted-foreground">当前账号无修改权限</p>}
      </div>

      {/* 角色说明 */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-base border-b pb-3 mb-4">角色权限说明</h2>
        <div className="space-y-3">
          {roles?.map(r => (
            <div key={r.id} className="flex items-start gap-4">
              <Badge variant={r.id === 1 ? 'default' : 'secondary'} className="shrink-0 mt-0.5">
                {r.name}
              </Badge>
              <p className="text-sm text-muted-foreground">{r.remark || '-'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
