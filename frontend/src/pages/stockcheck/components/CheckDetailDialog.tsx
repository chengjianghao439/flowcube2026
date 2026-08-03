import { useState, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { useCheckDetail, useUpdateCheckItems, useSubmitCheck, useRefreshCheckItem, useCancelCheck } from '@/hooks/useStockCheck'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import type { CheckItem } from '@/types/stockcheck'

interface Props { open: boolean; onClose: () => void; checkId: number | null }

export default function CheckDetailDialog({ open, onClose, checkId }: Props) {
  const { data: check, isLoading } = useCheckDetail(checkId||0)
  const updateItems = useUpdateCheckItems()
  const submit = useSubmitCheck()
  const refreshItem = useRefreshCheckItem()
  const cancel = useCancelCheck()
  const [actuals, setActuals] = useState<Record<number, string>>({})
  const [submitConfirm, setSubmitConfirm] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [saveLocked, setSaveLocked] = useState(false)
  const [submitLocked, setSubmitLocked] = useState(false)
  const [cancelLocked, setCancelLocked] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({})

  useEffect(() => {
    if(check?.items) {
      const m: Record<number,string> = {}
      check.items.forEach(i=>{ m[i.id] = i.actualQty!=null ? String(i.actualQty) : '' })
      setActuals(m)
      setFieldErrors({})
    }
  }, [check])

  function parseActualQty(raw: string) {
    if (raw.trim() === '') return 0
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  const hasUnsavedChanges = useMemo(() => {
    if (!check?.items?.length || check.status !== 1) return false
    // 序列号行没有输入框（实盘数由 PDA 扫码派生），不参与"未保存改动"判断
    return check.items.some(item => {
      if (item.serialManaged) return false
      const current = actuals[item.id] ?? ''
      const original = item.actualQty != null ? String(item.actualQty) : ''
      return current !== original
    })
  }, [actuals, check])

  function validateActuals() {
    if (!check?.items?.length) return { ok: true as const, items: [] as { id: number; actualQty: number }[] }
    const firstFieldError = Object.values(fieldErrors).find(Boolean)
    if (firstFieldError) return { ok: false as const, items: [] as { id: number; actualQty: number }[], message: firstFieldError }
    // 序列号行不进保存载荷：其实盘数只能由 PDA 逐台扫码写入，后端会拒绝手填
    const items = check.items.filter(i => !i.serialManaged).map(i => ({ id: i.id, actualQty: parseActualQty(actuals[i.id] ?? '') }))
    const invalid = items.find(i => Number.isNaN(i.actualQty) || i.actualQty < 0)
    if (invalid) {
      return { ok: false as const, items, message: '实盘数量必须为大于或等于 0 的数字' }
    }
    return { ok: true as const, items }
  }

  function handleActualChange(itemId: number, raw: string) {
    if (raw === '') {
      setActuals(prev => ({ ...prev, [itemId]: '' }))
      setFieldErrors(prev => ({ ...prev, [itemId]: '' }))
      return
    }

    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      setFieldErrors(prev => ({ ...prev, [itemId]: '请输入合法数字' }))
      return
    }
    if (parsed < 0) {
      setFieldErrors(prev => ({ ...prev, [itemId]: '实盘数量不能为负数' }))
      return
    }

    setActuals(prev => ({ ...prev, [itemId]: raw }))
    setFieldErrors(prev => ({ ...prev, [itemId]: '' }))
  }

  function requestClose() {
    if (saveLocked || submitLocked || cancelLocked || updateItems.isPending || submit.isPending || cancel.isPending) return
    confirmDirtyLeave({
      isDirty: hasUnsavedChanges,
      willNavigate: false,
      proceed: onClose,
    })
  }

  const handleSave = async () => {
    if(!check || saveLocked || updateItems.isPending) return
    const validation = validateActuals()
    if (!validation.ok) {
      toast.warning(validation.message || '实盘数量必须大于或等于 0')
      return
    }
    // 整单都是序列号商品时没有可手填的行（实盘数全部来自 PDA 扫码），没什么可保存
    if (!validation.items.length) {
      toast.warning('本单均为序列号管控商品，实盘数由 PDA 逐台扫码写入，无需在此保存')
      return
    }
    try {
      setSaveLocked(true)
      await updateItems.mutateAsync({ id:check.id, items: validation.items })
      toast.success('保存成功')
    } finally {
      setSaveLocked(false)
    }
  }

  const handleSubmit = async () => {
    if(!check || submitLocked || submit.isPending) return
    const validation = validateActuals()
    if (!validation.ok) {
      toast.warning(validation.message || '实盘数量必须大于或等于 0，修正后才能提交')
      return
    }
    try {
      setSubmitLocked(true)
      await submit.mutateAsync(check.id)
      onClose()
    } finally {
      setSubmitLocked(false)
    }
  }

  // 盘点期间该商品发生过出入库时（提交会被后端 409 拦截），刷新该行账面数并要求重盘
  const handleRefreshItem = async (itemId: number) => {
    if (!check || refreshItem.isPending) return
    const data = await refreshItem.mutateAsync({ id: check.id, itemId })
    setActuals(prev => ({ ...prev, [itemId]: '' }))
    toast.success(`「${data.productName}」账面已刷新为 ${data.bookQty}，请重新盘点该商品`)
  }

  const handleCancel = async () => {
    if(!check || cancelLocked || cancel.isPending) return
    try {
      setCancelLocked(true)
      await cancel.mutateAsync(check.id)
      onClose()
    } finally {
      setCancelLocked(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose() }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            盘点单详情
            {check && <SoftStatusLabel label={check.statusName} tone={check.status===1?'active':check.status===2?'success':'danger'} />}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-center py-8 text-muted-foreground">加载中...</p>}
        {check && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground">盘点单号：</span><span className="text-doc-code-strong">{check.checkNo}</span></div>
              <div><span className="text-muted-foreground">仓库：</span>{check.warehouseName}</div>
              <div><span className="text-muted-foreground">经办人：</span>{check.operatorName}</div>
              {check.remark && <div className="col-span-3"><span className="text-muted-foreground">备注：</span>{check.remark}</div>}
            </div>
            <div>
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium border-b pb-1 mb-1">
                <div className="col-span-2">编码</div>
                <div className="col-span-3">名称</div>
                <div className="col-span-1">单位</div>
                <div className="col-span-2">账面数量</div>
                <div className="col-span-2">实盘数量</div>
                <div className="col-span-1">差异</div>
                <div className="col-span-1"></div>
              </div>
              {check.items?.map((item: CheckItem)=>{
                const actualRaw = actuals[item.id]
                const actual = actualRaw!==''&&actualRaw!==undefined ? parseFloat(actualRaw) : null
                const hasError = !!fieldErrors[item.id]
                // 序列号行的差异以后端派生的 diffQty 为准（实盘数来自扫码，不来自输入框）
                const diff = item.serialManaged
                  ? (item.diffQty ?? null)
                  : (actual!=null && !hasError ? actual - item.bookQty : null)
                return (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center py-1 border-b last:border-0">
                    <div className="col-span-2 text-sm">{item.productCode}</div>
                    <div className="col-span-3 text-sm">{item.productName}</div>
                    <div className="col-span-1 text-sm text-muted-foreground">{item.unit}</div>
                    <div className="col-span-2 text-sm">{item.bookQty}</div>
                    <div className="col-span-2">
                      {/* 序列号商品：实盘数由 PDA 逐台扫码派生，不可手填（后端同样拒绝手填） */}
                      {item.serialManaged ? (
                        <div className="space-y-0.5">
                          <span className="text-sm block">
                            {item.actualQty!=null ? `${item.actualQty}（扫码）` : <span className="text-muted-foreground">待 PDA 扫码</span>}
                          </span>
                          {(item.missingSerials?.length || item.surplusSerials?.length) ? (
                            <p className="text-xs text-muted-foreground">
                              {item.missingSerials?.length ? <span className="text-red-600">盘亏 {item.missingSerials.length} 台</span> : null}
                              {item.missingSerials?.length && item.surplusSerials?.length ? ' · ' : null}
                              {item.surplusSerials?.length ? <span className="text-green-600">盘盈 {item.surplusSerials.length} 台</span> : null}
                            </p>
                          ) : null}
                        </div>
                      ) : check.status===1 ? (
                        <div className="space-y-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-sm"
                            value={actuals[item.id]??''}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>)=>handleActualChange(item.id, e.target.value)}
                            aria-invalid={hasError}
                          />
                          {hasError ? <p className="text-xs text-destructive">{fieldErrors[item.id]}</p> : null}
                        </div>
                      ) : (
                        <span className="text-sm block">{item.actualQty??'-'}</span>
                      )}
                    </div>
                    <div className={`col-span-1 text-sm font-medium ${diff!=null&&diff>0?'text-green-600':diff!=null&&diff<0?'text-red-600':''}`}>
                      {diff!=null ? (diff>0?'+':'')+diff.toFixed(2) : '-'}
                    </div>
                    <div className="col-span-1">
                      {check.status===1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          title="盘点期间该商品发生过出入库时，刷新账面数并重盘"
                          onClick={() => handleRefreshItem(item.id)}
                          disabled={refreshItem.isPending}
                        >刷新账面</Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {check?.status===1 && <>
            <Button variant="outline" onClick={handleSave} disabled={updateItems.isPending || saveLocked}>保存实盘数</Button>
            <Button onClick={() => {
              const validation = validateActuals()
              if (!validation.ok) {
                toast.warning(validation.message || '实盘数量必须大于或等于 0，修正后才能提交')
                return
              }
              setSubmitConfirm(true)
            }} disabled={submit.isPending || submitLocked}>{submit.isPending || submitLocked?'提交中...':'提交盘点'}</Button>
            <Button variant="destructive" onClick={() => setCancelConfirm(true)} disabled={cancel.isPending || cancelLocked}>取消盘点</Button>
          </>}
          <Button variant="outline" onClick={requestClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={submitConfirm}
      title="确认提交盘点"
      description="将批量调整库存至实盘数量，此操作不可撤销。"
      confirmText="确认提交"
      loading={submit.isPending || submitLocked}
      onConfirm={() => { setSubmitConfirm(false); handleSubmit() }}
      onCancel={() => setSubmitConfirm(false)}
    />
    <ConfirmDialog
      open={cancelConfirm}
      title="取消盘点"
      description="确认取消本次盘点？"
      variant="destructive"
      confirmText="确认取消"
      loading={cancel.isPending || cancelLocked}
      onConfirm={() => { setCancelConfirm(false); handleCancel() }}
      onCancel={() => setCancelConfirm(false)}
    />
    </>
  )
}
