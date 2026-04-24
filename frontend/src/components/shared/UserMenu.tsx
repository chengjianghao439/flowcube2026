import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { payloadClient as client } from '@/api/client'
import { toast } from '@/lib/toast'
import { performSessionLogout } from '@/lib/authSession'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'

export default function UserMenu() {
  const { user } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
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

  const handlePwdSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd !== confirmPwd) { toast.warning('两次输入的新密码不一致'); return }
    changePwd.mutate()
  }

  const initials = (user?.realName || user?.username || 'U').slice(0, 2).toUpperCase()

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
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border z-50 overflow-hidden">
            <div className="px-4 py-3 border-b">
              <p className="text-sm font-medium">{user?.realName || user?.username}</p>
              <p className="text-xs text-muted-foreground">{user?.roleName}</p>
            </div>
            <div className="py-1">
              <button onClick={() => { setMenuOpen(false); setPwdOpen(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2">
                <span>🔑</span> 修改密码
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
                <span>↩️</span> 退出登录
              </button>
            </div>
          </div>
        </>
      )}

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
              <Button type="submit" disabled={changePwd.isPending}>{changePwd.isPending ? '提交中...' : '确认修改'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
