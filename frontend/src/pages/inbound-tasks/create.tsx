import { useContext, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Save } from 'lucide-react'
import { ActionBar } from '@/components/shared/ActionBar'
import { TabPathContext } from '@/components/layout/TabPathContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { SupplierFinder, FinderTrigger } from '@/components/finder'
import type { FinderResult } from '@/types/finder'
import { useCreateInboundTask, useInboundPurchaseCandidates } from '@/hooks/useInboundTasks'
import { toast } from '@/lib/toast'

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
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [remark, setRemark] = useState('')
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({})

  const { data: candidates = [], isLoading } = useInboundPurchaseCandidates(supplier?.id ?? null, keyword)

  const selectedRows = useMemo(() => {
    return candidates
      .map(item => ({
        item,
        qty: Number(qtyMap[item.purchaseItemId] || 0),
      }))
      .filter(entry => Number.isFinite(entry.qty) && entry.qty > 0)
  }, [candidates, qtyMap])

  const isDirty = !!(supplier || remark || search || keyword || Object.keys(qtyMap).length)
  useDirtyGuard(tabPath, isDirty)

  function closeTab() {
    const { removeTab, tabs } = useWorkspaceStore.getState()
    const nextKey = removeTab(tabPath || '/inbound-tasks/new')
    const nextTab = tabs.find(t => t.key === nextKey)
    navigate(nextTab?.path ?? '/inbound-tasks')
  }

  function handleSupplierConfirm(result: FinderResult) {
    setSupplier(result)
    setKeyword('')
    setSearch('')
    setQtyMap({})
  }

  function setLineQty(purchaseItemId: number, remainingQty: number, raw: string) {
    const value = raw.trim()
    if (!value) {
      setQtyMap(prev => {
        const next = { ...prev }
        delete next[purchaseItemId]
        return next
      })
      return
    }

    const qty = Number(value.replace(/,/g, '.'))
    if (!Number.isFinite(qty) || qty < 0 || qty > remainingQty) return
    setQtyMap(prev => ({ ...prev, [purchaseItemId]: String(qty) }))
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
          const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '创建失败'
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
            <Button variant="outline" onClick={closeTab} disabled={createInbound.isPending}>
              取消
            </Button>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              className="flex-1"
              placeholder="按采购单号 / SKU / 商品名称搜索"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') setKeyword(search.trim())
              }}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setKeyword(search.trim())}>搜索</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setKeyword('')
                  setQtyMap({})
                }}
              >
                清空
              </Button>
            </div>
          </div>

          {!supplier && (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              先选择供应商，再从该供应商已提交的采购单中挑选本次到货商品
            </div>
          )}

          {supplier && (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[140px_110px_minmax(220px,1fr)_120px_90px_90px_120px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground">
                <span>采购单</span>
                <span>SKU</span>
                <span>商品</span>
                <span>仓库</span>
                <span className="text-right">已分配</span>
                <span className="text-right">可建单</span>
                <span className="text-right">本次到货</span>
              </div>

              <div className="max-h-[52vh] overflow-auto">
                {!isLoading && candidates.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    暂无可用采购明细
                  </div>
                )}

                <div className="divide-y">
                  {candidates.map(item => (
                    <div
                      key={item.purchaseItemId}
                      className="grid grid-cols-[140px_110px_minmax(220px,1fr)_120px_90px_90px_120px] gap-3 px-4 py-3 text-sm"
                    >
                      <div className="text-doc-code">{item.purchaseOrderNo}</div>
                      <div className="text-doc-code">{item.productCode}</div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">{item.unit ?? '—'}</div>
                      </div>
                      <div className="text-muted-foreground">{item.warehouseName}</div>
                      <div className="text-right text-muted-foreground">{item.assignedQty}</div>
                      <div className="text-right font-medium text-foreground">{item.remainingQty}</div>
                      <div>
                        <Input
                          className="text-right"
                          placeholder="0"
                          value={qtyMap[item.purchaseItemId] ?? ''}
                          onChange={e => setLineQty(item.purchaseItemId, item.remainingQty, e.target.value)}
                        />
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
          <div className="text-right">
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
    </div>
  )
}
