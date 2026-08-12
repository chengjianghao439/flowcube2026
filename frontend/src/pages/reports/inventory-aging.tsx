import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getInventoryAgingApi, getExpiryAlertsApi, type AgingItem, type ExpiryAlert } from '@/api/inventory'
import InventoryAgingQueryDialog, { type InventoryAgingQueryValues } from './InventoryAgingQueryDialog'
import type { TableColumn } from '@/types'

function fmtQty(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}
const fmtMoney = (v: unknown) => `¥${Number(v).toFixed(2)}`

export default function InventoryAgingPage() {
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [staleDays, setStaleDays] = useState(90)
  const [tab, setTab] = useState<'aging' | 'expiry'>('aging')
  const [queryOpen, setQueryOpen] = useState(false)

  const agingQ = useQuery({
    queryKey: ['inventory-aging', keyword, warehouseId, staleDays],
    queryFn: () => getInventoryAgingApi({ page: 1, pageSize: 500, keyword: keyword || undefined, warehouseId: warehouseId ?? undefined, staleDays }),
  })
  const expiryQ = useQuery({
    queryKey: ['expiry-alerts', warehouseId],
    queryFn: () => getExpiryAlertsApi({ warehouseId: warehouseId ?? undefined, warnDays: 30 }),
    enabled: tab === 'expiry',
  })

  const buckets = agingQ.data?.buckets ?? []
  const list = agingQ.data?.list ?? []
  const expiryList = expiryQ.data?.list ?? []

  const initialQuery: InventoryAgingQueryValues = {
    keyword, warehouseId, warehouseName: '', staleDays,
  }
  function applyQuery(v: InventoryAgingQueryValues) {
    setKeyword(v.keyword)
    setWarehouseId(v.warehouseId)
    setStaleDays(v.staleDays)
    setQueryOpen(false)
  }
  function clearAll() {
    setKeyword(''); setWarehouseId(null); setStaleDays(90)
  }

  // 当前生效筛选摘要（可逐项移除；呆滞阈值默认 90 天不显示）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseId}`, onRemove: () => setWarehouseId(null) },
    staleDays !== 90 && { key: 'staleDays', label: `呆滞阈值：${staleDays} 天`, onRemove: () => setStaleDays(90) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const agingCols: TableColumn<AgingItem>[] = [
    { key: 'productCode', title: '商品编码', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '商品名称' },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'qty0_30', title: '0-30天', width: 80, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'qty30_60', title: '30-60天', width: 82, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'qty60_90', title: '60-90天', width: 82, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'qty90p', title: '90+天', width: 82, align: 'right', render: v => Number(v) > 0 ? <span className="tabular-nums font-medium text-amber-600">{fmtQty(v)}</span> : <span className="tabular-nums text-muted-foreground">—</span> },
    { key: 'totalQty', title: '合计', width: 80, align: 'right', render: v => <span className="tabular-nums font-medium">{fmtQty(v)}</span> },
    { key: 'avgAgeDays', title: '平均库龄', width: 90, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'totalValue', title: '金额', width: 110, align: 'right', render: v => <span className="tabular-nums">{fmtMoney(v)}</span> },
    { key: 'lastOutboundAt', title: '最后出库', width: 150, render: v => v ? formatDisplayDateTime(String(v)) : <span className="text-muted-foreground">从未出库</span> },
    { key: 'isStale', title: '呆滞', width: 96, render: (_, r) => r.isStale ? <SoftStatusLabel label={`呆滞${r.daysSinceOutbound != null ? ` ${r.daysSinceOutbound}天` : ''}`} tone="danger" /> : <span className="text-xs text-muted-foreground">正常</span> },
  ]

  const expiryCols: TableColumn<ExpiryAlert>[] = [
    { key: 'productCode', title: '商品编码', width: 120, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '商品名称' },
    { key: 'warehouseName', title: '仓库', width: 100 },
    { key: 'batchNo', title: '批次', width: 130, render: v => (v as string) || '—' },
    { key: 'expDate', title: '到期日', width: 110, render: v => v ? String(v).slice(0, 10) : '—' },
    { key: 'daysToExpiry', title: '距到期', width: 90, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'remainingQty', title: '库存', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'expiryState', title: '状态', width: 90, render: (_, r) => r.expiryState === 'expired' ? <SoftStatusLabel label="已过期" tone="danger" /> : <SoftStatusLabel label="临期" tone="warning" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="库龄与呆滞"
        description="库龄自本仓落库起算（调拨/拆分会重置）；金额按移动加权成本 avg_cost 估值，仅供参考不作账。呆滞 = 仍有库存且超过阈值天数无出库。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button onClick={() => { agingQ.refetch(); expiryQ.refetch() }}>刷新</Button>
          </div>
        }
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {buckets.map(b => (
          <div key={b.bucket} className="card-base p-4">
            <p className="text-xs text-muted-foreground">{b.bucket} 天{b.bucket === '90+' ? '（积压）' : ''}</p>
            <p className={`mt-1 text-2xl font-bold ${b.bucket === '90+' ? 'text-amber-600' : 'text-foreground'}`}>{fmtMoney(b.totalValue)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{b.skuCount} SKU · {fmtQty(b.totalQty)} 件</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-border">
        {([{ k: 'aging', l: '库龄明细' }, { k: 'expiry', l: '效期预警' }] as const).map(t => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.k ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{t.l}</button>
        ))}
      </div>

      {tab === 'aging'
        ? <DataTable columns={agingCols} data={list} loading={agingQ.isLoading} rowKey="id" emptyText="暂无库存数据" />
        : <DataTable columns={expiryCols} data={expiryList} loading={expiryQ.isLoading} rowKey="id" emptyText="暂无临期 / 过期批次（仅批次管理商品参与效期预警）" />}

      <InventoryAgingQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
