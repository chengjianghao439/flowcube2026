import { ReportQueryFeedback } from './ReportQueryFeedback'
import { money, qty } from '@/lib/format'
import { ContentTabs } from '@/components/shared/ContentTabs'
import KeepAliveSection from '@/components/shared/KeepAliveSection'
import { useActiveWorkspaceTab } from '@/hooks/useActiveWorkspaceTab'
import { SummaryStrip } from '@/components/shared/SummaryStrip'
import { productIdentityColumns } from '@/components/shared/productIdentityColumns'
import { useMemo, useState } from 'react'
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

// 数量统一走 lib/format 的 qty；这里只是把 unknown 收敛成它接受的类型
const fmtQty = (v: unknown) => qty(v as number | null | undefined)

export default function InventoryAgingPage() {
  const active = useActiveWorkspaceTab()
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [staleDays, setStaleDays] = useState(90)
  const [tab, setTab] = useState<'aging' | 'expiry'>('aging')
  const [queryOpen, setQueryOpen] = useState(false)

  const agingQ = useQuery({
    enabled: active,
    queryKey: ['inventory-aging', keyword, warehouseId, staleDays],
    queryFn: () => getInventoryAgingApi({ page: 1, pageSize: 500, keyword: keyword || undefined, warehouseId: warehouseId ?? undefined, staleDays }),
  })
  const expiryQ = useQuery({
    queryKey: ['expiry-alerts', warehouseId],
    queryFn: () => getExpiryAlertsApi({ warehouseId: warehouseId ?? undefined, warnDays: 30 }),
    enabled: active && tab === 'expiry',
  })

  const buckets = agingQ.data?.buckets ?? []
  const list = agingQ.data?.list ?? []
  const expiryList = expiryQ.data?.list ?? []

  const initialQuery = useMemo<InventoryAgingQueryValues>(() => ({
    keyword, warehouseId, warehouseName: '', staleDays,
  }), [keyword, warehouseId, staleDays])
  function applyQuery(v: InventoryAgingQueryValues) {
    setKeyword(v.keyword)
    setWarehouseId(v.warehouseId)
    setStaleDays(v.staleDays)
    setQueryOpen(false)
  }
  function clearAll() {
    setKeyword(''); setWarehouseId(null); setStaleDays(90)
  }

  // 当前生效筛选摘要（可逐项移除；滞销阈值默认 90 天不显示）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    warehouseId && { key: 'warehouse', label: `仓库：${warehouseId}`, onRemove: () => setWarehouseId(null) },
    staleDays !== 90 && { key: 'staleDays', label: `滞销阈值：${staleDays} 天`, onRemove: () => setStaleDays(90) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const agingCols: TableColumn<AgingItem>[] = [
    { ...productIdentityColumns({ compact: true })[0], width: 330 },
    { key: 'warehouseName', title: '仓库', width: 136 },
    { key: 'qty0_30', title: '0-30天', width: 72, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'qty30_60', title: '30-60天', width: 72, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'qty60_90', title: '60-90天', width: 72, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'qty90p', title: '90+天', width: 72, align: 'right', render: v => Number(v) > 0 ? <span className="tabular-nums font-medium text-warning-ink">{fmtQty(v)}</span> : <span className="tabular-nums text-muted-foreground">—</span> },
    { key: 'totalQty', title: '合计', width: 74, align: 'right', render: v => <span className="tabular-nums font-medium">{fmtQty(v)}</span> },
    { key: 'avgAgeDays', title: '平均存放时长', width: 105, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'totalValue', title: '金额', width: 110, align: 'right', render: v => <span className="tabular-nums">{money(Number(v))}</span> },
    { key: 'lastOutboundAt', title: '最后出库 / 滞销', width: 166, render: (v, r) => (
      <div className="space-y-1">
        <div className="tabular-nums">{formatDisplayDateTime(v)}</div>
        {r.isStale
          ? <SoftStatusLabel label={r.daysSinceOutbound == null ? '从未出库' : `${r.daysSinceOutbound} 天未出库`} tone="danger" />
          : <div className="text-xs text-muted-foreground">正常</div>}
      </div>
    ) },
  ]

  const expiryCols: TableColumn<ExpiryAlert>[] = [
    { ...productIdentityColumns({ compact: true })[0], width: 248 },
    { key: 'warehouseName', title: '仓库', width: 136 },
    { key: 'batchNo', title: '批次', width: 130, render: v => (v as string) || '—' },
    { key: 'expDate', title: '到期日', width: 110, render: v => v ? String(v).slice(0, 10) : '—' },
    { key: 'daysToExpiry', title: '距到期', width: 90, align: 'right', render: v => <span className="tabular-nums">{Number(v)} 天</span> },
    { key: 'remainingQty', title: '库存', width: 90, align: 'right', render: v => <span className="tabular-nums">{fmtQty(v)}</span> },
    { key: 'expiryState', title: '状态', width: 90, render: (_, r) => r.expiryState === 'expired' ? <SoftStatusLabel label="已过期" tone="danger" /> : <SoftStatusLabel label="临期" tone="warning" /> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="存放时长与滞销"
        description={`库龄自入库本仓起算，超 ${staleDays} 天或从未出库的库存纳入滞销。`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
            <Button disabled={tab === 'aging' ? agingQ.isFetching : expiryQ.isFetching} onClick={() => void (tab === 'aging' ? agingQ.refetch() : expiryQ.refetch())}>{(tab === 'aging' ? agingQ.isFetching : expiryQ.isFetching) ? '正在刷新…' : '刷新'}</Button>
          </div>
        }
      />


      <ReportQueryFeedback title="存放明细" hasData={!!agingQ.data} isError={agingQ.isError} isFetching={agingQ.isFetching} error={agingQ.error} onRetry={() => void agingQ.refetch()} />
      {buckets.length > 0 && <SummaryStrip items={buckets.map(bucket => ({
        label: `存放 ${bucket.bucket} 天`,
        tone: bucket.bucket === '90+' ? 'text-warning-ink' : undefined,
        value: <>
          {money(bucket.totalValue)}
          <span className="block text-xs font-normal leading-5 text-muted-foreground">{bucket.skuCount} SKU · {fmtQty(bucket.totalQty)} 件</span>
        </>,
      }))} />}

      <ContentTabs variant="underline" value={tab} onValueChange={setTab} label="库存存放与效期"
        rightSlot={chips.length > 0 ? (
          <>
            {chips.map(c => (
              <span key={c.key} className="fc-query-chip">
                {c.label}
                <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
          </>
        ) : undefined}
        tabs={[
        { value: 'aging', label: '存放明细', content: <KeepAliveSection active={!agingQ.isError || !!agingQ.data}>
          <DataTable columns={agingCols} data={list} loading={agingQ.isLoading} rowKey="id" scrollLabel="存放明细表格" emptyText="暂无库存数据" />
        </KeepAliveSection> },
        { value: 'expiry', label: '效期预警', content: <>
          <ReportQueryFeedback title="效期预警" hasData={!!expiryQ.data} isError={expiryQ.isError} isFetching={expiryQ.isFetching} error={expiryQ.error} onRetry={() => void expiryQ.refetch()} />
          {(!expiryQ.isError || !!expiryQ.data) && <DataTable columns={expiryCols} data={expiryList} loading={expiryQ.isLoading} rowKey="id" scrollLabel="效期预警表格" emptyText="暂无临期 / 过期批次（仅批次管理商品参与效期预警）" />}
        </> },
      ]} />

      <InventoryAgingQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
