import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useCreateUser, useUpdateUser } from '@/hooks/useUsers'
import { useDepartmentOptions } from '@/hooks/useDepartments'
import type { SysUser } from '@/types/users'

// 角色 1（管理员/超管）不能经此表单创建或改派：后端 users.routes schema 只放行 2-5，
// service 层还有 assertCanAssignRole 纵深防御。编辑已有超管时 roleId=1 但禁用选项，
// 避免提交一个必然 400 的表单，同时让用户看到该账号确实是超管。
const ROLES = [
  { value: 2, label: '仓库管理员' },
  { value: 3, label: '采购员' },
  { value: 4, label: '销售员' },
  { value: 5, label: '只读用户' },
]
const isSuperAdmin = (roleId: number | undefined) => roleId === 1

interface UserFormDialogProps {
  open: boolean
  onClose: () => void
  editUser?: SysUser | null
}

export default function UserFormDialog({ open, onClose, editUser }: UserFormDialogProps) {
  const isEdit = !!editUser

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [realName, setRealName] = useState('')
  const [roleId, setRoleId] = useState(2)
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [isActive, setIsActive] = useState(true)

  const { mutate: createUser, isPending: creating, error: createError } = useCreateUser()
  const { mutate: updateUser, isPending: updating, error: updateError } = useUpdateUser()
  const { data: departments } = useDepartmentOptions()

  const isPending = creating || updating
  const error = createError || updateError

  useEffect(() => {
    if (editUser) {
      setRealName(editUser.realName)
      setRoleId(editUser.roleId)
      setDepartmentId(editUser.departmentId ?? null)
      setIsActive(editUser.isActive)
    } else {
      setUsername('')
      setPassword('')
      setRealName('')
      setRoleId(2)
      setDepartmentId(null)
      setIsActive(true)
    }
  }, [editUser, open])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isEdit && editUser) {
      // 编辑超管账号时不传 roleId（后端保持原角色）——超管不可经此表单改派
      const payload = isSuperAdmin(editUser.roleId)
        ? { realName, isActive, departmentId }
        : { realName, roleId, isActive, departmentId }
      updateUser(
        { id: editUser.id, data: payload },
        { onSuccess: onClose },
      )
    } else {
      createUser({ username, password, realName, roleId, departmentId }, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑用户' : '新增用户'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {!isEdit && (
            <>
              <div className="space-y-2">
                <Label htmlFor="form-username">账号</Label>
                <Input
                  id="form-username"
                  value={username}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                  placeholder="登录账号"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="form-password">初始密码</Label>
                <Input
                  id="form-password"
                  type="password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  disabled={isPending}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="form-realName">姓名</Label>
            <Input
              id="form-realName"
              value={realName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRealName(e.target.value)}
              placeholder="真实姓名"
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label>角色</Label>
            <div className="flex gap-4">
              {isSuperAdmin(roleId) && (
                <label className="flex items-center gap-2 cursor-not-allowed opacity-60">
                  <input
                    type="radio"
                    name="roleId"
                    value={1}
                    checked={true}
                    disabled
                    className="accent-primary"
                  />
                  <span className="text-sm">管理员（系统内置）</span>
                </label>
              )}
              {ROLES.map((r) => (
                <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="roleId"
                    value={r.value}
                    checked={roleId === r.value}
                    onChange={() => setRoleId(r.value)}
                    disabled={isPending}
                    className="accent-primary"
                  />
                  <span className="text-sm">{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="form-department">部门</Label>
            <select
              id="form-department"
              value={departmentId ?? ''}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setDepartmentId(e.target.value ? Number(e.target.value) : null)}
              disabled={isPending}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">未分配</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="form-isActive"
                checked={isActive}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIsActive(e.target.checked)}
                disabled={isPending}
                className="accent-primary"
              />
              <Label htmlFor="form-isActive" className="cursor-pointer">启用账号</Label>
            </div>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
