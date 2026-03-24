import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useCheckDetail, useUpdateCheckItems, useSubmitCheck, useCancelCheck } from '@/hooks/useStockCheck'
import type { CheckItem } from '@/types/stockcheck'

interface Props { open: boolean; onClose: () => void; checkId: number | null }

export default function CheckDetailDialog({ open, onClose, checkId }: Props) {
  const { data: check, isLoading } = useCheckDetail(checkId||0)
  const updateItems = useUpdateCheckItems()
  const submit = useSubmitCheck()
  const cancel = useCancelCheck()
  const [actuals, setActuals] = useState<Record<number, string>>({})
  const [submitConfirm, setSubmitConfirm] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  useEffect(() => {
    if(check?.items) {
      const m: Record<number,string> = {}
      check.items.forEach(i=>{ m[i.id] = i.actualQty!=null ? String(i.actualQty) : '' })
      setActuals(m)
    }
  }, [check])

  const handleSave = async () => {
    if(!check) return
    const items = check.items!.map(i=>({ id:i.id, actualQty:parseFloat(actuals[i.id]||'0') }))
    await updateItems.mutateAsync({ id:check.id, items })
    toast.success('保存成功')
  }

  const handleSubmit = async () => {
    if(!check) return
    await submit.mutateAsync(check.id)
    onClose()
  }

  const handleCancel = async () => {
    if(!check) return
    await cancel.mutateAsync(check.id)
    onClose()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            盘点单详情
            {check && <Badge variant={check.status===1?'default':check.status===2?'outline':'destructive'}>{check.statusName}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-center py-8 text-muted-foreground">加载中...</p>}
        {check && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground">盘点单号：</span>{check.checkNo}</div>
              <div><span className="text-muted-foreground">仓库：</span>{check.warehouseName}</div>
              <div><span className="text-muted-foreground">经办人：</span>{check.operatorName}</div>
              {check.remark && <div className="col-span-3"><span className="text-muted-foreground">备注：</span>{check.remark}</div>}
            </div>
            <div>
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium border-b pb-1 mb-1">
                <div className="col-span-2">编码</div>
                <div className="col-span-3">名称</div>
                <div className="col-span-1">单位</div>
                <div className="col-span-2 text-right">账面数量</div>
                <div className="col-span-2 text-right">实盘数量</div>
                <div className="col-span-2 text-right">差异</div>
              </div>
              {check.items?.map((item: CheckItem)=>{
                const actual = actuals[item.id]!==''&&actuals[item.id]!==undefined ? parseFloat(actuals[item.id]) : null
                const diff = actual!=null ? actual - item.bookQty : null
                return (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center py-1 border-b last:border-0">
                    <div className="col-span-2 text-sm">{item.productCode}</div>
                    <div className="col-span-3 text-sm">{item.productName}</div>
                    <div className="col-span-1 text-sm text-muted-foreground">{item.unit}</div>
                    <div className="col-span-2 text-right text-sm">{item.bookQty}</div>
                    <div className="col-span-2">
                      {check.status===1 ? (
                        <Input type="number" min="0" step="0.01" className="text-sm text-right h-8" value={actuals[item.id]??''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setActuals(p=>({...p,[item.id]:e.target.value}))} />
                      ) : (
                        <span className="text-sm text-right block">{item.actualQty??'-'}</span>
                      )}
                    </div>
                    <div className={`col-span-2 text-right text-sm font-medium ${diff!=null&&diff>0?'text-green-600':diff!=null&&diff<0?'text-red-600':''}`}>
                      {diff!=null ? (diff>0?'+':'')+diff.toFixed(2) : '-'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {check?.status===1 && <>
            <Button variant="outline" onClick={handleSave} disabled={updateItems.isPending}>保存实盘数</Button>
            <Button onClick={() => setSubmitConfirm(true)} disabled={submit.isPending}>{submit.isPending?'提交中...':'提交盘点'}</Button>
            <Button variant="destructive" onClick={() => setCancelConfirm(true)}>取消盘点</Button>
          </>}
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={submitConfirm}
      title="确认提交盘点"
      description="将批量调整库存至实盘数量，此操作不可撤销。"
      confirmText="确认提交"
      onConfirm={() => { setSubmitConfirm(false); handleSubmit() }}
      onCancel={() => setSubmitConfirm(false)}
    />
    <ConfirmDialog
      open={cancelConfirm}
      title="取消盘点"
      description="确认取消本次盘点？"
      variant="destructive"
      confirmText="确认取消"
      onConfirm={() => { setCancelConfirm(false); handleCancel() }}
      onCancel={() => setCancelConfirm(false)}
    />
    </>
  )
}
