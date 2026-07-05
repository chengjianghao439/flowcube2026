import * as React from 'react'
import { format, parse, isValid } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const DATE_FMT = 'yyyy-MM-dd'

function parseStrict(value?: string): Date | undefined {
  if (!value) return undefined
  const d = parse(value, DATE_FMT, new Date())
  return isValid(d) ? d : undefined
}

/** 宽容解析用户手输的文本：允许 2026-6-1 这类不补零的写法 */
function parseTyped(text: string): Date | undefined {
  const m = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return undefined
  const [, y, mo, d] = m
  const padded = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return parseStrict(padded)
}

interface DatePickerProps {
  id?: string
  /** 受控值，格式 yyyy-MM-dd；空字符串表示未选择 */
  value: string
  onChange: (value: string) => void
  /** 可选范围下限（yyyy-MM-dd），超出禁用 */
  min?: string
  /** 可选范围上限（yyyy-MM-dd），超出禁用 */
  max?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}

/** 统一日期选择控件：可直接输入 yyyy-MM-dd，也可点击日历图标弹出选择——跨度大时打字比翻页快 */
export function DatePicker({ id, value, onChange, min, max, placeholder = 'yyyy-mm-dd', className, disabled }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState(value)
  const selected = parseStrict(value)
  const minDate = parseStrict(min)
  const maxDate = parseStrict(max)

  // 外部 value 变化（如日历选中、重置）时同步输入框展示文本
  React.useEffect(() => { setText(value) }, [value])

  function commitText() {
    const trimmed = text.trim()
    if (!trimmed) { onChange(''); return }
    const parsed = parseTyped(trimmed)
    if (parsed) { onChange(format(parsed, DATE_FMT)) }
    else { setText(value) } // 输入非法，恢复上一个合法值
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative flex items-center">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen(o => !o)}
            className="absolute left-3 flex h-4 w-4 items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground disabled:pointer-events-none"
            aria-label="打开日历选择"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
          <input
            id={id}
            type="text"
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            onChange={e => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
            onFocus={() => setOpen(true)}
            className={cn(
              'h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? format(d, DATE_FMT) : '')
            setOpen(false)
          }}
          disabled={(d) => (minDate ? d < minDate : false) || (maxDate ? d > maxDate : false)}
        />
        <div className="flex items-center justify-between border-t px-3 py-2">
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => { onChange(''); setOpen(false) }}
          >
            清除
          </button>
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => { onChange(format(new Date(), DATE_FMT)); setOpen(false) }}
          >
            今天
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
