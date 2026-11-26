import { act } from 'react'
import { expect, vi } from 'vitest'

/** 夹具只显示一张申请。沿实际行菜单读取权限决定的可用动作。 */
export async function openCreditActions() {
  const trigger = document.querySelector<HTMLButtonElement>('tbody button[aria-label^="更多操作 "]')
  if (!trigger) return []
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  await vi.waitFor(() => expect(document.querySelector('[role="menuitem"]')).not.toBeNull())
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

export async function chooseCreditAction(label: string) {
  const item = (await openCreditActions()).find(node => node.textContent?.trim() === label)
  expect(item, label).toBeDefined()
  await act(async () => item!.click())
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
