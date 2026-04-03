import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCustomers, useDeleteCustomer } from '@/hooks/useCustomers'
import CustomerFormDialog from './components/CustomerFormDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { getPriceListsApi, bindCustomerApi } from '@/api/price-lists'
import type { Customer } from '@/types/customers'
import type { TableColumn } from '@/types'

export default function CustomersPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [bindOpen, setBindOpen] = useState(false)
  const [bindCustomer, setBindCustomer] = useState<Customer | null>(null)
  const [selectedListId, setSelectedListId] = useState<string>('')

  const { data, isLoading } = useCustomers({ page, pageSize: 20, keyword })
  const del = useDeleteCustomer()
  const [confirmTarget, setConfirmTarget] = useState<Customer | null>(null)
  const { data: priceLists } = useQuery({ queryKey: ['price-lists'], queryFn: () => getPriceListsApi().then(r => r.data.data || []) })
  const bindMut = useMutation({
    mutationFn: () => bindCustomerApi(bindCustomer!.id, selectedListId ? +selectedListId : null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setBindOpen(false); setBindCustomer(null) }
  })

  const openBind = (c: Customer) => {
    setBindCustomer(c)
    setSelectedListId((c as Customer & { priceListId?: number }).priceListId ? String((c as Customer & { priceListId?: number }).priceListId) : '')
    setBindOpen(true)
  }

  const columns: TableColumn<Customer>[] = [
    { key: 'code', title: '编码', width: 120 },
    { key: 'name', title: '客户名称' },
    { key: 'contact', title: '联系人', width: 100 },
    { key: 'phone', title: '电话', width: 130 },
    { key: 'email', title: '邮箱', width: 160 },
    { key: 'priceListName' as keyof Customer, title: '价格表', width: 120, render: (v) => v ? <Badge variant="outline" className="text-primary border-primary/30">{String(v)}</Badge> : <span className="text-muted-foreground text-xs">默认价</span> },
    { key: 'isActive', title: '状态', width: 70, render:(v)=> <Badge variant={v ? 'default' : 'secondary'}>{v ? '启用' : '停用'}</Badge> },
    { key: 'id', title: '操作', width: 160, render:(_, row)=>(
      <TableActionsMenu
        primaryLabel="编辑"
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
      <PageHeader title="客户管理" description="管理销售客户档案，可绑定专属价格表" actions={<Button onClick={()=>{ setEditing(null); setDialogOpen(true) }}>+ 新增客户</Button>} />
      <FilterCard>
        <Input placeholder="搜索编码/名称..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="h-9 w-64" onKeyDown={(e: React.KeyboardEvent)=>{ if(e.key==='Enter'){ setKeyword(search); setPage(1) } }} />
        <Button size="sm" variant="outline" onClick={()=>{ setKeyword(search); setPage(1) }}>搜索</Button>
        {keyword && <Button size="sm" variant="ghost" onClick={()=>{ setSearch(''); setKeyword(''); setPage(1) }}>重置</Button>}
      </FilterCard>
      <DataTable columns={columns} data={data?.list||[]} loading={isLoading} pagination={data?.pagination} onPageChange={setPage} />
      <CustomerFormDialog open={dialogOpen} onClose={()=>setDialogOpen(false)} customer={editing} />
      <ConfirmDialog
        open={!!confirmTarget}
        title="确认删除"
        description={`删除客户「${confirmTarget?.name}」？该操作不可撤销。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => { del.mutate(confirmTarget!.id); setConfirmTarget(null) }}
        onCancel={() => setConfirmTarget(null)}
      />

      {/* 绑定价格表弹窗 */}
      <Dialog open={bindOpen} onOpenChange={setBindOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>绑定价格表 — {bindCustomer?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">选择一个价格表绑定到此客户，下销售单时将自动带入专属价格。</p>
            <Select value={selectedListId || '__none__'} onValueChange={v => setSelectedListId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="选择价格表" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">不使用价格表（默认售价）</SelectItem>
                {priceLists?.filter(p => p.isActive).map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!priceLists?.length && <p className="text-xs text-muted-foreground">暂无可用价格表，请先在「价格管理」中创建。</p>}
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
