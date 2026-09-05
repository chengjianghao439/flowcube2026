/**
 * 货架管理
 * 路由：/racks
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { activeTone } from '@/lib/statusTone'
import { getRacksApi, createRackApi, updateRackApi, deleteRackApi, printRackLabelApi, scanRackHintApi } from '@/api/racks'
import { getWarehousesActiveApi } from '@/api/warehouses'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
import type { TableColumn } from '@/types'
import type { Rack } from '@/types/racks'
import { RACK_STATUS_OPTIONS } from '@/types/racks'
import { getLocalPrintEnvironmentKind } from '@/lib/desktopLocalPrint'
import { printQueueFeedback, triggerPrintPoll } from '@/lib/printQueue'
import { downloadExport } from '@/lib/exportDownload'
import RackQueryDialog, { type RackQueryValues } from './RackQueryDialog'
import BaseCrudPage from '@/components/shared/BaseCrudPage'

const defaultForm = {
  warehouseId: 0, zone: '', code: '', name: '',
  maxLevels: 5, maxPositions: 10, status: 1, remark: '',
}

export default function RacksPage() {
  const [keyword, setKeyword] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState<number | null>(null)
  const [warehouseName, setWarehouseName] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [queryOpen, setQueryOpen] = useState(false)
  const [form, setForm] = useState(defaultForm)
  const [scanRaw, setScanRaw] = useState('')
  const [page, setPage] = useState(1)

  const { data: whData } = useQuery({
    queryKey: ['warehouses-simple'],
    queryFn: () => getWarehousesActiveApi().then(r => r ?? []),
  })

  // 打开弹窗时回填表单（新建=默认值，编辑=行数据）
  function handleOpen(editing: Rack | null) {
    if (editing) {
      setForm({
        warehouseId:  editing.warehouseId,
        zone:         editing.zone ?? '',
        code:         editing.code,
        name:         editing.name ?? '',
        maxLevels:    editing.maxLevels,
        maxPositions: editing.maxPositions,
        status:       editing.status,
        remark:       editing.remark ?? '',
      })
    } else {
      setForm(defaultForm)
    }
    setScanRaw('')
  }

  // ── 查询弹窗筛选值 ──
  const initialQuery: RackQueryValues = {
    keyword, warehouseId: warehouseFilter, warehouseName, zone: zoneFilter,
  }
  function applyQuery(v: RackQueryValues) {
    setKeyword(v.keyword)
    setWarehouseFilter(v.warehouseId)
    setWarehouseName(v.warehouseName)
    setZoneFilter(v.zone)
    setPage(1)
    setQueryOpen(false)
  }
  function clearAll() { setKeyword(''); setWarehouseFilter(null); setWarehouseName(''); setZoneFilter(''); setPage(1) }

  // 当前生效筛选摘要（可逐项移除）
  const chips = [
    keyword && { key: 'keyword', label: `关键字：${keyword}`, onRemove: () => setKeyword('') },
    warehouseFilter && { key: 'warehouse', label: `仓库：${warehouseName || (whData ?? []).find((w: { id: number; name: string }) => w.id === warehouseFilter)?.name || warehouseFilter}`, onRemove: () => { setWarehouseFilter(null); setWarehouseName('') } },
    zoneFilter && { key: 'zone', label: `区域：${zoneFilter}`, onRemove: () => setZoneFilter('') },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[]

  // 扫码校验（新建弹窗内选填）
  const hintMut = useMutation({
    mutationFn: () =>
      scanRackHintApi({
        warehouseId: form.warehouseId,
        rackCode:    form.code,
        scanRaw:     scanRaw.trim(),
      }, { skipGlobalError: true }),
    onSuccess: (res) => {
      if (res.kind === 'binding' || res.kind === 'warn') toast.warning(res.message)
      else if (res.kind === 'invalid') toast.error(res.message)
      else toast.success(res.message)
    },
    onError: (e: unknown) =>
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '扫描校验失败'),
  })

  const printMut = useMutation({
    mutationFn: (id: number) => printRackLabelApi(id),
    onSuccess: (d) => {
      if (!d) return
      if (!d.queued) {
        toast.warning('未绑定打印机或离线')
        return
      }
      triggerPrintPoll()
      const fb = printQueueFeedback(d.dispatchHint)
      if (fb.level === 'warning') toast.warning(fb.message)
      else toast.success(fb.message)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '打印失败'),
  })

  const localPrintEnv = getLocalPrintEnvironmentKind()

  const columns: TableColumn<Rack>[] = [
    {
      key: 'barcode',
      title: '货架条码',
      width: 220,
      render: (v) =>
        v ? <span className="text-doc-code-strong">{v as string}</span> : <span className="text-muted-foreground">—</span>,
    },
    { key: 'code', title: '编码', width: 100 },
    { key: 'zone', title: '库区', width: 72, render: v => (v as string) || '—' },
    { key: 'name', title: '名称', width: 180, render: v => (v as string) || '—' },
    { key: 'warehouseName', title: '仓库', width: 140 },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (_, row) => (
        <SoftStatusLabel label={row.status === 1 ? '启用' : '停用'} tone={activeTone(row.status === 1)} />
      ),
    },
  ]

  return (
    <>
      <BaseCrudPage<Rack>
        title="货架管理"
        description="货架唯一条码（H）与标签打印"
        columns={columns}
        queryKey={['racks', keyword, warehouseFilter, zoneFilter, page]}
        listQuery={() =>
          getRacksApi({
            pageSize: 20,
            page,
            keyword,
            warehouseId: warehouseFilter ?? undefined,
            zone: zoneFilter || undefined,
          })
        }
        pagination={{ page, pageSize: 20, unit: '个', onPageChange: setPage }}
        deleteApi={(id) => deleteRackApi(id, { skipGlobalError: true })}
        deleteMessage="若库位或库存仍指向该货架编码，将禁止删除。"
        createLabel="+ 新建货架"
        saveSuccessMessage={(editing) => editing ? '货架已保存' : '货架已创建'}
        formWidthClass="sm:max-w-2xl"
        onOpen={handleOpen}
        canSubmit={(editing) => !!form.code && (!!editing || !!form.warehouseId)}
        headerActions={
          <>
            <Button variant="outline" onClick={() => downloadExport('/export/racks').catch(e => toast.error((e as Error).message))}>导出</Button>
            <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          </>
        }
        renderToolbar={
          <>
            {localPrintEnv !== 'ok' && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
                  localPrintEnv === 'electron_no_bridge'
                    ? 'border-destructive/50 bg-destructive/5 text-destructive'
                    : 'border-amber-500/50 bg-amber-500/5 text-amber-950 dark:text-amber-100'
                }`}
              >
                {localPrintEnv === 'browser' ? (
                  <>
                    <strong>当前页面无法本机出纸：</strong>
                    检测到在普通浏览器中打开，不会调用 Windows
                    打印队列，故「打印队列里什么也没有」是正常现象。请安装并打开
                    <strong> 极序 Flow ERP 桌面客户端</strong>
                    ，在桌面程序里登录同一服务器后再点「打印」。
                  </>
                ) : (
                  <>
                    <strong>桌面端未加载本机打印桥接：</strong>
                    无法向标签机送 RAW。请完全退出后重启极序 Flow ERP；仍不行请检查安全软件是否拦截预加载脚本。在控制台执行{' '}
                    <code className="rounded bg-muted px-1">typeof window.flowcubeDesktop?.printZpl</code> 应显示{' '}
                    <code className="rounded bg-muted px-1">&quot;function&quot;</code>。
                  </>
                )}
              </div>
            )}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {chips.map(c => (
                  <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                    {c.label}
                    <button type="button" onClick={c.onRemove} className="text-muted-foreground/70 hover:text-foreground" aria-label={`移除筛选 ${c.label}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <Button size="sm" variant="ghost" onClick={clearAll}>清空</Button>
              </div>
            )}
          </>
        }
        renderActions={(row, helpers) => (
          <TableActionsMenu
            primaryLabel="打印"
            primaryVariant="outline"
            primaryDisabled={printMut.isPending && printMut.variables === row.id}
            onPrimaryClick={() => printMut.mutate(row.id)}
            items={[
              {
                label: '删除',
                destructive: true,
                separatorBefore: true,
                onClick: () => helpers.openDelete(row),
              },
            ]}
          />
        )}
        renderForm={(editing) => {
          const isEdit = !!editing
          return (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>所属仓库 *</Label>
                {isEdit ? (
                  <Input value={editing?.warehouseName ?? ''} disabled className="bg-muted/50 text-sm" />
                ) : (
                  <Select
                    value={form.warehouseId ? String(form.warehouseId) : '__none__'}
                    onValueChange={v => setForm(f => ({ ...f, warehouseId: v === '__none__' ? 0 : +v }))}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="请选择仓库" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">请选择仓库</SelectItem>
                      {whData?.map(w => (
                        <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {!isEdit && (
                <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/15 px-3 py-3">
                  <Label className="text-xs text-muted-foreground">扫码校验（选填）</Label>
                  <p className="text-xs text-muted-foreground">
                    填写仓库与货架编码后，可扫 H / P / I 或商品编码，检查条码冲突或在库绑定提示。
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={scanRaw}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScanRaw(e.target.value)}
                      placeholder="扫描或粘贴条码后回车"
                      className="font-mono text-sm"
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter' && scanRaw.trim()) {
                          e.preventDefault()
                          if (!form.warehouseId || !form.code.trim()) {
                            toast.warning('请先选择仓库并填写货架编码')
                            return
                          }
                          hintMut.mutate()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full shrink-0 sm:w-40"
                      disabled={hintMut.isPending || !form.warehouseId || !form.code.trim()}
                      onClick={() => {
                        const s = scanRaw.trim()
                        if (!s) { toast.warning('请先输入或扫描条码'); return }
                        if (!form.warehouseId || !form.code.trim()) {
                          toast.warning('请先选择仓库并填写货架编码')
                          return
                        }
                        hintMut.mutate()
                      }}
                    >
                      {hintMut.isPending ? '校验中…' : '校验'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>库区</Label>
                  <Input
                    value={form.zone}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, zone: e.target.value }))}
                    placeholder="A"
                    maxLength={20}
                  />
                </div>
                <div className="space-y-2">
                  <Label>货架编码 *</Label>
                  <Input
                    value={form.code}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, code: e.target.value }))}
                    placeholder="A01"
                    maxLength={50}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>货架名称</Label>
                <Input
                  value={form.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="货架名称（选填）"
                  maxLength={100}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>最大层数</Label>
                  <Input
                    type="number" min={1} max={99}
                    value={form.maxLevels}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, maxLevels: +e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>每层位数</Label>
                  <Input
                    type="number" min={1} max={99}
                    value={form.maxPositions}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, maxPositions: +e.target.value }))}
                  />
                </div>
              </div>

              {isEdit && (
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select value={String(form.status)} onValueChange={v => setForm(f => ({ ...f, status: +v }))}>
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RACK_STATUS_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>备注</Label>
                <Input
                  value={form.remark}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, remark: e.target.value }))}
                  placeholder="备注信息"
                />
              </div>
            </div>
          )
        }}
        submitForm={(editing) => {
          if (editing) {
            return updateRackApi(editing.id, {
              zone:         form.zone         || undefined,
              code:         form.code         || undefined,
              name:         form.name         || undefined,
              maxLevels:    form.maxLevels,
              maxPositions: form.maxPositions,
              status:       form.status,
              remark:       form.remark       || undefined,
            })
          }
          return createRackApi({
            warehouseId:  form.warehouseId,
            zone:         form.zone         || undefined,
            code:         form.code,
            name:         form.name         || undefined,
            maxLevels:    form.maxLevels,
            maxPositions: form.maxPositions,
            remark:       form.remark       || undefined,
          })
        }}
      />
      <RackQueryDialog
        open={queryOpen}
        initial={initialQuery}
        onClose={() => setQueryOpen(false)}
        onApply={applyQuery}
      />
    </>
  )
}
