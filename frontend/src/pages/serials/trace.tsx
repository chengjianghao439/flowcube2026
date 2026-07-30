import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { traceSerialApi } from '@/api/serials'
import type { StatusTone } from '@/lib/statusTone'

const STATUS_TONE: Record<number, StatusTone> = { 1: 'success', 2: 'draft', 3: 'warning' }
const EVENT_LABEL: Record<string, string> = {
  register: '收货登记', putaway: '上架', pick: '拣货', ship: '出库核销',
  return_in: '退货入库', qa: '质检', transfer: '调拨', void: '作废',
}

export default function SerialTracePage() {
  const [params] = useSearchParams()
  const [input, setInput] = useState(params.get('serialNo') || '')
  const [serialNo, setSerialNo] = useState(params.get('serialNo') || '')
  const productId = params.get('productId') ? Number(params.get('productId')) : undefined

  // 从台账「追溯」跳转进来时，URL 带的 serialNo 变化要同步触发查询
  useEffect(() => {
    const sn = params.get('serialNo') || ''
    setInput(sn); setSerialNo(sn)
  }, [params])

  const q = useQuery({
    queryKey: ['serial-trace', serialNo, productId],
    queryFn: () => traceSerialApi(serialNo, productId),
    enabled: !!serialNo,
  })

  const matches = q.data?.matches ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="序列号追溯" description="输入一个序列号，查看它的一生：从哪张采购单进、经哪个容器、由哪张销售单出、是否退回。" />

      <FilterCard>
        <div className="flex items-center gap-2">
          <Input placeholder="输入序列号 / 机身码 / IMEI..." value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setSerialNo(input.trim())}
            className="w-72" />
          <Button onClick={() => setSerialNo(input.trim())}>追溯</Button>
        </div>
      </FilterCard>

      {!serialNo && <div className="card-base p-8 text-center text-sm text-muted-foreground">请输入序列号开始追溯</div>}
      {serialNo && q.isLoading && <div className="card-base p-8 text-center text-sm text-muted-foreground">查询中…</div>}
      {serialNo && !q.isLoading && matches.length === 0 && (
        <div className="card-base p-8 text-center text-sm text-muted-foreground">未找到序列号「{serialNo}」的记录</div>
      )}

      {matches.map(m => (
        <div key={m.serial.id} className="card-base p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-3">
            <div><span className="text-xs text-muted-foreground">序列号</span><div className="text-doc-code font-medium">{m.serial.serialNo}</div></div>
            <div><span className="text-xs text-muted-foreground">商品</span><div>{m.serial.productName} <span className="text-doc-code text-xs text-muted-foreground">{m.serial.productCode}</span></div></div>
            <div><span className="text-xs text-muted-foreground">当前状态</span><div><SoftStatusLabel label={m.serial.statusLabel} tone={STATUS_TONE[m.serial.status] ?? 'info'} /></div></div>
            <div><span className="text-xs text-muted-foreground">所在仓</span><div>{m.serial.warehouseName || '—'}</div></div>
            <div><span className="text-xs text-muted-foreground">所在容器</span><div className="text-doc-code">{m.serial.containerBarcode || '已出库'}</div></div>
          </div>

          <ol className="relative border-l-2 border-border pl-5 space-y-4">
            {m.events.map(e => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-primary" />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{EVENT_LABEL[e.eventType] || e.eventType}</span>
                  <span className="text-xs text-muted-foreground">{formatDisplayDateTime(e.createdAt)}</span>
                  {e.containerBarcode && <span className="text-xs text-doc-code text-muted-foreground">容器 {e.containerBarcode}</span>}
                  {e.refType && e.refId != null && <span className="text-xs text-muted-foreground">{e.refType} #{e.refId}</span>}
                  {e.operatorName && <span className="text-xs text-muted-foreground">操作人 {e.operatorName}</span>}
                </div>
                {e.remark && <div className="mt-0.5 text-xs text-muted-foreground">{e.remark}</div>}
              </li>
            ))}
            {m.events.length === 0 && <li className="text-sm text-muted-foreground">暂无事件</li>}
          </ol>
        </div>
      ))}
    </div>
  )
}
