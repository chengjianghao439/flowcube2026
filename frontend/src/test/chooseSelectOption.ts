import { getByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

export async function chooseSelectOption(trigger: HTMLElement, name: string | RegExp) {
  // Radix scrolls the active option into view. jsdom does not implement layout.
  Element.prototype.scrollIntoView ??= () => {}
  const user = userEvent.setup()
  await act(async () => {
    trigger.focus()
    await user.keyboard('{ArrowDown}')
  })
  await act(async () => {
    getByRole(document.body, 'option', { name }).focus()
    await user.keyboard('{Enter}')
  })
}
