import { ReportTable } from '@/components/shared/ReportTable'
import { OrderDetailSections } from '@/components/shared/OrderDetailSections'
import { ProductIdentityCells, ProductIdentityHeaders } from '@/components/shared/ProductIdentityCells'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { useCheckDetail, useUpdateCheckItems, useSubmitCheck, useRefreshCheckItem, useCancelCheck } from '@/hooks/useStockCheck'
import { useProductQtyPolicies } from '@/hooks/useProductQtyPolicies'
import { qtyStep } from '@/lib/qtyStep'
import { confirmDirtyLeave } from '@/lib/unsavedChanges'
import type { CheckItem } from '@/types/stockcheck'

interface Props { open: boolean; onClose: () => void; checkId: number | null }
interface ActualDraft {
  checkId: number
  actuals: Record<number, string>
  baseline: Record<number, string>
  fieldErrors: Record<number, string>
}

function showActionError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  toast.error(/[\u3400-\u9fff]/u.test(message) ? message : '操作失败，请检查网络后重试')
}

export default function CheckDetailDialog({ open, onClose, checkId }: Props) {
  const { data: loadedCheck, isLoading, error, refetch } = useCheckDetail(checkId||0)
  const check = !error && loadedCheck?.id === checkId ? loadedCheck : undefined
  const currentEditableId = useRef<number | null>(null)
  currentEditableId.current = open && check?.status === 1 ? check.id : null
  const canOperate = currentEditableId.current !== null
  const readStatus = (error as { status?: number; response?: { status?: number } } | null)?.status
    ?? (error as { response?: { status?: number } } | null)?.response?.status
  const readTitle = readStatus === 403 ? '无权查看盘点单' : readStatus === 404 ? '盘点单不存在或已删除' : '盘点单读取失败'
  const updateItems = useUpdateCheckItems()
  const submit = useSubmitCheck()
  const refreshItem = useRefreshCheckItem()
  const cancel = useCancelCheck()
  const [draft, setDraft] = useState<ActualDraft | null>(null)
  const currentDraft = draft?.checkId === checkId ? draft : null
  const actuals = currentDraft?.actuals ?? {}
  const fieldErrors = currentDraft?.fieldErrors ?? {}
  // 「只能整数」的商品把实盘数量框的 step 切成 1（迁移 254）
  const allowDecimalOf = useProductQtyPolicies((check?.items ?? []).map(i => i.productId))
  const [submitConfirm, setSubmitConfirm] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [saveLocked, setSaveLocked] = useState(false)
  const [submitLocked, setSubmitLocked] = useState(false)
  const [cancelLocked, setCancelLocked] = useState(false)
  useEffect(() => {
    if(check?.items) {
      setDraft(previous => {
        if (previous?.checkId === check.id && (saveLocked || Object.entries(previous.baseline).some(([id, value]) => (previous.actuals[Number(id)] ?? '') !== value))) return previous
        const values: Record<number, string> = {}, baseline: Record<number, string> = {}
        check.items!.forEach(item => {
          values[item.id] = item.actualQty != null ? String(item.actualQty) : ''
          if (!item.scanDriven) baseline[item.id] = values[item.id]
        })
        return { checkId: check.id, actuals: values, baseline, fieldErrors: {} }
      })
    }
  }, [check, saveLocked])

  useEffect(() => {
    setSubmitConfirm(false)
    setCancelConfirm(false)
  }, [checkId, error, open, check?.status])

  function setActuals(update: (previous: Record<number, string>) => Record<number, string>) {
    setDraft(previous => previous?.checkId === checkId ? { ...previous, actuals: update(previous.actuals) } : previous)
  }
  function setFieldErrors(update: (previous: Record<number, string>) => Record<number, string>) {
    setDraft(previous => previous?.checkId === checkId ? { ...previous, fieldErrors: update(previous.fieldErrors) } : previous)
  }

  function parseActualQty(raw: string) {
    if (raw.trim() === '') return 0
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }

  const hasUnsavedChanges = useMemo(() => {
    if (!currentDraft) return false
    return Object.entries(currentDraft.baseline).some(([id, value]) => (currentDraft.actuals[Number(id)] ?? '') !== value)
  }, [currentDraft])

  function validateActuals() {
    if (!check?.items?.length) return { ok: true as const, items: [] as { id: number; actualQty: number }[] }
    const firstFieldError = Object.values(fieldErrors).find(Boolean)
    if (firstFieldError) return { ok: false as const, items: [] as { id: number; actualQty: number }[], message: firstFieldError }
    // 2026-09-17 验收修复（G-13）：只提交用户真正填写的行。
    // 此前对每个非扫码行都调用 parseActualQty('')，而空值被当作 0，于是「保存实盘数」
    // 会把整单未填写行写成实盘 0（差异 = -账面量），提交后会把全仓库存按盘亏清零
    // ——全盘单实测一次写入 1,553 行 0。留空必须保持 NULL（= 未盘），不能等同「实盘 0」。
    const items = check.items
      .filter(i => !i.scanDriven)
      .map(i => ({ id: i.id, raw: String(actuals[i.id] ?? '').trim() }))
      .filter(i => i.raw !== '')
      .map(i => ({ id: i.id, actualQty: parseActualQty(i.raw) }))
    const invalid = items.find(i => Number.isNaN(i.actualQty) || i.actualQty < 0)
    if (invalid) {
      return { ok: false as const, items, message: '实盘数量必须为大于或等于 0 的数字' }
    }
    if (!items.length) {
      // 全部明细由 PDA 扫码盘点时没有任何"手工填写行"，但这并不代表单据是空的：
      // 实盘数量已经由扫码确定（后端按扫码集合派生 actual_qty）。此前这里一律报
      // 「请至少填写一行实盘数量」，导致**纯 PDA 扫码完成的盘点单在 ERP 永远提交不了**
      //（2026-09-17 验收续测发现），盘点链断在最后一步。
      const scannedRows = check.items.filter(i => i.scanDriven && i.actualQty != null)
      if (scannedRows.length) return { ok: true as const, items }
      return { ok: false as const, items, message: '请至少填写一行实盘数量后再保存' }
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
      proceed: () => { setDraft(null); onClose() },
    })
  }

  const handleSave = async () => {
    if(!check || currentEditableId.current !== check.id || saveLocked || updateItems.isPending) return
    const validation = validateActuals()
    if (!validation.ok) {
      toast.warning(validation.message || '实盘数量必须大于或等于 0')
      return
    }
    if (!validation.items.length) {
      toast.warning('没有可保存的行')
      return
    }
    try {
      setSaveLocked(true)
      const savedValues = { ...actuals }
      await updateItems.mutateAsync({ id:check.id, items: validation.items })
      setDraft(previous => previous?.checkId === check.id ? {
        ...previous,
        baseline: { ...previous.baseline, ...Object.fromEntries(validation.items.map(item => [item.id, savedValues[item.id] ?? ''])) },
      } : previous)
      toast.success('保存成功')
    } catch (error) {
      showActionError(error)
    } finally {
      setSaveLocked(false)
    }
  }

  const handleSubmit = async () => {
    if(!check || currentEditableId.current !== check.id || submitLocked || submit.isPending) return
    const validation = validateActuals()
    if (!validation.ok) {
      toast.warning(validation.message || '实盘数量必须大于或等于 0，修正后才能提交')
      return
    }
    try {
      setSubmitLocked(true)
      await submit.mutateAsync(check.id)
      onClose()
    } catch (error) {
      showActionError(error)
    } finally {
      setSubmitLocked(false)
    }
  }

  // 盘点期间该商品发生过出入库时（提交会被后端 409 拦截），刷新该行账面数并要求重盘
  const handleRefreshItem = async (itemId: number) => {
    if (!check || currentEditableId.current !== check.id || refreshItem.isPending) return
    try {
      const data = await refreshItem.mutateAsync({ id: check.id, itemId })
      setDraft(previous => previous?.checkId === check.id ? {
        ...previous,
        actuals: { ...previous.actuals, [itemId]: '' },
        baseline: { ...previous.baseline, [itemId]: '' },
        fieldErrors: { ...previous.fieldErrors, [itemId]: '' },
      } : previous)
      toast.success(`「${data.productName}」账面已刷新为 ${data.bookQty}，请重新盘点该商品`)
    } catch (error) {
      showActionError(error)
    }
  }

  const handleCancel = async () => {
    if(!check || currentEditableId.current !== check.id || cancelLocked || cancel.isPending) return
    try {
      setCancelLocked(true)
      await cancel.mutateAsync(check.id)
      onClose()
    } catch (error) {
      showActionError(error)
    } finally {
      setCancelLocked(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose() }}>
      <DialogContent className="grid-cols-1 max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader description={"核对盘点商品、账面量、实盘量与差异。"}>
          <DialogTitle className="flex items-center gap-3">
            盘点单详情
            {check && <SoftStatusLabel label={check.statusName} tone={check.status===1?'active':check.status===2?'success':'danger'} />}
          </DialogTitle>
        </DialogHeader>
        {error && <QueryErrorState error={error} title={readTitle} onRetry={() => { void refetch() }} />}
        {!error && isLoading && <p className="text-center py-8 text-muted-foreground">加载中…</p>}
        {check && (
          <OrderDetailSections type="stockcheck" id={checkId || 0}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-lg bg-muted/30 p-4 text-sm">
              <div><span className="text-muted-foreground">盘点单号：</span><span className="text-doc-code-strong">{check.checkNo}</span></div>
              <div><span className="text-muted-foreground">仓库：</span>{check.warehouseName}</div>
              <div><span className="text-muted-foreground">经办人：</span>{check.operatorName}</div>
              {check.remark && <div className="col-span-3"><span className="text-muted-foreground">备注：</span>{check.remark}</div>}
            </div>
            <div className="overflow-x-auto">
              <ReportTable className="w-full min-w-[1440px] text-sm"><thead><tr>
                <ProductIdentityHeaders />
                <th className="w-20">单位</th>
                <th className="w-32">账面数量</th>
                <th className="w-44">实盘数量</th>
                <th className="w-32">差异</th>
                {check.status === 1 && <th className="w-28">操作</th>}
              </tr></thead><tbody>
              {check.items?.map((item: CheckItem)=>{
                const actualRaw = actuals[item.id]
                const actual = actualRaw!==''&&actualRaw!==undefined ? parseFloat(actualRaw) : null
                const hasError = !!fieldErrors[item.id]
                const diff = item.scanDriven || check.status !== 1
                  ? (item.diffQty ?? null)
                  : (actual!=null && !hasError ? actual - item.bookQty : null)
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <ProductIdentityCells product={item} />
                    <td className="text-sm text-muted-foreground">{item.unit}</td>
                    <td className="text-sm">{item.bookQty}</td>
                    <td>
                      {item.scanDriven ? (
                        <div className="space-y-0.5">
                          <span className="text-sm block">
                            {item.actualQty!=null ? `${item.actualQty}（扫码）` : <span className="text-muted-foreground">待 PDA 扫码</span>}
                          </span>
                          <p className="text-xs text-muted-foreground">PDA 扫码盘点 · 已扫 {item.scannedContainerCount ?? 0} 个条码</p>
                        </div>
                      ) : check.status===1 ? (
                        <div className="space-y-1">
                          <Input quantity
                            type="number"
                            min="0"
                            step={qtyStep(allowDecimalOf(item.productId))}
                            className="h-9 text-right text-sm tabular-nums" aria-label={`${item.productName}实盘数量`}
                            value={actuals[item.id]??''}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>)=>handleActualChange(item.id, e.target.value)}
                            aria-invalid={hasError}
                          />
                          {hasError ? <p className="text-xs text-destructive-ink">{fieldErrors[item.id]}</p> : null}
                        </div>
                      ) : (
                        <span className="text-sm block">{item.actualQty??'-'}</span>
                      )}
                    </td>
                    <td className={`text-sm font-medium ${diff!=null&&diff>0?'text-green-600':diff!=null&&diff<0?'text-red-600':''}`}>
                      {diff!=null ? (diff>0?'+':'')+diff.toFixed(2) : '-'}
                    </td>
                    {check.status === 1 && <td>
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
                    </td>}
                  </tr>
                )
              })}
            </tbody></ReportTable></div>
          </div>
          </OrderDetailSections>
        )}
        <DialogFooter className="gap-2">
          {canOperate && <>
            <Button variant="outline" onClick={handleSave} disabled={updateItems.isPending || saveLocked}>保存实盘数</Button>
            <Button onClick={() => {
              const validation = validateActuals()
              if (!validation.ok) {
                toast.warning(validation.message || '实盘数量必须大于或等于 0，修正后才能提交')
                return
              }
              setSubmitConfirm(true)
            }} disabled={submit.isPending || submitLocked}>{submit.isPending || submitLocked?'提交中…':'提交盘点'}</Button>
            <Button variant="destructive" onClick={() => setCancelConfirm(true)} disabled={cancel.isPending || cancelLocked}>取消盘点</Button>
          </>}
          <Button variant="outline" onClick={requestClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={canOperate && submitConfirm}
      title="确认提交盘点"
      description="将批量调整库存至实盘数量，此操作不可撤销。"
      confirmText="确认提交"
      loading={submit.isPending || submitLocked}
      onConfirm={() => { setSubmitConfirm(false); void handleSubmit() }}
      onCancel={() => setSubmitConfirm(false)}
    />
    <ConfirmDialog
      open={canOperate && cancelConfirm}
      title="取消盘点"
      description="确认取消本次盘点？"
      variant="destructive"
      confirmText="确认取消"
      loading={cancel.isPending || cancelLocked}
      onConfirm={() => { setCancelConfirm(false); void handleCancel() }}
      onCancel={() => setCancelConfirm(false)}
    />
    </>
  )
}
