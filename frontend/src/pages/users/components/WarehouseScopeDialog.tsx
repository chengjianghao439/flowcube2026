import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { getWarehousesApi } from '@/api/warehouses'
import { useUserWarehouseScope, useSaveUserWarehouseScope } from '@/hooks/useUserWarehouseScope'

interface Props { open: boolean; onClose: () => void; userId: number | null; userName?: string }

/**
 * 用户仓库数据权限配置：不勾任何仓 = 不限仓（默认）；勾选后该用户的
 * 仓库下拉、库存/销售/仓库任务列表只显示 scope 内仓库的数据。
 */
export default function WarehouseScopeDialog({ open, onClose, userId, userName }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses-active-all'],
    queryFn: () => getWarehousesApi({ page: 1, pageSize: 999 }),
    enabled: open,
  })
  const { data: scope, isLoading } = useUserWarehouseScope(userId, open)
  useEffect(() => {
    if (scope) setSelected(new Set(scope.map(s => s.warehouseId)))
  }, [scope])

  const save = useSaveUserWarehouseScope(userId)

  const list = warehouses?.list ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>仓库数据权限{userName ? ` — ${userName}` : ''}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          不勾选任何仓库 = 不限仓（默认）。勾选后该用户只能查看/操作所选仓库的数据（超级管理员始终不限仓）。
        </p>
        {isLoading && <p className="py-4 text-center text-muted-foreground text-sm">加载中...</p>}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {list.map((w: { id: number; name: string; code?: string }) => (
            <label key={w.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
              <input type="checkbox" className="h-4 w-4" checked={selected.has(w.id)}
                onChange={e => {
                  setSelected(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(w.id); else next.delete(w.id)
                    return next
                  })
                }} />
              <span>{w.name}</span>
              {w.code && <span className="text-xs text-muted-foreground">{w.code}</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate([...selected], {
            onSuccess: () => {
              toast.success(selected.size ? '仓库数据权限已更新（限定仓库生效）' : '已清空限定，该用户不限仓')
              onClose()
            },
          })}>{save.isPending ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
