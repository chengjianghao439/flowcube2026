/**
 * 序列号 · 历史导入（文档 04 · Phase 2）
 * 给已有存量库存的商品补齐序列号并原子开启 serial_managed。逐容器录入其在库单位的序列号
 * （每容器数量必须与容器 remaining_qty 一致），一次性覆盖商品全部在库容器。不改动库存数量。
 * 路由：/serials/import（权限 SERIAL_MANAGE）
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import ProductFinderModal from '@/components/shared/ProductFinderModal'
import { createRequestKey } from '@/lib/requestKey'
import { getSerialImportCandidatesApi, importSerialsApi } from '@/api/serials'
import type { ProductFinderResult } from '@/types/products'

/** 解析文本域里的序列号：换行 / 逗号 / 分号 / 空白皆可分隔 */
function parseSns(text: string): string[] {
  return (text || '').split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
}

export default function SerialImportPage() {
  const navigate = useNavigate()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [product, setProduct] = useState<{ id: number; code: string; name: string; unit: string } | null>(null)
  const [snText, setSnText] = useState<Record<number, string>>({})   // key = containerId

  const candQ = useQuery({
    queryKey: ['serial-import-candidates', product?.id],
    queryFn: () => getSerialImportCandidatesApi(product!.id),
    enabled: !!product,
  })
  const cand = candQ.data

  const importMut = useMutation({
    mutationFn: (payload: { productId: number; containers: Array<{ containerId: number; serialNos: string[] }> }) =>
      importSerialsApi(payload, createRequestKey('serial_import')),
  })

  const containers = cand?.containers ?? []
  const perContainer = containers.map(c => {
    const sns = parseSns(snText[c.containerId] ?? '')
    return { ...c, entered: sns.length, sns }
  })
  const totalEntered = perContainer.reduce((s, c) => s + c.entered, 0)
  const totalRequired = cand?.totalQty ?? 0
  const allMatch = containers.length > 0 && perContainer.every(c => c.entered === c.remainingQty)

  const b = cand?.blockers
  const blockReason =
    b?.alreadySerialized ? '该商品已启用序列号管理，无需再次导入'
    : b?.noStock ? '该商品无在库库存；零库存商品可直接在商品档案开启序列号管理'
    : b?.pendingContainers ? `有 ${b.pendingContainers} 个待上架/待质检容器，请先完成上架/质检再导入`
    : b?.lockedContainers ? `有 ${b.lockedContainers} 个容器正被出库任务锁定，请等出库完成后再导入`
    : b?.outOfScopeStock ? '该商品在你无权限的仓库还有在库库存，无法完成商品级全覆盖导入（请由具备全仓权限的管理员操作）'
    : null
  const canSubmit = !!product && !blockReason && allMatch && !importMut.isPending

  function handleSubmit() {
    if (!product || !canSubmit) return
    importMut.mutate(
      { productId: product.id, containers: perContainer.map(c => ({ containerId: c.containerId, serialNos: c.sns })) },
      {
        onSuccess: (res) => {
          toast.success(`已导入 ${res?.importedCount ?? totalEntered} 台序列号，序列号管理已开启`)
          setProduct(null); setSnText({})
          navigate('/serials')
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '导入失败'
          toast.error(msg)
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="序列号 · 历史导入"
        description="给已有存量库存的商品补齐序列号并开启序列号管理：逐容器录入在库单位的序列号（每容器数量须与容器数量一致），一次性覆盖该商品全部在库容器、原子开启。只补个体账，不改动库存数量。"
      />

      {/* 选商品 */}
      <div className="card-base p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setPickerOpen(true)}>{product ? '重新选择商品' : '选择商品'}</Button>
          {product && <span className="text-sm"><span className="font-medium">{product.name}</span> <span className="text-doc-code text-muted-foreground">{product.code}</span></span>}
        </div>
        {product && candQ.isLoading && <p className="text-sm text-muted-foreground">加载在库容器…</p>}
        {product && cand && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>在库容器 <b className="tabular-nums text-foreground">{containers.length}</b> 个 · 待补齐 <b className="tabular-nums text-foreground">{totalRequired}</b> {product.unit || '件'}</span>
            {blockReason && <SoftStatusLabel label={blockReason} tone="danger" />}
          </div>
        )}
      </div>

      {/* 逐容器录入 */}
      {product && cand && !blockReason && containers.length > 0 && (
        <>
          <div className="space-y-3">
            {perContainer.map(c => {
              const over = c.entered > c.remainingQty
              const ok = c.entered === c.remainingQty
              return (
                <div key={c.containerId} className="card-base p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-doc-code font-medium">{c.barcode}</span>
                      <span className="text-muted-foreground">{c.warehouseName || '—'}{c.locationCode ? ` · ${c.locationCode}` : ''}</span>
                    </div>
                    <SoftStatusLabel label={`${c.entered} / ${c.remainingQty}`} tone={ok ? 'success' : over ? 'danger' : 'warning'} />
                  </div>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder={`录入/扫描该容器的 ${c.remainingQty} 个序列号，每行一个（也可空格/逗号分隔）`}
                    value={snText[c.containerId] ?? ''}
                    onChange={e => setSnText(prev => ({ ...prev, [c.containerId]: e.target.value }))}
                  />
                </div>
              )
            })}
          </div>

          <div className="card-base p-4 flex flex-wrap items-center justify-between gap-3 sticky bottom-4 shadow-sm">
            <div className="text-sm">
              合计已录入 <b className={cn('tabular-nums', totalEntered === totalRequired ? 'text-success' : 'text-warning')}>{totalEntered}</b>
              <span className="text-muted-foreground"> / {totalRequired}</span>
              {!allMatch && <span className="ml-2 text-helper">每个容器的序列号数须与容器数量一致才能提交</span>}
            </div>
            <Button disabled={!canSubmit} onClick={handleSubmit}>
              {importMut.isPending ? '导入中…' : '导入并开启序列号管理'}
            </Button>
          </div>
        </>
      )}

      <ProductFinderModal
        open={pickerOpen}
        onConfirm={(p: ProductFinderResult) => { setProduct({ id: p.id, code: p.code, name: p.name, unit: p.unit }); setSnText({}) }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}
