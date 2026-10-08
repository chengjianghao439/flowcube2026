import { useCallback, useEffect, useRef, useState } from 'react'
import { payloadClient } from '@/api/client'
import { commercialReadConfig } from '@/api/sale-commercial'
import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from '@/hooks/useKits'
import type { CustomerAddressGuard } from '@/hooks/useCustomerAddresses'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import type { KitDefinition } from '@/types/kits'
import type { Product, ProductFinderResult } from '@/types/products'
import type { PaginatedData } from '@/types'
import { AppDialog } from '@/components/shared/AppDialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { CommercialDraftRow } from './commercialDraft'
interface SelectableKit extends KitDefinition {
  selectable: boolean
  disabledReasons: { message: string }[]
  standaloneCompleteSetsByCurrentStock: number
}
export default function CommercialPicker({
  kind,
  warehouseId,
  owner,
  readGuard,
  onSelect,
  onClose
}: {
  kind: 'kit' | 'ordinary'
  warehouseId: number
  owner: KitReadOwner
  readGuard?: CustomerAddressGuard
  onSelect: (row: CommercialDraftRow) => void
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [result, setResult] = useState<PaginatedData<SelectableKit | ProductFinderResult> | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const active = useSectionActive()
  const currentGuard = useRef(readGuard)
  currentGuard.current = readGuard
  const visible = active && (!readGuard || readGuard.isCurrent())
  const activity = useRef({ visible, epoch: readGuard?.epoch, kind, warehouseId, owner, page, search, generation: 0 })
  if (activity.current.visible !== visible || activity.current.epoch !== readGuard?.epoch ||
    activity.current.kind !== kind || activity.current.warehouseId !== warehouseId || activity.current.owner !== owner ||
    activity.current.page !== page || activity.current.search !== search) {
    activity.current = { visible, epoch: readGuard?.epoch, kind, warehouseId, owner, page, search, generation: activity.current.generation + 1 }
  }
  const generation = activity.current.generation
  const isCurrent = useCallback(() => activity.current.visible && activity.current.generation === generation &&
    (!currentGuard.current || currentGuard.current.isCurrent()), [generation])
  const selection = useRef<{ generation: number; controller: AbortController } | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    setResult(null)
    setError('')
    if (!isCurrent()) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      try {
        assertKitReadOwner(owner)
        const data = await payloadClient.get<PaginatedData<SelectableKit | ProductFinderResult>>(
          kind === 'kit' ? '/kits/finder' : '/products/finder',
          {
            ...commercialReadConfig(owner),
            signal: abort.signal,
            params: { page, pageSize: 20, keyword: search, warehouseId },
            listMode: 'paged'
          }
        )
        assertKitReadOwner(owner)
        if (!abort.signal.aborted && isCurrent()) setResult(data)
      } catch (e) {
        if (!abort.signal.aborted && isCurrent()) setError(e instanceof Error ? e.message : '读取失败')
      } finally {
        if (!abort.signal.aborted && isCurrent()) setLoading(false)
      }
    })()
    return () => {
      abort.abort()
      if (selection.current?.generation === generation) selection.current.controller.abort()
    }
  }, [generation, isCurrent, kind, owner, page, search, warehouseId])
  async function choose(item: SelectableKit | ProductFinderResult) {
    if (!isCurrent() || loading || selection.current?.generation === generation) return
    try {
      assertKitReadOwner(owner)
      const lineKey = crypto.randomUUID()
      if ('version' in item) {
        if (!item.selectable || !item.version) return
        onSelect({
          input: {
            kind: 'kit',
            lineKey,
            warehouseId,
            kitVersionId: item.currentVersionId,
            quantity: 1,
            priceSource: 'kit_default'
          },
          name: item.name,
          code: item.code,
          spec: item.spec, color: item.color, articleNumber: item.articleNumber, costPrice: item.costPrice,
          unit: item.unit || '套',
          quantity: '1',
          price: String(item.version.referenceUnitPrice),
          units: [],
          packagingExpressible: true
        })
      } else {
        const controller = new AbortController()
        selection.current = { generation, controller }
        setLoading(true)
        const product = await payloadClient.get<Product>(`/products/${item.id}`, { ...commercialReadConfig(owner), signal: controller.signal })
        assertKitReadOwner(owner)
        if (!isCurrent() || controller.signal.aborted) return
        onSelect({
          input: {
            kind: 'ordinary',
            lineKey,
            warehouseId,
            productId: item.id,
            entryUnit: item.unit,
            quantity: 1,
            priceSource: 'default'
          },
          name: item.name,
          code: item.code,
          spec: product.spec, color: product.color, articleNumber: product.articleNumber, costPrice: product.costPrice,
          unit: item.unit,
          quantity: '1',
          price: '',
          units: product.units ?? [],
          baseUnit: product.unit,
          allowDecimalQty: product.allowDecimalQty,
          packagingExpressible: true
        })
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : '选择失败')
    } finally {
      if (isCurrent()) { selection.current = null; setLoading(false) }
    }
  }
  return (
    <AppDialog
      open={visible}
      dialogId={`sale-commercial-picker-${kind}`}
      title={kind === 'kit' ? '选择成套配件' : '选择普通商品'}
      defaultWidth={900}
      defaultHeight={620}
      onOpenChange={(open) => {
        if (!open && !loading && isCurrent()) onClose()
      }}
    >
      <div className="space-y-3 overflow-auto p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!isCurrent()) return
            setPage(1)
            setSearch(keyword)
          }}
        >
          <Input
            aria-label="搜索成交商品"
            value={keyword}
            maxLength={100}
            onChange={(e) => { if (isCurrent()) setKeyword(e.target.value) }}
          />
          <Button type="submit" variant="outline">
            查询
          </Button>
        </form>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">读取中…</p>}
        <p className="text-xs text-muted-foreground">单套现货只供参考；共享组件按整单预览核对，不能相加或保证可拣。{kind === 'kit' && '选择后按客户等级核对成交价。'}</p>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">编码 / 名称</th>
              <th className="text-left">报价与现货参考</th>
              <th>选择</th>
            </tr>
          </thead>
          <tbody>
            {result?.list.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="py-3">
                  {item.code} · {item.name}
                </td>
                <td>
                  {'version' in item ? (
                    <>
                      价格 A 参考：{item.version?.referenceUnitPrice.toFixed(4)}/{item.unit || '套'} · 独立参考{' '}
                      {item.standaloneCompleteSetsByCurrentStock} {item.unit || '套'}
                      {!item.selectable && (
                        <p className="text-destructive-ink">{item.disabledReasons.map((r) => r.message).join('；')}</p>
                      )}
                    </>
                  ) : (
                    '按当前客户价格，辅助单位沿原换算'
                  )}
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading || ('version' in item && !item.selectable)}
                    onClick={() => void choose(item)}
                  >
                    选择
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={loading || page <= 1} onClick={() => { if (isCurrent()) setPage(page - 1) }}>
            上一页
          </Button>
          <Button
            variant="outline"
            disabled={loading || !result || page * 20 >= result.pagination.total}
            onClick={() => { if (isCurrent()) setPage(page + 1) }}
          >
            下一页
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}
