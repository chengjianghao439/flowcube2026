import { useState } from 'react'
import { Search, Package, History, Layers } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { getContainerByBarcodeApi, getContainerLogsApi, type ContainerLogItem } from '@/api/inventory'
import { formatDisplayDateTime } from '@/lib/dateTime'

/**
 * 批次追溯：按库存条码（I…）或塑料盒条码（B…）查容器的来源与去向时间线。
 * 复用容器条码解析 + 单容器流水两个既有接口，个体容器的追溯能力由此承接
 * （原序列号追溯页，设计文档 13）。不用 /inventory/trace/:productId——
 * 它只按数字商品 ID 查，且返回批量容器链，与本页"查一个条码的来龙去脉"不符。
 */

function ContainerBlock({ data }: { data: Awaited<ReturnType<typeof getContainerByBarcodeApi>> }) {
  const containerKind = data.containerKind === 'plastic_box' ? '塑料盒' : '库存容器'
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            {/* 库存容器 vs 塑料盒用不同图标，但加载同一个条码信息 */}
            <ContainerKindIcon kind={data.containerKind} />
          </div>
          <div>
            <div className="font-mono text-sm font-medium">{data.barcode}</div>
            <div className="text-sm text-muted-foreground">{data.productName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{Number(data.remainingQty)}</div>
          <div className="text-sm text-muted-foreground">{data.unit} / 当前库存</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">商品编码：</span>
          <span className="font-mono">{data.productCode}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">类型：</span>
          <span>{containerKind}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">仓库：</span>
          <span>{data.warehouseName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">库位：</span>
          <span>{data.locationCode || (data.locationId != null ? `#${data.locationId}` : '未上架')}</span>
        </div>
        {data.lockedByTaskNo && (
          <div className="flex items-center gap-2 text-amber-700">
            <span className="text-muted-foreground">拣货锁定：</span>
            <span>{data.lockedByTaskNo}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ContainerKindIcon({ kind }: { kind?: 'inventory' | 'plastic_box' }) {
  return kind === 'plastic_box'
    ? <Layers className="h-5 w-5 text-primary" />
    : <Package className="h-5 w-5 text-primary" />
}

function LogRow({ item }: { item: ContainerLogItem }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.moveTypeName && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.moveTypeName}</span>
          )}
          {item.refNo && <span className="text-xs text-muted-foreground">单据 {item.refNo}</span>}
        </div>
        {item.remark && <div className="mt-1 text-sm text-muted-foreground">{item.remark}</div>}
      </div>
      <div className="text-right">
        <div className={`font-medium ${item.qty < 0 ? 'text-destructive' : ''}`}>
          {item.qty > 0 ? '+' : ''}{Number(item.qty)}
        </div>
        <div className="text-xs text-muted-foreground">{formatDisplayDateTime(item.createdAt)}</div>
        {item.operatorName && <div className="text-xs text-muted-foreground">操作人 {item.operatorName}</div>}
      </div>
    </div>
  )
}

export default function TracePage() {
  const [barcode, setBarcode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [container, setContainer] = useState<Awaited<ReturnType<typeof getContainerByBarcodeApi>> | null>(null)
  const [logs, setLogs] = useState<ContainerLogItem[]>([])

  async function handleTrace() {
    const code = barcode.trim()
    if (!code) {
      toast.warning('请输入库存条码或塑料盒条码')
      return
    }
    setLoading(true)
    setError(null)
    setContainer(null)
    setLogs([])
    try {
      // 1. 解析条码 → 容器信息
      const c = await getContainerByBarcodeApi(code)
      setContainer(c)
      // 2. 查该容器流水（来源去向时间线）
      const l = await getContainerLogsApi(c.containerId)
      setLogs(l)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string }
      setError(err?.response?.data?.message || err?.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="批次追溯"
        description="按库存条码或塑料盒条码，追踪单个容器从入库到出库的全部流水"
      />

      <div className="flex gap-2">
        <Input
          placeholder="输入库存条码（如 I000001）或塑料盒条码"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleTrace()}
          className="max-w-md font-mono"
        />
        <Button onClick={handleTrace} disabled={loading}>
          <Search className="mr-2 h-4 w-4" />
          {loading ? '查询中...' : '查询'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {container && (
        <div className="space-y-4">
          <ContainerBlock data={container} />

          <div className="rounded-lg border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">容器流水（{logs.length} 条）</h3>
            </div>
            {logs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">该容器暂无流水记录</div>
            ) : (
              <div className="divide-y">
                {logs.map((item, idx) => (
                  <LogRow key={idx} item={item} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!container && !error && !loading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Package className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            输入条码开始追溯。可按扫描枪扫码，或手动输入库存条码 / 塑料盒条码。
          </p>
        </div>
      )}
    </div>
  )
}
