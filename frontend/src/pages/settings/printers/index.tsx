/**
 * 打印机管理页面
 * 路由：/settings/printers
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '@/api/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

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
  { key: 'waybill', label: '面单打印机' },
  { key: 'product_label', label: '商品标签机' },
  { key: 'inventory_label', label: '库存标签机' },
] as const

type BindType = (typeof BIND_TYPES)[number]['key']

interface Printer {
  id: number
  name: string
  code: string
  type: number
  typeName: string
  description: string
  status: number
  source?: string
  clientId?: string
  clientAliasName?: string | null
  clientHostname?: string | null
  clientDisplayName?: string | null
  createdAt: string
}

type BindingMap = Record<string, { print_type: string; printer_code: string; printer_name: string }>

const EMPTY_FORM = { name: '', code: '', type: 1, description: '' }

interface BindDialogProps {
  printer: Printer
  bindings: BindingMap
  onBind: (type: BindType, printer: Printer) => void
  onClose: () => void
}

function BindDialog({ printer, bindings, onBind, onClose }: BindDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-80 rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <p className="mb-1 font-semibold text-foreground">绑定打印机用途</p>
        <p className="mb-4 text-sm text-muted-foreground">
          {printer.name} <span className="font-mono text-xs">({printer.code})</span>
        </p>
        <div className="space-y-2">
          {BIND_TYPES.map(t => {
            const isBound = bindings[t.key]?.printer_code === printer.code
            const currentCode = bindings[t.key]?.printer_code
            return (
              <button
                key={t.key}
                onClick={() => onBind(t.key, printer)}
                className={[
                  'w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                  isBound ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-border hover:bg-muted/40',
                ].join(' ')}
              >
                <span className="font-medium">{t.label}</span>
                {currentCode && !isBound && (
                  <span className="ml-2 text-xs text-muted-foreground">（当前：{currentCode}）</span>
                )}
                {isBound && <span className="ml-2 text-xs">✓ 已绑定</span>}
              </button>
            )
          })}
        </div>
        <button onClick={onClose} className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground">
          取消
        </button>
      </div>
    </div>
  )
}

export default function PrintersPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [bindTarget, setBindTarget] = useState<Printer | null>(null)
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({})

  const { data: printers = [], isLoading } = useQuery<Printer[]>({
    queryKey: ['printers'],
    queryFn: () => apiClient.get('/printers').then(r => r.data.data),
  })

  const { data: bindings = {} } = useQuery<BindingMap>({
    queryKey: ['printer-bindings'],
    queryFn: () => apiClient.get('/printer-bindings').then(r => r.data.data),
  })

  const save = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) =>
      editId ? apiClient.put(`/printers/${editId}`, body) : apiClient.post('/printers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printers'] })
      toast.success(editId ? '已更新' : '已添加')
      setShowForm(false)
      setEditId(null)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '操作失败'),
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
      setBindTarget(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '绑定失败'),
  })

  const aliasMutation = useMutation({
    mutationFn: ({ clientId, aliasName }: { clientId: string; aliasName: string }) =>
      apiClient.put(`/printers/clients/${clientId}/alias`, { aliasName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printers'] })
      toast.success('设备名称已更新')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '更新设备名称失败'),
  })

  function openEdit(p: Printer) {
    setEditId(p.id)
    setForm({ name: p.name, code: p.code, type: p.type, description: p.description || '' })
    setShowForm(true)
  }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-page-title">打印机管理</h2>
        <Button onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_FORM) }}>+ 添加打印机</Button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 font-semibold text-foreground">{editId ? '编辑打印机' : '添加打印机'}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-label mb-1 block">打印机名称 *</label>
              <input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：仓库标签机" />
            </div>
            <div>
              <label className="text-label mb-1 block">打印机编码 *</label>
              <input className="input w-full" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="如：LABEL_01" />
            </div>
            <div>
              <label className="text-label mb-1 block">类型 *</label>
              <select className="input w-full" value={form.type} onChange={e => setForm(f => ({ ...f, type: +e.target.value }))}>
                <option value={1}>标签打印机</option>
                <option value={2}>面单打印机</option>
                <option value={3}>A4打印机</option>
              </select>
            </div>
            <div>
              <label className="text-label mb-1 block">备注</label>
              <input className="input w-full" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="可选" />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name || !form.code}>
              {save.isPending ? '保存中...' : '保存'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null) }}>取消</Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">名称</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">编码</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">类型</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">状态</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">来源</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">所属设备</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">绑定</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
            )}
            {!isLoading && printers.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">暂无打印机</td></tr>
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
                  <button onClick={() => toggleStatus.mutate(p)} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${p.status === 1 ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className={`text-xs ${p.status === 1 ? 'text-green-600' : 'text-muted-foreground'}`}>{p.status === 1 ? '在线' : '离线'}</span>
                  </button>
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={`rounded-full border px-2 py-0.5 ${p.source === 'client' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                    {p.source === 'client' ? 'client' : 'manual'}
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
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>编辑</Button>
                    <Button size="sm" variant="destructive" onClick={() => { if (confirm('确认删除？')) del.mutate(p.id) }}>删除</Button>
                  </div>
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
          onBind={(type, printer) => bindMutation.mutate({ type, printer })}
          onClose={() => setBindTarget(null)}
        />
      )}
    </div>
  )
}
