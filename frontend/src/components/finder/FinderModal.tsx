import type { ReactNode } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { FinderSearch } from './FinderSearch'
import { FinderTable } from './FinderTable'
import type { FinderColumn } from '@/types/finder'

interface FinderModalProps<T extends Record<string, unknown>> {
  open: boolean
  onClose: () => void
  title: ReactNode
  dialogId: string

  columns: FinderColumn<T>[]
  data: T[]
  selected: T | null
  onSelect: (row: T) => void
  onConfirm: () => void
  /** 双击行时直接以该行数据确认，绕过 selected 状态 */
  onConfirmRow?: (row: T) => void
  getRowKey: (row: T) => number
  isLoading?: boolean

  keyword: string
  onKeywordChange: (v: string) => void
  searchPlaceholder?: string

  page: number
  onPageChange: (page: number) => void
  total: number
  pageSize?: number
  selectedLabel?: (row: T) => string
}

export function FinderModal<T extends Record<string, unknown>>({
  open, onClose, title, dialogId,
  columns, data, selected, onSelect, onConfirm, onConfirmRow,
  getRowKey, isLoading,
  keyword, onKeywordChange, searchPlaceholder,
  page, onPageChange, total, pageSize = 10,
}: FinderModalProps<T>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AppDialog
      open={open}
      onOpenChange={v => !v && onClose()}
      dialogId={dialogId}
      defaultWidth={700}
      defaultHeight={560}
      minWidth={500}
      minHeight={420}
      title={title}
    >
      {/*
        Full-height flex column — owns the layout of all three zones.
        AppDialog body: min-h-0 flex-1 overflow-hidden, so this div fills it completely.
      */}
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Search ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-b px-6 py-4">
          <FinderSearch
            value={keyword}
            onChange={onKeywordChange}
            placeholder={searchPlaceholder}
            autoFocus
          />
        </div>

        {/* ── Table body (scrollable) ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <FinderTable
            columns={columns}
            data={data}
            selected={selected}
            onSelect={onSelect}
            onDoubleClickRow={onConfirmRow}
            getRowKey={getRowKey}
            isLoading={isLoading}
          />
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-t bg-muted/20 px-6 py-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!selected} onClick={onConfirm}>确认选择</Button>
          </div>
        </div>

      </div>
    </AppDialog>
  )
}

// ─── Shared trigger button ────────────────────────────────────────────────────

interface FinderTriggerProps {
  value: string
  placeholder: string
  onClick: () => void
  /** 双击时执行（通常为跳转主数据管理页） */
  onDoubleClick?: () => void
  disabled?: boolean
  className?: string
}

/**
 * FinderTrigger — a form-field-styled button that opens a Finder modal.
 * Matches the look of the native <select> used elsewhere in the forms.
 * Single click: open finder. Double click: navigate to master data page (if provided).
 */
export function FinderTrigger({ value, placeholder, onClick, onDoubleClick, disabled, className = '' }: FinderTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={disabled}
      className={[
        'h-10 w-full truncate rounded-md border border-input bg-background px-3 py-2',
        'text-left text-sm shadow-sm transition-colors',
        'hover:border-primary hover:bg-muted/30',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {value
        ? <span className="truncate text-foreground">{value}</span>
        : <span className="text-muted-foreground">{placeholder}</span>}
    </button>
  )
}
