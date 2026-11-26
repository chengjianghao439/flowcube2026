import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TabPathContext } from '@/components/layout/TabPathContext'
import PageHeader from '@/components/shared/PageHeader'
import DataTable from '@/components/shared/DataTable'
import ListSummary from '@/components/shared/ListSummary'
import { ProductIdentitySummary } from '@/components/shared/ProductIdentitySummary'
import { KeywordQueryChips, KeywordQueryDialog } from '@/components/shared/KeywordQueryDialog'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { AppDialog } from '@/components/shared/AppDialog'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import TableActionsMenu from '@/components/shared/TableActionsMenu'
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
  const [queryOpen, setQueryOpen] = useState(false)
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
    { key: 'name', title: '成套配件', width: 258, render: (_, row) => <ProductIdentitySummary product={row} /> },
    { key: 'categoryName', title: '分类 / 供应商', width: 154, render: (_, row) => (
      <div className="space-y-1">
        <div>{row.categoryName || '—'}</div>
        <div className="text-xs text-muted-foreground">{row.supplierName || '—'}</div>
      </div>
    ) },
    { key: 'unit', title: '单位', width: 62, render: (_, row) => row.unit || '套' },
    { key: 'costPrice', title: '进价', width: 106, align: 'right', render: (_, row) => row.costPrice != null ? <span className="tabular-nums" title={`¥${row.costPrice.toFixed(4)}`}>{money(row.costPrice)}</span> : '—' },
    { key: 'salePriceA', title: '价格A', width: 106, align: 'right', render: (_, row) => {
      const price = row.salePriceA ?? row.version?.salePriceA ?? row.version?.referenceUnitPrice
      return price != null ? <span className="tabular-nums" title={`¥${price.toFixed(4)}`}>{money(price)}</span> : '—'
    } },
    { key: 'components', title: '组件数', width: 76, align: 'right', render: (_, row) => <span className="tabular-nums">{row.version?.components.length ?? '—'}</span> },
    { key: 'isActive', title: '状态', width: 76, render: (_, row) => <SoftStatusLabel label={row.isActive ? '启用' : '停用'} tone={activeTone(row.isActive)} /> },
    { key: 'actions', title: '操作', width: 144, render: (_, row) => (
      <TableActionsMenu rowLabel={row.code} primaryVariant="outline" primaryLabel={canUpdate ? '维护' : '查看'} onPrimaryClick={() => setEditor(row.id)}
        items={canDelete ? [{ label: '删除', destructive: true, afterMenuClose: true, onClick: () => setDeleting(row) }] : []} />
    ) },
  ], [canUpdate, canDelete])
  return <div className="desktop-record-page space-y-4">
    <PageHeader title="成套配件"
        description={!query.isError && !query.isLoading && query.data?.truncated ? <><span role="status">已读取 {query.data.list.length.toLocaleString()} / 总匹配 {total.toLocaleString()} 条，请缩小查询范围。</span> 已保存的销售单保留原成交资料，库存按真实组件管理。</> : '已保存的销售单保留原成交资料，库存按真实组件管理。'}  actions={<>
          <Button variant="outline" onClick={() => setQueryOpen(true)}>查询</Button>
          {canCreate && <Button onClick={() => setEditor('new')}>新增配件</Button>}
        </>} />

    <KeywordQueryChips keyword={keyword} onClear={() => updateKeyword('')} />
    <KeywordQueryDialog open={queryOpen} dialogId="kits-query" title="查询成套配件"
      label="关键词" placeholder="按编码、名称、型号、颜色或供应商型号搜索" maxLength={100} initial={keyword}
      onClose={() => setQueryOpen(false)} onApply={value => updateKeyword(value.trim())} />
    {query.isError ? <QueryErrorState error={query.error} title="成套配件加载失败" onRetry={() => void query.refetch()} /> : <KitsTable columns={columns} data={query.data?.list ?? EMPTY_KITS} loading={query.isLoading} emptyText="暂无成套配件；有维护权限的员工可添加固定商品组成。" columnStorageKey="kits-v3" fluid scrollLabel="成套配件表格" virtualized preserveFocus retainFocusedRow={editor != null || !!deleting} />}
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
  return <AppDialog formDialog descriptionInHeader description={<>{<>确认删除「{target.name}」（{target.code}）？资料修订 {target.revision}。</>} {<>删除后不能再用于新选择；已保存订单的组成、金额和历史版本仍保留。</>}</>} open dialogId="kit-delete" title="删除成套配件" defaultWidth={620} defaultHeight={380} minHeight={320} onOpenChange={open => { if (!open && !locked) onClose() }}
    footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={locked} onClick={onClose}>取消</Button>{can(PERMISSIONS.PRODUCT_DELETE) && <Button variant="destructive" disabled={write.busy || reloading || !!target.deletedAt} onClick={() => { setError(''); void (write.pendingRecord ? write.retry() : write.submit({ kind: 'delete', id: target.id, data: { revision: target.revision } })).then(accept) }}>{write.pendingRecord ? '按原请求重试' : '确认删除'}</Button>}</div>}>
    <div className="space-y-4">{(error || backup.error || write.error) && <p role="alert" className="text-sm text-destructive-ink">{error || (backup.error && (backup.text ? '复制失败，原资料仍保留；请重试复制后再重读。' : backup.error)) || write.error}</p>}{write.conflict && !write.pendingRecord && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copy()}>复制原资料</Button><Button variant="outline" disabled={!backup.copied || locked} onClick={() => void reload()}>重读待删资料</Button></div>}</div>
  </AppDialog>
}
