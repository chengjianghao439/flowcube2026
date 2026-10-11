import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useState, useRef, useEffect } from 'react'
import { Truck } from 'lucide-react'
import { FinderModal } from './FinderModal'
import { useSuppliers } from '@/hooks/useSuppliers'
import type { FinderResult, FinderColumn } from '@/types/finder'
import type { Supplier } from '@/types/suppliers'
import type { ProductFinderReadContext } from '@/hooks/useProducts'
import { useFinderReadContext } from '@/hooks/useFinderReadContext'
import { PERMISSIONS } from '@/lib/permission-codes'
import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/lib/permissions'

export interface SupplierFinderProps {
  open: boolean
  onClose: () => void
  onConfirm: (result: FinderResult) => void
  context?: ProductFinderReadContext | 'purchase'
  compact?: boolean
  dialogId?: string
}

type Row = Supplier & Record<string, unknown>

const COLUMNS: FinderColumn<Row>[] = [
  { key: 'name', title: '供应商 / 编码', render: (_, row) => <RecordIdentity title={row.name} code={row.code} /> },
  { key: 'contact', title: '联系人', width: 140 },
  { key: 'phone', title: '联系电话', width: 180 },
]

const COMPACT_COLUMNS: FinderColumn<Row>[] = [
  { key: 'code', title: '编码', width: 120, render: value => <span className="font-mono text-xs text-muted-foreground">{String(value ?? '—')}</span> },
  { key: 'name', title: '供应商名称' },
  { key: 'contact', title: '联系人', width: 140 },
  { key: 'phone', title: '联系电话', width: 160 },
]

export function SupplierFinder({ open, onClose, onConfirm, context: suppliedContext, compact = false, dialogId = 'supplier-finder' }: SupplierFinderProps) {
  const purchaseContext = useFinderReadContext(suppliedContext === 'purchase', open, PERMISSIONS.SUPPLIER_VIEW, 'supplier')
  const context = suppliedContext === 'purchase' ? purchaseContext : suppliedContext
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')
  // 只存 id：选中行一律从**当前启用列表**派生 ⇒ 后台刷新后拿到的是最新值，
  // 行被移除/停用则派生为 null，页脚自动禁用（不会回传列表之外的过期对象）。
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const delivery = useRef({ open, closed: false })
  if (delivery.current.open !== open) delivery.current = { open, closed: false }
  const latest = useRef({ open, context })
  latest.current = { open, context }

  // 关闭时**同时清掉未落定的 debounce**，否则旧 timer 会在重开后把 searchText 改回上一个词，
  // 而 keyword 已被清空 ⇒ 两者永久不相等、永远 pending。
  // 返回的 cleanup 在**卸载/依赖变化**时同样清 timer，避免离开页面后还残留本组件的定时器。
  useEffect(() => {
    if (!open) {
      clearTimeout(debounceRef.current)
      setKeyword(''); setSearchText(''); setSelectedId(null)
    }
    return () => clearTimeout(debounceRef.current)
  }, [open])

  const { data, isFetching, isError, error, refetch } = useSuppliers({ pageSize: 500, keyword: searchText }, context ? { ...context, enabled: open && context.enabled } : undefined)
  function current() {
    if (compact && (!latest.current.open || delivery.current.closed)) return false
    if (compact && latest.current.context) {
      try { latest.current.context.assertCurrent(); return latest.current.context.enabled } catch { return false }
    }
    if (!context) return true
    if (!open || !context.enabled) return false
    try { context.assertCurrent(); return true } catch { return false }
  }
  const readable = current()
  const auth = useAuthStore.getState()
  const unavailableMessage = suppliedContext === 'purchase' && !readable
    ? hasPermission(auth.user?.permissions, PERMISSIONS.SUPPLIER_VIEW, auth.user?.roleId)
      ? '读取已暂停，输入已保留。请关闭后重新选择供应商。'
      : '当前没有供应商查看权限，输入已保留。'
    : undefined

  function handleKeywordChange(v: string) {
    if (!current()) return
    setKeyword(v)
    setSelectedId(null)   // 搜索立刻清选择
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearchText(v) }, 300)
  }

  const rows = readable ? ((data?.list ?? []) as Row[]).filter(r => r.isActive !== false) : []
  const selected = selectedId != null ? rows.find(r => r.id === selectedId) ?? null : null
  // 比较用**原始值**（不 trim），与定时器提交的原文保持同一语义，避免带空格输入时永久 pending。
  const debouncing = keyword !== searchText
  const incomplete = compact && data?.truncated === true
  const allowIncompleteSelection = suppliedContext === 'purchase'
  const blockedIncomplete = incomplete && !allowIncompleteSelection
  const displayed = useRef({ rows, isFetching, isError, debouncing, blockedIncomplete })
  displayed.current = { rows, isFetching, isError, debouncing, blockedIncomplete }

  // 页脚「确认选择」与行双击/空格共用这一个回调，映射只写一次。
  function handleConfirm(row: Row) {
    if (!current()) return
    if (compact) {
      const now = displayed.current
      const currentRow = now.rows.find(value => value.id === row.id)
      if (!currentRow || now.isFetching || now.isError || now.debouncing || now.blockedIncomplete) return
      row = currentRow; delivery.current.closed = true
    }
    onConfirm({
      id: row.id,
      name: row.name,
      code: row.code,
      contact: row.contact ?? undefined,
      phone: row.phone ?? undefined,
    })
    onClose()
  }
  function handleClose() {
    if (compact) {
      if (!latest.current.open || delivery.current.closed) return
      delivery.current.closed = true
    }
    purchaseContext?.cancel()
    onClose()
  }

  return (
    <FinderModal
      open={open}
      onClose={handleClose}
      title={<span className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />选择供应商</span>}
      dialogId={dialogId}
      compact={compact}
      entityName="供应商"
      incomplete={incomplete}
      allowIncompleteSelection={allowIncompleteSelection}
      loadedCount={compact ? data?.list?.length : undefined}
      totalCount={compact ? data?.pagination?.total : undefined}
      recordLabel="条供应商记录"
      unavailableMessage={unavailableMessage}
      permissionErrorTitle={compact ? '没有供应商查看权限' : undefined}
      columns={compact ? COMPACT_COLUMNS : COLUMNS}
      data={rows}
      selected={selected}
      onSelect={row => { if (current()) setSelectedId(row.id) }}
      onConfirm={handleConfirm}
      getRowKey={r => r.id}
      isLoading={isFetching || debouncing || (!readable && !unavailableMessage)}
      isError={isError}
      error={error}
      onRetry={() => { if (current()) void refetch() }}
      keyword={keyword}
      onKeywordChange={handleKeywordChange}
      searchPlaceholder="搜索供应商名称、编码…"
      selectedLabel={r => `${r.name}${r.code ? ` (${r.code})` : ''}`}
    />
  )
}
