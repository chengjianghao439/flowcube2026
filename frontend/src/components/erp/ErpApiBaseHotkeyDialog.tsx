import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getApiBase, setApiBase } from '@/config/api'
import { applyErpApiBaseFromStorage } from '@/lib/apiOrigin'
import { toast } from '@/lib/toast'

/** 全局快捷键 Ctrl+Shift+S：开发者修改 ERP API 根地址（localStorage API_BASE_URL） */
export default function ErpApiBaseHotkeyDialog() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        setValue(getApiBase())
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleSave() {
    setApiBase(value)
    applyErpApiBaseFromStorage()
    setOpen(false)
    toast.success('API 地址已保存')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>服务器 API 地址</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          开发者入口（<kbd className="rounded border px-1 text-xs">Ctrl</kbd>+
          <kbd className="rounded border px-1 text-xs">Shift</kbd>+
          <kbd className="rounded border px-1 text-xs">S</kbd>）。不含{' '}
          <code className="text-xs">/api</code>，例如：<code className="text-xs">http://192.168.1.10:3000</code>
        </p>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="http://192.168.8.123:3000"
          autoComplete="off"
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
