import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
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

  const { data: warehouses, isLoading: warehousesLoading, isError: warehousesError, refetch: refetchWarehouses } = useQuery({
    queryKey: ['warehouses-active-all'],
    queryFn: () => getWarehousesApi({ page: 1, pageSize: 500 }),
    enabled: open,
  })
  const { data: scope, isLoading, isError: scopeError, refetch: refetchScope } = useUserWarehouseScope(userId, open)
  useEffect(() => { setSelected(new Set()) }, [userId])
  useEffect(() => {
    if (scope) setSelected(new Set(scope.map(s => s.warehouseId)))
  }, [scope])

  const save = useSaveUserWarehouseScope(userId)

  const list = warehouses?.list ?? []
  const ready = !!scope && !!warehouses && !isLoading && !warehousesLoading && !scopeError && !warehousesError

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !save.isPending) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>仓库数据权限{userName ? ` — ${userName}` : ''}</DialogTitle></DialogHeader>
        <DialogDescription className="rounded-md border border-border bg-muted/30 p-4 leading-6">
          不勾选任何仓库 = 不限仓（默认）。勾选后该用户只能查看/操作所选仓库的数据（超级管理员始终不限仓）。
        </DialogDescription>
        {(isLoading || warehousesLoading) && <p className="py-4 text-center text-muted-foreground text-sm">加载中…</p>}
        {scopeError && <p role="alert" className="text-sm text-destructive">当前仓库权限加载失败。<button type="button" className="underline" onClick={() => void refetchScope()}>重试</button></p>}
        {warehousesError && <p role="alert" className="text-sm text-destructive">仓库列表加载失败。<button type="button" className="underline" onClick={() => void refetchWarehouses()}>重试</button></p>}
        <div className="grid max-h-[420px] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
          {list.map((w: { id: number; name: string; code?: string }) => (
            <label key={w.id} className="flex items-start gap-3 rounded-md border px-4 py-3 text-sm hover:bg-muted/50">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={selected.has(w.id)} disabled={!ready || save.isPending}
                onChange={e => {
                  setSelected(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(w.id); else next.delete(w.id)
                    return next
                  })
                }} />
              <span className="min-w-0 flex-1 break-words leading-6">{w.name}</span>
              {w.code && <span className="text-xs text-muted-foreground">{w.code}</span>}
            </label>
          ))}
        </div>
        {ready && <p className="text-sm text-muted-foreground">已选择 {selected.size} 个仓库{selected.size === 0 ? ' · 当前为不限仓' : ''}</p>}
        {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>取消</Button>
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate([...selected], {
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
