import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EditModeBadge } from '@/components/shared/EditModeBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateUser, useUpdateUser, useAssignableRoles } from '@/hooks/useUsers'
import { useDepartmentOptions } from '@/hooks/useDepartments'
import { useAuthStore } from '@/store/authStore'
import { usePermission } from '@/hooks/usePermission'
import { visibleRoles } from '@/lib/visibleRoles'
import type { SysUser } from '@/types/users'

// 动态角色由后端返回可分配集合，管理员角色仍不可经表单改派。
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
  const [roleId, setRoleId] = useState(0)
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [allowSelfApprove, setAllowSelfApprove] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'username' | 'password' | 'realName' | 'roleId', string>>>({})
  const [serverError, setServerError] = useState('')

  // 当前登录者是否超管——决定「允许自行审批」开关是否出现（后端另有权威校验）
  const { roleId: operatorRoleId } = usePermission()
  const isOperatorSuperAdmin = operatorRoleId === 1
  const operatorId = useAuthStore(s => s.user?.id)
  const ownRoleLocked = !isOperatorSuperAdmin && editUser?.id === operatorId
  const { data: assignableRoles = [], isLoading: rolesLoading, isError: rolesError, refetch: refetchRoles } = useAssignableRoles(open)
  const visibleAssignableRoles = visibleRoles(assignableRoles)
  const currentRoleHidden = !!editUser && assignableRoles.some(r => r.id === editUser.roleId) && !visibleAssignableRoles.some(r => r.id === editUser.roleId)
  const roles = editUser && !isSuperAdmin(editUser.roleId) && !assignableRoles.some(r => r.id === editUser.roleId)
    ? [...visibleAssignableRoles, { id: editUser.roleId, code: '', name: '当前角色（不可分配）' }]
    : visibleAssignableRoles

  const { mutate: createUser, isPending: creating } = useCreateUser()
  const { mutate: updateUser, isPending: updating } = useUpdateUser()
  const { data: departments, isError: departmentsError, refetch: refetchDepartments } = useDepartmentOptions()

  const isPending = creating || updating

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
      setRoleId(0)
      setDepartmentId(null)
      setIsActive(true)
      setAllowSelfApprove(false)
    }
    setFieldErrors({})
    setServerError('')
  }, [editUser, open])

  function clearError(field: 'username' | 'password' | 'realName' | 'roleId') {
    setFieldErrors(current => ({ ...current, [field]: undefined }))
    setServerError('')
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isPending) return
    const errors: typeof fieldErrors = {}
    const name = realName.trim()
    const account = username.trim()
    if (!name) errors.realName = '请输入姓名'
    else if (name.length > 50) errors.realName = '姓名不能超过 50 个字符'
    if (!isEdit) {
      if (account.length < 2) errors.username = '账号至少 2 个字符'
      else if (account.length > 50) errors.username = '账号不能超过 50 个字符'
      if (password.length < 6) errors.password = '密码至少 6 位'
      else if (password.length > 100) errors.password = '密码不能超过 100 个字符'
      if (!visibleAssignableRoles.some(role => role.id === roleId)) errors.roleId = '请选择可分配的角色'
    }
    if (Object.keys(errors).length) { setFieldErrors(errors); return }
    setFieldErrors({})
    setServerError('')
    const onError = (error: Error) => setServerError(error.message)
    if (isEdit && editUser) {
      // 编辑超管账号时不传 roleId（后端保持原角色）——超管不可经此表单改派
      // allowSelfApprove 只在操作者是超管时才带上：非超管传该字段会被后端 403 拒绝，
      // 不传则保持原值，普通管理员照常编辑姓名/部门。
      const base = isSuperAdmin(editUser.roleId)
        ? { realName: name, isActive, departmentId }
        : { realName: name, roleId, isActive, departmentId }
      const payload = isOperatorSuperAdmin ? { ...base, allowSelfApprove } : base
      updateUser(
        { id: editUser.id, data: payload },
        { onSuccess: onClose, onError },
      )
    } else {
      createUser({ username: account, password, realName: name, roleId, departmentId }, { onSuccess: onClose, onError })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isPending && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6">
          {/* 编辑态与默认（新增）态一眼可分 */}
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {isEdit ? '编辑用户' : '新增用户'}
            {isEdit && <EditModeBadge />}
          </DialogTitle>
          <DialogDescription className="text-foreground/80">
            {isEdit && editUser
              ? <>正在编辑账号 <span className="font-medium text-foreground">{editUser.username}</span>。账号不能在此修改。</>
              : '填写登录信息并选择角色；新账号创建后默认启用。'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col overflow-hidden">
          <div className="grid min-h-0 grid-cols-1 gap-x-5 gap-y-4 overflow-y-auto px-6 py-4 sm:grid-cols-2">
          <h3 className="border-b pb-2 text-sm font-semibold sm:col-span-2">账号信息</h3>
          {!isEdit && (
            <>
              <div className="space-y-2">
                <Label htmlFor="form-username">账号 <span className="text-destructive">*</span></Label>
                <Input
                  id="form-username"
                  value={username}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setUsername(e.target.value); clearError('username') }}
                  placeholder="用于登录，至少 2 个字符"
                  maxLength={50}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.username}
                  aria-describedby={fieldErrors.username ? 'form-username-error' : undefined}
                  disabled={isPending}
                />
                {fieldErrors.username && <p id="form-username-error" className="text-sm text-destructive">{fieldErrors.username}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="form-password">初始密码 <span className="text-destructive">*</span></Label>
                <Input
                  id="form-password"
                  type="password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); clearError('password') }}
                  placeholder="至少 6 位"
                  maxLength={100}
                  autoComplete="new-password"
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? 'form-password-error' : undefined}
                  disabled={isPending}
                />
                {fieldErrors.password && <p id="form-password-error" className="text-sm text-destructive">{fieldErrors.password}</p>}
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="form-realName">姓名 <span className="text-destructive">*</span></Label>
            <Input
              id="form-realName"
              value={realName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setRealName(e.target.value); clearError('realName') }}
              placeholder="显示在系统中的姓名"
              maxLength={50}
              autoComplete="name"
              aria-invalid={!!fieldErrors.realName}
              aria-describedby={fieldErrors.realName ? 'form-realName-error' : undefined}
              disabled={isPending}
            />
            {fieldErrors.realName && <p id="form-realName-error" className="text-sm text-destructive">{fieldErrors.realName}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="form-department">部门</Label>
            <Select value={departmentId ? String(departmentId) : '0'} onValueChange={(v) => { setDepartmentId(v === '0' ? null : Number(v)); setServerError('') }}>
              <SelectTrigger id="form-department" className="w-full" disabled={isPending || departmentsError}>
                <SelectValue placeholder="未分配" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">未分配</SelectItem>
                {(departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {departmentsError && <p className="text-sm text-destructive">部门加载失败。<button type="button" className="underline" onClick={() => void refetchDepartments()}>重试</button></p>}
          </div>

          <h3 className="border-b pb-2 text-sm font-semibold sm:col-span-2">访问权限</h3>
          <fieldset className="space-y-2 sm:col-span-2" aria-describedby={fieldErrors.roleId ? 'form-role-error' : undefined}>
            <legend className="text-sm font-medium">角色 {!isEdit && <span className="text-destructive">*</span>}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {isSuperAdmin(roleId) && (
                <label className="flex min-h-11 items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm cursor-not-allowed opacity-60">
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
              {roles.map((r) => (
                <label key={r.id} className={`flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm ${roleId === r.id ? 'border-primary bg-primary/5' : 'border-border'} ${isPending || ownRoleLocked || isSuperAdmin(editUser?.roleId) || !visibleAssignableRoles.some(role => role.id === r.id) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/40'}`}>
                  <input
                    type="radio"
                    name="roleId"
                    value={r.id}
                    checked={roleId === r.id}
                    onChange={() => { setRoleId(r.id); clearError('roleId') }}
                    disabled={isPending || ownRoleLocked || isSuperAdmin(editUser?.roleId) || !visibleAssignableRoles.some(role => role.id === r.id)}
                    className="accent-primary"
                  />
                  <span className="break-words">{r.name}{!visibleAssignableRoles.some(role => role.id === r.id) && '（当前不可分配）'}</span>
                </label>
              ))}
            </div>
            {rolesLoading && <p className="text-sm text-muted-foreground">正在加载角色…</p>}
            {rolesError && <p className="text-sm text-destructive">角色加载失败。<button type="button" className="underline" onClick={() => void refetchRoles()}>重试</button></p>}
            {!rolesLoading && !rolesError && roles.length === 0 && <p className="text-sm text-muted-foreground">暂无可分配角色，请联系管理员。</p>}
            {currentRoleHidden && <p className="text-sm text-foreground/80">当前角色不可选；保存其他资料时会保留原角色。</p>}
            {fieldErrors.roleId && <p id="form-role-error" className="text-sm text-destructive">{fieldErrors.roleId}</p>}
            {ownRoleLocked && <p className="text-sm text-muted-foreground">不能修改自己的角色。</p>}
          </fieldset>

          {isEdit && (
            <>
              <div className="flex items-start gap-3 sm:col-span-2">
                <input
                  type="checkbox"
                  id="form-isActive"
                  checked={isActive}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setIsActive(e.target.checked); setServerError('') }}
                  disabled={isPending}
                  className="mt-0.5 size-4 accent-primary"
                />
                <div className="space-y-1"><Label htmlFor="form-isActive" className="cursor-pointer">启用账号</Label>
                  <p className="text-sm text-foreground/80">关闭后，该账号不能继续登录或使用系统。</p></div>
              </div>

              {/* 提权类开关：豁免「申请人不得审批自己提交的单」这道全站内控，只有超管能设
                  （后端 users.service.assertCanGrantSelfApprove 是权威校验，这里只是不给非超管入口）。
                  非超管编辑用户时整块不渲染 ⇒ 表单不传该字段 ⇒ 后端保持原值，不会触发 403。 */}
              {isOperatorSuperAdmin && (
                <div className="space-y-1 sm:col-span-2">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="form-allowSelfApprove"
                      checked={allowSelfApprove}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setAllowSelfApprove(e.target.checked); setServerError('') }}
                      disabled={isPending}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <div className="space-y-1"><Label htmlFor="form-allowSelfApprove" className="cursor-pointer">允许自行审批</Label>
                      <p className="text-sm text-foreground/80">开启后可审批自己提交的单据；仅超级管理员可设置。</p></div>
                  </div>
                </div>
              )}
            </>
          )}

          {serverError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
              {serverError}
            </p>
          )}
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || (!isEdit && (rolesLoading || rolesError || visibleAssignableRoles.length === 0))}>
              {isPending ? '保存中…' : (isEdit ? '保存修改' : '创建用户')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
