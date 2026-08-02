/**
 * PDA 收货 — 支持按产品逐箱录入并批量打印库存条码
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getInboundTaskByIdApi, receiveInboundApi } from '@/api/inbound-tasks'
import type { InboundTask } from '@/types/inbound-tasks'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaBottomBar from '@/components/pda/PdaBottomBar'
import PdaScanner from '@/components/pda/PdaScanner'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import { PdaLoading } from '@/components/pda/PdaEmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseBarcode } from '@/utils/barcode'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { useCriticalPdaAction } from '@/hooks/useCriticalPdaAction'

import PdaCriticalActionNotice from '@/components/pda/PdaCriticalActionNotice'
import PdaOverReceiveDialog, { type OverReceiveReasonCode } from '@/components/pda/PdaOverReceiveDialog'
import PdaSerialScanSheet from '@/components/pda/PdaSerialScanSheet'

interface ProductSummary {
  productId: number
  productCode: string | null
  productName: string
  unit: string | null
  orderedQty: number
  receivedQty: number
  remainingQty: number
  purchaseRefs: string[]
  /** 序列号管控：收货需逐台扫序列号（每箱 SN 数 == 箱数量） */
  serialManaged: boolean
  /** 多单位（文档03 Phase4b）：主辅助单位名 + 率，配了才有值。按箱快捷录入用，率由系统给定不可改 */
  boxUnit: string | null
  boxRate: number | null
}

/** 该商品「按箱收货」的每箱预填件数：仅当配了整数率 > 1 的辅助单位；否则空串（逐件录入） */
function boxFill(product: ProductSummary | null): string {
  const r = product?.boxRate
  return r && r > 1 && Number.isInteger(r) ? String(r) : ''
}

function groupProducts(task: InboundTask): ProductSummary[] {
  const map = new Map<number, ProductSummary>()
  for (const item of task.items ?? []) {
    const current = map.get(item.productId)
    const purchaseRef = item.purchaseOrderNo ?? '—'
    if (current) {
      current.orderedQty += item.orderedQty
      current.receivedQty += item.receivedQty
      current.remainingQty += Math.max(0, item.orderedQty - item.receivedQty)
      if (!current.purchaseRefs.includes(purchaseRef)) current.purchaseRefs.push(purchaseRef)
      continue
    }
    map.set(item.productId, {
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      unit: item.unit,
      orderedQty: item.orderedQty,
      receivedQty: item.receivedQty,
      remainingQty: Math.max(0, item.orderedQty - item.receivedQty),
      purchaseRefs: [purchaseRef],
      serialManaged: !!item.serialManaged,
      boxUnit: item.boxUnit ?? null,
      boxRate: item.boxRate ?? null,
    })
  }
  return [...map.values()]
}

// 中文环境小数点只会是"."，逗号在数量输入里只可能是千分位分隔符或误触，
// 不能当小数点处理——否则粘贴 "1,234" 会被解析成 1.234，数量差 1000 倍且不报错。
function parseQty(value: string): number {
  return Number(value.trim().replace(/,/g, ''))
}

