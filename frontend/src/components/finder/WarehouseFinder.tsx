import { useState, useRef, useEffect } from 'react'
import { Warehouse } from 'lucide-react'
import { FinderModal } from './FinderModal'
import { useWarehouses } from '@/hooks/useWarehouses'
import type { FinderResult, FinderColumn } from '@/types/finder'
import type { Warehouse as WarehouseType } from '@/types/warehouses'

export interface WarehouseFinderProps {
  open: boolean
  onClose: () => void
  onConfirm: (result: FinderResult) => void
}

type Row = WarehouseType & Record<string, unknown>

const COLUMNS: FinderColumn<Row>[] = [
  { key: 'code',     title: '编码',   width: 110 },
  { key: 'name',     title: '仓库名称' },
  { key: 'typeName', title: '类型',   width: 100 },
  { key: 'manager',  title: '负责人', width: 110, render: v => (v as string | null) ?? '—' },
]

export function WarehouseFinder({ open, onClose, onConfirm }: WarehouseFinderProps) {
  const [keyword,    setKeyword]    = useState('')
  const [searchText, setSearchText] = useState('')
  const [page,       setPage]       = useState(1)
  const [selected,   setSelected]   = useState<Row | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!open) { setKeyword(''); setSearchText(''); setPage(1); setSelected(null) }
  }, [open])

  useEffect(() => { setPage(1) }, [searchText])

  const { data, isFetching } = useWarehouses({ page, pageSize: 10, keyword: searchText })

  function handleKeywordChange(v: string) {
    setKeyword(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearchText(v); setPage(1) }, 300)
  }

  function handleConfirm() {
    if (!selected) return
    onConfirm({ id: selected.id, name: selected.name, code: selected.code })
    onClose()
  }

  return (
    <FinderModal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary" />选择仓库</span>}
      dialogId="warehouse-finder"
      columns={COLUMNS}
      data={(data?.list ?? []) as Row[]}
      selected={selected}
      onSelect={setSelected}
      onConfirm={handleConfirm}
      onConfirmRow={row => {
        onConfirm({ id: row.id, name: row.name, code: row.code })
        onClose()
      }}
      getRowKey={r => r.id}
      isLoading={isFetching}
      keyword={keyword}
      onKeywordChange={handleKeywordChange}
      page={page}
      onPageChange={setPage}
      total={data?.pagination?.total ?? 0}
      searchPlaceholder="搜索仓库名称、编码..."
      selectedLabel={r => `${r.name}${r.typeName ? ` · ${r.typeName}` : ''}`}
    />
  )
}
