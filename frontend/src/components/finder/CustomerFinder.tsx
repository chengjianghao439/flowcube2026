import { useState, useRef, useEffect } from 'react'
import { Users } from 'lucide-react'
import { FinderModal } from './FinderModal'
import { useCustomers } from '@/hooks/useCustomers'
import type { FinderResult, FinderColumn } from '@/types/finder'
import type { Customer } from '@/types/customers'

export interface CustomerFinderProps {
  open: boolean
  onClose: () => void
  onConfirm: (result: FinderResult) => void
}

type Row = Customer & Record<string, unknown>

const COLUMNS: FinderColumn<Row>[] = [
  { key: 'code',    title: '编码',   width: 110 },
  { key: 'name',    title: '客户名称' },
  { key: 'contact', title: '联系人', width: 110, render: v => (v as string | null) ?? '—' },
  { key: 'phone',   title: '电话',   width: 140, render: v => (v as string | null) ?? '—' },
]

export function CustomerFinder({ open, onClose, onConfirm }: CustomerFinderProps) {
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')
  const [page,       setPage]       = useState(1)
  const [selected,   setSelected]   = useState<Row | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) { setKeyword(''); setSearchText(''); setPage(1); setSelected(null) }
  }, [open])

  // Reset page when search changes
  useEffect(() => { setPage(1) }, [searchText])

  const { data, isFetching } = useCustomers({ page, pageSize: 10, keyword: searchText })

  function handleKeywordChange(v: string) {
    setKeyword(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearchText(v); setPage(1) }, 300)
  }

  function handleConfirm() {
    if (!selected) return
    onConfirm({
      id: selected.id,
      name: selected.name,
      code: selected.code,
      contact: selected.contact ?? undefined,
      phone: selected.phone ?? undefined,
    })
    onClose()
  }

  return (
    <FinderModal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />选择客户</span>}
      dialogId="customer-finder"
      columns={COLUMNS}
      data={(data?.list ?? []) as Row[]}
      selected={selected}
      onSelect={setSelected}
      onConfirm={handleConfirm}
      onConfirmRow={row => {
        onConfirm({ id: row.id, name: row.name, code: row.code, contact: row.contact ?? undefined, phone: row.phone ?? undefined })
        onClose()
      }}
      getRowKey={r => r.id}
      isLoading={isFetching}
      keyword={keyword}
      onKeywordChange={handleKeywordChange}
      page={page}
      onPageChange={setPage}
      total={data?.pagination?.total ?? 0}
      searchPlaceholder="搜索客户名称、编码..."
      selectedLabel={r => `${r.name}${r.code ? ` (${r.code})` : ''}`}
    />
  )
}
