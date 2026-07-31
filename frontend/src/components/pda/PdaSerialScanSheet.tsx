/**
 * PdaSerialScanSheet — 序列号逐台扫码采集面板（PDA 全屏覆盖层，文档 04）
 *
 * 通用于两个作业点：
 *  - 收货登记（按「箱」分组，每箱 requiredQty = 该箱数量）
 *  - 出库核销（按「商品」分组，每商品 requiredQty = 该商品本次出库量）
 *
 * 扫入的序列号按组顺序依次填满未满的组，全局去重，扫满后才允许确认。确认时按组切片回传
 * `{ groupKey: string[] }`，由调用页组装成后端要的 packages[].serialNos / serialNosByProduct。
 *
 * ⚠️ 扫码走 PdaScanner（内部 usePdaScanner 全局监听 keydown）。本面板打开期间，调用页必须把页面里
 * 其它 PdaScanner 置 disabled，否则一次扫码会被多个监听器同时接收。
 */
import { useMemo, useState } from 'react'
import PdaScanner from './PdaScanner'
import { Button } from '@/components/ui/button'

export interface SerialScanGroup {
  /** 组唯一键：收货用箱序号字符串，出库用 productId 字符串 */
  key: string
  /** 组显示名：如「箱 1」或商品名 */
  label: string
  /** 该组需要扫入的序列号数量 */
  requiredQty: number
}

interface Props {
  title: string
  subtitle?: string
  groups: SerialScanGroup[]
  submitting?: boolean
  confirmLabel?: string
  onCancel: () => void
  onConfirm: (serialsByGroup: Record<string, string[]>) => void
}

export default function PdaSerialScanSheet({
  title,
  subtitle,
  groups,
  submitting = false,
  confirmLabel = '确认登记',
  onCancel,
  onConfirm,
}: Props) {
  // 扁平存储按扫入顺序的序列号；分组归属靠 sliced 按组顺序切片得出（删除中间项会自动前移补位，
  // 后端只校验每组数量与整批不重复，不关心某个 SN 具体归哪组，故重排无碍）
  const [serials, setSerials] = useState<string[]>([])
  const [flash, setFlash] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null)

  const totalRequired = useMemo(() => groups.reduce((sum, g) => sum + g.requiredQty, 0), [groups])
  const filled = serials.length
  const remaining = totalRequired - filled

  const sliced = useMemo(() => {
    const out: Record<string, string[]> = {}
    let cursor = 0
    for (const g of groups) {
      out[g.key] = serials.slice(cursor, cursor + g.requiredQty)
      cursor += g.requiredQty
    }
    return out
  }, [groups, serials])

  const currentGroupKey = groups.find(g => (sliced[g.key]?.length ?? 0) < g.requiredQty)?.key ?? null

  function notify(tone: 'ok' | 'err', msg: string) {
    setFlash({ tone, msg })
    setTimeout(() => setFlash(prev => (prev?.msg === msg ? null : prev)), 1600)
  }

  function handleScan(raw: string) {
    const sn = raw.trim()
    if (!sn) return
    if (serials.includes(sn)) {
      notify('err', `重复序列号：${sn}`)
      return
    }
    if (filled >= totalRequired) {
      notify('err', `已扫满 ${totalRequired} 个，无需再扫`)
      return
    }
    setSerials(prev => [...prev, sn])
    notify('ok', `已扫 ${sn}（${filled + 1}/${totalRequired}）`)
  }

  function removeSerial(sn: string) {
    setSerials(prev => prev.filter(s => s !== sn))
  }

  function confirm() {
    if (filled !== totalRequired) {
      notify('err', `还需扫 ${remaining} 个序列号`)
      return
    }
    onConfirm(sliced)
  }

  const done = filled === totalRequired

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* 顶部：标题 + 总进度 */}
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
            done ? 'bg-emerald-500/10 text-emerald-600' : 'bg-primary/10 text-primary'
          }`}>
            {filled}/{totalRequired}
          </span>
        </div>
      </div>

      {flash && (
        <div className={`px-4 py-2 text-sm font-medium ${
          flash.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {flash.msg}
        </div>
      )}

      {/* 中部：按组展示已扫序列号 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {groups.map((g, index) => {
          const items = sliced[g.key] ?? []
          const isCurrent = g.key === currentGroupKey
          const groupDone = items.length >= g.requiredQty
          return (
            <div
              key={g.key}
              className={`rounded-2xl border p-3 ${
                isCurrent ? 'border-primary bg-primary/5' : groupDone ? 'border-emerald-200 bg-emerald-50/40' : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  {g.label || `第 ${index + 1} 组`}
                  {isCurrent && <span className="ml-2 text-xs font-normal text-primary">← 正在扫</span>}
                </p>
                <span className={`text-xs font-semibold ${groupDone ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {items.length}/{g.requiredQty}
                </span>
              </div>
              {items.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {items.map((sn, i) => (
                    <div key={sn} className="flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-1.5">
                      <span className="font-mono text-sm text-foreground">
                        <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>{sn}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-red-500 active:scale-95 disabled:opacity-40"
                        onClick={() => removeSerial(sn)}
                        disabled={submitting}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部：扫描器 + 操作按钮 */}
      <div className="border-t border-border bg-card px-4 py-3 space-y-3">
        <PdaScanner
          onScan={handleScan}
          placeholder={done ? '已扫满，可确认登记' : '逐台扫描序列号'}
          disabled={submitting || done}
          onDuplicate={(code) => notify('err', `重复扫码：${code}`)}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="button" className="flex-1" onClick={confirm} disabled={submitting || !done}>
            {submitting ? '提交中...' : `${confirmLabel}（${filled}/${totalRequired}）`}
          </Button>
        </div>
      </div>
    </div>
  )
}
