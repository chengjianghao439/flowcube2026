/**
 * 打印机管理页面
 * 路由：/settings/printers
 * 添加打印机：仅在 FlowCube 桌面端从本机系统已安装列表中选择（与系统「打印机」设置一致）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/lib/toast'
import { IS_ELECTRON_DESKTOP } from '@/lib/platform'
import { ensureUniquePrinterCode, systemNameToPrinterCode } from '@/utils/printerCode'
import {
  normalizeSystemPrinterName,
  pickSystemPrinterRow,
  type SystemPrinterRow,
} from '@/utils/printerName'

/** 打印机硬件分类（与「绑定用途」独立：用途决定业务走哪台机；类型用于列表展示与无绑定时的兜底调度） */
const TYPE_LABEL: Record<number, string> = {
  1: '标签打印机',
  2: '面单打印机',
  3: 'A4打印机',
}

const TYPE_COLOR: Record<number, string> = {
  1: 'bg-blue-50 text-blue-700 border-blue-200',
  2: 'bg-purple-50 text-purple-700 border-purple-200',
  3: 'bg-gray-50 text-gray-700 border-gray-200',
}

const BIND_TYPES = [
  { key: 'waybill', label: '电子面单', desc: '快递面单等' },
  { key: 'product_label', label: '商品标签', desc: '商品条码、PDA 商品标等' },
  { key: 'inventory_label', label: '库存标签', desc: '库存盘点、通用库存 ZPL' },
  { key: 'rack_label', label: '货架标签', desc: '货架仓位条码；未单独绑定时使用「库存标签」绑定' },
  { key: 'container_label', label: '散件容器标签', desc: '入库容器等；未单独绑定时使用「库存标签」绑定' },
] as const

type BindType = (typeof BIND_TYPES)[number]['key']

interface Printer {
  id: number
  name: string
  code: string
  type: number
  typeName: string
  /** 本机 RAW：zpl 斑马系；tspl 通用 TSPL 标签机 */
  labelRawFormat?: 'zpl' | 'tspl'
  description: string
  status: number
  warehouseId?: number | null
  source?: string
  clientId?: string
  clientAliasName?: string | null
  clientHostname?: string | null
  clientDisplayName?: string | null
  createdAt: string
}

type BindingMap = Record<string, { print_type: string; printer_code: string; printer_name: string }>

interface BindDialogProps {
  printer: Printer
  bindings: BindingMap
  /** 已绑定本机时再次点击同项 → 解除绑定 */
  onToggleBind: (type: BindType, printer: Printer) => void
  busy: boolean
  onClose: () => void
}

