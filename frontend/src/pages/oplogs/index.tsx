import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getOpLogsApi, clearLogsApi } from '@/api/oplogs'
import { usePermission } from '@/hooks/usePermission'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatDisplayDateTime } from '@/lib/dateTime'
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
import type { OpLog } from '@/api/oplogs'
import type { TableColumn } from '@/types'
import { PERMISSIONS } from '@/lib/permission-codes'

const METHOD_BADGE_CLASS = 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50'

const RESULT_BADGE_CLASS: Record<OperationLogStatusTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50',
}

function RawValue({ value }: { value: unknown }) {
  const text = value == null || value === '' ? '—' : String(value)
  return <span className="break-all font-mono text-xs text-foreground">{text}</span>
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border px-3 py-2 sm:grid-cols-[120px_1fr]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <RawValue value={value} />
    </div>
  )
}

export default function OpLogsPage() {
  const { can } = usePermission()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [module, setModule] = useState('')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [detail, setDetail] = useState<OpLog | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['oplogs', { page, keyword, module }], queryFn: () => getOpLogsApi({ page, pageSize: 30, keyword, module }) })
  const clear = useMutation({ mutationFn: clearLogsApi, onSuccess: () => qc.invalidateQueries({ queryKey: ['oplogs'] }) })

  const columns: TableColumn<OpLog>[] = [
    { key: 'createdAt', title: '时间', width: 160, render: (v) => formatDisplayDateTime(v) },
    { key: 'userName', title: '操作人', width: 120, render: (v) => formatOperator(v) },
    {
      key: 'method',
      title: '操作类型',
      width: 100,
      render: (v) => <Badge variant="outline" className={METHOD_BADGE_CLASS}>{formatHttpMethod(v)}</Badge>,
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
        return <Badge variant="outline" className={RESULT_BADGE_CLASS[tone]}>{formatOperationResult(row.path, v)}</Badge>
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
        can(PERMISSIONS.AUDIT_LOG_CLEAR) ? <Button variant="destructive" size="sm" onClick={() => setClearConfirm(true)}>清理旧日志</Button> : undefined
      } />
      <div className="flex gap-2 flex-wrap">
        <Input placeholder="搜索用户/路径..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="w-56"
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { setKeyword(search); setPage(1) } }} />
        <Select value={module || '__all__'} onValueChange={v => { setModule(v === '__all__' ? '' : v); setPage(1) }}>
          <SelectTrigger className="h-10 w-40">
            <SelectValue placeholder="全部模块" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部模块</SelectItem>
            {OPERATION_LOG_MODULE_OPTIONS.map(item => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => { setKeyword(search); setPage(1) }}>搜索</Button>
      </div>
      <DataTable columns={columns} data={data?.list || []} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} />
      <ConfirmDialog
        open={clearConfirm}
        title="清理旧日志"
        description="确认清理 30 天前的操作日志？该操作不可撤销。"
        variant="destructive"
        confirmText="清理"
        onConfirm={() => { clear.mutate(); setClearConfirm(false) }}
        onCancel={() => setClearConfirm(false)}
      />
      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>操作日志详情</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={METHOD_BADGE_CLASS}>{formatHttpMethod(detail.method)}</Badge>
                  <Badge variant="outline" className={RESULT_BADGE_CLASS[getStatusTone(detail.statusCode)]}>
                    {formatOperationResult(detail.path, detail.statusCode)}
                  </Badge>
                  {isSensitivePath(detail.path) && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                      敏感路径探测
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatOperator(detail.userName)} · {formatModuleName(detail.module)} · {formatApiPath(detail.path, detail.method, detail.statusCode)}
                </p>
              </div>

              <div className="grid gap-2">
                <DetailRow label="原始 HTTP 方法" value={detail.method} />
                <DetailRow label="原始接口路径" value={detail.path} />
                <DetailRow label="原始状态码" value={detail.statusCode} />
                <DetailRow label="原始模块名" value={detail.module} />
                <DetailRow label="原始操作人" value={detail.userName} />
                <DetailRow label="原始 IP" value={detail.ip} />
                <DetailRow label="userId" value={detail.userId} />
                <DetailRow label="时间" value={formatDisplayDateTime(detail.createdAt)} />
                <DetailRow label="createdAt" value={detail.createdAt} />
                <DetailRow label="日志 ID" value={detail.id} />
                <DetailRow label="请求内容" value={detail.requestBody} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
