import type { ReactNode } from 'react'
import { AppDialog } from '@/components/shared/AppDialog'
import { Button } from '@/components/ui/button'
import { QueryErrorState } from '@/components/shared/QueryErrorState'
import { FinderSearch } from './FinderSearch'
import { FinderTable } from './FinderTable'
import { FinderDataTable } from './FinderDataTable'
import type { FinderColumn } from '@/types/finder'

interface FinderModalProps<T extends Record<string, unknown>> {
  open: boolean
  onClose: () => void
  title: ReactNode
  dialogId: string

  columns: FinderColumn<T>[]
  data: T[]
  /** 选中行：**由调用方从当前列表派生**——行已不在列表 ⇒ 传 null，页脚自动禁用。 */
  selected: T | null
  onSelect: (row: T) => void
  /** 确认（页脚「确认选择」与行双击共用）：**始终传当前行**，映射只由调用方做一次。 */
  onConfirm: (row: T) => void
  getRowKey: (row: T) => number
  /** 数据未就绪（搜索 debounce 中 / 请求进行中）：此时**禁止一切确认入口**。 */
  isLoading?: boolean
  /** 查询出错：禁止确认，并显示可重试错误（不拿旧 data 确认）。 */
  isError?: boolean
  error?: unknown
  onRetry?: () => void

  keyword: string
  onKeywordChange: (v: string) => void
  searchPlaceholder?: string

  selectedLabel?: (row: T) => string
  compact?: boolean
  incomplete?: boolean
  /** 仅独立对象选择可显式放行；默认保留销售的截断确认规则。 */
  allowIncompleteSelection?: boolean
  entityName?: string
  loadedCount?: number
  totalCount?: number
  recordLabel?: string
  unavailableMessage?: string
  permissionErrorTitle?: string
}

export function FinderModal<T extends Record<string, unknown>>({
  open, onClose, title, dialogId,
  columns, data, selected, onSelect, onConfirm,
  getRowKey, isLoading = false, isError = false, error, onRetry,
  keyword, onKeywordChange, searchPlaceholder,
  selectedLabel, compact = false, incomplete = false,
  allowIncompleteSelection = false,
  entityName = '客户', loadedCount, totalCount, recordLabel,
  unavailableMessage, permissionErrorTitle,
}: FinderModalProps<T>) {
  // 唯一判据：数据未加载/未出错，且选中行仍在当前列表（由调用方派生保证）。
  // 页脚、行双击、Space 键三个确认入口共用它，避免各写一套守卫。
  const canConfirm = selected != null && !isLoading && !isError && (!incomplete || allowIncompleteSelection) && !unavailableMessage
  const canConfirmRow = !isLoading && !isError && (!incomplete || allowIncompleteSelection) && !unavailableMessage
  const errorStatus = error as { status?: number; response?: { status?: number } } | null | undefined
  const forbidden = (errorStatus?.status ?? errorStatus?.response?.status) === 403

  return (
    <AppDialog
      open={open}
      captureFocusOnOpen={compact}
      onOpenChange={v => !v && onClose()}
      dialogId={dialogId}
      defaultWidth={960}
      defaultHeight={560}
      minWidth={640}
      minHeight={420}
      title={title}
    >
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Search ──────────────────────────────────────────────── */}
        <div className={compact ? "shrink-0 border-b px-4 py-3" : "shrink-0 border-b px-6 py-4"}>
          <FinderSearch
            value={keyword}
            onChange={onKeywordChange}
            placeholder={searchPlaceholder}
            autoFocus
          />
        </div>

        {/* ── Table body (scrollable) ──────────────────────────────── */}
        <div data-table-scroll className="min-h-0 flex-1 overflow-auto">
          {unavailableMessage ? <p role="status" className="px-4 py-4 text-sm text-warning-ink">{unavailableMessage}</p> : isError ? (
            <QueryErrorState error={error} onRetry={() => onRetry?.()} title={forbidden && permissionErrorTitle ? permissionErrorTitle : '加载失败'} compact />
          ) : compact ? (
            <FinderDataTable columns={columns} data={data} selected={selected}
              onSelect={row => { if (canConfirmRow) onSelect(row) }}
              onConfirm={row => { if (canConfirmRow) onConfirm(row) }}
              getRowKey={getRowKey} isLoading={isLoading} emptyText={`没有匹配的${entityName}`} />
          ) : (
            <FinderTable
              columns={columns}
              data={data}
              selected={selected}
              onSelect={row => { if (canConfirmRow) onSelect(row) }}
              onDoubleClickRow={row => { if (canConfirmRow) onConfirm(row) }}
              getRowKey={getRowKey}
              isLoading={isLoading}
            />
          )}
        </div>

        {incomplete && !isLoading && !isError && <p role="alert" className="shrink-0 border-t px-4 py-2 text-sm text-warning-ink">{loadedCount != null && totalCount != null ? `已读取 ${loadedCount.toLocaleString()} / ${totalCount.toLocaleString()} ${recordLabel ?? `条${entityName}记录`}。` : '结果超过查询上限，'}{allowIncompleteSelection ? '请缩小搜索范围以查看其余结果。' : '请缩小搜索范围后选择。'}</p>}

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className={compact ? "shrink-0 border-t px-4 py-3" : "shrink-0 border-t bg-muted/20 px-6 py-4"}>
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0 flex-1 text-sm text-muted-foreground">
              {selected && selectedLabel ? (
                <span className="flex items-center gap-2">
                  <span className="font-medium text-foreground">已选：</span>
                  <span className="break-words leading-5" title={selectedLabel(selected)}>{selectedLabel(selected)}</span>
                </span>
              ) : (
                compact ? (!isLoading && !isError && !incomplete && !unavailableMessage ? `共 ${data.length} 个${entityName}` : '') : '单击选择，双击直接填入'
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={!canConfirm} onClick={() => { if (canConfirm && selected) onConfirm(selected) }}>确认选择</Button>
            </div>
          </div>
        </div>

      </div>
    </AppDialog>
  )
}