function BindDialog({ printer, bindings, onToggleBind, busy, onClose }: BindDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[22rem] max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <p className="mb-1 font-semibold text-foreground">绑定业务用途</p>
        <p className="mb-1 text-sm text-muted-foreground">
          {printer.name} <span className="font-mono text-xs">({printer.code})</span>
        </p>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          与添加打印机时的「设备类型」不同：此处指定各业务场景使用哪台机。已绑定本项时再次点击可解除绑定。
        </p>
        <div className="space-y-2">
          {BIND_TYPES.map(t => {
            const isBound = bindings[t.key]?.printer_code === printer.code
            const currentCode = bindings[t.key]?.printer_code
            return (
              <button
                key={t.key}
                type="button"
                disabled={busy}
                onClick={() => onToggleBind(t.key, printer)}
                className={[
                  'w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-60',
                  isBound ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-border hover:bg-muted/40',
                ].join(' ')}
              >
                <div className="font-medium">{t.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground leading-snug">{t.desc}</div>
                {currentCode && !isBound && (
                  <div className="mt-1 text-xs text-amber-700">当前已绑：{currentCode}</div>
                )}
                {isBound && <div className="mt-1 text-xs font-medium text-blue-700">✓ 已绑定本机 · 再点解除</div>}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          关闭
        </button>
      </div>
    </div>
  )
}

function sourceBadgeLabel(source?: string) {
  if (source === 'client') return 'client'
  if (source === 'local_desktop') return '本机'
  return 'manual'
}

export default function PrintersPage() {
  const qc = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [systemList, setSystemList] = useState<SystemPrinterRow[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string>('')
  const [addType, setAddType] = useState<1 | 2 | 3>(1)
  const [bindTarget, setBindTarget] = useState<Printer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Printer | null>(null)
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({})

  const canUseSystemPrinters =
    IS_ELECTRON_DESKTOP && typeof window.flowcubeDesktop?.getSystemPrinters === 'function'

  const { data: printers = [], isLoading } = useQuery<Printer[]>({
    queryKey: ['printers'],
    queryFn: () => apiClient.get('/printers').then(r => r.data.data),
  })

  const existingCodes = useMemo(() => new Set(printers.map(p => p.code)), [printers])
  /** 与 RAW 打印侧规范化一致，避免「已添加」与系统枚举因 Unicode 不一致漏判 */
  const existingNamesNormalized = useMemo(
    () => new Set(printers.map(p => normalizeSystemPrinterName(p.name))),
    [printers],
  )

  const { data: bindings = {} } = useQuery<BindingMap>({
    queryKey: ['printer-bindings'],
    queryFn: () => apiClient.get('/printer-bindings').then(r => r.data.data),
  })

  const updateLabelFmt = useMutation({
    mutationFn: async (printer: Printer) => {
      await apiClient.put(`/printers/${printer.id}`, {
        name: printer.name,
        code: printer.code,
        type: printer.type,
        description: printer.description ?? '',
        status: printer.status,
        warehouseId: printer.warehouseId ?? null,
        labelRawFormat: printer.labelRawFormat ?? 'zpl',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printers'] })
      toast.success('已更新 RAW 指令集')
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '保存失败'),
  })

  const loadSystemPrinters = useCallback(async () => {
    if (!canUseSystemPrinters) {
      setListError('请在 FlowCube 桌面客户端中打开本页，以读取本机已安装打印机。')
      setSystemList([])
      return
    }
    setListLoading(true)
    setListError(null)
    try {
      const raw = await window.flowcubeDesktop!.getSystemPrinters!()
      const list = (Array.isArray(raw) ? raw : []).filter(
        (p): p is SystemPrinterRow =>
          !!p &&
          typeof p.name === 'string' &&
          normalizeSystemPrinterName(p.name).length > 0,
      )
      setSystemList(list)
      setSelectedName(prev => {
        if (!prev) return ''
        return list.some(q => q.name === prev) ? prev : ''
      })
      if (!list.length) {
        setListError('未检测到本机打印机，请在系统设置中先安装打印机后再试。')
      }
    } catch {
      setListError('读取本机打印机失败，请重试。')
      setSystemList([])
    } finally {
      setListLoading(false)
    }
  }, [canUseSystemPrinters])

  useEffect(() => {
    if (showAddDialog && canUseSystemPrinters) {
      void loadSystemPrinters()
      setSelectedName('')
      setAddType(1)
    }
  }, [showAddDialog, canUseSystemPrinters, loadSystemPrinters])

  const addPrinter = useMutation({
    mutationFn: async (payload: { name: string; code: string; type: number; description: string | null }) => {
      await apiClient.post('/printers', { ...payload, source: 'local_desktop' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printers'] })
      toast.success('已添加')
      setShowAddDialog(false)
      setSelectedName('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '添加失败'),
  })

  const del = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/printers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printers'] })
      toast.success('已删除')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const toggleStatus = useMutation({
    mutationFn: (p: Printer) => apiClient.put(`/printers/${p.id}`, { ...p, status: p.status === 1 ? 0 : 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printers'] }),
  })

  const bindMutation = useMutation({
    mutationFn: ({ type, printer }: { type: BindType; printer: Printer }) =>
      apiClient.put(`/printer-bindings/${type}`, { printerId: printer.id }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['printer-bindings'] })
      toast.success(`已绑定 ${vars.printer.code} → ${BIND_TYPES.find(t => t.key === vars.type)?.label}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '绑定失败'),
  })

  const unbindMutation = useMutation({
    mutationFn: (type: BindType) => apiClient.delete(`/printer-bindings/${encodeURIComponent(type)}`),
    onSuccess: (_, type) => {
      qc.invalidateQueries({ queryKey: ['printer-bindings'] })
      toast.success(`已解除「${BIND_TYPES.find(t => t.key === type)?.label}」绑定`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '解除绑定失败'),
  })

  const bindBusy = bindMutation.isPending || unbindMutation.isPending

  function togglePrinterBinding(type: BindType, printer: Printer) {
    const row = bindings[type]
    const isBoundHere = row?.printer_code === printer.code
    if (isBoundHere) {
      unbindMutation.mutate(type)
    } else {
      bindMutation.mutate({ type, printer })
    }
  }

  const aliasMutation = useMutation({
    mutationFn: ({ clientId, aliasName }: { clientId: string; aliasName: string }) =>
      apiClient.put(`/printers/clients/${clientId}/alias`, { aliasName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printers'] })
      toast.success('设备名称已更新')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '更新设备名称失败'),
  })

  function getBoundLabels(code: string): string {
    return BIND_TYPES.filter(t => bindings[t.key]?.printer_code === code).map(t => t.label).join(' / ')
  }

  function getDeviceName(p: Printer): string {
    return p.clientAliasName || p.clientHostname || p.clientId || '-'
  }

  function saveAlias(p: Printer) {
    if (!p.clientId) return
    const aliasName = (aliasDraft[p.clientId] ?? p.clientAliasName ?? '').trim()
    aliasMutation.mutate({ clientId: p.clientId, aliasName })
  }

  async function confirmAddFromSystem() {
    if (!canUseSystemPrinters || !selectedName) {
      toast.error('请选择本机打印机')
      return
    }
    let fresh: SystemPrinterRow[] = []
    try {
      fresh = await window.flowcubeDesktop!.getSystemPrinters!()
    } catch {
      toast.error('无法再次确认本机打印机列表，请重试')
      return
    }
    const picked = pickSystemPrinterRow(fresh, selectedName)
    if (!picked) {
      toast.error('所选打印机不在当前系统已安装列表中，请重新选择或刷新列表')
      return
    }
    const name = picked.name
    const baseCode = systemNameToPrinterCode(name)
    const code = ensureUniquePrinterCode(baseCode, existingCodes)
    const description = `本机系统打印机`
    addPrinter.mutate({ name, code, type: addType, description })
  }

  function openAddDialog() {
    if (!canUseSystemPrinters) {
      toast.error('添加打印机需在 FlowCube 桌面客户端中操作，以便读取本机已安装打印机。')
      return
    }
    setShowAddDialog(true)
  }

  const selectableSystemPrinters = useMemo(() => {
    return systemList.map(row => ({
      ...row,
      alreadyInErp: existingNamesNormalized.has(normalizeSystemPrinterName(row.name)),
    }))
  }, [systemList, existingNamesNormalized])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-page-title">打印机管理</h2>
        <Button onClick={openAddDialog}>+ 添加打印机</Button>
      </div>

      {IS_ELECTRON_DESKTOP && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-semibold text-foreground">本机打印标签（RAW）</h3>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            无需填写任何网络地址。请使用下方「从本机添加」，在系统已安装的打印机里选中您的标签机，并在用途中绑定「库存标签」等；打印时软件会按该打印机在系统中的名称自动出纸。请勿随意修改 ERP
            里该打印机的「名称」，以免与系统不一致导致打不出来。
          </p>
        </div>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>从本机添加打印机</DialogTitle>
            <DialogDescription>
              仅可选择当前操作系统中已安装的打印机（与「设置 → 打印机」列表一致）。浏览器中无法枚举本机设备，请使用桌面客户端。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {listLoading && <p className="text-sm text-muted-foreground">正在读取本机打印机…</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!listLoading && !listError && systemList.length > 0 && (
              <>
                <div>
                  <label className="text-label mb-1 block">本机打印机 *</label>
                  <Select value={selectedName} onValueChange={setSelectedName}>
                    <SelectTrigger className="input w-full">
                      <SelectValue placeholder="请选择" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableSystemPrinters.map(p => (
                        <SelectItem key={p.name} value={p.name} disabled={p.alreadyInErp}>
                          {p.displayName || p.name}
                          {p.isDefault ? ' （默认）' : ''}
                          {p.alreadyInErp ? ' — 已在系统中' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-label mb-1 block">设备类型 *</label>
                  <Select value={String(addType)} onValueChange={v => setAddType(+v as 1 | 2 | 3)}>
                    <SelectTrigger className="input w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">标签打印机（ZPL 热敏等）</SelectItem>
                      <SelectItem value="2">面单打印机</SelectItem>
                      <SelectItem value="3">A4 / 文档打印机</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    此为硬件分类，与下方列表中的「绑定用途」无关。实际打印走哪台机请在添加后使用「绑定用途」指定（如商品标签、货架标签等）。
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  保存时将自动生成符合规则的编码，并与列表中已有编码去重。
                </p>
              </>
            )}
            {!listLoading && canUseSystemPrinters && systemList.length === 0 && !listError && (
              <p className="text-sm text-muted-foreground">暂无数据，请点击刷新重试。</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => void loadSystemPrinters()} disabled={listLoading}>
              刷新列表
            </Button>
            <Button
              type="button"
              onClick={() => void confirmAddFromSystem()}
              disabled={
                addPrinter.isPending ||
                listLoading ||
                !selectedName ||
                selectableSystemPrinters.find(p => p.name === selectedName)?.alreadyInErp === true
              }
            >
              {addPrinter.isPending ? '添加中…' : '确认添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">名称</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">编码</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">类型</th>
              <th
                className="px-4 py-3 text-left font-medium text-muted-foreground"
                title="本机 RAW：ZPL 适用于斑马等；TSPL 适用于通用 TSPL 标签机"
              >
                RAW
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">状态</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">来源</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">所属设备</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">绑定</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
            )}
            {!isLoading && printers.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">暂无打印机</td></tr>
            )}
            {printers.map(p => (
              <tr key={p.id} className="hover:bg-muted/20">
                <td className="px-4 py-3 font-medium text-foreground">
                  {p.name}
                  {p.description && <span className="ml-2 text-xs text-muted-foreground">{p.description}</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.code}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_COLOR[p.type]}`}>{TYPE_LABEL[p.type]}</span>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={p.labelRawFormat ?? 'zpl'}
                    onValueChange={v =>
                      updateLabelFmt.mutate({ ...p, labelRawFormat: v as 'zpl' | 'tspl' })
                    }
                    disabled={updateLabelFmt.isPending}
                  >
                    <SelectTrigger className="h-8 w-[92px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zpl">ZPL</SelectItem>
                      <SelectItem value="tspl">TSPL</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleStatus.mutate(p)} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${p.status === 1 ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className={`text-xs ${p.status === 1 ? 'text-green-600' : 'text-muted-foreground'}`}>{p.status === 1 ? '在线' : '离线'}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={`rounded-full border px-2 py-0.5 ${p.source === 'client' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : p.source === 'local_desktop' ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                    {sourceBadgeLabel(p.source)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {p.clientId ? (
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">🖥️ {getDeviceName(p)}</div>
                      <div className="flex items-center gap-2">
                        <input
                          className="input h-8 w-44"
                          placeholder={p.clientHostname || p.clientId}
                          value={aliasDraft[p.clientId] ?? p.clientAliasName ?? ''}
                          onChange={e => setAliasDraft(s => ({ ...s, [p.clientId!]: e.target.value }))}
                        />
                        <Button size="sm" variant="outline" onClick={() => saveAlias(p)} disabled={aliasMutation.isPending}>
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : '-'}
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="outline" onClick={() => setBindTarget(p)}>绑定用途</Button>
                  {getBoundLabels(p.code) && <div className="mt-1 text-xs text-blue-700">{getBoundLabels(p.code)}</div>}
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(p)}>删除</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bindTarget && (
        <BindDialog
          printer={bindTarget}
          bindings={bindings}
          busy={bindBusy}
          onToggleBind={(type, printer) => togglePrinterBinding(type, printer)}
          onClose={() => setBindTarget(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={deleteTarget ? `确定删除打印机「${deleteTarget.name}」(${deleteTarget.code})？` : ''}
        variant="destructive"
        confirmText="删除"
        loading={del.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          del.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
