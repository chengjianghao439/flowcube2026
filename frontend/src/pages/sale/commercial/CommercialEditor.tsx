import { commercialWarehouseName } from './warehouseName'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SaleOrder } from '@/types/sale'
import type { CommercialBody } from '@/types/sale-commercial'
import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner, useKitBackup } from '@/hooks/useKits'
import { useCommercialPreview, useCommercialWrite, readCommercialSaleOwned } from '@/hooks/useCommercialSale'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { CustomerFinder } from '@/components/finder'
import { SaleOrderHeaderFields } from '../form/components/SaleOrderHeaderFields'
import { useSaleOrderForm } from '../form/useSaleOrderForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ActionBar } from '@/components/shared/ActionBar'
import { SectionCard } from '@/components/shared/SectionCard'
import { money } from '@/lib/format'
import { toast } from '@/lib/toast'
import CommercialPicker from './CommercialPicker'
import { draftFromGroups, toCommercialInputs, type CommercialDraftRow } from './commercialDraft'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
export default function CommercialEditor({
  order,
  owner,
  tabPath,
  adjust = false,
  onDone,
  onReload
}: {
  order?: SaleOrder
  owner: KitReadOwner
  tabPath: string
  adjust?: boolean
  onDone: (id?: number) => void
  onReload?: (order: SaleOrder) => void
}) {
  // Header reuse without entering the legacy physical item initialization/pricing path.
  const headerOrder = useMemo(() => (order ? { ...order, items: [] } : undefined), [order])
  const h = useSaleOrderForm('', headerOrder, owner)
  const [rows, setRows] = useState<CommercialDraftRow[]>(() => draftFromGroups(order?.commercialGroups ?? [])),
    [picker, setPicker] = useState<'kit' | 'ordinary' | null>(null),
    [error, setError] = useState(''),
    [reloading, setReloading] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false)
  const write = useCommercialWrite(owner, `commercial-editor:${buildWorkspaceTabRegistrationFromPath(tabPath).key}`),
    { can } = usePermission()
  let ownerCurrent = true
  try {
    assertKitReadOwner(owner)
  } catch {
    ownerCurrent = false
  }
  const locked = write.blocked || reloading || !ownerCurrent
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A guard covers the entire commercial draft, including original operation identity on unknown results.
  const snapshot = JSON.stringify({
    owner,
    baseline: order,
    customerId: h.customerId,
    warehouseId: h.warehouseId,
    remark: h.remark,
    carrierId: h.carrierId,
    shippingProduct: h.shippingProduct,
    freightType: h.freightType,
    receiverName: h.receiverName,
    receiverPhone: h.receiverPhone,
    receiverAddress: h.receiverAddress,
    discountAmount: h.discountAmount,
    rows
  })
  const original = useRef(snapshot),
    current = useRef(snapshot)
  current.current = snapshot
  useDirtyGuard(tabPath, snapshot !== original.current || !!write.pending || write.busy)
  const backup = useKitBackup(snapshot, owner)
  const bodyResult = useMemo((): { body: CommercialBody | null; error?: string } => {
    try {
      if (!h.customerId || !h.warehouseId) return { body: null, error: '请选择客户和出库仓库' }
      if (h.receiverPhone && !/^[0-9+()\-\s]{3,30}$/.test(h.receiverPhone)) throw new Error('联系电话格式不正确')
      const discountAmount = Number(h.discountAmount || 0)
      if (!Number.isFinite(discountAmount) || discountAmount < 0) throw new Error('折扣金额须为非负数')
      const commercialGroups = toCommercialInputs(rows).map((g) => (order ? g : { ...g, warehouseId: +h.warehouseId }))
      return {
        body: {
          commercialModel: 'kit-v1',
          ...(order ? { expectedRevision: order.commercialRevision! } : {}),
          customerId: +h.customerId,
          customerName: h.customerName,
          warehouseId: +h.warehouseId,
          warehouseName: h.warehouseName,
          discountAmount,
          commercialGroups,
          remark: h.remark || undefined,
          carrierId: h.carrierId ? +h.carrierId : null,
          shippingProduct: h.shippingProduct || null,
          freightType: h.freightType ? +h.freightType : null,
          receiverName: h.receiverName || undefined,
          receiverPhone: h.receiverPhone || undefined,
          receiverAddress: h.receiverAddress || undefined
        }
      }
    } catch (e) {
      return { body: null, error: e instanceof Error ? e.message : '请核对输入' }
    }
  }, [
    h.customerId,
    h.customerName,
    h.warehouseId,
    h.warehouseName,
    h.discountAmount,
    h.remark,
    h.carrierId,
    h.shippingProduct,
    h.freightType,
    h.receiverName,
    h.receiverPhone,
    h.receiverAddress,
    order,
    rows
  ])
  const preview = useCommercialPreview(bodyResult.body, owner, order?.id)
  const priceRequired = preview.data?.commercialGroups.some((g) => !(g.unitPrice > 0))
  const valid =
    !!preview.data &&
    !preview.loading &&
    !preview.error &&
    !priceRequired &&
    Number(h.discountAmount || 0) <= preview.data.amount
  function update(key: string, patch: Partial<CommercialDraftRow>) {
    if (!locked) setRows((old) => old.map((r) => (r.input.lineKey === key ? { ...r, ...patch } : r)))
  }
  async function save() {
    if (!valid || !bodyResult.body || locked) return
    try {
      assertKitReadOwner(owner)
      const answer = await write.submit({
        action: order ? (adjust ? 'adjust' : 'update') : 'create',
        id: order?.id,
        body: bodyResult.body
      })
      if (answer && write.canApplyConfirmation(answer)) {
        toast.success(
          answer.result?.pending ? '改单已提交，等待仓库确认；预占与派发以原单最新事实为准' : '销售单已保存'
        )
        onDone(answer.result?.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }
  async function reload() {
    if (!order || !backup.canReload() || locked) return
    const before = current.current
    setReloading(true)
    try {
      const latest = await readCommercialSaleOwned(order.id, owner)
      if (!mounted.current || current.current !== before || !backup.canReload()) return
      assertKitReadOwner(owner)
      backup.invalidate()
      onReload?.(latest)
    } catch (e) {
      setError(e instanceof Error ? e.message : '重读失败，当前草稿保留')
    } finally {
      setReloading(false)
    }
  }
  const permission = order ? PERMISSIONS.SALE_ORDER_UPDATE : PERMISSIONS.SALE_ORDER_CREATE
  return (
    <div className="space-y-3">
      <ActionBar
        title={order ? `${order.orderNo} · ${adjust ? '修改订单' : '编辑订单'}` : '新建套销售'}
        rightActions={
          <>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                if (snapshot !== original.current) setDiscardOpen(true)
                else onDone()
              }}
            >
              返回订单
            </Button>
            {can(permission) && (
              <Button disabled={locked || !valid} onClick={() => void save()}>
                保存草稿
              </Button>
            )}
          </>
        }
      />
      <p className="text-sm text-muted-foreground">
        固定组成按完整套安排发货；普通商品保留独立成交行。套主无库存，仓库按真实组件作业。原套组成和成交价不变、数量不超过当前目标时才可保留；改价或组成需重新核对当前启用版本。
      </p>
      {(error || write.error || preview.error || bodyResult.error || backup.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || write.error || preview.error || bodyResult.error || backup.error}
        </p>
      )}
      {write.pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p>原请求结果待确认，离开或刷新不会自动重新提交。刷新后仅保留查询身份，不保存表单内容。</p>
          <Button disabled={write.busy} onClick={() => void write.queryOriginal().then(answer => {
            if (answer?.queryOnly) toast.success('原操作结果已核实，请自行打开原单；当前草稿未修改')
            else if (answer && write.canApplyConfirmation(answer)) onDone(answer.result?.id)
          })}>查询原操作结果</Button>
          <Button
            disabled={write.busy || !write.canRetry}
            onClick={() =>
              void write.retry().then((answer) => {
                if (answer && write.canApplyConfirmation(answer)) onDone(answer.result?.id)
              })
            }
          >
            按原请求重试
          </Button>
        </div>
      )}
      {write.conflict && !write.pending && (
        <div className="space-y-2">
          <p>订单或套版本已变化。草稿未覆盖；先复制，再显式重读核对，不能自动合并。</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void backup.copy(snapshot)}>
              复制草稿内容
            </Button>
            {order && (
              <Button variant="outline" disabled={!backup.copied || locked} onClick={() => void reload()}>
                重读最新订单
              </Button>
            )}
          </div>
          {backup.text && (
            <>
              <textarea
                aria-label="完整草稿备份"
                readOnly
                value={backup.text}
                className="w-full rounded border p-2 text-xs"
              />
              <Button variant="outline" onClick={() => backup.acknowledge(backup.text)}>
                已备份草稿
              </Button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={locked} className="min-w-0 space-y-3">
        <SaleOrderHeaderFields
          readOwner={owner}
          {...h}
          headerReadOnly={adjust || locked}
          shippingProductDisabled={adjust || locked}
        />
        <SectionCard title="成交明细" compact>
          <div className="flex gap-2 p-3">
            <Button
              variant="outline"
              disabled={!h.warehouseId || !can(PERMISSIONS.PRODUCT_VIEW)}
              onClick={() => setPicker('kit')}
            >
              添加成套配件
            </Button>
            <Button
              variant="outline"
              disabled={!h.warehouseId || !can(PERMISSIONS.PRODUCT_VIEW)}
              onClick={() => setPicker('ordinary')}
            >
              添加普通商品
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-2 text-left">编码 / 名称与依据</th>
                  <th>数量</th>
                  <th>单位</th>
                  <th>成交单价</th>
                  <th>来源</th>
                  <th>金额</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const resolved = preview.data?.commercialGroups.find((g) => g.lineKey === row.input.lineKey)
                  const integerQuantity =
                    row.input.kind === 'kit' || (row.allowDecimalQty === false && row.unit === row.baseUnit)
                  return (
                    <tr key={row.input.lineKey} className="border-t align-top">
                      <td className="p-3">
                        <p>
                          {row.code} · {row.name}
                        </p>
                        {row.input.kind === 'kit' ? (
                          <p className="text-xs text-muted-foreground">
                            {row.saved ? '原订单套组成' : '所选套组成 · 已选报价版本'} ·{' '}
                            {order && row.input.warehouseId
                              ? commercialWarehouseName(order, row.input.warehouseId)
                              : h.warehouseName || '待选仓库'}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {row.input.priceSource === 'manual'
                              ? `人工确认${row.unit}单价；更改单位后请核对成交价`
                              : resolved?.metadata.quote
                                ? `${resolved.metadata.quote.resolvedPriceSource === 'price_list' ? '客户价目表' : `客户${resolved.metadata.quote.resolvedPriceLevel}价`} · 按系统换算`
                                : '按当前客户默认价，等待系统核对'}
                          </p>
                        )}
                        {row.saved &&
                          row.input.kind === 'ordinary' &&
                          row.unit === row.baseUnit &&
                          row.allowDecimalQty === undefined && (
                            <p className="text-xs text-muted-foreground">
                              基本量是否支持小数尚未核对，保存时由系统检查。
                            </p>
                          )}
                        {row.saved && (
                          <p className="text-xs text-muted-foreground">
                            原目标 {row.saved.originalQty} · 原金额 {money(row.saved.originalAmount)}；当前目标{' '}
                            {row.saved.targetQty}
                          </p>
                        )}
                        {row.input.kind === 'kit' && (
                          <details className="mt-1 text-xs">
                            <summary>展开真实组件（只读）</summary>
                            {(resolved ?? row.saved)?.components.map((c) => (
                              <p key={c.productId}>
                                {c.productCode} {c.productName} · 每套 {c.baseQty}
                                {c.unit}
                              </p>
                            ))}
                          </details>
                        )}
                        {!row.packagingExpressible && (
                          <p className="text-destructive">
                            当前 {row.saved?.targetQty}
                            {row.saved?.components[0]?.unit}{' '}
                            无法按原包装精度表达；不能按原包装填写，保留原包装成交依据。
                          </p>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          quantity
                          aria-label={`${row.name}数量`}
                          type="number"
                          step={integerQuantity ? 1 : 0.01}
                          min={integerQuantity ? 1 : 0.01}
                          value={row.quantity}
                          disabled={!row.packagingExpressible}
                          onChange={(e) => update(row.input.lineKey, { quantity: e.target.value })}
                          className="w-28"
                        />
                      </td>
                      <td className="p-2">
                        {row.input.kind === 'ordinary' && row.units.length ? (
                          <select
                            aria-label={`${row.name}录入单位`}
                            value={row.unit}
                            className="h-9 rounded border bg-background px-2"
                            onChange={(e) =>
                              update(row.input.lineKey, {
                                unit: e.target.value,
                                input: { ...row.input, entryUnit: e.target.value } as CommercialDraftRow['input']
                              })
                            }
                          >
                            {[
                              ...new Set([
                                row.unit,
                                ...(row.baseUnit ? [row.baseUnit] : []),
                                ...row.units.map((u) => u.unitName)
                              ])
                            ].map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        ) : (
                          row.unit
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          aria-label={`${row.name}成交单价`}
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          value={
                            row.input.priceSource === 'manual'
                              ? row.price
                              : resolved
                                ? String(
                                    row.input.kind === 'kit'
                                      ? resolved.unitPrice
                                      : (resolved.metadata.entry?.entryUnitPrice ?? resolved.unitPrice)
                                  )
                                : row.price
                          }
                          onChange={(e) =>
                            update(row.input.lineKey, {
                              price: e.target.value,
                              input: { ...row.input, priceSource: 'manual' }
                            })
                          }
                          className="w-32"
                        />
                      </td>
                      <td className="p-2">
                        {row.input.priceSource === 'manual'
                          ? '人工确认'
                          : row.input.kind === 'kit'
                            ? '套默认报价'
                            : '客户默认价'}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            update(row.input.lineKey, {
                              input:
                                row.input.kind === 'kit'
                                  ? { ...row.input, priceSource: 'kit_default', unitPrice: undefined }
                                  : { ...row.input, priceSource: 'default', unitPrice: undefined }
                            })
                          }
                        >
                          用默认价
                        </Button>
                      </td>
                      <td className="p-2 text-right tabular-nums">{resolved ? money(resolved.amount) : '待预览'}</td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRows((old) => old.filter((r) => r.input.lineKey !== row.input.lineKey))}
                        >
                          移除
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <SectionCard title="订单汇总" compact>
          <div className="flex flex-wrap items-center gap-6 p-3">
            <p>商品金额 {preview.data ? money(preview.data.amount) : '待系统预览'}</p>
            <label className="flex items-center gap-2">
              折扣金额
              <Input
                aria-label="折扣金额"
                type="number"
                min="0"
                step="0.01"
                value={h.discountAmount}
                onChange={(e) => h.setDiscountAmount(e.target.value)}
                className="w-32"
              />
            </label>
          </div>
        </SectionCard>
      </fieldset>
      {priceRequired && (
        <p role="alert" className="text-destructive">
          默认报价为零，请填写大于零的正式成交价后保存。
        </p>
      )}
      {preview.loading && <p role="status">正在核对整单组件需求与成交金额…</p>}
      {preview.data && (
        <SectionCard title="整单供货预览" compact>
          <div className="space-y-2 p-3 text-sm">
            <p>
              {preview.data.canFulfillEntireVector
                ? '当前现货满足整单需求'
                : '当前现货存在短缺，仍可保存合法缺货单；派发须另核完整套及预占'}
            </p>
            <p>
              {preview.data.inventoryExplanation
                .replaceAll(/来自 ACTIVE 容器/g, '来自有效库存条码')
                .replaceAll('整个物理向量', '整单配件需求')}
            </p>
            <p>预计供货与成套日期尚未分配；{preview.data.readyDateExplanation}</p>
            {preview.data.physicalItems.map((p) => (
              <p key={`${p.productId}:${p.warehouseId}`}>
                {p.productCode} {p.productName} ·{' '}
                {order
                  ? commercialWarehouseName(order, p.warehouseId)
                  : p.warehouseId === +h.warehouseId && h.warehouseName
                    ? h.warehouseName
                    : `仓库 #${p.warehouseId}`}{' '}
                · 总需求 {p.quantity}
                {p.unit} · 可用 {p.inventory.available} · 短缺 {p.inventory.shortage}
              </p>
            ))}
          </div>
        </SectionCard>
      )}
      {h.customerFinderOpen && !locked && (
        <CustomerFinder
          readOwner={owner}
          open
          onClose={() => h.setCustomerFinderOpen(false)}
          onConfirm={(customer) => {
            try {
              assertKitReadOwner(owner)
              h.setCustomerId(String(customer.id))
              h.setCustomerName(customer.name)
              h.setCustomerFinderOpen(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : '来源已变化')
            }
          }}
        />
      )}
      {picker && !locked && (
        <CommercialPicker
          kind={picker}
          warehouseId={+h.warehouseId}
          owner={owner}
          onClose={() => setPicker(null)}
          onSelect={(row) => {
            setRows((old) => [...old, row])
            setPicker(null)
          }}
        />
      )}
      <ConfirmDialog
        open={discardOpen}
        title="放弃当前草稿"
        description="当前修改尚未保存。返回后这些输入会丢失，请确认是否放弃。"
        confirmText="放弃并返回"
        cancelText="继续编辑"
        loading={locked}
        onCancel={() => {
          if (!locked) setDiscardOpen(false)
        }}
        onConfirm={() => {
          if (!locked) {
            setDiscardOpen(false)
            onDone()
          }
        }}
      />
    </div>
  )
}
