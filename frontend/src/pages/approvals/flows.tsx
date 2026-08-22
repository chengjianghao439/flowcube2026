import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { getRolesApi } from '@/api/settings'
import { useDepartments } from '@/hooks/useDepartments'
import { useUsers } from '@/hooks/useUsers'
import {
  useApprovalFlows, useCreateApprovalFlow, useUpdateApprovalFlow, useDeleteApprovalFlow,
} from '@/hooks/useApprovals'
import { APPROVER_TYPE } from '@/types/approval'
import type { ApprovalFlow } from '@/types/approval'
import type { TableColumn } from '@/types'

const BIZ_TYPES = [
  { value: 'purchase_requisition', label: '采购请购单' },
  { value: 'sale_credit_override', label: '超额放行申请' },
  { value: 'expense_claim', label: '费用报销' },
  { value: 'purchase_order', label: '采购单' },
  { value: 'inventory_disposal', label: '呆滞处置单' },
  { value: 'product_price', label: '商品改价申请' },
]
const BIZ_LABEL: Record<string, string> = Object.fromEntries(BIZ_TYPES.map(b => [b.value, b.label]))
const APPROVER_LABEL: Record<number, string> = { [APPROVER_TYPE.ROLE]: '指定角色', [APPROVER_TYPE.DEPT_MANAGER]: '部门负责人', [APPROVER_TYPE.USER]: '指定用户' }

interface FlowDraft {
  bizType: string
  name: string
  minAmount: string
  maxAmount: string
  isActive: boolean
  remark: string
  steps: Array<{
    stepOrder: number
    approverType: number
    roleId: string
    departmentId: string
    userId: string
  }>
}
const emptyStep = (stepOrder: number) => ({ stepOrder, approverType: APPROVER_TYPE.ROLE, roleId: '', departmentId: '', userId: '' })
const emptyFlow = (): FlowDraft => ({ bizType: 'purchase_requisition', name: '', minAmount: '', maxAmount: '', isActive: true, remark: '', steps: [emptyStep(1)] })

