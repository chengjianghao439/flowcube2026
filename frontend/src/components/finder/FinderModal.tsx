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

  selectedLabel?: (row: T) => string
}

export function FinderModal<T extends Record<string, unknown>>({
  open, onClose, title, dialogId,
  columns, data, selected, onSelect, onConfirm, onConfirmRow,
  getRowKey, isLoading,
  keyword, onKeywordChange, searchPlaceholder,
  selectedLabel,
}: FinderModalProps<T>) {

  return (
    <AppDialog
      open={open}
      onOpenChange={v => !v && onClose()}
      dialogId={dialogId}
      defaultWidth={960}
      defaultHeight={560}
      minWidth={640}
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
        <div className="min-h-0 flex-1 overflow-auto">
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
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0 flex-1 text-sm text-muted-foreground">
              {selected && selectedLabel ? (
                <span className="flex items-center gap-2">
                  <span className="font-medium text-foreground">已选：</span>
                  <span className="break-words leading-5" title={selectedLabel(selected)}>{selectedLabel(selected)}</span>
                </span>
              ) : (
                '单击选择，双击直接填入'
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={!selected} onClick={onConfirm}>确认选择</Button>
            </div>
          </div>
        </div>

      </div>
    </AppDialog>
  )
}

