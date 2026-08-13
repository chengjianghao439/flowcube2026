import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { LogOut, KeyRound, UserCircle2, Building2, Warehouse, ShieldCheck, ChevronDown, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { payloadClient as client } from '@/api/client'
import { toast } from '@/lib/toast'
import { performSessionLogout } from '@/lib/authSession'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

interface MyInfo {
  id: number
  username: string
  realName: string
  roleId: number
  roleName: string
  isActive: boolean
  departmentId: number | null
  departmentName: string | null
}
interface WarehouseScope { warehouseId: number; warehouseName: string }

export default function UserMenu() {
  const { user } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')

  const changePwd = useMutation({
    mutationFn: () => client.put('/auth/change-password', { oldPassword: oldPwd, newPassword: newPwd }),
    onSuccess: () => {
      setPwdOpen(false); setOldPwd(''); setNewPwd(''); setConfirmPwd('')
      toast.success('密码修改成功，即将退出登录')
      setTimeout(() => performSessionLogout(), 1000)
    },
  })

  // 我的信息（当前用户 id 从 authStore 拿；仓库权限调 /users/:id/warehouse-scope）
  const myId = user?.id ?? 0
  const { data: myInfo } = useQuery({
    queryKey: ['my-info', myId],
    queryFn: () => client.get<MyInfo>(`/users/${myId}`).then(r => r ?? null),
    enabled: infoOpen && myId > 0,
  })
  const { data: myWarehouses, isLoading: whLoading } = useQuery({
    queryKey: ['my-warehouses', myId],
    queryFn: () => client.get<WarehouseScope[]>(`/users/${myId}/warehouse-scope`).then(r => r ?? []),
    enabled: infoOpen && myId > 0,
  })

  const handlePwdSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd !== confirmPwd) { toast.warning('两次输入的新密码不一致'); return }
    changePwd.mutate()
  }

  const initials = (user?.realName || user?.username || 'U').slice(0, 2).toUpperCase()
  const isUnrestricted = myWarehouses?.length === 0 // 空 = 不限仓

  return (
    <div className="relative">
      <button onClick={() => setMenuOpen(o => !o)} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-accent transition-colors">
        <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
          {initials}
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-xs font-medium leading-tight">{user?.realName || user?.username}</p>
          <p className="text-[10px] text-muted-foreground">{user?.roleName || '管理员'}</p>
        </div>
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border z-50 overflow-hidden">
            {/* 登录信息卡片 */}
            <div className="px-4 py-3 border-b bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user?.realName || user?.username}</p>
                  <p className="text-[11px] text-muted-foreground truncate">@{user?.username}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user?.roleName}</p>
                </div>
              </div>
            </div>

            <div className="py-1">
              <button
                onClick={() => { setMenuOpen(false); setInfoOpen(true) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
              >
                <UserCircle2 className="size-4 text-muted-foreground" /> 我的信息
              </button>
              <button
                onClick={() => { setMenuOpen(false); setPwdOpen(true) }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
              >
                <KeyRound className="size-4 text-muted-foreground" /> 修改密码
              </button>
              <div className="border-t my-1" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  if (
                    IS_ELECTRON_DESKTOP &&
                    typeof window.flowcubeDesktop?.showMessageBox === 'function'
                  ) {
                    void window.flowcubeDesktop.showMessageBox({
                      type: 'question',
                      title: '退出系统',
                      message: '确定要退出系统吗？未保存的数据可能会丢失。',
                      buttons: ['确定退出', '取消'],
                      defaultId: 0,
                      cancelId: 1,
                      noLink: true,
                    }).then(({ response }) => {
                      if (response === 0) performSessionLogout()
                    })
                    return
                  }
                  setLogoutOpen(true)
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <LogOut className="size-4" /> 退出登录
              </button>
            </div>
          </div>
        </>
      )}

      {/* 我的信息弹窗 */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>我的信息</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground">账号信息</div>
              <dl className="divide-y divide-border/60 text-sm">
                <div className="flex justify-between px-4 py-2"><dt className="text-muted-foreground">姓名</dt><dd className="font-medium">{myInfo?.realName || user?.realName || '—'}</dd></div>
                <div className="flex justify-between px-4 py-2"><dt className="text-muted-foreground">登录账号</dt><dd className="font-medium">{myInfo?.username || user?.username || '—'}</dd></div>
                <div className="flex justify-between px-4 py-2"><dt className="text-muted-foreground">角色</dt><dd className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-muted-foreground" />{myInfo?.roleName || user?.roleName || '—'}</dd></div>
                <div className="flex justify-between px-4 py-2"><dt className="text-muted-foreground">部门</dt><dd className="flex items-center gap-1.5"><Building2 className="size-3.5 text-muted-foreground" />{myInfo?.departmentName || '—'}</dd></div>
              </dl>
            </div>
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Warehouse className="size-3.5" /> 我的仓库权限
              </div>
              <div className="px-4 py-2 text-sm">
                {whLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-1"><Loader2 className="size-3.5 animate-spin" /> 加载中…</div>
                ) : isUnrestricted ? (
                  <p className="text-emerald-600 font-medium">不限仓库（可访问全部仓库）</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {myWarehouses?.map(w => (
                      <span key={w.warehouseId} className="rounded-md bg-muted px-2 py-0.5 text-xs">{w.warehouseName}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInfoOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 浏览器端退出确认（桌面端走原生 messageBox） */}
      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>退出系统</DialogTitle>
            <DialogDescription>
              确定要退出系统吗？未保存的数据可能会丢失。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setLogoutOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setLogoutOpen(false)
                performSessionLogout()
              }}
            >
              确定退出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>修改密码</DialogTitle></DialogHeader>
          <form onSubmit={handlePwdSubmit} className="space-y-4 py-2">
            <div className="space-y-1"><Label>当前密码 *</Label><Input type="password" value={oldPwd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOldPwd(e.target.value)} required autoComplete="current-password" /></div>
            <div className="space-y-1"><Label>新密码 *（至少6位）</Label><Input type="password" value={newPwd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPwd(e.target.value)} required minLength={6} autoComplete="new-password" /></div>
            <div className="space-y-1"><Label>确认新密码 *</Label><Input type="password" value={confirmPwd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPwd(e.target.value)} required autoComplete="new-password" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
              <Button type="submit" disabled={changePwd.isPending}>{changePwd.isPending ? '提交中…' : '确认修改'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
