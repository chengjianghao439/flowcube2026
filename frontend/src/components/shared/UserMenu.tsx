import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { LogOut, KeyRound, UserCircle2, Building2, Warehouse, ShieldCheck, ChevronDown, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { payloadClient as client } from '@/api/client'
import { getMyInfoApi, getMyWarehouseScopeApi } from '@/api/users'
import { toast } from '@/lib/toast'
import { performSessionLogout } from '@/lib/authSession'
import { isElectronRuntime } from '@/lib/platform'
import { visibleAccountIdentity } from '@/lib/visibleAccountIdentity'

export default function UserMenu() {
  const { user } = useAuthStore()
  const location = useLocation()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')

  useEffect(() => setMenuOpen(false), [location])

  const changePwd = useMutation({
    mutationFn: () => client.put('/auth/change-password', { oldPassword: oldPwd, newPassword: newPwd }),
    onSuccess: () => {
      setPwdOpen(false); setOldPwd(''); setNewPwd(''); setConfirmPwd('')
      toast.success('密码修改成功，即将退出登录')
      setTimeout(() => performSessionLogout(), 1000)
    },
  })

  // 自助资料只查登录者本人，不需要用户管理查看权限。
  const myId = user?.id ?? 0
  const { data: myInfo, isError: myInfoError, refetch: refetchMyInfo } = useQuery({
    queryKey: ['my-info', myId],
    queryFn: getMyInfoApi,
    enabled: infoOpen && myId > 0,
  })
  const { data: myWarehouses, isLoading: whLoading, isError: whError, refetch: refetchMyWarehouses } = useQuery({
    queryKey: ['my-warehouses', myId],
    queryFn: getMyWarehouseScopeApi,
    enabled: infoOpen && myId > 0,
  })

  const handlePwdSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd !== confirmPwd) { toast.warning('两次输入的新密码不一致'); return }
    changePwd.mutate()
  }

  function handleLogoutSelect() {
    if (isElectronRuntime() && typeof window.flowcubeDesktop?.showMessageBox === 'function') {
      void window.flowcubeDesktop.showMessageBox({
        type: 'question',
        title: '退出登录',
        message: '确定退出登录吗？未保存的数据可能会丢失。',
        buttons: ['退出登录', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }).then(({ response }) => {
        if (response === 0) performSessionLogout()
      })
      return
    }
    setLogoutOpen(true)
  }

  function restoreMenuFocus(event: Event) {
    event.preventDefault()
    menuTrigger.current?.focus()
  }

  const identity = visibleAccountIdentity(user ?? {})
  const profileIdentity = visibleAccountIdentity(myInfo ?? user ?? {})
  const initials = identity.name.slice(0, 2).toUpperCase()
  const isUnrestricted = myWarehouses?.length === 0 // 空 = 不限仓

  return (
    <div className="relative">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger ref={menuTrigger} aria-label={`用户菜单，${identity.name}`} className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden text-left sm:block">
            <span className="desktop-user-name block text-xs font-medium leading-tight">{identity.name}</span>
            <span className="desktop-user-role block text-xs text-muted-foreground">{identity.role}</span>
          </span>
          <ChevronDown aria-hidden="true" className="size-3 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-0"
          onCloseAutoFocus={event => { if (infoOpen || pwdOpen || logoutOpen) event.preventDefault() }}>
          <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {initials}
            </div>
            <div className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
              <p className="text-sm font-medium">{identity.name}</p>
              <p className="text-xs text-muted-foreground">{identity.account === '—' ? '—' : `@${identity.account}`}</p>
              <p className="text-xs text-muted-foreground">{identity.role}</p>
            </div>
          </div>
          <div className="p-1">
            <DropdownMenuItem onSelect={() => setInfoOpen(true)} className="px-3 py-2">
              <UserCircle2 aria-hidden="true" className="text-muted-foreground" /> 我的信息
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPwdOpen(true)} className="px-3 py-2">
              <KeyRound aria-hidden="true" className="text-muted-foreground" /> 修改密码
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogoutSelect} className="px-3 py-2 text-destructive-ink focus:bg-destructive/10 focus:text-destructive-ink">
              <LogOut aria-hidden="true" /> 退出登录
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 我的信息弹窗 */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-2xl" onCloseAutoFocus={restoreMenuFocus}>
          <DialogHeader description={"核对当前账号的个人与岗位资料。"}><DialogTitle>我的信息</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {myInfoError && <p role="alert" className="text-sm text-destructive-ink">个人资料加载失败。<button type="button" className="underline" onClick={() => void refetchMyInfo()}>重试</button></p>}
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground">账号信息</div>
              <dl className="divide-y divide-border/60 text-sm">
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 px-4 py-3 [&_dd]:break-words"><dt className="text-muted-foreground">姓名</dt><dd className="font-medium">{profileIdentity.name}</dd></div>
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 px-4 py-3 [&_dd]:break-words"><dt className="text-muted-foreground">登录账号</dt><dd className="font-medium">{profileIdentity.account}</dd></div>
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 px-4 py-3 [&_dd]:break-words"><dt className="text-muted-foreground">角色</dt><dd className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-muted-foreground" />{profileIdentity.role}</dd></div>
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 px-4 py-3 [&_dd]:break-words"><dt className="text-muted-foreground">部门</dt><dd className="flex items-center gap-1.5"><Building2 className="size-3.5 text-muted-foreground" />{myInfo?.departmentName || '—'}</dd></div>
              </dl>
            </div>
            <div className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Warehouse className="size-3.5" /> 我的仓库权限
              </div>
              <div className="px-4 py-2 text-sm">
                {whError ? (
                  <p role="alert" className="text-destructive-ink">仓库权限加载失败。<button type="button" className="underline" onClick={() => void refetchMyWarehouses()}>重试</button></p>
                ) : whLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-1"><Loader2 className="size-3.5 animate-spin" /> 加载中…</div>
                ) : isUnrestricted ? (
                  <p className="text-success-ink font-medium">不限仓库（可访问全部仓库）</p>
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
        <DialogContent className="max-w-lg" onCloseAutoFocus={restoreMenuFocus}>
          <DialogHeader description={<>{<>
              确定退出登录吗？未保存的数据可能会丢失。
            </>}</>}>
            <DialogTitle>退出登录</DialogTitle>

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
              退出登录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="max-w-lg" onCloseAutoFocus={restoreMenuFocus}>
          <DialogHeader description={"填写当前密码与新密码。"}><DialogTitle>修改密码</DialogTitle></DialogHeader>
          <form onSubmit={handlePwdSubmit} className="space-y-4 py-2">
            <div className="space-y-1"><Label htmlFor="profile-old-password">当前密码 *</Label><Input id="profile-old-password" type="password" value={oldPwd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOldPwd(e.target.value)} required autoComplete="current-password" /></div>
            <div className="space-y-1"><Label htmlFor="profile-new-password">新密码 *（至少 6 位）</Label><Input id="profile-new-password" type="password" value={newPwd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPwd(e.target.value)} required minLength={6} autoComplete="new-password" /></div>
            <div className="space-y-1"><Label htmlFor="profile-confirm-password">确认新密码 *</Label><Input id="profile-confirm-password" type="password" value={confirmPwd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPwd(e.target.value)} required autoComplete="new-password" /></div>
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
