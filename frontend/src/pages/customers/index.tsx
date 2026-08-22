import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import Pagination from '@/components/shared/Pagination'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone, type StatusTone } from '@/lib/statusTone'
import { SETTLEMENT_TYPE, SETTLEMENT_TYPE_TONE } from '@/generated/status'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { downloadExport } from '@/lib/exportDownload'
import { useCustomers, useDeleteCustomer } from '@/hooks/useCustomers'
import CustomerFormDialog from './components/CustomerFormDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { bindCustomerApi } from '@/api/price-lists'
import type { Customer } from '@/types/customers'
import type { TableColumn } from '@/types'

const PRICE_LEVELS = ['A', 'B', 'C', 'D'] as const
const PAGE_SIZE = 20

export default function CustomersPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [bindOpen, setBindOpen] = useState(false)
  const [bindCustomer, setBindCustomer] = useState<Customer | null>(null)
  const [selectedPriceLevel, setSelectedPriceLevel] = useState<'A' | 'B' | 'C' | 'D'>('A')

  const { data, isLoading } = useCustomers({ page, pageSize: PAGE_SIZE, keyword })
  const total = data?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const del = useDeleteCustomer()
  const [confirmTarget, setConfirmTarget] = useState<Customer | null>(null)
  const bindMut = useMutation({
    mutationFn: () => bindCustomerApi(bindCustomer!.id, selectedPriceLevel, { skipGlobalError: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setBindOpen(false); setBindCustomer(null); toast.success('价格等级已绑定') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '绑定失败'),
  })

  const openBind = (c: Customer) => {
    setBindCustomer(c)
    setSelectedPriceLevel((c.priceLevel ?? 'A') as 'A' | 'B' | 'C' | 'D')
    setBindOpen(true)
  }

  const columns: TableColumn<Customer>[] = [
    { key: 'code', title: '编码', width: 120 },
    { key: 'name', title: '客户名称', width: 180 },
    { key: 'contact', title: '联系人', width: 100 },
    { key: 'phone', title: '电话', width: 130 },
    { key: 'email', title: '邮箱', width: 160 },
    { key: 'priceLevelName' as keyof Customer, title: '价格等级', width: 120, render: (_, row) => <SoftStatusLabel label={`价格${row.priceLevel ?? 'A'}`} tone="info" /> },
    { key: 'settlementType', title: '结算方式', width: 110, render: (_, row) => (
      <SoftStatusLabel
        label={row.settlementType === SETTLEMENT_TYPE.MONTHLY ? `月结 ${row.paymentTermsDays} 天` : row.settlementTypeName}
        tone={(SETTLEMENT_TYPE_TONE[String(row.settlementType) as keyof typeof SETTLEMENT_TYPE_TONE] ?? 'info') as StatusTone}
      />
    ) },
    { key: 'creditLimit', title: '授信额度', width: 110, align: 'right', render: (_, row) => row.creditLimit == null
      ? <span className="text-xs text-muted-foreground">未启用</span>
      : <span className="tabular-nums">¥{Number(row.creditLimit).toFixed(2)}</span> },
    { key: 'isActive', title: '状态', width: 70, render:(v)=> <SoftStatusLabel label={v ? '启用' : '停用'} tone={activeTone(v as boolean)} /> },
    { key: 'id', title: '操作', width: 120, render:(_, row)=>(
      <TableActionsMenu
        primaryLabel="编辑"
        primaryVariant="outline"
        onPrimaryClick={()=>{ setEditing(row as Customer); setDialogOpen(true) }}
        items={[
          { label: '绑定价格', onClick:()=>openBind(row as Customer) },
          { label: '删除', onClick:()=> setConfirmTarget(row as Customer), destructive: true, separatorBefore: true },
        ]}
      />
    )}
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="客户管理" description="管理销售客户档案，可绑定价格 A / B / C / D" actions={
        <>
          <Button variant="outline" onClick={() => downloadExport('/export/customers').catch(e => toast.error((e as Error).message))}>导出</Button>
          <Button onClick={()=>{ setEditing(null); setDialogOpen(true) }}>+ 新增客户</Button>
        </>
      } />
      <FilterCard>
        <Input placeholder="搜索编码/名称…" value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-64" onKeyDown={(e: React.KeyboardEvent)=>{ if(e.key==='Enter'){ setKeyword(search); setPage(1) } }} />
        <Button size="sm" variant="outline" onClick={()=>{ setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{ setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list||[]} loading={isLoading} />
      <Pagination page={page} totalPages={totalPages} total={total} unit="个" onPageChange={setPage} />
      <CustomerFormDialog open={dialogOpen} onClose={()=>setDialogOpen(false)} customer={editing} />
      <ConfirmDialog
        open={!!confirmTarget}
        title="确认删除"
        description={`删除客户「${confirmTarget?.name}」？仅未被销售、退货或任务引用的客户允许删除；若已被引用，请改为编辑后停用。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { del.mutate(confirmTarget!.id); setConfirmTarget(null) }}
        onCancel={() => setConfirmTarget(null)}
      />

      {/* 绑定价格等级弹窗 */}
      <Dialog open={bindOpen} onOpenChange={setBindOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>绑定价格等级 — {bindCustomer?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">选择客户默认价格等级，下销售单时会自动带入对应的 A / B / C / D 价格。</p>
            <Select value={selectedPriceLevel} onValueChange={v => setSelectedPriceLevel(v as 'A' | 'B' | 'C' | 'D')}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="选择价格等级" />
              </SelectTrigger>
              <SelectContent>
                {PRICE_LEVELS.map(level => (
                  <SelectItem key={level} value={level}>价格{level}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindOpen(false)}>取消</Button>
            <Button onClick={() => bindMut.mutate()} disabled={bindMut.isPending}>保存绑定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
