import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import { FocusModePanel } from '@/components/shared/FocusModePanel'
import { ExecutionBridgePanel } from '@/components/shared/ExecutionBridgePanel'
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
import { bindCustomerApi } from '@/api/price-lists'
import type { Customer } from '@/types/customers'
import type { TableColumn } from '@/types'

const PRICE_LEVELS = ['A', 'B', 'C', 'D'] as const

export default function CustomersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [bindOpen, setBindOpen] = useState(false)
  const [bindCustomer, setBindCustomer] = useState<Customer | null>(null)
  const [selectedPriceLevel, setSelectedPriceLevel] = useState<'A' | 'B' | 'C' | 'D'>('A')

  const { data, isLoading } = useCustomers({ page, pageSize: 20, keyword })
  const del = useDeleteCustomer()
  const [confirmTarget, setConfirmTarget] = useState<Customer | null>(null)
  const bindMut = useMutation({
    mutationFn: () => bindCustomerApi(bindCustomer!.id, selectedPriceLevel),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setBindOpen(false); setBindCustomer(null) }
  })

  const openBind = (c: Customer) => {
    setBindCustomer(c)
    setSelectedPriceLevel((c.priceLevel ?? 'A') as 'A' | 'B' | 'C' | 'D')
    setBindOpen(true)
  }

  const columns: TableColumn<Customer>[] = [
    { key: 'code', title: '编码', width: 120 },
    { key: 'name', title: '客户名称' },
    { key: 'contact', title: '联系人', width: 100 },
    { key: 'phone', title: '电话', width: 130 },
    { key: 'email', title: '邮箱', width: 160 },
    { key: 'priceLevelName' as keyof Customer, title: '价格等级', width: 120, render: (_, row) => <Badge variant="outline" className="text-primary border-primary/30">价格{row.priceLevel ?? 'A'}</Badge> },
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
      <PageHeader title="客户管理" description="管理销售客户档案，可绑定价格 A / B / C / D" actions={<Button onClick={()=>{ setEditing(null); setDialogOpen(true) }}>+ 新增客户</Button>} />
      <FocusModePanel
        badge="经营侧闭环"
        title="客户页负责维护销售前置资料，并把后续处理交给销售、对账和提醒入口"
        description="这页最适合先确认客户档案和价格等级，再继续去销售单、对账基础版或审批与提醒处理后续业务。客户页不直接承担执行闭环，但要把经营侧入口串起来。"
        summary={bindCustomer ? `当前操作：绑定价格等级 - ${bindCustomer.name}` : '当前焦点：客户资料维护'}
        steps={[
          '先维护客户档案、联系人和默认价格等级，保证下销售单时价格和对象都准确。',
          '需要核对销售回款时，优先切到对账基础版和应收账款页。',
          '遇到高风险订单、低毛利或系统提醒时，再回审批与提醒和岗位工作台继续处理。',
        ]}
        actions={[
          { label: '打开对账基础版', variant: 'default', onClick: () => navigate('/reports/reconciliation?type=2') },
          { label: '打开应收账款', onClick: () => navigate('/payments') },
          { label: '打开审批与提醒', onClick: () => navigate('/reports/approvals') },
        ]}
      />
      <ExecutionBridgePanel
        badge="ERP / 处理执行桥接"
        title="客户页统一承接经营判断与后续业务处理动作"
        description="ERP 在这里负责判断客户资料、价格等级、启停状态是否适合继续承接销售业务；实际处理动作则通过销售单、对账、应收账款和提醒入口继续推进，避免客户页只停在资料维护。"
        erpTitle="先在 ERP 判断客户资料、价格策略和风险状态"
        erpItems={[
          '先确认客户联系人、启停状态和默认价格等级，保证销售建单不会带错对象或价格。',
          '如果客户存在高风险订单、低毛利或未收回款项，优先在 ERP 层判断是否需要先收口风险。',
          '客户资料变更完成后，再决定回销售单、对账页还是审批页继续处理。',
        ]}
        pdaTitle="再通过经营处理入口完成真实业务推进"
        pdaItems={[
          '需要继续成交时，回销售单和仓库任务主链推进实际业务。',
          '需要核对回款时，回对账基础版和应收账款页继续登记与追溯。',
          '如果客户问题最终落到仓库或异常执行，再由岗位工作台和异常工作台承接后续动作。',
        ]}
        actions={[
          { label: '打开销售单', variant: 'default', onClick: () => navigate('/sale') },
          { label: '打开对账基础版', onClick: () => navigate('/reports/reconciliation?type=2') },
          { label: '打开应收账款', onClick: () => navigate('/payments') },
        ]}
      />
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
