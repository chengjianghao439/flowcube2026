import { useState } from 'react'
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
import { useResetPassword } from '@/hooks/useUsers'

interface ResetPasswordDialogProps {
  open: boolean
  onClose: () => void
  userId: number
  username: string
}

export default function ResetPasswordDialog({
  open,
  onClose,
  userId,
  username,
}: ResetPasswordDialogProps) {
  const [newPassword, setNewPassword] = useState('')
  const { mutate: resetPassword, isPending, error } = useResetPassword()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    resetPassword({ id: userId, newPassword }, { onSuccess: () => { onClose(); setNewPassword('') } })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>重置密码</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            正在重置账号 <span className="font-medium text-foreground">{username}</span> 的密码
          </p>

          <div className="space-y-2">
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
              placeholder="至少 6 位"
              disabled={isPending}
              autoFocus
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || newPassword.length < 6}>
              {isPending ? '重置中...' : '确认重置'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
