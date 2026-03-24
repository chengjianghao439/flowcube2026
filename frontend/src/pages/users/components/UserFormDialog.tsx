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
import type { SysUser } from '@/types/users'

const ROLES = [
  { value: 1, label: '管理员' },
  { value: 2, label: '普通用户' },
]

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
  const [isActive, setIsActive] = useState(true)

  const { mutate: createUser, isPending: creating, error: createError } = useCreateUser()
  const { mutate: updateUser, isPending: updating, error: updateError } = useUpdateUser()

  const isPending = creating || updating
  const error = createError || updateError

  useEffect(() => {
    if (editUser) {
      setRealName(editUser.realName)
      setRoleId(editUser.roleId)
      setIsActive(editUser.isActive)
    } else {
      setUsername('')
      setPassword('')
      setRealName('')
      setRoleId(2)
      setIsActive(true)
    }
  }, [editUser, open])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isEdit && editUser) {
      updateUser(
        { id: editUser.id, data: { realName, roleId, isActive } },
        { onSuccess: onClose },
      )
    } else {
      createUser({ username, password, realName, roleId }, { onSuccess: onClose })
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
