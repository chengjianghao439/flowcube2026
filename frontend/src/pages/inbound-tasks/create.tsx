import { useContext, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save, ShoppingCart, X } from 'lucide-react'
import { ActionBar } from '@/components/shared/ActionBar'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { SupplierFinder, FinderTrigger } from '@/components/finder'
import type { FinderResult } from '@/types/finder'
import { useCreateInboundTask } from '@/hooks/useInboundTasks'
import { toast } from '@/lib/toast'
import { PurchaseItemPickerDialog, type PickedPurchaseItem } from './PurchaseItemPickerDialog'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-base p-5">
      <h3 className="text-section-title mb-4 border-b border-border/50 pb-2">{title}</h3>
      {children}
    </div>
  )
}

export default function InboundTaskCreatePage() {
  const tabPath = useContext(TabPathContext)
  const navigate = useNavigate()
  const addTab = useWorkspaceStore(s => s.addTab)
  const createInbound = useCreateInboundTask()

  const [supplierFinderOpen, setSupplierFinderOpen] = useState(false)
  const [supplier, setSupplier] = useState<FinderResult | null>(null)
  const [remark, setRemark] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedMap, setSelectedMap] = useState<Record<number, PickedPurchaseItem>>({})

  const selectedRows = useMemo(() => Object.values(selectedMap), [selectedMap])

  const isDirty = !!(supplier || remark || selectedRows.length)
  useDirtyGuard(tabPath, isDirty)

  function closeTab() {
    const { removeTab } = useWorkspaceStore.getState()
    removeTab(tabPath || '/inbound-tasks/new')
    navigate('/inbound-tasks')
  }

  function handleSupplierConfirm(result: FinderResult) {
    setSupplier(result)
    setSelectedMap({})
  }

  function handlePickerConfirm(rows: PickedPurchaseItem[]) {
    const next: Record<number, PickedPurchaseItem> = {}
    for (const row of rows) next[row.item.purchaseItemId] = row
    setSelectedMap(next)
    setPickerOpen(false)
  }

  function setLineQty(purchaseItemId: number, remainingQty: number, raw: string) {
    const entry = selectedMap[purchaseItemId]
    if (!entry) return
    const value = raw.trim()
    if (!value) {
      setSelectedMap(prev => {
        const next = { ...prev }
        delete next[purchaseItemId]
        return next
      })
      return
    }
    const qty = Number(value.replace(/,/g, '.'))
    if (!Number.isFinite(qty) || qty < 0 || qty > remainingQty) return
    setSelectedMap(prev => ({ ...prev, [purchaseItemId]: { ...entry, qty } }))
  }

  function removeLine(purchaseItemId: number) {
    setSelectedMap(prev => {
      const next = { ...prev }
      delete next[purchaseItemId]
      return next
    })
  }

  function submit() {
    if (!supplier) {
      toast.warning('请先选择供应商')
      return
    }
    if (selectedRows.length === 0) {
      toast.warning('请至少填写一条收货数量')
      return
    }

    const overflow = selectedRows.find(entry => entry.qty > entry.item.remainingQty)
    if (overflow) {
      toast.error(`${overflow.item.productName} 超出可建单数量`)
      return
    }

    createInbound.mutate(
      {
        supplierId: supplier.id,
        supplierName: supplier.name,
        remark: remark.trim() || undefined,
        items: selectedRows.map(entry => ({
          purchaseItemId: entry.item.purchaseItemId,
          qty: entry.qty,
        })),
      },
      {
        onSuccess: (data) => {
          toast.success(`收货订单 ${data.taskNo} 已创建`)
          const path = `/inbound-tasks/${data.taskId}`
          addTab({ key: path, title: data.taskNo, path })
          closeTab()
          navigate(path)
        },
        onError: (error: unknown) => {
          const msg = error instanceof Error ? error.message : '创建失败'
          toast.error(msg)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionBar
        title="新建收货订单"
        rightActions={
          <>

            <Button onClick={submit} disabled={createInbound.isPending} className="gap-1.5">
              {createInbound.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  创建收货订单
                </>
              )}
            </Button>
          </>
        }
      />

      <Section title="订单信息">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">供应商 *</p>
            <FinderTrigger
              value={supplier?.name ?? ''}
              placeholder="点击选择供应商..."
              onClick={() => setSupplierFinderOpen(true)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">备注</p>
            <Input value={remark} onChange={e => setRemark(e.target.value)} placeholder="选填" />
          </div>
        </div>
      </Section>

      <Section title="商品明细">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {supplier ? '从该供应商已提交的采购单中挑选本次到货商品' : '请先选择供应商'}
            </p>
            <Button
              variant="outline"
              disabled={!supplier}
              onClick={() => setPickerOpen(true)}
              className="gap-1.5"
            >
              <ShoppingCart className="h-4 w-4" />
              选择商品
            </Button>
          </div>

          {selectedRows.length === 0 && (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              {supplier ? '尚未选择商品，点击右上角「选择商品」挑选本次到货明细' : '先选择供应商，再选择本次到货商品'}
            </div>
          )}

          {selectedRows.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[140px_minmax(260px,1fr)_120px_90px_120px_60px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground">
                <span>采购单</span>
                <span>商品</span>
                <span>仓库</span>
                <span className="text-left">单价</span>
                <span className="text-left">本次到货</span>
                <span></span>
              </div>

              <div className="max-h-[52vh] overflow-auto">
                <div className="divide-y">
                  {selectedRows.map(({ item, qty }) => (
                    <div
                      key={item.purchaseItemId}
                      className="grid grid-cols-[140px_minmax(260px,1fr)_120px_90px_120px_60px] gap-3 px-4 py-3 text-sm"
                    >
                      <div className="text-doc-code">{item.purchaseOrderNo}</div>
                      <div className="min-w-0">
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="font-mono text-doc-code-muted">{item.productCode}</span>
                          {' · 货号 '}{item.articleNumber || '—'}
                          {' · 型号 '}{item.spec || '—'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-foreground">{item.productName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">颜色 {item.color || '—'}（{item.unit ?? '—'}）</span>
                        </div>
                      </div>
                      <div className="text-muted-foreground">{item.warehouseName}</div>
                      <div className="text-left text-muted-foreground">{item.unitPrice.toFixed(2)}</div>
                      <div>
                        <Input
                          className="text-left"
                          placeholder="0"
                          value={String(qty)}
                          onChange={e => setLineQty(item.purchaseItemId, item.remainingQty, e.target.value)}
                        />
                      </div>
                      <div className="flex items-center justify-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeLine(item.purchaseItemId)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="数量汇总">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>已选商品：{selectedRows.length} 行</p>
            <p>供应商：{supplier?.name ?? '未选择'}</p>
          </div>
          <div className="text-left">
            <p className="mb-1 text-xs text-muted-foreground">本次到货总数</p>
            <p className="text-3xl font-bold text-foreground">
              {selectedRows.reduce((sum, entry) => sum + entry.qty, 0)}
            </p>
          </div>
        </div>
      </Section>

      <SupplierFinder
        open={supplierFinderOpen}
        onClose={() => setSupplierFinderOpen(false)}
        onConfirm={handleSupplierConfirm}
      />

      <PurchaseItemPickerDialog
        open={pickerOpen}
        supplierId={supplier?.id ?? null}
        initialSelection={selectedMap}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
      />
    </div>
  )
}
