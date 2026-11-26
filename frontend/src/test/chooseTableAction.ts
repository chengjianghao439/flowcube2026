import { act } from 'react'
import { getByRole } from '@testing-library/dom'

export async function openTableActions(rowLabel: string) {
  const trigger = getByRole(document.body, 'button', { name: `更多操作 ${rowLabel}` })
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  return getByRole(document.body, 'menu')
}

export async function chooseTableAction(rowLabel: string, label: string) {
  const menu = await openTableActions(rowLabel)
  await act(async () => { getByRole(menu, 'menuitem', { name: `${label} ${rowLabel}` }).click() })
  // Radix 在关闭菜单后的焦点归还阶段打开下一弹窗。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
