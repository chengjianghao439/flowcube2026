import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { FilterCard } from '@/components/shared/FilterCard'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { AppDialog } from '@/components/shared/AppDialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { assertKitReadOwner, readKitOwned, useKitBackup, useKits, useKitWrite } from '@/hooks/useKits'
import { usePermission } from '@/hooks/usePermission'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { PERMISSIONS } from '@/lib/permission-codes'
import { activeTone } from '@/lib/statusTone'
import { money } from '@/lib/format'
import { toast } from '@/lib/toast'
import type { KitReadOwner } from '@/api/kits'
import type { TableColumn } from '@/types'
import type { KitDefinition } from '@/types/kits'
import KitEditor from './KitEditor'

const KitsTable = memo(DataTable<KitDefinition>)
const EMPTY_KITS: KitDefinition[] = []
export default function KitsPage() {
  const { can } = usePermission()
  const canCreate = can(PERMISSIONS.PRODUCT_CREATE), canUpdate = can(PERMISSIONS.PRODUCT_UPDATE), canDelete = can(PERMISSIONS.PRODUCT_DELETE)
  const tabPath = useContext(TabPathContext), [locationParams] = useSearchParams(), navigate = useNavigate()
  const params = tabPath ? new URLSearchParams(tabPath.split('?')[1] || '') : locationParams
  const keyword = params.get('keyword') ?? ''
  const [editor, setEditor] = useState<number | 'new' | null>(null), [deleting, setDeleting] = useState<KitDefinition | null>(null)
  const query = useKits({ page: 1, pageSize: 100, keyword })
  const total = query.data?.pagination.total ?? 0
  function updateKeyword(search: string) {
    const values = new URLSearchParams(params)
    values.delete('page')
    if (search) values.set('keyword', search)
    else values.delete('keyword')
    navigate(`/kits${values.size ? `?${values}` : ''}`)
  }
  const columns = useMemo<TableColumn<KitDefinition>[]>(() => [
    { key: 'code', title: '编码', width: 130 }, { key: 'name', title: '配件名称', width: 220 },
    { key: 'categoryName', title: '分类', width: 140 }, { key: 'supplierName', title: '供应商', width: 180 },
    { key: 'unit', title: '单位', width: 80, render: (_, row) => row.unit || '套' },
    { key: 'spec', title: '型号', width: 140 }, { key: 'color', title: '颜色', width: 100 },
    { key: 'articleNumber', title: '供应商型号', width: 150 },
    { key: 'costPrice', title: '进价', width: 120, align: 'right', render: (_, row) => row.costPrice != null ? <span title={`¥${row.costPrice.toFixed(4)}`}>{money(row.costPrice)}</span> : '—' },
    ...(['A', 'B', 'C', 'D'] as const).map(level => ({ key: `salePrice${level}`, title: `价格${level}`, width: 120, align: 'right' as const, render: (_: unknown, row: KitDefinition) => {
      const price = row[`salePrice${level}`] ?? row.version?.[`salePrice${level}`] ?? row.salePriceA ?? row.version?.salePriceA ?? row.version?.referenceUnitPrice
      return price != null ? <span title={`¥${price.toFixed(4)}`}>{money(price)}</span> : '—'
    } })),
    { key: 'currentVersionId', title: '当前版本', width: 110, render: (_, row) => row.version?.versionNo ?? '—' },
    { key: 'revision', title: '资料修订', width: 100 },
    { key: 'components', title: '组件数', width: 90, render: (_, row) => row.version?.components.length ?? '—' },
    { key: 'isActive', title: '状态', width: 90, render: (_, row) => <SoftStatusLabel label={row.isActive ? '启用' : '停用'} tone={activeTone(row.isActive)} /> },
    { key: 'actions', title: '操作', width: 160, render: (_, row) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditor(row.id)}>{canUpdate ? '维护' : '查看'}</Button>{canDelete && <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>删除</Button>}</div> },
  ], [canUpdate, canDelete])
  return <div>
    <PageHeader title="成套配件"
        description={!query.isError && !query.isLoading && query.data?.truncated ? <><span role="status">已读取 {query.data.list.length.toLocaleString()} / 总匹配 {total.toLocaleString()} 条，请缩小查询范围。</span> 已保存的销售单保留原成交资料，库存按真实组件管理。</> : '已保存的销售单保留原成交资料，库存按真实组件管理。'}  actions={canCreate ? <Button onClick={() => setEditor('new')}>新增配件</Button> : undefined} />

    <FilterCard className="mb-4">
    <form key={keyword} className="flex w-full max-w-xl gap-2" onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('keyword'); updateKeyword(String(value ?? '').trim()) }}>
      <Input name="keyword" aria-label="搜索成套配件" defaultValue={keyword} maxLength={100} autoComplete="off" placeholder="按编码、名称、型号、颜色或供应商型号搜索" /><Button variant="outline" type="submit">查询</Button>{keyword && <Button variant="ghost" type="button" onClick={() => updateKeyword('')}>清空</Button>}
    </form>
    </FilterCard>
    {query.isError ? <QueryErrorState error={query.error} title="成套配件加载失败" onRetry={() => void query.refetch()} /> : <KitsTable columns={columns} data={query.data?.list ?? EMPTY_KITS} loading={query.isLoading} emptyText="暂无成套配件；有维护权限的员工可添加固定商品组成。" columnStorageKey="kits-v2" virtualized preserveFocus retainFocusedRow={editor != null || !!deleting} />}
    {!query.isError && !query.isLoading && query.data && !query.data.truncated && <ListSummary total={total} />}
    {editor != null && <KitEditor key={editor} id={editor} source={query.readOwner} onClose={() => setEditor(null)} />}
    {deleting && <DeleteKitDialog initial={deleting} readOwner={query.readOwner} onClose={() => setDeleting(null)} />}
  </div>
}
function DeleteKitDialog({ initial, readOwner, onClose }: { initial: KitDefinition; readOwner: KitReadOwner; onClose: () => void }) {
  const { can } = usePermission(), write = useKitWrite(readOwner)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [target, setTarget] = useState(initial), [error, setError] = useState(''), [reloading, setReloading] = useState(false)
  const backup = useKitBackup(JSON.stringify({ target, readOwner }), readOwner)
  const tabPath = useContext(TabPathContext)
  const locked = write.busy || !!write.pendingRecord || reloading
  useDirtyGuard(tabPath || '/kits', locked)
  const accept = (result: KitDefinition | null) => { if (result) { toast.success('成套配件已删除，历史订单保留原版本'); onClose() } }
  async function copy() {
    setError(''); await backup.copy(JSON.stringify(target, null, 2))
  }
  async function reload() {
    if (!backup.canReload() || locked) return
    setReloading(true)
    try {
      const latest = await readKitOwned(target.id, readOwner)
      if (!mounted.current) return
      assertKitReadOwner(readOwner); setTarget(latest); backup.invalidate(); setError('已重读，请再次核对要删除的配件名称和修订。')
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : '重读失败，原资料仍保留') }
    finally { if (mounted.current) setReloading(false) }
  }
  return <AppDialog descriptionInHeader description={<>{<>确认删除「{target.name}」（{target.code}）？资料修订 {target.revision}。</>} {<>删除后不能再用于新选择；已保存订单的组成、金额和历史版本仍保留。</>}</>} open dialogId="kit-delete" title="删除成套配件" defaultWidth={620} defaultHeight={380} minHeight={320} onOpenChange={open => { if (!open && !locked) onClose() }}
    footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={locked} onClick={onClose}>取消</Button>{can(PERMISSIONS.PRODUCT_DELETE) && <Button variant="destructive" disabled={write.busy || reloading || !!target.deletedAt} onClick={() => { setError(''); void (write.pendingRecord ? write.retry() : write.submit({ kind: 'delete', id: target.id, data: { revision: target.revision } })).then(accept) }}>{write.pendingRecord ? '按原请求重试' : '确认删除'}</Button>}</div>}>
    <div className="space-y-4 overflow-auto p-5">{(error || backup.error || write.error) && <p role="alert" className="text-sm text-destructive-ink">{error || (backup.error && (backup.text ? '复制失败，原资料仍保留；请重试复制后再重读。' : backup.error)) || write.error}</p>}{write.conflict && !write.pendingRecord && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copy()}>复制原资料</Button><Button variant="outline" disabled={!backup.copied || locked} onClick={() => void reload()}>重读待删资料</Button></div>}</div>
  </AppDialog>
}
