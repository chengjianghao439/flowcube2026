import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { Button } from '@/components/ui/button'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import type { StatusTone } from '@/lib/statusTone'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getOpLogsApi, clearLogsApi } from '@/api/oplogs'
import { usePermission } from '@/hooks/usePermission'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatDisplayDateTime, defaultRangeYmds } from '@/lib/dateTime'
import { downloadExport } from '@/lib/exportDownload'
import { toast } from '@/lib/toast'
import {
  OPERATION_LOG_MODULE_OPTIONS,
  formatApiPath,
  formatHttpMethod,
  formatModuleName,
  formatOperationResult,
  formatOperator,
  getStatusTone,
  isSensitivePath,
  type OperationLogStatusTone,
} from '@/utils/operationLogFormatters'
import { readStringParam, upsertSearchParams } from '@/lib/urlSearchParams'
import OpLogQueryDialog, { type OpLogQueryValues } from './OpLogQueryDialog'
import type { OpLog } from '@/api/oplogs'
import type { TableColumn } from '@/types'
import { PERMISSIONS } from '@/lib/permission-codes'

/** 默认筛选的天数窗口（最近一周，含今天），口径与单据列表一致 */
const DEFAULT_RANGE_DAYS = 7

/** 日志结果 tone → 全站统一状态 tone（`@/lib/statusTone`） */
const RESULT_TONE: Record<OperationLogStatusTone, StatusTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'draft',
}

function RawValue({ value }: { value: unknown }) {
  const text = value == null || value === '' ? '—' : String(value)
  return <span className="break-all font-mono text-xs text-foreground">{text}</span>
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border px-3 py-2 sm:grid-cols-[160px_minmax(0,1fr)]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <RawValue value={value} />
    </div>
  )
}