export default function ApprovalFlowsPage() {
  const { data: flows = [] } = useApprovalFlows()
  const { mutate: createFlow } = useCreateApprovalFlow()
  const { mutate: updateFlow } = useUpdateApprovalFlow()
  const { mutate: deleteFlow } = useDeleteApprovalFlow()
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => getRolesApi().then(r => r || []) })
  const { data: departments = [] } = useDepartments()
  const { data: usersData } = useUsers({ pageSize: 500, keyword: '' })
  const users = usersData?.list ?? []

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ApprovalFlow | null>(null)
  const [form, setForm] = useState<FlowDraft>(emptyFlow())
  const [deleteTarget, setDeleteTarget] = useState<ApprovalFlow | null>(null)

  function openCreate() {
    setEditing(null)
    setForm(emptyFlow())
    setFormOpen(true)
  }
  function openEdit(f: ApprovalFlow) {
    setEditing(f)
    setForm({
      bizType: f.bizType,
      name: f.name,
      minAmount: String(f.minAmount),
      maxAmount: f.maxAmount == null ? '' : String(f.maxAmount),
      isActive: f.isActive,
      remark: f.remark ?? '',
      steps: (f.steps ?? []).map(s => ({
        stepOrder: s.stepOrder,
        approverType: s.approverType,
        roleId: s.roleId != null ? String(s.roleId) : '',
        departmentId: s.departmentId != null ? String(s.departmentId) : '',
        userId: s.userId != null ? String(s.userId) : '',
      })),
    })
    setFormOpen(true)
  }

  function setStep(index: number, patch: Partial<FlowDraft['steps'][number]>) {
    setForm(f => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }))
  }
  function addStep() {
    setForm(f => ({ ...f, steps: [...f.steps, emptyStep(f.steps.length + 1)] }))
  }
  function removeStep(index: number) {
    setForm(f => {
      const steps = f.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i + 1 }))
      return { ...f, steps }
    })
  }

  function handleSave() {
    if (!form.name.trim()) return toast.error('请填写流程名称')
    if (form.steps.length === 0) return toast.error('至少配置一个审批节点')
    for (const s of form.steps) {
      if (s.approverType === APPROVER_TYPE.ROLE && !s.roleId) return toast.error(`第 ${s.stepOrder} 级：审批人类型为「指定角色」时，必须选择角色`)
      if (s.approverType === APPROVER_TYPE.USER && !s.userId) return toast.error(`第 ${s.stepOrder} 级：审批人类型为「指定用户」时，必须选择用户`)
    }
    const payload = {
      bizType: form.bizType,
      name: form.name.trim(),
      minAmount: form.minAmount ? Number(form.minAmount) : 0,
      maxAmount: form.maxAmount === '' ? null : Number(form.maxAmount),
      isActive: form.isActive,
      remark: form.remark,
      steps: form.steps.map(s => ({
        stepOrder: s.stepOrder,
        approverType: s.approverType as typeof APPROVER_TYPE[keyof typeof APPROVER_TYPE],
        roleId: s.approverType === APPROVER_TYPE.ROLE ? Number(s.roleId) : null,
        departmentId: s.approverType === APPROVER_TYPE.DEPT_MANAGER ? (s.departmentId === '' ? 0 : Number(s.departmentId)) : null,
        userId: s.approverType === APPROVER_TYPE.USER ? Number(s.userId) : null,
      })),
    }
    const done = () => { setFormOpen(false); toast.success('已保存') }
    const fail = (e: Error) => toast.error(e.message)
    if (editing) updateFlow({ id: editing.id, data: payload }, { onSuccess: done, onError: fail })
    else createFlow(payload, { onSuccess: done, onError: fail })
  }

  const columns: TableColumn<ApprovalFlow>[] = [
    {
      key: 'bizType',
      title: '业务类型',
      width: 130,
      render: (v) => BIZ_LABEL[v as string] ?? v,
    },
    { key: 'name', title: '流程名称', width: 180 },
    {
      key: 'minAmount',
      title: '适用金额',
      width: 150,
      render: (_, row) => `¥${row.minAmount} ~ ${row.maxAmount == null ? '不限' : `¥${row.maxAmount}`}`,
    },
    {
      key: 'stepCount',
      title: '审批级数',
      width: 90,
      render: (v) => `${v} 级`,
    },
    {
      key: 'isActive',
      title: '状态',
      width: 80,
      render: (_, row) => <SoftStatusLabel label={row.isActive ? '启用' : '停用'} tone={row.isActive ? 'success' : 'draft'} />,
    },
    {
      key: 'id',
      title: '操作',
      width: 120,
      render: (_, row) => (
        <TableActionsMenu
          primaryLabel="编辑"
          primaryVariant="outline"
          onPrimaryClick={() => openEdit(row)}
          items={[{ label: '删除', destructive: true, separatorBefore: true, onClick: () => setDeleteTarget(row) }]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="审批流配置"
        description="按业务类型 + 金额区间配置多级审批节点（指定角色 / 部门负责人 / 指定用户）"
        actions={<Button onClick={openCreate}>新增审批流</Button>}
      />

      <DataTable columns={columns} data={flows} loading={false} rowKey="id" />

      <Dialog open={formOpen} onOpenChange={(v) => !v && setFormOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑审批流' : '新增审批流'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>业务类型</Label>
                <select
                  value={form.bizType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, bizType: e.target.value })}
                  disabled={!!editing}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {BIZ_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>流程名称</Label>
                <Input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} placeholder="如：请购多级审批" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>适用金额下限（含）</Label>
                <Input type="number" min={0} value={form.minAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, minAmount: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>适用金额上限（含，留空=不限）</Label>
                <Input type="number" min={0} value={form.maxAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, maxAmount: e.target.value })} placeholder="不限" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>审批节点（按顺序逐级审批）</Label>
                <Button size="sm" variant="outline" onClick={addStep}>+ 添加节点</Button>
              </div>
              {form.steps.map((s, i) => (
                <div key={i} className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">第 {s.stepOrder} 级</span>
                    {form.steps.length > 1 && (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeStep(i)}>移除</Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>审批人类型</Label>
                      <select
                        value={s.approverType}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStep(i, { approverType: Number(e.target.value) })}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value={APPROVER_TYPE.ROLE}>指定角色</option>
                        <option value={APPROVER_TYPE.DEPT_MANAGER}>部门负责人</option>
                        <option value={APPROVER_TYPE.USER}>指定用户</option>
                      </select>
                    </div>
                    {s.approverType === APPROVER_TYPE.ROLE && (
                      <div className="space-y-1">
                        <Label>角色</Label>
                        <select value={s.roleId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStep(i, { roleId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                          <option value="">选择角色</option>
                          {roles.map((r: { id: number; name: string }) => <option key={r.id} value={r.id}>{r.name}</option>)}                        </select>
                      </div>
                    )}
                    {s.approverType === APPROVER_TYPE.DEPT_MANAGER && (
                      <div className="space-y-1">
                        <Label>部门（留空=申请人所属部门）</Label>
                        <select value={s.departmentId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStep(i, { departmentId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                          <option value="">申请人所属部门</option>
                          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                    )}
                    {s.approverType === APPROVER_TYPE.USER && (
                      <div className="space-y-1">
                        <Label>用户</Label>
                        <select value={s.userId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStep(i, { userId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                          <option value="">选择用户</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.realName}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {form.steps.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  当前节点：{form.steps.map(s => APPROVER_LABEL[s.approverType]).join(' → ')}
                </p>
              )}
            </div>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isActive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, isActive: e.target.checked })} className="accent-primary" />
              <span className="text-sm">启用该流程</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={`确定删除审批流「${deleteTarget?.name}」吗？已被使用的流程不能删除，只能停用。`}
        variant="destructive"
        confirmText="删除"
        onConfirm={() => {
          if (deleteTarget) deleteFlow(deleteTarget.id, { onSuccess: () => { setDeleteTarget(null); toast.success('已删除') }, onError: (e: Error) => toast.error(e.message) })
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
