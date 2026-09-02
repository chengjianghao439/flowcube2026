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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateUser, useUpdateUser } from '@/hooks/useUsers'
import { useDepartmentOptions } from '@/hooks/useDepartments'
import { usePermission } from '@/hooks/usePermission'
import { toast } from '@/lib/toast'
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
  const [allowSelfApprove, setAllowSelfApprove] = useState(false)

  // 当前登录者是否超管——决定「允许自行审批」开关是否出现（后端另有权威校验）
  const { roleId: operatorRoleId } = usePermission()
  const isOperatorSuperAdmin = operatorRoleId === 1

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
      setAllowSelfApprove(!!editUser.allowSelfApprove)
    } else {
      setUsername('')
      setPassword('')
      setRealName('')
      setRoleId(2)
      setDepartmentId(null)
      setIsActive(true)
      setAllowSelfApprove(false)
    }
  }, [editUser, open])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isEdit) {
      if (username.trim().length < 2) return toast.error('账号至少 2 个字符')
      if (password.length < 6) return toast.error('密码至少 6 位')
      if (!realName.trim()) return toast.error('姓名不能为空')
    }
    if (isEdit && editUser) {
      // 编辑超管账号时不传 roleId（后端保持原角色）——超管不可经此表单改派
      // allowSelfApprove 只在操作者是超管时才带上：非超管传该字段会被后端 403 拒绝，
      // 不传则保持原值，普通管理员照常编辑姓名/部门。
      const base = isSuperAdmin(editUser.roleId)
        ? { realName, isActive, departmentId }
        : { realName, roleId, isActive, departmentId }
      const payload = isOperatorSuperAdmin ? { ...base, allowSelfApprove } : base
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
            <Label>部门</Label>
            <Select value={departmentId ? String(departmentId) : '0'} onValueChange={(v) => setDepartmentId(v === '0' ? null : Number(v))}>
              <SelectTrigger className="w-full" disabled={isPending}>
                <SelectValue placeholder="未分配" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">未分配</SelectItem>
                {(departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isEdit && (
            <>
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

              {/* 提权类开关：豁免「申请人不得审批自己提交的单」这道全站内控，只有超管能设
                  （后端 users.service.assertCanGrantSelfApprove 是权威校验，这里只是不给非超管入口）。
                  非超管编辑用户时整块不渲染 ⇒ 表单不传该字段 ⇒ 后端保持原值，不会触发 403。 */}
              {isOperatorSuperAdmin && (
                <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="form-allowSelfApprove"
                      checked={allowSelfApprove}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllowSelfApprove(e.target.checked)}
                      disabled={isPending}
                      className="accent-primary"
                    />
                    <Label htmlFor="form-allowSelfApprove" className="cursor-pointer">允许自行审批</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    开启后该账号可审批/驳回自己提交的费用报销、采购单、采购申请、授信放行与审批流单据。
                    适合单人或小团队记账；默认关闭，须由他人审批。
                  </p>
                </div>
              )}
            </>
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
              {isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
