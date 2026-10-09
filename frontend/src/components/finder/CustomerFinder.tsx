import type { CustomerAddressGuard } from '@/hooks/useCustomerAddresses'
import { useSectionActive } from '@/components/layout/SectionVisibilityContext'
import type { KitReadOwner } from '@/api/kits'
import { assertKitReadOwner } from '@/hooks/useKits'
import { toast } from '@/lib/toast'
import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useState, useRef, useEffect, useMemo } from 'react'
import { Users } from 'lucide-react'
import { FinderModal } from './FinderModal'
import { useCustomers } from '@/hooks/useCustomers'
import type { FinderResult, FinderColumn } from '@/types/finder'
import type { Customer } from '@/types/customers'

export interface CustomerFinderProps {
  compact?: boolean
  readOwner?: KitReadOwner
  readGuard?: CustomerAddressGuard
  open: boolean
  onClose: () => void
  onConfirm: (result: FinderResult) => void
}

type Row = Customer & Record<string, unknown>

const COLUMNS: FinderColumn<Row>[] = [
  { key: 'name', title: '客户 / 编码', render: (_, row) => <RecordIdentity title={row.name} code={row.code} /> },
  { key: 'contact', title: '联系人', width: 140 },
  { key: 'phone', title: '联系电话', width: 180 },
]

const COMPACT_COLUMNS: FinderColumn<Row>[] = [
  { key: 'code', title: '编码', width: 120, render: value => <span className="font-mono text-xs text-muted-foreground">{String(value ?? '—')}</span> },
  { key: 'name', title: '客户名称' },
  { key: 'contact', title: '联系人', width: 140 },
  { key: 'phone', title: '联系电话', width: 160 },
]

export function CustomerFinder({ open, onClose, onConfirm, readOwner, readGuard, compact = false }: CustomerFinderProps) {
  const active = useSectionActive(), latest = useRef({ open, active, readGuard })
  latest.current = { open, active, readGuard }
  const current = () => latest.current.open && latest.current.active && (!latest.current.readGuard || latest.current.readGuard.isCurrent())
  const visible = readGuard ? current() : open
  // The controller belongs to this visibility/owner epoch; reopening aborts the old read.
  const readLifecycle = useMemo(() => ({ controller: new AbortController(), visible, epoch: readGuard?.epoch }), [visible, readGuard?.epoch])
  const abort = readLifecycle.controller
  useEffect(() => () => abort.abort(), [abort])
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')
  // 只存 id：选中行一律从**当前启用列表**派生 ⇒ 后台刷新后拿到的是最新值，
  // 行被移除/停用则派生为 null，页脚自动禁用（不会回传列表之外的过期对象）。
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const confirmed = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Reset state when dialog closes；**同时清掉未落定的 debounce**，否则旧 timer 会在重开后
  // 把 searchText 改回上一个词，而 keyword 已被清空 ⇒ 两者永久不相等、永远 pending。
  // 返回的 cleanup 在**卸载/依赖变化**时同样清 timer，避免离开页面后还残留本组件的定时器。
  useEffect(() => {
    confirmed.current = false
    if (!open) {
      clearTimeout(debounceRef.current)
      setKeyword(''); setSearchText(''); setSelectedId(null)
    }
    return () => clearTimeout(debounceRef.current)
  }, [open])

  const { data, isFetching, isError, error, refetch } = useCustomers({ pageSize: 500, keyword: searchText }, false, readOwner, readGuard ? current : undefined, readGuard ? abort.signal : undefined)

  function handleKeywordChange(v: string) {
    if (readGuard && !current()) return
    confirmed.current = false
    setKeyword(v)
    setSelectedId(null)   // 搜索立刻清选择：避免"选了一条又搜成别的，却确认了原来那条"
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearchText(v) }, 300)
  }

  const rows = ((data?.list ?? []) as Row[]).filter(r => r.isActive !== false)
  const selected = selectedId != null ? rows.find(r => r.id === selectedId) ?? null : null
  // debounce 还没落到 searchText 时也算"数据未就绪"，期间禁止一切确认入口。
  // 比较用**原始值**（不 trim）：定时器提交的就是未 trim 的原文，两侧语义必须一致，
  // 否则输入带首尾空格时会判定为"一直没落定"而永久 pending。
  const debouncing = keyword !== searchText

  // 页脚「确认选择」与行双击/空格共用这一个回调，映射只写一次。
  function handleConfirm(row: Row) {
    if (compact && (confirmed.current || data?.truncated || isFetching || keyword !== searchText || isError)) return
    if (readGuard && !current()) return
    if (readOwner) {
      try { assertKitReadOwner(readOwner) }
      catch (error) { toast.error(error instanceof Error ? error.message : '读取来源已变化'); return }
    }
    if (compact) confirmed.current = true
    onConfirm({
      id: row.id,
      name: row.name,
      code: row.code,
      contact: row.contact ?? undefined,
      phone: row.phone ?? undefined,
    })
    onClose()
  }

  return (
    <FinderModal
      compact={compact}
      incomplete={compact && data?.truncated === true}
      open={visible}
      onClose={() => { if (!readGuard || current()) onClose() }}
      title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />选择客户</span>}
      dialogId="customer-finder"
      columns={compact ? COMPACT_COLUMNS : COLUMNS}
      data={visible ? rows : []}
      selected={selected}
      onSelect={row => { if (!readGuard || current()) setSelectedId(row.id) }}
      onConfirm={handleConfirm}
      getRowKey={r => r.id}
      isLoading={isFetching || debouncing}
      isError={isError}
      error={error}
      onRetry={() => void refetch()}
      keyword={keyword}
      onKeywordChange={handleKeywordChange}
      searchPlaceholder="搜索客户名称、编码…"
      selectedLabel={r => `${r.name}${r.code ? ` (${r.code})` : ''}`}
    />
  )
}
