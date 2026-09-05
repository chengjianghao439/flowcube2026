import { ProductIdentityDetails } from '@/components/shared/ProductIdentityCells'
/**
 * ContainerDrawer — 库存条码可视化侧滑面板
 *
 * 从库存总览行点击「查看条码」触发，右侧弹出 640px 面板。
 * 仅展示数据，不允许修改容器。点击单条条码可展开其流转时间线（追溯）。
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Package2, Box, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { useInventoryContainers } from '@/hooks/useInventory'
import { getContainerLogsApi } from '@/api/inventory'
import type { InventoryOverviewItem } from '@/types/inventory'
import { formatDisplayDateTime } from '@/lib/dateTime'

interface ContainerDrawerProps {
  open:    boolean
  onClose: () => void
  item:    InventoryOverviewItem | null
}

export default function ContainerDrawer({ open, onClose, item }: ContainerDrawerProps) {
  const { data: containers, isLoading } = useInventoryContainers(
    item?.productId ?? null,
    item?.warehouseId ?? null,
  )
  const [onlyIndividual, setOnlyIndividual] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const visible = (containers ?? []).filter(c => !onlyIndividual || c.individual)
  const individualCount = (containers ?? []).filter(c => c.individual).length

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      {/* 覆盖 SheetContent 的默认宽度 */}
      <SheetContent
        side="right"
        className="flex w-[640px] max-w-[640px] flex-col gap-0 p-0 sm:max-w-[640px]"
      >
        {/* ── 顶部信息区 ───────────────────────────────────────────────── */}
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Box className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="break-words text-base">
                {item?.productName ?? '—'}
              </SheetTitle>
              <SheetDescription>{item?.warehouseName || '库存容器'}</SheetDescription>
              {item && <div className="mt-4"><ProductIdentityDetails product={item} /></div>}
            </div>
          </div>

          {/* 库存摘要 */}
          {item && (
            <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-lg border bg-muted/30">
              <StockMini label="在库" value={formatQty(item.onHand)}   unit={item.unit} color="text-primary" />
              <StockMini label="预占" value={formatQty(item.reserved)} unit={item.unit} color="text-warning" />
              <StockMini label="可用" value={formatQty(item.available)} unit={item.unit}
                color={item.available <= 0 ? 'text-destructive' : 'text-success'} />
            </div>
          )}
        </SheetHeader>

        {/* ── 条码列表 ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 列表标题栏 */}
          <div className="flex items-center justify-between border-b bg-muted/20 px-6 py-2.5">
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold text-muted-foreground">
                在库条码
              </p>
              {individualCount > 0 && (
                <button
                  onClick={() => setOnlyIndividual(v => !v)}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                    onlyIndividual ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  仅看单件（{individualCount}）
                </button>
              )}
            </div>
            {!isLoading && containers && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {visible.length} 个
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />加载中…
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Package2 className="h-8 w-8 opacity-30" />
                <p className="text-sm">{onlyIndividual ? '无单件条码' : '暂无在库条码'}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {visible.map((c, idx) => (
                  <div key={c.id} className="px-6 py-4 transition-colors hover:bg-muted/20">
                    {/* 第一行：条码 + 序号徽标 + 剩余量 */}
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                          {idx + 1}
                        </span>
                        <button
                          className="flex items-center gap-1 break-words font-mono text-xs text-foreground hover:text-primary"
                          title="查看流转时间线"
                          onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        >
                          {c.barcode}
                          {expandedId === c.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                        {c.individual && <SoftStatusLabel label="单件" tone="info" />}
                        {/^B/i.test(c.barcode) && <SoftStatusLabel label="塑料盒" tone="draft" />}
                      </div>
                      {/* 剩余量 / 初始量 进度 */}
                      <div className="text-right">
                        <span className="text-base font-bold text-foreground tabular-nums">
                          {formatQty(c.remainingQty)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          / {formatQty(c.initialQty)} {c.unit ?? item?.unit}
                        </span>
                      </div>
                    </div>

                    {/* 进度条 */}
                    <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all"
                        style={{
                          width: c.initialQty > 0
                            ? `${Math.min(100, (c.remainingQty / c.initialQty) * 100)}%`
                            : '0%',
                        }}
                      />
                    </div>

                    {/* 第二行：详情字段 */}
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {c.batchNo && (
                        <Field label="批次号" value={c.batchNo} />
                      )}
                      {c.sourceRefNo && (
                        <Field label="来源单号" value={c.sourceRefNo} mono />
                      )}
                      {c.mfgDate && (
                        <Field label="生产日期" value={c.mfgDate} />
                      )}
                      {c.expDate && (
                        <Field label="到期日期" value={c.expDate}
                          valueClass={isExpiringSoon(c.expDate) ? 'text-warning font-medium' : undefined}
                        />
                      )}
                      <Field label="入库时间" value={formatDisplayDateTime(c.createdAt)} className="col-span-2" />
                      {c.remark && (
                        <Field label="备注" value={c.remark} className="col-span-2" />
                      )}
                    </dl>

                    {/* 流转时间线（点击条码展开） */}
                    {expandedId === c.id && <ContainerTimeline containerId={c.id} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────

const LOG_TYPE_NAMES: Record<number, string> = { 1: '入库', 2: '出库', 3: '调整' }

/** 单条条码的流转时间线（追溯）：该容器从建到今的全部库存动作 */
function ContainerTimeline({ containerId }: { containerId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['container-logs', containerId],
    queryFn: () => getContainerLogsApi(containerId),
    staleTime: 30000,
  })
  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />加载流转记录…
      </div>
    )
  }
  if (!data?.length) {
    return <div className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">暂无流转记录</div>
  }
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">流转时间线</p>
      <ol className="relative space-y-2.5 border-l border-border pl-4">
        {data.map((log, i) => (
          <li key={i} className="relative text-xs">
            <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary/60" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground">{formatDisplayDateTime(log.createdAt)}</span>
              <SoftStatusLabel label={log.moveTypeName ?? LOG_TYPE_NAMES[log.type] ?? `类型${log.type}`} tone="info" />
              <span className="tabular-nums">{log.type === 2 ? `-${log.qty}` : log.qty}</span>
              {log.refNo && <span className="font-mono text-muted-foreground">{log.refNo}</span>}
            </div>
            {(log.remark || log.operatorName) && (
              <p className="mt-0.5 text-muted-foreground">
                {log.remark}{log.remark && log.operatorName ? ' · ' : ''}{log.operatorName ?? ''}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function StockMini({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="flex flex-col items-center py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`mt-0.5 text-lg font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </div>
  )
}

interface FieldProps {
  label:       string
  value:       string
  mono?:       boolean
  valueClass?: string
  className?:  string
}
function Field({ label, value, mono, valueClass, className }: FieldProps) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium ${mono ? 'font-mono' : ''} ${valueClass ?? ''}`}>{value}</dd>
    </div>
  )
}

function formatQty(v?: number): string {
  if (v === undefined || v === null) return '—'
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)
}

function isExpiringSoon(dateStr: string): boolean {
  const diff = new Date(dateStr).getTime() - Date.now()
  return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000 // 30 天内到期
}
