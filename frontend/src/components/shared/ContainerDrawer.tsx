/**
 * ContainerDrawer — 容器可视化侧滑面板
 *
 * 从库存总览行点击「查看容器」触发，右侧弹出 520px 面板。
 * 仅展示数据，不允许修改容器。
 */

import { Loader2, Package2, Box } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { useInventoryContainers } from '@/hooks/useInventory'
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

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      {/* 覆盖 SheetContent 的默认宽度 */}
      <SheetContent
        side="right"
        className="flex w-[520px] max-w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]"
      >
        {/* ── 顶部信息区 ───────────────────────────────────────────────── */}
        <SheetHeader className="border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Box className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">
                {item?.productName ?? '—'}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {item?.productCode}
                {item?.warehouseName && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-sans text-xs not-italic">
                    {item.warehouseName}
                  </span>
                )}
              </SheetDescription>
            </div>
          </div>

          {/* 库存摘要 */}
          {item && (
            <div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-lg border bg-muted/30">
              <StockMini label="在库" value={formatQty(item.onHand)}   unit={item.unit} color="text-blue-600" />
              <StockMini label="预占" value={formatQty(item.reserved)} unit={item.unit} color="text-amber-600" />
              <StockMini label="可用" value={formatQty(item.available)} unit={item.unit}
                color={item.available <= 0 ? 'text-destructive' : 'text-emerald-600'} />
            </div>
          )}
        </SheetHeader>

        {/* ── 容器列表 ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 列表标题栏 */}
          <div className="flex items-center justify-between border-b bg-muted/20 px-6 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              ACTIVE 容器
            </p>
            {!isLoading && containers && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {containers.length} 个
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />加载中...
              </div>
            ) : !containers || containers.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Package2 className="h-8 w-8 opacity-30" />
                <p className="text-sm">暂无活跃容器</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {containers.map((c, idx) => (
                  <div key={c.id} className="px-6 py-4 transition-colors hover:bg-muted/20">
                    {/* 第一行：条码 + 序号徽标 + 剩余量 */}
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="font-mono text-xs text-foreground">{c.barcode}</span>
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
                          valueClass={isExpiringSoon(c.expDate) ? 'text-amber-600 font-medium' : undefined}
                        />
                      )}
                      <Field label="入库时间" value={formatDisplayDateTime(c.createdAt)} className="col-span-2" />
                      {c.remark && (
                        <Field label="备注" value={c.remark} className="col-span-2" />
                      )}
                    </dl>
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
