import type { KeyboardEvent } from 'react'

const entryControl = 'input:not([type="hidden"]),button,select,textarea,[tabindex]'

export function focusOrderEntryField(root: HTMLElement | null, target: string): boolean {
  if (!root?.isConnected || root.closest('[hidden],[inert]')) return false
  for (const field of root.querySelectorAll<HTMLElement>('[data-entry-field]')) {
    if (field.dataset.entryField !== target || field.closest('[hidden],[inert]')) continue
    const candidates = field.matches(entryControl) ? [field] : [...field.querySelectorAll<HTMLElement>(entryControl)]
    const control = candidates.find(element => !element.matches(':disabled,[aria-disabled="true"]') && !element.closest('[hidden],[inert]'))
    if (!control) continue
    control.focus({ preventScroll: true })
    if (control instanceof HTMLInputElement) control.select()
    control.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return true
  }
  return false
}

/** 只接管明细数字输入的 Enter，保持原生 Tab、输入法和按钮激活行为。 */
export function handleEntryKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-entry-input')) return
  const form = input.closest('[data-order-entry]')
  if (!form) return
  const fields = [...form.querySelectorAll<HTMLInputElement>('input[data-entry-input]:not(:disabled)')].filter(el => !el.closest('[hidden]'))
  const index = fields.indexOf(input)
  if (index < 0) return
  const target = fields[index + (event.shiftKey ? -1 : 1)] ?? (!event.shiftKey ? form.querySelector<HTMLElement>('[data-entry-add]:not(:disabled)') : null)
  event.preventDefault()
  if (target) { target.focus(); if (target instanceof HTMLInputElement) target.select() }
}
