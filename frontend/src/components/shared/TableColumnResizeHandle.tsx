import type { TableColumn } from '@/types'
import type { useTableColumns } from './useTableColumns'

/** 与共享表格同一套拖动、自动适配和键盘调整入口。 */
export function TableColumnResizeHandle<T extends object>({ column: col, layout }: {
  column: TableColumn<T>
  layout: Pick<ReturnType<typeof useTableColumns<T>>, 'startResize' | 'fitColumn' | 'measureWidths' | 'savePixelWidths'>
}) {
  const { startResize, fitColumn, measureWidths, savePixelWidths } = layout
  return <button
    type="button"
    aria-label={`调整${col.title}列宽`}
    onMouseDown={event => startResize(event, col)}
    title="拖动调整列宽，双击或按 Enter 适应内容；方向键微调"
    draggable={false}
    onClick={event => { event.preventDefault(); event.stopPropagation() }}
    onDoubleClick={event => { event.stopPropagation(); fitColumn(col) }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); fitColumn(col) }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation()
        const widths = measureWidths()
        const key = String(col.key)
        savePixelWidths({ ...widths, [key]: Math.max(80, widths[key] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10)) })
      }
    }}
    className="group/resize absolute inset-y-0 right-0 z-30 flex w-3 cursor-col-resize items-center justify-end touch-none hover:bg-primary/10 focus-visible:outline-none focus-visible:bg-primary/10 data-[resizing=true]:bg-primary/15"
  >
    <span className="pointer-events-none h-full w-px bg-border group-hover/resize:w-0.5 group-hover/resize:bg-primary group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-primary group-data-[resizing=true]/resize:w-0.5 group-data-[resizing=true]/resize:bg-primary" />
  </button>
}
