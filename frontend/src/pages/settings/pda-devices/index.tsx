/**
 * PDA 设备管理
 * 路由：/settings/pda-devices
 *
 * 每台 PDA 在这里登记后拿到「设备码 + 密钥」，现场用 PDA 扫二维码完成绑定。
 * 绑定之后，这台机器的每次作业都会带上设备身份：系统不只知道是谁在操作，
 * 还知道用的是哪台机器、这台机器属于哪个仓——绑了仓库的设备扫别仓的单据会被直接拒绝。
 *
 * 密钥只在「新增」和「重置密钥」之后显示这一次，关掉就再也拿不到（库里只存哈希）。
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  listPdaDevicesApi,
  createPdaDeviceApi,
  updatePdaDeviceApi,
  setPdaDeviceStatusApi,
  resetPdaDeviceSecretApi,
  buildBindingPayload,
  type PdaDevice,
  type PdaDeviceWithSecret,
  type PdaDeviceStatus,
} from '@/api/pda-devices'
import { getWarehousesActiveApi } from '@/api/warehouses'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import DataTable from '@/components/shared/DataTable'
import { FilterCard } from '@/components/shared/FilterCard'
import TableActionsMenu, { type TableActionItem } from '@/components/shared/TableActionsMenu'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import { toast } from '@/lib/toast'
import { formatDisplayDateTime } from '@/lib/dateTime'
import type { TableColumn } from '@/types'

const STATUS_LABEL: Record<PdaDeviceStatus, string> = {
  active: '启用中',
  disabled: '已停用',
  retired: '已报废',
}

const NO_WAREHOUSE = '__none__'

export default function PdaDevicesPage() {
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<{ deviceName: string; warehouseId: string }>({ deviceName: '', warehouseId: NO_WAREHOUSE })
  const [secretView, setSecretView] = useState<PdaDeviceWithSecret | null>(null)
  const [editing, setEditing] = useState<PdaDevice | null>(null)
  const [resetTarget, setResetTarget] = useState<PdaDevice | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['pda-devices', page, keyword],
    queryFn: () => listPdaDevicesApi({ page, pageSize: 20, keyword }),
  })
  const { data: warehouses } = useQuery({
    queryKey: ['warehouse-options'],
    queryFn: () => getWarehousesActiveApi(),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['pda-devices'] })

  const createMut = useMutation({
    mutationFn: () => createPdaDeviceApi({
      deviceName: form.deviceName.trim(),
      warehouseId: form.warehouseId === NO_WAREHOUSE ? null : Number(form.warehouseId),
    }),
    onSuccess: (device) => {
      setCreateOpen(false)
      setForm({ deviceName: '', warehouseId: NO_WAREHOUSE })
      setSecretView(device!)
      void refresh()
    },
  })

  const updateMut = useMutation({
    mutationFn: (payload: { id: number; deviceName: string; warehouseId: number | null }) =>
      updatePdaDeviceApi(payload.id, { deviceName: payload.deviceName, warehouseId: payload.warehouseId }),
    onSuccess: () => {
      toast.success('已保存')
      setEditing(null)
      void refresh()
    },
  })

  const statusMut = useMutation({
    mutationFn: (payload: { id: number; status: PdaDeviceStatus }) => setPdaDeviceStatusApi(payload.id, payload.status),
    onSuccess: () => { void refresh() },
  })

  const resetMut = useMutation({
    mutationFn: (id: number) => resetPdaDeviceSecretApi(id),
    onSuccess: (device) => {
      setResetTarget(null)
      setSecretView(device!)
      void refresh()
    },
  })

  const columns: TableColumn<PdaDevice>[] = [
    { key: 'deviceName', title: '设备名称', width: 16, render: v => (v as string) || '—' },
    { key: 'deviceCode', title: '设备码', width: 16, render: v => <span className="font-mono text-xs">{v as string}</span> },
    { key: 'warehouseName', title: '所属仓库', width: 14, render: v => (v as string) || <span className="text-muted-foreground">未绑定（可跨仓作业）</span> },
    {
      key: 'status', title: '状态', width: 10,
      render: (v) => {
        const status = v as PdaDeviceStatus
        return <SoftStatusLabel label={STATUS_LABEL[status]} tone={status === 'active' ? 'success' : 'draft'} />
      },
    },
    {
      key: 'activeSessions', title: '在用会话', width: 10,
      render: v => Number(v) > 0 ? <span className="text-emerald-600">{v as number}</span> : <span className="text-muted-foreground">0</span>,
    },
    { key: 'lastSeenAt', title: '最后在线', width: 14, render: v => v ? formatDisplayDateTime(v as string) : '从未连接' },
    {
      key: 'id', title: '操作', width: 20,
      render: (_, row) => {
        const items: TableActionItem[] = [
          { label: row.status === 'active' ? '停用' : '启用', onClick: () => statusMut.mutate({ id: row.id, status: row.status === 'active' ? 'disabled' : 'active' }) },
          { label: '重置密钥', destructive: true, separatorBefore: true, onClick: () => setResetTarget(row) },
        ]
        return <TableActionsMenu primaryLabel="编辑" primaryVariant="outline" onPrimaryClick={() => setEditing(row)} items={items} />
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="PDA 设备"
        description="登记 PDA 设备生成设备码与密钥，扫码绑定后即可现场作业；停用或重置密钥会立即吊销该机会话"
        actions={<Button onClick={() => setCreateOpen(true)}>登记新设备</Button>}
      />
      <FilterCard>
        <Input
          className="w-64"
          placeholder="搜索设备名称或设备码"
          value={keyword}
          onChange={e => { setKeyword(e.target.value); setPage(1) }}
        />
      </FilterCard>

      <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        绑定仓库后，这台 PDA 只能作业本仓的单据；未绑定的设备可在任何仓作业。
        停用设备或重置密钥会立即吊销该机在用的会话——设备丢失时请立即「停用」。
      </div>

      <DataTable
        columns={columns}
        data={data?.list ?? []}
        loading={isLoading}
        rowKey="id"
        fluid
        columnStorageKey="pda-devices:v1"
      />

      {(data?.pagination?.total ?? 0) > 20 && (
        <Pagination
          page={page}
          totalPages={Math.ceil((data?.pagination?.total ?? 0) / 20)}
          total={data?.pagination?.total ?? 0}
          unit="台"
          onPageChange={setPage}
        />
      )}

      {/* 登记新设备 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>登记新 PDA 设备</DialogTitle>
            <DialogDescription>
              登记后会生成设备码与密钥，密钥只显示一次，请立刻拿 PDA 扫码绑定。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-sm font-medium">设备名称</div>
              <Input
                placeholder="例如：一号仓收货机"
                value={form.deviceName}
                onChange={e => setForm(f => ({ ...f, deviceName: e.target.value }))}
              />
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">所属仓库</div>
              <Select value={form.warehouseId} onValueChange={v => setForm(f => ({ ...f, warehouseId: v }))}>
                <SelectTrigger><SelectValue placeholder="选择仓库" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WAREHOUSE}>不绑定（可在任何仓作业）</SelectItem>
                  {(warehouses ?? []).map(w => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                绑定后，这台机器扫其他仓库的收货单/上架单会被直接拒绝。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              disabled={!form.deviceName.trim() || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? '登记中…' : '登记并生成密钥'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 密钥与绑定二维码：仅此一次 */}
      <Dialog open={!!secretView} onOpenChange={open => { if (!open) setSecretView(null) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>用 PDA 扫这个码完成绑定</DialogTitle>
            <DialogDescription>
              密钥仅显示一次，关闭后不可再查看；如遗失，需重置密钥后重新绑定。
            </DialogDescription>
          </DialogHeader>
          {secretView && (
            <div className="space-y-3">
              <div className="flex justify-center rounded-xl bg-white p-4">
                <QRCodeSVG value={buildBindingPayload(secretView)} size={200} />
              </div>
              <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">设备名称</span>
                  <span>{secretView.deviceName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">设备码</span>
                  <span className="font-mono">{secretView.deviceCode}</span>
                </div>
                <div>
                  <div className="text-muted-foreground">密钥（扫码失败时可手动输入）</div>
                  <div className="mt-1 break-all rounded-lg bg-background p-2 font-mono text-xs">{secretView.deviceSecret}</div>
                </div>
              </div>
              {typeof secretView.revokedSessions === 'number' && secretView.revokedSessions > 0 && (
                <p className="text-xs text-destructive">
                  已吊销该设备原有的 {secretView.revokedSessions} 个会话，这台机器需要重新绑定才能继续作业。
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSecretView(null)}>我已完成绑定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑 */}
      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑设备</DialogTitle>
            <DialogDescription>改绑仓库会吊销这台机器当前的会话，需要重新登录。</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-sm font-medium">设备名称</div>
                <Input
                  value={editing.deviceName ?? ''}
                  onChange={e => setEditing(d => d && ({ ...d, deviceName: e.target.value }))}
                />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">所属仓库</div>
                <Select
                  value={editing.warehouseId == null ? NO_WAREHOUSE : String(editing.warehouseId)}
                  onValueChange={v => setEditing(d => d && ({ ...d, warehouseId: v === NO_WAREHOUSE ? null : Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_WAREHOUSE}>不绑定（可在任何仓作业）</SelectItem>
                    {(warehouses ?? []).map(w => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button
              disabled={!editing?.deviceName?.trim() || updateMut.isPending}
              onClick={() => editing && updateMut.mutate({
                id: editing.id,
                deviceName: editing.deviceName ?? '',
                warehouseId: editing.warehouseId,
              })}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!resetTarget}
        title="重置设备密钥"
        description={`「${resetTarget?.deviceName ?? ''}」的旧密钥将立即作废，这台机器当前会话会被吊销、必须重新扫码绑定才能继续作业。确定要重置吗？`}
        confirmText="重置密钥"
        onConfirm={() => resetTarget && resetMut.mutate(resetTarget.id)}
        onCancel={() => setResetTarget(null)}
      />
    </div>
  )
}
