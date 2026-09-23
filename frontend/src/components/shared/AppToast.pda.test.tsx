// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { toast } from '@/lib/toast'
import { AppToast } from './AppToast'

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<AppToast placement="pda" />) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

test('PDA 全局提示居中且一次只显示一条', async () => {
  await act(async () => {
    toast.error('第一次失败')
    toast.error('第二次失败')
  })
  expect(document.querySelector('ol[class*="left-1/2"]')).not.toBeNull()
  const messages = [...document.querySelectorAll('.fc-toast')].map(item => item.textContent)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('第二次失败')
})