export default function OpLogsPage() {
  const { can } = usePermission()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [queryOpen, setQueryOpen] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [detail, setDetail] = useState<OpLog | null>(null)

  // ── 当前生效的筛选（全部存于 URL 参数，刷新/分享可保留） ──
  const keyword   = readStringParam(searchParams, 'keyword')
  const module    = readStringParam(searchParams, 'module')
  const startDate = readStringParam(searchParams, 'startDate')
  const endDate   = readStringParam(searchParams, 'endDate')

  const PAGE_SIZE = 20

  // 默认窗口在「构造查询参数处」兜底：不依赖那个只跑一次的 effect，首次打开与切回已挂载页签范围一致。
  // 操作日志是全站增长最快的表（每次写操作一条），没有窗口时首屏要串行拉全表。
  const rangeAll = searchParams.get('range') === 'all'
  const defaultRange = useMemo(() => defaultRangeYmds(DEFAULT_RANGE_DAYS), [])
  const effectiveStartDate = startDate || (rangeAll ? '' : defaultRange.start)
  const effectiveEndDate = endDate || (rangeAll ? '' : defaultRange.end)

  const { data, isLoading } = useQuery({
    queryKey: ['oplogs', { keyword, module, effectiveStartDate, effectiveEndDate }],
    queryFn: () => getOpLogsApi({ page: 1, pageSize: PAGE_SIZE, keyword, module, startDate: effectiveStartDate, endDate: effectiveEndDate }),
  })
  const total = data?.pagination?.total ?? 0
  const clear = useMutation({ mutationFn: clearLogsApi, onSuccess: () => qc.invalidateQueries({ queryKey: ['oplogs'] }) })

  function updateParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams(upsertSearchParams(searchParams, updates))
  }

  // 首次打开：把默认窗口写进 URL（便于分享与回看）。真正的筛选兜底在构造查询处。
  useEffect(() => {
    if (!startDate && !endDate && searchParams.get('range') !== 'all') {
      setSearchParams(upsertSearchParams(searchParams, { startDate: defaultRange.start, endDate: defaultRange.end }), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 查询弹窗初始值：日期用「当前实际生效」的范围（含默认窗口），用户打开就能看见
  const initialQuery: OpLogQueryValues = { keyword, module, startDate: effectiveStartDate, endDate: effectiveEndDate }

  function applyQuery(v: OpLogQueryValues) {
    updateParams({
      keyword: v.keyword || null,
      module: v.module || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
      // 弹窗里清空日期＝明确要看全部；设了日期则清掉 range 标记
      range: (!v.startDate && !v.endDate) ? 'all' : null,
    });
    setQueryOpen(false)
  }

  function clearAll() {
    updateParams({ keyword: null, module: null, startDate: null, endDate: null, range: 'all' });
  }

  // 导出参数（与列表当前筛选保持一致，含默认窗口）
  const exportParams = {
    ...(keyword ? { keyword } : {}),
    ...(module ? { module } : {}),
    ...(effectiveStartDate ? { startDate: effectiveStartDate } : {}),
    ...(effectiveEndDate ? { endDate: effectiveEndDate } : {}),
  }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => updateParams({ keyword: null }) },
    module && { key: 'module', label: `模块：${OPERATION_LOG_MODULE_OPTIONS.find(o => o.value === module)?.label ?? module}`, onRemove: () => updateParams({ module: null }) },
    startDate && { key: 'startDate', label: `日期从：${startDate}`, onRemove: () => updateParams({ startDate: null }) },
    endDate && { key: 'endDate', label: `日期至：${endDate}`, onRemove: () => updateParams({ endDate: null }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  const columns: TableColumn<OpLog>[] = [
    { key: 'createdAt', title: '时间', width: 160, render: (v) => formatDisplayDateTime(v) },
    { key: 'userName', title: '操作人', width: 120, render: (v) => formatOperator(v) },
    {
      key: 'method',
      title: '操作类型',
      width: 100,
      render: (v) => <SoftStatusLabel label={formatHttpMethod(v)} tone="info" />,
    },
    { key: 'module', title: '业务模块', width: 110, render: (v) => formatModuleName(v) },
    {
      key: 'path',
      title: '操作内容',
      render: (v, row) => (
        <span className={isSensitivePath(v) ? 'font-medium text-amber-700' : undefined}>
          {formatApiPath(v, row.method, row.statusCode)}
        </span>
      ),
    },
    {
      key: 'statusCode',
      title: '结果',
      width: 130,
      render: (v, row) => {
        const tone = getStatusTone(v)
        return <SoftStatusLabel label={formatOperationResult(row.path, v)} tone={RESULT_TONE[tone]} />
      },
    },
    { key: 'ip', title: '来源 IP', width: 130, render: v => v ? String(v) : '—' },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      render: (_, row) => (
        <Button size="sm" variant="outline" onClick={() => setDetail(row)}>
          详情
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="操作日志" description="记录所有写操作，追踪变更历史" actions={
        <>
          <Button variant="outline" onClick={() => downloadExport('/export/oplogs', exportParams).catch(e => toast.error((e as Error).message))}>导出</Button>
          <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          {can(PERMISSIONS.AUDIT_LOG_CLEAR) ? <Button variant="destructive" size="sm" onClick={() => setClearConfirm(true)}>清理旧日志</Button> : undefined}
        </>
      } />
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              {c.label}
              <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除「${c.label}」`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
        </div>
      )}
      <DataTable virtualized columns={columns} data={data?.list || []} loading={isLoading} />

      <ListSummary total={total} unit="条" />
      {/* 操作日志是全站增长最快的表：自动取齐到上限即停，这里如实说明，避免"看起来只有这么多" */}
      {data?.truncated && (
        <p className="mt-1 text-xs text-muted-foreground">
          仅加载最近 {data.list.length.toLocaleString()} 条（已达取数上限），请缩小时间范围或加筛选条件查看更早的日志。
        </p>
      )}
      <ConfirmDialog
        open={clearConfirm}
        title="清理旧日志"
        description="确认清理创建时间超过 30 天的操作日志？该操作不可撤销。"
        variant="destructive"
        confirmText="清理"
        onConfirm={() => { clear.mutate(); setClearConfirm(false) }}
        onCancel={() => setClearConfirm(false)}
      />
      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>操作日志详情</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SoftStatusLabel label={formatHttpMethod(detail.method)} tone="info" />
                  <SoftStatusLabel
                    label={formatOperationResult(detail.path, detail.statusCode)}
                    tone={RESULT_TONE[getStatusTone(detail.statusCode)]}
                  />
                  {isSensitivePath(detail.path) && (
                    <SoftStatusLabel label="敏感路径探测" tone="warning" />
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatOperator(detail.userName)} · {formatModuleName(detail.module)} · {formatApiPath(detail.path, detail.method, detail.statusCode)}
                </p>
              </div>

              <div className="grid gap-2">
                <DetailRow label="请求方式" value={detail.method} />
                <DetailRow label="访问地址" value={detail.path} />
                <DetailRow label="状态码" value={detail.statusCode} />
                <DetailRow label="业务模块" value={detail.module} />
                <DetailRow label="操作人" value={detail.userName} />
                <DetailRow label="来源 IP" value={detail.ip} />
                <DetailRow label="用户 ID" value={detail.userId} />
                <DetailRow label="时间" value={formatDisplayDateTime(detail.createdAt)} />
                <DetailRow label="日志 ID" value={detail.id} />
                <DetailRow label="请求内容" value={detail.requestBody} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <OpLogQueryDialog
        open={queryOpen}
        initial={initialQuery}
        resetValues={{ startDate: defaultRange.start, endDate: defaultRange.end }}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </div>
  )
}
