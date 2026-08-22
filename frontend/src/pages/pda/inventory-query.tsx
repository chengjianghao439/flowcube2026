/**
 * PDA 只读库存查询（无副作用）
 * 路由：/pda/inventory-query
 *
 * 扫描库存条码（I…/B…）→ 展示容器在库信息（商品/仓库/库位/批次/效期/剩余量）。
 * 只读查询：不提供改数量、移库位等任何决策入口（守 CLAUDE.md「仓库端只执行不决策」）。
 * 数据权限由后端 scopeFilter 按用户仓库范围过滤。
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import PdaHeader from '@/components/pda/PdaHeader'
import PdaCard from '@/components/pda/PdaCard'
import PdaFlash from '@/components/pda/PdaFlash'
import { usePdaFeedback } from '@/hooks/usePdaFeedback'
import { usePdaScanner } from '@/hooks/usePdaScanner'
import { queryInventoryByBarcodeApi, type InventoryQueryContainer } from '@/api/inventory'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatPdaErrorMessage } from '@/utils/displayFormatters'

function formatQty(qty: number): string {
  return Number.isFinite(qty) ? String(qty) : '—'
}

function formatDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toISOString().slice(0, 10)
}

function ContainerRow({ c }: { c: InventoryQueryContainer }) {
  return (
    <PdaCard>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-doc-code font-medium text-foreground">{c.barcode}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {c.containerKind === 'plastic_box' ? '塑料盒' : c.individual ? '单件' : '库存'}
            {c.containerStatus === 'waiting_putaway' ? ' · 待上架' : ''}
          </span>
        </div>
        <p className="font-medium text-foreground">{c.productName}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>仓库：{c.warehouseName}</span>
          <span>库位：{c.locationCode ?? '—'}</span>
          <span>批次：{c.batchNo ?? '—'}</span>
          <span>效期：{formatDate(c.expDate)}</span>
          <span>生产日期：{formatDate(c.mfgDate)}</span>
          <span>条码类型：{c.barcode.startsWith('B') ? '塑料盒' : '库存'}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border/60 pt-1.5">
          <span className="text-xs text-muted-foreground">
            剩余 <b className="text-base tabular-nums text-foreground">{formatQty(c.remainingQty)}</b> {c.unit ?? ''}
            {c.lockedByTaskNo ? ` · 已锁定（${c.lockedByTaskNo}）` : ''}
          </span>
        </div>
      </div>
    </PdaCard>
  )
}

export default function PdaInventoryQueryPage() {
  const navigate = useNavigate()
  const { flash, err, ok } = usePdaFeedback()
  const [manual, setManual] = useState('')
  const [results, setResults] = useState<InventoryQueryContainer[] | null>(null)
  const [lastBarcode, setLastBarcode] = useState('')
  const [querying, setQuerying] = useState(false)

  const doQuery = useCallback(async (raw: string) => {
    const bc = raw.trim()
    if (!bc || querying) return
    setQuerying(true)
    try {
      const list = await queryInventoryByBarcodeApi(bc)
      setResults(list)
      setLastBarcode(bc)
      if (list.length === 0) {
        err('未找到该条码对应的库存容器')
      } else {
        ok(`找到 ${list.length} 个容器`)
      }
    } catch (e: unknown) {
      setResults(null)
      setLastBarcode(bc)
      err(formatPdaErrorMessage((e as { response?: { data?: { message?: string } } })?.response?.data?.message, '条码查询失败'))
    } finally {
      setQuerying(false)
    }
  }, [querying, err, ok])

  usePdaScanner({ onScan: (code) => { void doQuery(code) } })

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PdaHeader title="库存查询" subtitle="扫描库存条码查看在库信息" onBack={() => navigate('/pda')} />
      <div className="max-w-md mx-auto flex-1 space-y-3 overflow-y-auto p-3 w-full">
        <PdaCard>
          <p className="mb-2 text-sm text-foreground">扫描库存条码（I…/B…）或输入后回车</p>
          <div className="flex gap-2">
            <Input
              data-scanner-manual="true"
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder="扫描或输入库存条码"
              className="h-10 flex-1 font-mono"
              onKeyDown={e => { if (e.key === 'Enter') { void doQuery(manual); setManual('') } }}
            />
            <Button className="h-10" disabled={querying} onClick={() => { void doQuery(manual); setManual('') }}>
              {querying ? '查询中…' : '查询'}
            </Button>
          </div>
        </PdaCard>

        {results !== null && (
          <>
            <p className="px-1 text-xs text-muted-foreground">
              {results.length > 0 ? `条码 ${lastBarcode}：${results.length} 个容器` : `条码 ${lastBarcode}：未找到`}
            </p>
            {results.map(c => <ContainerRow key={c.containerId} c={c} />)}
            <button
              type="button"
              onClick={() => { setResults(null); setLastBarcode('') }}
              className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground active:scale-95 transition-all"
            >
              清除结果
            </button>
          </>
        )}
      </div>
      <PdaFlash flash={flash} />
    </div>
  )
}
