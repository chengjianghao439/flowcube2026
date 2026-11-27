import { useState, type ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { clampVal } from './editorUtils'

type LayoutNumberInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'min' | 'max' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: number | undefined
  min: number
  max?: number
  roundOnBlur?: boolean
  onValueChange: (value: number) => void
  onClear?: () => void
  onComplete: () => void
}

export function LayoutNumberInput({ value, min, max, roundOnBlur = false, onValueChange, onClear, onComplete, ...props }: LayoutNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)

  function apply(raw: string, round: boolean) {
    if (raw === '') {
      if (value !== undefined) onClear?.()
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    if (onClear && parsed <= 0) {
      if (value !== undefined) onClear()
      return
    }
    const next = clampVal(round ? Math.round(parsed) : parsed, min, max ?? Infinity)
    if (next !== value) onValueChange(next)
  }

  return <Input
    {...props}
    type="number" min={min} max={max}
    value={draft ?? value ?? ''}
    onFocus={onComplete}
    onChange={event => {
      const raw = event.currentTarget.value
      setDraft(raw)
      if (!event.currentTarget.validity.badInput) apply(raw, false)
    }}
    onBlur={event => {
      if (draft != null && !event.currentTarget.validity.badInput) apply(draft, roundOnBlur)
      setDraft(null)
      onComplete()
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
      }
    }}
  />
}
