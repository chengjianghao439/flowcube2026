import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSelect } from '@/components/shared/WarehouseSelect'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { getSerialsApi, checkSerialConsistencyApi, type SerialLedgerItem, type SerialConsistencyMismatch } from '@/api/serials'
import type { TableColumn } from '@/types'
import type { StatusTone } from '@/lib/statusTone'

const STATUS_TONE: Record<number, StatusTone> = { 1: 'success', 2: 'draft', 3: 'warning' }

export default function SerialLedgerPage() {
  const navigate = useNavigate()
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [tab, setTab] = useState<'ledger' | 'consistency'>('ledger')

  const ledgerQ = useQuery({
    queryKey: ['serials', keyword, status, warehouseId],
    queryFn: () => getSerialsApi({
      page: 1, pageSize: 500,
      keyword: keyword || undefined,
      status: status !== 'all' ? Number(status) : undefined,
      warehouseId: warehouseId ?? undefined,
    }),
  })
  const consistencyQ = useQuery({
    queryKey: ['serial-consistency', warehouseId],
    queryFn: () => checkSerialConsistencyApi(warehouseId ?? undefined),
    enabled: tab === 'consistency',
  })

  const list = ledgerQ.data?.list ?? []
  const total = ledgerQ.data?.pagination?.total ?? 0
  const cons = consistencyQ.data

  const cols: TableColumn<SerialLedgerItem>[] = [
    { key: 'serialNo', title: '序列号', width: 180, render: v => <span className="text-doc-code font-medium">{String(v)}</span> },
    { key: 'productName', title: '商品', render: (_, r) => <div><div>{r.productName}</div><div className="text-xs text-muted-foreground text-doc-code">{r.productCode}</div></div> },
    { key: 'status', title: '状态', width: 90, render: (_, r) => <SoftStatusLabel label={r.statusLabel} tone={STATUS_TONE[r.status] ?? 'info'} /> },
    { key: 'warehouseName', title: '所在仓', width: 100, render: v => (v as string) || '—' },
    { key: 'containerBarcode', title: '所在容器', width: 140, render: v => v ? <span className="text-doc-code">{String(v)}</span> : <span className="text-muted-foreground">已出库</span> },
    { key: 'purchaseOrderId', title: '来源采购单', width: 100, align: 'right', render: v => v ? <span className="tabular-nums">#{String(v)}</span> : '—' },
    { key: 'saleOrderId', title: '出库销售单', width: 100, align: 'right', render: v => v ? <span className="tabular-nums">#{String(v)}</span> : '—' },
    { key: 'shippedAt', title: '出库时间', width: 150, render: v => v ? formatDisplayDateTime(String(v)) : '—' },
    { key: 'id', title: '操作', width: 80, render: (_, r) => <Button variant="ghost" size="sm" onClick={() => navigate(`/serials/trace?serialNo=${encodeURIComponent(r.serialNo)}&productId=${r.productId}`)}>追溯</Button> },
  ]

  const consCols: TableColumn<SerialConsistencyMismatch>[] = [
    { key: 'barcode', title: '容器条码', width: 160, render: v => <span className="text-doc-code">{String(v)}</span> },
    { key: 'productName', title: '商品', render: (_, r) => <div><div>{r.productName}</div><div className="text-xs text-muted-foreground text-doc-code">{r.productCode}</div></div> },
    { key: 'warehouseName', title: '仓库', width: 100, render: v => (v as string) || '—' },
    { key: 'remainingQty', title: '容器数量', width: 100, align: 'right', render: v => <span className="tabular-nums font-medium">{Number(v)}</span> },
    { key: 'inStockSerialCount', title: '在库序列号数', width: 120, align: 'right', render: v => <span className="tabular-nums font-medium text-danger">{Number(v)}</span> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="序列号台账"
        description="序列号是容器下挂的个体账（数量以容器为准）。台账查每台的当前状态与归属；一致性对账守护「容器数量 == 在库序列号数」不变量。"
        actions={<Button onClick={() => { ledgerQ.refetch(); consistencyQ.refetch() }}>刷新</Button>}
      />

      <div className="flex gap-1 border-b border-border">
        {([{ k: 'ledger', l: '序列号台账' }, { k: 'consistency', l: '一致性对账' }] as const).map(t => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.k ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{t.l}</button>
        ))}
      </div>

      {tab === 'ledger' ? (
        <>
          <FilterCard>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Input placeholder="序列号 / 商品编码 / 名称..." value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && setKeyword(search)} className="w-60" />
                <Button variant="outline" onClick={() => setKeyword(search)}>搜索</Button>
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="1">在库</SelectItem>
                  <SelectItem value="2">已出库</SelectItem>
                  <SelectItem value="3">已退货</SelectItem>
                </SelectContent>
              </Select>
              <WarehouseSelect value={warehouseId} onChange={id => setWarehouseId(id)} allowClear placeholder="全部仓库" className="w-44" />
              {total > 500 && <span className="text-xs text-amber-600">结果较多，仅展示前 500 条，请用搜索缩小范围</span>}
            </div>
          </FilterCard>

          <DataTable columns={cols} data={list} loading={ledgerQ.isLoading} rowKey="id" emptyText="暂无序列号记录（仅序列号管控商品收货后逐台登记）" />
        </>
      ) : (
        <>
          <FilterCard>
            <div className="flex flex-wrap items-center gap-3">
              <WarehouseSelect value={warehouseId} onChange={id => setWarehouseId(id)} allowClear placeholder="全部仓库" className="w-44" />
              {cons && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  已检查 <b className="tabular-nums">{cons.checkedContainers}</b> 个在库容器，
                  {cons.consistent
                    ? <SoftStatusLabel label="全部一致" tone="success" />
                    : <SoftStatusLabel label={`${cons.mismatchCount} 个不一致`} tone="danger" />}
                </span>
              )}
            </div>
          </FilterCard>
          <p className="text-xs text-muted-foreground">
            说明：给已有库存的商品新开启「序列号管理」时，历史库存容器尚无序列号，会在这里列为不一致——这是正常现象，需通过 Phase 2 的历史序列号导入补齐，或仅对新品 / 零库存商品开启。
          </p>
          <DataTable columns={consCols} data={cons?.mismatches ?? []} loading={consistencyQ.isLoading} rowKey="containerId" emptyText="未发现不一致，容器数量与在库序列号数完全吻合 ✓" />
        </>
      )}
    </div>
  )
}
