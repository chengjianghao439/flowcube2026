import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, CheckCircle2, Plus, UserPlus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import { SectionCard } from '@/components/shared/SectionCard'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { usePermission } from '@/hooks/usePermission'
import { PERMISSIONS } from '@/lib/permission-codes'
import { money } from '@/lib/format'
import { todayYmd } from '@/lib/dateTime'
import { createRequestKey } from '@/lib/requestKey'
import {
  calculateHrPayrollApi,
  createHrEmployeeApi,
  createHrPayrollApi,
  getHrEmployeesApi,
  getHrPayrollDetailApi,
  getHrPayrollsApi,
  payHrPayrollApi,
  updateHrPayrollLineApi,
  type HrPayroll,
} from '@/api/hr'

const PAYROLL_STATUS: Record<number, { label: string; tone: 'draft' | 'info' | 'success' }> = {
  1: { label: '草稿', tone: 'draft' },
  2: { label: '已核算', tone: 'info' },
  3: { label: '已发放', tone: 'success' },
}

export default function HrPayrollPage() {
  const { can } = usePermission()
  const canManage = can(PERMISSIONS.ACCOUNTING_VOUCHER_MANAGE)
  const qc = useQueryClient()

  const defaultPeriod = todayYmd().slice(0, 7).replace('-', '')
  const [selectedPayrollId, setSelectedPayrollId] = useState<number | null>(null)
  const [empDialogOpen, setEmpDialogOpen] = useState(false)
  const [payrollDialogOpen, setPayrollDialogOpen] = useState(false)
  const [empName, setEmpName] = useState('')
  const [empNo, setEmpNo] = useState('')
  const [empDept, setEmpDept] = useState('')
  const [newPeriod, setNewPeriod] = useState(defaultPeriod)
  const [grossDrafts, setGrossDrafts] = useState<Record<number, string>>({})

  const employeesQuery = useQuery({
    queryKey: ['hr-employees'],
    queryFn: () => getHrEmployeesApi({ page: 1, pageSize: 100 }),
  })
  const payrollsQuery = useQuery({
    queryKey: ['hr-payrolls'],
    queryFn: () => getHrPayrollsApi({ page: 1, pageSize: 50 }),
  })
  const detailQuery = useQuery({
    queryKey: ['hr-payroll-detail', selectedPayrollId],
    queryFn: () => getHrPayrollDetailApi(selectedPayrollId!),
    enabled: selectedPayrollId != null,
  })

  const createEmp = useMutation({
    mutationFn: () => createHrEmployeeApi({
      name: empName.trim(),
      empNo: empNo.trim() || undefined,
      departmentName: empDept.trim() || null,
    }),
    onSuccess: () => {
      toast.success('员工已创建')
      setEmpDialogOpen(false)
      setEmpName('')
      setEmpNo('')
      setEmpDept('')
      void qc.invalidateQueries({ queryKey: ['hr-employees'] })
    },
  })

  const createPayroll = useMutation({
    mutationFn: () => createHrPayrollApi(newPeriod.trim()),
    onSuccess: (res) => {
      toast.success('工资单已创建')
      setPayrollDialogOpen(false)
      void qc.invalidateQueries({ queryKey: ['hr-payrolls'] })
      if (res?.id) setSelectedPayrollId(res.id)
    },
  })

  const saveLine = useMutation({
    mutationFn: ({ payrollId, lineId, gross }: { payrollId: number; lineId: number; gross: number }) =>
      updateHrPayrollLineApi(payrollId, lineId, gross, createRequestKey()),
    onSuccess: () => {
      toast.success('应发工资已保存')
      void qc.invalidateQueries({ queryKey: ['hr-payroll-detail', selectedPayrollId] })
      void qc.invalidateQueries({ queryKey: ['hr-payrolls'] })
    },
  })

  const calcPayroll = useMutation({
    mutationFn: (id: number) => calculateHrPayrollApi(id),
    onSuccess: () => {
      toast.success('工资核算完成')
      void qc.invalidateQueries({ queryKey: ['hr-payroll-detail', selectedPayrollId] })
      void qc.invalidateQueries({ queryKey: ['hr-payrolls'] })
    },
  })

  const payPayroll = useMutation({
    mutationFn: (id: number) => payHrPayrollApi(id, todayYmd()),
    onSuccess: () => {
      toast.success('工资已发放')
      void qc.invalidateQueries({ queryKey: ['hr-payroll-detail', selectedPayrollId] })
      void qc.invalidateQueries({ queryKey: ['hr-payrolls'] })
    },
  })

  const employees = employeesQuery.data?.list ?? []
  const payrolls = payrollsQuery.data?.list ?? []
  const detail = detailQuery.data

  return (
    <div className="space-y-4">
      <PageHeader
        title="工资管理"
        description="维护员工档案、按月录入应发工资并完成社保个税核算与发放。"
        actions={canManage ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setEmpDialogOpen(true)}>
              <UserPlus className="h-4 w-4" />新增员工
            </Button>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setPayrollDialogOpen(true)}>
              <Plus className="h-4 w-4" />新建工资单
            </Button>
          </div>
        ) : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <SectionCard title={`月度工资单（${payrolls.length}）`} compact noPadding>
            {payrolls.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">暂无工资单</p>
            ) : (
              <div className="divide-y divide-border/50">
                {payrolls.map((p: HrPayroll) => {
                  const st = PAYROLL_STATUS[p.status] ?? { label: '未知', tone: 'draft' as const }
                  const active = selectedPayrollId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedPayrollId(p.id); setGrossDrafts({}) }}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 ${active ? 'bg-primary/5' : ''}`}
                    >
                      <div>
                        <div className="font-medium text-foreground">{p.period} · {p.payrollNo}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          人数 {p.empCount} · 应发 {money(p.totalGross)} · 实发 {money(p.totalNet)}
                        </div>
                      </div>
                      <SoftStatusLabel label={st.label} tone={st.tone} />
                    </button>
                  )
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard title={`员工档案（${employees.length}）`} compact noPadding>
            {employees.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">暂无员工档案，请先新增员工</p>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
                {employees.map(emp => (
                  <div key={emp.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <span className="font-medium">{emp.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{emp.empNo}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{emp.departmentName || '未分部门'}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="lg:col-span-7">
          <SectionCard
            title={detail ? `工资明细 · ${detail.period}（${detail.payrollNo}）` : '工资明细'}
            compact
            noPadding
            actions={detail && canManage ? (
              <div className="flex items-center gap-2">
                {detail.status === 1 && (
                  <Button size="sm" variant="outline" className="h-8 gap-1" disabled={calcPayroll.isPending}
                    onClick={() => calcPayroll.mutate(detail.id)}>
                    <Calculator className="h-3.5 w-3.5" />核算个税
                  </Button>
                )}
                {detail.status === 2 && (
                  <Button size="sm" className="h-8 gap-1" disabled={payPayroll.isPending}
                    onClick={() => payPayroll.mutate(detail.id)}>
                    <CheckCircle2 className="h-3.5 w-3.5" />确认发放
                  </Button>
                )}
              </div>
            ) : undefined}
          >
            {!detail ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">请从左侧选择一张工资单查看明细</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">员工</th>
                      <th className="px-3 py-2 text-right font-medium">应发工资</th>
                      <th className="px-3 py-2 text-right font-medium">个人社保</th>
                      <th className="px-3 py-2 text-right font-medium">个税</th>
                      <th className="px-3 py-2 text-right font-medium">实发工资</th>
                      {detail.status === 1 && canManage && <th className="px-3 py-2 text-center font-medium">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {detail.lines.map(line => {
                      const draft = grossDrafts[line.id] ?? (line.gross !== null ? String(line.gross) : '')
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{line.employeeName}</span>
                            <span className="ml-1.5 font-mono text-xs text-muted-foreground">{line.empNo}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {detail.status === 1 && canManage ? (
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft}
                                placeholder="录入金额"
                                aria-label={`${line.employeeName}应发工资`}
                                onChange={e => setGrossDrafts(prev => ({ ...prev, [line.id]: e.target.value }))}
                                className="ml-auto h-8 w-28 text-right text-sm tabular-nums"
                              />
                            ) : (line.gross !== null ? money(line.gross) : '未录入')}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(line.socialPersonal)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(line.tax)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{money(line.net)}</td>
                          {detail.status === 1 && canManage && (
                            <td className="px-3 py-2 text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={saveLine.isPending || draft.trim() === '' || Number.isNaN(Number(draft))}
                                onClick={() => saveLine.mutate({ payrollId: detail.id, lineId: line.id, gross: Number(draft) })}
                              >
                                保存
                              </Button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <AppDialog dialogId="hr-employee-create" open={empDialogOpen} onOpenChange={setEmpDialogOpen} title="新增员工" formDialog>
        <div className="fc-form-dialog-body space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">员工姓名</span>
            <Input className="h-9" value={empName} onChange={e => setEmpName(e.target.value)} placeholder="请输入姓名" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">工号（选填）</span>
            <Input className="h-9" value={empNo} onChange={e => setEmpNo(e.target.value)} placeholder="留空自动生成" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">部门（选填）</span>
            <Input className="h-9" value={empDept} onChange={e => setEmpDept(e.target.value)} placeholder="例如：仓储部" />
          </label>
        </div>
        <div className="fc-form-dialog-footer">
          <Button variant="outline" className="h-9" onClick={() => setEmpDialogOpen(false)}>取消</Button>
          <Button className="h-9" disabled={!empName.trim() || createEmp.isPending} onClick={() => createEmp.mutate()}>保存</Button>
        </div>
      </AppDialog>

      <AppDialog dialogId="hr-payroll-create" open={payrollDialogOpen} onOpenChange={setPayrollDialogOpen} title="新建月度工资单" formDialog>
        <div className="fc-form-dialog-body space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">发放期间（YYYYMM）</span>
            <Input className="h-9" value={newPeriod} onChange={e => setNewPeriod(e.target.value)} placeholder="例如 202611" />
          </label>
        </div>
        <div className="fc-form-dialog-footer">
          <Button variant="outline" className="h-9" onClick={() => setPayrollDialogOpen(false)}>取消</Button>
          <Button className="h-9" disabled={!/^[1-9]\d{3}(0[1-9]|1[0-2])$/.test(newPeriod.trim()) || createPayroll.isPending} onClick={() => createPayroll.mutate()}>创建</Button>
        </div>
      </AppDialog>
    </div>
  )
}
