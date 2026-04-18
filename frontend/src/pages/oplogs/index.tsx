import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getOpLogsApi, clearLogsApi } from '@/api/oplogs'
import { usePermission } from '@/hooks/usePermission'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { OpLog } from '@/api/oplogs'
import type { TableColumn } from '@/types'
import { PERMISSIONS } from '@/lib/permission-codes'

const METHOD_COLOR: Record<string,'default'|'secondary'|'destructive'|'outline'> = { GET:'secondary', POST:'default', PUT:'outline', DELETE:'destructive', PATCH:'outline' }
const MODULE_LABELS: Record<string, string> = { auth:'认证', users:'用户', warehouses:'仓库', suppliers:'供应商', products:'商品', inventory:'库存', customers:'客户', purchase:'采购', sale:'销售', stockcheck:'盘点', transfer:'调拨', returns:'退货', payments:'账款', settings:'设置' }

export default function OpLogsPage() {
  const { can } = usePermission()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [module, setModule] = useState('')
  const [clearConfirm, setClearConfirm] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['oplogs', { page, keyword, module }], queryFn: () => getOpLogsApi({ page, pageSize: 30, keyword, module }).then(r => r.data.data!) })
  const clear = useMutation({ mutationFn: clearLogsApi, onSuccess: () => qc.invalidateQueries({ queryKey: ['oplogs'] }) })

  const columns: TableColumn<OpLog>[] = [
    { key: 'createdAt', title: '时间', width: 160, render: (v) => formatDisplayDateTime(v) },
    { key: 'userName', title: '操作人', width: 90 },
    { key: 'method', title: '方法', width: 70, render: (v) => <Badge variant={METHOD_COLOR[String(v)] || 'secondary'}>{String(v)}</Badge> },
    { key: 'module', title: '模块', width: 80, render: (v) => MODULE_LABELS[String(v)] || String(v) },
    { key: 'path', title: '接口路径' },
    { key: 'statusCode', title: '状态码', width: 80, render: (v) => <span className={Number(v) >= 400 ? 'text-red-500 font-medium' : 'text-green-600'}>{String(v)}</span> },
    { key: 'ip', title: 'IP', width: 120 },
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
            {Object.entries(MODULE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
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
    </div>
  )
}
