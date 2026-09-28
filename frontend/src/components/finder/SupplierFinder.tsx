import { RecordIdentity } from '@/components/shared/RecordIdentity'
import { useState, useRef, useEffect } from 'react'
import { Truck } from 'lucide-react'
import { FinderModal } from './FinderModal'
import { useSuppliers } from '@/hooks/useSuppliers'
import type { FinderResult, FinderColumn } from '@/types/finder'
import type { Supplier } from '@/types/suppliers'

export interface SupplierFinderProps {
  open: boolean
  onClose: () => void
  onConfirm: (result: FinderResult) => void
}

type Row = Supplier & Record<string, unknown>

const COLUMNS: FinderColumn<Row>[] = [
  { key: 'name', title: '供应商 / 编码', render: (_, row) => <RecordIdentity title={row.name} code={row.code} /> },
  { key: 'contact', title: '联系人', width: 140 },
  { key: 'phone', title: '联系电话', width: 180 },
]

export function SupplierFinder({ open, onClose, onConfirm }: SupplierFinderProps) {
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')
  // 只存 id：选中行一律从**当前启用列表**派生 ⇒ 后台刷新后拿到的是最新值，
  // 行被移除/停用则派生为 null，页脚自动禁用（不会回传列表之外的过期对象）。
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

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

  const { data, isFetching, isError, error, refetch } = useSuppliers({ pageSize: 500, keyword: searchText })

  function handleKeywordChange(v: string) {
    setKeyword(v)
    setSelectedId(null)   // 搜索立刻清选择
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearchText(v) }, 300)
  }

  const rows = ((data?.list ?? []) as Row[]).filter(r => r.isActive !== false)
  const selected = selectedId != null ? rows.find(r => r.id === selectedId) ?? null : null
  // 比较用**原始值**（不 trim），与定时器提交的原文保持同一语义，避免带空格输入时永久 pending。
  const debouncing = keyword !== searchText

  // 页脚「确认选择」与行双击/空格共用这一个回调，映射只写一次。
  function handleConfirm(row: Row) {
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
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />选择供应商</span>}
      dialogId="supplier-finder"
      columns={COLUMNS}
      data={rows}
      selected={selected}
      onSelect={row => setSelectedId(row.id)}
      onConfirm={handleConfirm}
      getRowKey={r => r.id}
      isLoading={isFetching || debouncing}
      isError={isError}
      error={error}
      onRetry={() => void refetch()}
      keyword={keyword}
      onKeywordChange={handleKeywordChange}
      searchPlaceholder="搜索供应商名称、编码…"
      selectedLabel={r => `${r.name}${r.code ? ` (${r.code})` : ''}`}
    />
  )
}