function ProductCard({
  product,
  active,
  onClick,
}: {
  product: ProductSummary
  active: boolean
  onClick: () => void
}) {
  return (
    <PdaCard active={active} onClick={onClick} className="text-left">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{product.productName}</p>
            <p className="font-mono text-xs text-muted-foreground">{product.productCode ?? '—'}</p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${product.remainingQty > 0 ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-600'}`}>
            剩余 {product.remainingQty}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>应到 {product.orderedQty}</span>
          <span>已收 {product.receivedQty}</span>
        </div>
      </div>
    </PdaCard>
  )
}

function ReceiveEditor({
  product,
  boxes,
  submitting,
  onChangeBox,
  onAddBox,
  onRemoveBox,
  onReset,
  onSubmit,
}: {
  product: ProductSummary
  boxes: string[]
  submitting: boolean
  onChangeBox: (index: number, value: string) => void
  onAddBox: () => void
  onRemoveBox: (index: number) => void
  onReset: () => void
  onSubmit: () => void
}) {
  const parsedBoxes = boxes.map(parseQty).filter(qty => Number.isFinite(qty) && qty > 0)
  const totalQty = parsedBoxes.reduce((sum, qty) => sum + qty, 0)
  const remainingAfter = product.remainingQty - totalQty

  return (
    <PdaCard active className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-foreground">{product.productName}</p>
        <p className="font-mono text-xs text-muted-foreground mt-1">{product.productCode ?? '—'}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>应到 {product.orderedQty}</span>
          <span>已收 {product.receivedQty}</span>
          <span>剩余 {product.remainingQty}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">来源采购单：{product.purchaseRefs.join('、')}</p>
        {product.boxRate && product.boxRate > 1 && (
          <div className="mt-2 rounded-md bg-primary/5 px-2.5 py-1.5 text-xs text-primary">
            按{product.boxUnit}收货：1 {product.boxUnit} = {product.boxRate} {product.unit}；每箱已预填 {product.boxRate}，实收不足可改本箱件数（箱规由系统设定，现场不可改）
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">逐箱数量</p>
          <Button type="button" size="sm" variant="outline" onClick={onAddBox}>+ 增加一箱</Button>
        </div>

        <div className="space-y-2">
          {boxes.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="w-14 shrink-0 text-xs text-muted-foreground">箱 {index + 1}</div>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={value}
                onChange={e => onChangeBox(index, e.target.value)}
                placeholder="输入本箱数量"
                className="font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemoveBox(index)}
                disabled={boxes.length === 1}
              >
                删除
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 px-3 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">本次打印箱数</span>
          <span className="font-semibold text-foreground">{parsedBoxes.length}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">本次收货数量</span>
          <span className="font-semibold text-foreground">
            {totalQty}{product.unit ? ` ${product.unit}` : ''}
            {product.boxRate && product.boxRate > 1 && totalQty > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                （{totalQty % product.boxRate === 0 ? `${totalQty / product.boxRate} ${product.boxUnit}` : `≈${(totalQty / product.boxRate).toFixed(2)} ${product.boxUnit}`}）
              </span>
            )}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">提交后剩余</span>
          <span className={`font-semibold ${remainingAfter < 0 ? 'text-destructive' : 'text-foreground'}`}>{remainingAfter}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onReset} disabled={submitting}>
          清空箱数
        </Button>
        <Button type="button" className="flex-1" onClick={onSubmit} disabled={submitting}>
          {submitting ? '提交中...' : '打印并登记'}
        </Button>
      </div>
    </PdaCard>
  )
}

function ReceiveRunner({ task }: { task: InboundTask }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { flash, ok, err, warn } = usePdaFeedback()
  const products = useMemo(() => groupProducts(task), [task])
  const selectableProducts = useMemo(() => products.filter(product => product.remainingQty > 0), [products])
  const [selectedProductId, setSelectedProductId] = useState<number | null>(selectableProducts[0]?.productId ?? null)
  const [boxes, setBoxes] = useState<string[]>([boxFill(selectableProducts[0] ?? null)])
  const [submitting, setSubmitting] = useState(false)
  // 超收确认：后端闸门触发后弹独立确认框（带准确数量/金额，强制选原因码），
  // 确认后把这里暂存的这一次提交原样重发。不再用「再点一次同一个按钮」——
  // 员工戴着手套赶工连点两下是本能，那道闸门等于没有，而超收会随上架自动结算真的进应付。
  const [overReceivePrompt, setOverReceivePrompt] = useState<{
    product: ProductSummary
    boxes: Array<{ qty: number }>
    totalQty: number
    scannedBarcode?: string
    confirmDuplicate?: boolean
    serialNosByBox?: string[][]
    orderedQty: number
    receivedQty: number
    overQty: number
    overAmount: number | null
  } | null>(null)
  // 序列号采集面板：serial_managed 商品箱数量校验通过后弹此面板逐台扫 SN（每箱 SN 数==箱数量），
  // 扫满后切片成每箱 serialNos 再提交。lastSerialRef 暂存最近一次采集结果，供超收/重复扫码
  // 后端闸门触发时的重试复用——重试不该让员工把序列号重扫一遍。
  const [serialSheet, setSerialSheet] = useState<{
    product: ProductSummary
    boxes: Array<{ qty: number }>
    totalQty: number
    scannedBarcode?: string
    confirmDuplicate?: boolean
  } | null>(null)
  const lastSerialRef = useRef<{ productId: number; byBox: string[][] } | null>(null)
  // 重复扫码防护：后端在 30 秒时间窗里发现同商品、同箱数、同总量的重复提交会返回 409
  // DUPLICATE_SCAN_CONFIRM_REQUIRED，这里进入待确认状态，再点一次带 confirmDuplicate 放行。
  // 本地无法自行判断（前端每次提交都是新的 requestKey，看不到别人/上一次的提交），必须由后端发起。
  const [duplicateArmed, setDuplicateArmed] = useState<{ productId: number; qty: number } | null>(null)
  // 错货防护：扫码选中的商品视为已核对（记录原始扫码值供后端兜底比对）；
  // 手动点选的商品提交前给一次"未核对"警示（armed 二次点击放行，兼容商品无条码的场景）
  const [scanVerified, setScanVerified] = useState<{ productId: number; barcode: string } | null>(null)
  const [noScanArmed, setNoScanArmed] = useState<number | null>(null)
  // 批次/效期采集（选填折叠区）：批次管理商品后端强制校验，未填会明确报错引导补录
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [mfgDate, setMfgDate] = useState('')
  const [expDate, setExpDate] = useState('')
  const receiveAction = useCriticalPdaAction<{
    containers?: Array<{ containerId: number }>
    printJobIds?: number[]
    noPrinterCount?: number
  }>({
    action: `inbound.receive.${task.id}`,
    label: `收货单 ${task.taskNo}`,
    onConfirmed: async (data, ctx) => {
      await qc.invalidateQueries({ queryKey: ['pda-inbound-task', task.id] })
      await qc.invalidateQueries({ queryKey: ['pda-inbound-tasks'] })
      if (ctx.recovered) {
        // 断网重连后自动核实出来的成功，没有原始响应里的容器/打印数量，不编造具体数字
        ok('收货已确认成功，任务状态已更新。')
        return
      }
      const count = data.containers?.length ?? 0
      const printCount = data.printJobIds?.length ?? 0
      ok(`已生成 ${count} 个条码${printCount > 0 ? `，${printCount} 条已提交打印` : ''}`)
      if (data.noPrinterCount) {
        // 收货本身已成功记录，只是暂无可用打印机——不是失败，但要提醒现场后续记得补打
        warn(`${data.noPrinterCount} 个条码暂无打印机可用，收货已记录，请稍后到"查看打印/补打"里补打标签`)
      }
    },
    // 网络波动导致提交结果不明时，用"目标商品的已收数量是否已经涨到本次提交后
    // 应有的水平"来核实上一次收货请求是否其实已经生效，而不是让用户凭经验重试。
    resolveServerState: async ({ record }) => {
      const productId = Number(record.metadata?.productId ?? 0)
      const expectedReceivedQty = Number(record.metadata?.expectedReceivedQty ?? NaN)
      if (!productId || !Number.isFinite(expectedReceivedQty)) return { effective: false }
      const latest = await getInboundTaskByIdApi(task.id)
      const line = groupProducts(latest).find(p => p.productId === productId)
      if (!line || line.receivedQty < expectedReceivedQty) return { effective: false }
      return {
        effective: true,
        data: {},
        message: `收货已成功，${line.productName} 已收 ${line.receivedQty}。`,
      }
    },
  })

  const activeProduct = selectableProducts.find(product => product.productId === selectedProductId) ?? null

  function resetBoxes(defaultCount = 1, fill = '') {
    setBoxes(Array.from({ length: defaultCount }, () => fill))
  }

  function selectProduct(productId: number) {
    setSelectedProductId(productId)
    // 按箱收货：切到配了辅助单位的商品时，第一箱预填箱规（每箱件数），率由系统给定不可改（文档03 Phase4b）
    resetBoxes(1, boxFill(selectableProducts.find(x => x.productId === productId) ?? null))
    // 切换商品即重置核对状态（扫码选中路径会在 handleScan 里重新置位）与批次录入
    setScanVerified(null)
    setNoScanArmed(null)
    setBatchNo(''); setMfgDate(''); setExpDate(''); setBatchOpen(false)
  }

  function handleScan(raw: string) {
    const parsed = parseBarcode(raw)
    if (parsed.type !== 'product' && parsed.type !== 'unknown') {
      err('扫描产品条码')
      return
    }

    const normalized = raw.trim().toUpperCase()
    const match = selectableProducts.find(product =>
      normalized === String(product.productCode ?? '').toUpperCase()
      || parsed.id === product.productId,
    )
    if (!match) {
      err(`商品不在本收货单：${raw}`)
      return
    }

    selectProduct(match.productId)
    setScanVerified({ productId: match.productId, barcode: raw.trim() })
    ok(`已选中 ${match.productName}（已扫码核对）`)
  }

  function submitReceive() {
    if (!activeProduct) {
      err('请先扫描或选择商品')
      return
    }

    // 先按原始输入逐箱校验：非空但解析不出合法正数的，明确提示是哪一箱有问题，
    // 不要静默丢弃——否则用户会以为提交了 3 箱，实际只提交了 2 箱。
    const parsedBoxes = boxes.map((value, index) => ({ index, raw: value.trim(), qty: parseQty(value) }))
    const invalidBox = parsedBoxes.find(box => box.raw !== '' && (!Number.isFinite(box.qty) || box.qty <= 0))
    if (invalidBox) {
      err(`箱 ${invalidBox.index + 1} 数量无效：${invalidBox.raw}`)
      return
    }

    const normalizedBoxes = parsedBoxes.filter(box => Number.isFinite(box.qty) && box.qty > 0)
    if (normalizedBoxes.length === 0) {
      err('请至少填写一箱数量')
      return
    }

    const totalQty = normalizedBoxes.reduce((sum, box) => sum + box.qty, 0)
    const duplicateConfirmed = duplicateArmed?.productId === activeProduct.productId && duplicateArmed.qty === totalQty

    // 超收不再由前端预判：阈值（比例 OR 金额）只在后端维护一份，触发时返回
    // 409 OVER_RECEIVE_CONFIRM_REQUIRED，带着准确的数量与金额，前端据此弹确认框。
    // 以前前端也硬编码了一份 0.2 的比例判断，既算不出金额，又会和后端阈值悄悄漂移。
    const scanOk = scanVerified?.productId === activeProduct.productId
    // 错货防护：手动点选（未扫码核对）的商品，第一次提交给警示，再次点击放行
    if (!scanOk && noScanArmed !== activeProduct.productId) {
      setNoScanArmed(activeProduct.productId)
      warn('该商品未经扫码核对，建议扫描实物商品条码确认；确认实物无误可再次点击直接提交')
      return
    }
    if (totalQty < activeProduct.remainingQty) {
      warn(`当前只登记 ${totalQty}，提交后该商品还剩 ${activeProduct.remainingQty - totalQty}`)
    }

    // 序列号管控商品：箱数量校验通过后先弹面板逐台扫 SN（每箱 SN 数==箱数量），扫满才提交。
    // 已扫过（lastSerialRef 命中相同商品+箱型）直接复用——超收/重复扫码后端闸门触发时会二次
    // 进来，不该让员工把序列号重扫一遍。非管控商品完全旁路，行为不变。
    const cachedSerials = (() => {
      if (!activeProduct.serialManaged) return undefined
      const cached = lastSerialRef.current
      if (!cached || cached.productId !== activeProduct.productId) return undefined
      const boxQtys = normalizedBoxes.map(box => box.qty)
      if (cached.byBox.length !== boxQtys.length) return undefined
      if (!cached.byBox.every((sns, i) => sns.length === boxQtys[i])) return undefined
      return cached.byBox
    })()
    if (activeProduct.serialManaged && !cachedSerials) {
      setSerialSheet({
        product: activeProduct,
        boxes: normalizedBoxes.map(box => ({ qty: box.qty })),
        totalQty,
        scannedBarcode: scanOk ? scanVerified?.barcode : undefined,
        confirmDuplicate: duplicateConfirmed,
      })
      return
    }

    submitToServer({
      product: activeProduct,
      boxes: normalizedBoxes.map(box => ({ qty: box.qty })),
      totalQty,
      scannedBarcode: scanOk ? scanVerified?.barcode : undefined,
      confirmDuplicate: duplicateConfirmed,
      serialNosByBox: cachedSerials,
    })
  }

  /** 真正发请求的那一步。超收确认走弹窗回调再次进来，此时带上 confirmOverReceive + 原因码。 */
  function submitToServer(opts: {
    product: ProductSummary
    boxes: Array<{ qty: number }>
    totalQty: number
    scannedBarcode?: string
    confirmDuplicate?: boolean
    overReceiveReason?: OverReceiveReasonCode
    /** 序列号管控商品：每箱逐台扫入的序列号（下标与 boxes 对齐，长度==该箱 qty）；非管控商品省略 */
    serialNosByBox?: string[][]
  }) {
    const { product, boxes: pkgs, totalQty, scannedBarcode, confirmDuplicate, overReceiveReason, serialNosByBox } = opts
    setSubmitting(true)
    const expectedReceivedQty = product.receivedQty + totalQty
    void receiveAction.run(
      (requestKey) =>
        receiveInboundApi(task.id, {
          productId: product.productId,
          packages: pkgs.map((box, i) => (
            serialNosByBox ? { qty: box.qty, serialNos: serialNosByBox[i] ?? [] } : { qty: box.qty }
          )),
          confirmOverReceive: overReceiveReason ? true : undefined,
          overReceiveReason,
          confirmDuplicate: confirmDuplicate || undefined,
          scannedBarcode,
          batchNo: batchNo.trim() || undefined,
          mfgDate: mfgDate || undefined,
          expDate: expDate || undefined,
        }, requestKey).then((res) => res!),
      { productId: product.productId, expectedReceivedQty },
    ).then((result) => {
      setDuplicateArmed(null)
      setOverReceivePrompt(null)
      if (result.kind === 'success') {
        // 收货成功，丢弃序列号采集缓存
        lastSerialRef.current = null
        if ((product.remainingQty - totalQty) > 0) {
          resetBoxes(1, boxFill(product))   // 继续收同商品：预填箱规（文档03 Phase4b）
        } else {
          setSelectedProductId(null)
          resetBoxes(1)
        }
      } else {
        // 结果待确认：清空当前箱数输入，避免用户误以为这些箱子还没提交而重复填报
        resetBoxes(1)
        warn('网络中断，收货结果待确认。请先确认刚才那次是否成功，再决定是否重试。')
      }
    }).catch((error: unknown) => {
      const message = (error as { message?: string })?.message ?? '收货失败'
      const code = (error as { code?: string })?.code
      const data = (error as { data?: Record<string, unknown> })?.data
      // 服务端闸门不是失败，是要人确认一次。必须清掉 useCriticalPdaAction 的失败态，
      // 否则页面顶部挂着红色报错，员工会以为这次收货已经出错、不敢再点。
      if (code === 'OVER_RECEIVE_CONFIRM_REQUIRED') {
        receiveAction.clearError()
        // 用后端返回的准确数量与金额弹确认框，强制选原因码——不再是「再点一次同一个按钮」，
        // 那道闸门对戴手套赶工的员工形同虚设，而超收会随上架自动结算真的进应付。
        setOverReceivePrompt({
          product,
          boxes: pkgs,
          totalQty,
          scannedBarcode,
          confirmDuplicate,
          serialNosByBox,
          orderedQty: Number(data?.orderedQty ?? product.orderedQty),
          receivedQty: Number(data?.receivedQty ?? product.receivedQty),
          overQty: Number(data?.overQty ?? 0),
          overAmount: data?.overAmount != null ? Number(data.overAmount) : null,
        })
        return
      }
      if (code === 'DUPLICATE_SCAN_CONFIRM_REQUIRED') {
        receiveAction.clearError()
        setDuplicateArmed({ productId: product.productId, qty: totalQty })
        warn(`${message}——再次点击"打印并登记"确认提交`)
        return
      }
      setDuplicateArmed(null)
      setOverReceivePrompt(null)
      err(message)
    }).finally(() => {
      setSubmitting(false)
    })
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader
        title={task.taskNo}
        subtitle={task.supplierName ?? undefined}
        backLabel="← 收货订单"
        onBack={() => navigate('/pda/inbound')}
        right={<span className="text-xs text-muted-foreground">收货</span>}
      />
      <PdaFlash flash={flash} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md mx-auto w-full space-y-4">
        <PdaCriticalActionNotice
          blockedReason={receiveAction.blockedReason}
          pendingRecord={receiveAction.pendingRecord}
          confirming={receiveAction.confirming}
          phase={receiveAction.phase}
          phaseMessage={receiveAction.phaseMessage}
          lastErrorMessage={receiveAction.lastErrorMessage}
          onConfirm={() => {
            void receiveAction.confirmPending().then((status) => {
              if (!status) return
              if (status.status === 'pending') warn(status.message || '服务端仍未确认结果，请稍后再查或刷新页面校验')
              if (status.status === 'state_unconfirmed') warn(status.message)
              if (status.status === 'not_found') warn(status.message || '服务端未找到该次收货记录；请检查明细后再手动重试')
              if (status.status === 'failed') err(status.message || '上次收货未成功，请检查后重试')
            })
          }}
          onClear={() => receiveAction.clearPending()}
          onDismissError={() => receiveAction.clearError()}
        />
        <PdaCard>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">仓库：{task.warehouseName ?? '—'}</p>
            <p className="text-muted-foreground">关联采购：{task.purchaseOrderNo ?? '混合采购单'}</p>
            <p className="text-muted-foreground">收货状态：{task.receiptStatus?.label ?? task.statusName}</p>
            <p className="text-muted-foreground">打印 {task.printStatus?.label ?? '—'} · 上架 {task.putawayStatus?.label ?? '—'}</p>
          </div>
        </PdaCard>

        <PdaCard>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">已打印</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{task.printSummary?.success ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">待上架</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{task.putawaySummary?.waitingContainers ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">已上架</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{task.putawaySummary?.storedContainers ?? 0}</p>
            </div>
          </div>
        </PdaCard>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">待收商品</p>
            <span className="text-xs text-muted-foreground">{selectableProducts.length} 个待收 SKU</span>
          </div>
          <div className="space-y-2">
            {products.map(product => (
              <ProductCard
                key={product.productId}
                product={product}
                active={product.productId === selectedProductId}
                onClick={() => {
                  if (product.remainingQty <= 0) {
                    warn(`${product.productName} 已收货完成`)
                    return
                  }
                  selectProduct(product.productId)
                }}
              />
            ))}
          </div>
        </div>

        {activeProduct && (
          <PdaCard>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setBatchOpen(o => !o)}>
              {batchOpen ? '▲ 收起批次/效期' : '▼ 批次/效期（批次管理商品必填）'}
            </button>
            {batchOpen && (
              <div className="mt-2 grid grid-cols-1 gap-2">
                <input className="h-10 rounded-md border border-border bg-background px-3 text-sm" placeholder="批次号"
                  value={batchNo} onChange={e => setBatchNo(e.target.value)} maxLength={50} />
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">生产日期</span>
                  <input type="date" className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                    value={mfgDate} onChange={e => setMfgDate(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">效期至</span>
                  <input type="date" className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
                    value={expDate} onChange={e => setExpDate(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">商品维护了保质期天数时，只填生产日期即可自动算效期</p>
              </div>
            )}
          </PdaCard>
        )}

        {activeProduct ? (
          <ReceiveEditor
            product={activeProduct}
            boxes={boxes}
            submitting={submitting || receiveAction.submitBlocked}
            onChangeBox={(index, value) => {
              setBoxes(prev => prev.map((item, idx) => idx === index ? value : item))
            }}
            onAddBox={() => setBoxes(prev => [...prev, boxFill(activeProduct)])}
            onRemoveBox={(index) => {
              setBoxes(prev => prev.filter((_, idx) => idx !== index))
            }}
            onReset={() => resetBoxes(1, boxFill(activeProduct))}
            onSubmit={submitReceive}
          />
        ) : (
          <PdaCard>
            <p className="text-sm text-muted-foreground">扫描产品条码</p>
          </PdaCard>
        )}
      </div>

      <PdaBottomBar>
        <PdaScanner
          onScan={handleScan}
          placeholder="扫描产品条码"
          disabled={submitting || receiveAction.submitBlocked || !!serialSheet}
        />
      </PdaBottomBar>

      {overReceivePrompt && (
        <PdaOverReceiveDialog
          productName={overReceivePrompt.product.productName}
          unit={overReceivePrompt.product.unit ?? ''}
          orderedQty={overReceivePrompt.orderedQty}
          receivedQty={overReceivePrompt.receivedQty}
          thisQty={overReceivePrompt.totalQty}
          overQty={overReceivePrompt.overQty}
          overAmount={overReceivePrompt.overAmount}
          onCancel={() => {
            setOverReceivePrompt(null)
            warn('已取消本次超收登记，请核对实物数量后重新录入')
          }}
          onConfirm={(reason) => {
            const pending = overReceivePrompt
            setOverReceivePrompt(null)
            submitToServer({
              product: pending.product,
              boxes: pending.boxes,
              totalQty: pending.totalQty,
              scannedBarcode: pending.scannedBarcode,
              confirmDuplicate: pending.confirmDuplicate,
              serialNosByBox: pending.serialNosByBox,
              overReceiveReason: reason,
            })
          }}
        />
      )}

      {serialSheet && (
        <PdaSerialScanSheet
          title={`逐台扫序列号 · ${serialSheet.product.productName}`}
          subtitle={`共 ${serialSheet.totalQty} 台，按箱逐台扫描`}
          groups={serialSheet.boxes.map((box, i) => ({
            key: String(i),
            label: `箱 ${i + 1}`,
            requiredQty: box.qty,
          }))}
          submitting={submitting || receiveAction.submitBlocked}
          confirmLabel="登记并打印"
          onCancel={() => setSerialSheet(null)}
          onConfirm={(map) => {
            const pending = serialSheet
            setSerialSheet(null)
            const byBox = pending.boxes.map((_, i) => map[String(i)] ?? [])
            lastSerialRef.current = { productId: pending.product.productId, byBox }
            submitToServer({ ...pending, serialNosByBox: byBox })
          }}
        />
      )}
    </div>
  )
}

export default function PdaReceivePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id) || 0

  const { data: task, isLoading } = useQuery({
    queryKey: ['pda-inbound-task', taskId],
    queryFn: () => getInboundTaskByIdApi(taskId),
    enabled: taskId > 0,
  })

  if (!taskId) {
    return (
      <div className="min-h-screen bg-background p-6 text-center text-muted-foreground">
        无效任务
        <button type="button" className="mt-4 block mx-auto text-primary" onClick={() => navigate('/pda/inbound')}>返回</button>
      </div>
    )
  }

  if (isLoading || !task) {
    return (
      <div className="min-h-screen bg-background">
        <PdaHeader title="收货" onBack={() => navigate('/pda/inbound')} />
        <PdaLoading className="h-40 mt-8" />
      </div>
    )
  }

  if (!task.submittedAt) {
    return (
      <div className="min-h-screen bg-background p-6 text-center space-y-3">
        <p className="text-muted-foreground">该收货订单尚未提交，请先在 ERP 中提交后再收货。</p>
        <button type="button" className="text-primary font-medium" onClick={() => navigate('/pda/inbound')}>返回列表</button>
      </div>
    )
  }

  if (task.putawayStatus?.key === 'waiting' || task.putawayStatus?.key === 'putting_away' || task.status >= 3) {
    return (
      <div className="min-h-screen bg-background p-6 text-center space-y-3">
        <p className="text-muted-foreground">收货已完成，该订单已进入上架阶段。</p>
        <button type="button" className="text-primary font-medium" onClick={() => navigate('/pda/inbound')}>返回列表</button>
      </div>
    )
  }

  return <ReceiveRunner task={task} />
}
