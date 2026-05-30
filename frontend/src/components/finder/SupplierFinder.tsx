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
  { key: 'code',    title: '编码',    width: 110 },
  { key: 'name',    title: '供应商名称' },
  { key: 'contact', title: '联系人',  width: 110, render: v => (v as string | null) ?? '—' },
  { key: 'phone',   title: '电话',    width: 140, render: v => (v as string | null) ?? '—' },
]

export function SupplierFinder({ open, onClose, onConfirm }: SupplierFinderProps) {
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')
  const [selected,   setSelected]   = useState<Row | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!open) { setKeyword(''); setSearchText(''); setSelected(null) }
  }, [open])

  const { data, isFetching } = useSuppliers({ pageSize: 99999, keyword: searchText })

  function handleKeywordChange(v: string) {
    setKeyword(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearchText(v) }, 300)
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
      title={<span className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />选择供应商</span>}
      dialogId="supplier-finder"
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
      searchPlaceholder="搜索供应商名称、编码..."
      selectedLabel={r => `${r.name}${r.code ? ` (${r.code})` : ''}`}
    />
  )
}
