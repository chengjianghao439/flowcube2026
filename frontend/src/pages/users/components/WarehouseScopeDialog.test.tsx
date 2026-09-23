// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import WarehouseScopeDialog from './WarehouseScopeDialog'

const save = vi.fn()
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: { list: [{ id: 1, name: '一号仓' }] }, isLoading: false }),
}))
vi.mock('@/hooks/useUserWarehouseScope', () => ({
  useUserWarehouseScope: () => ({ data: undefined, isLoading: true }),
  useSaveUserWarehouseScope: () => ({ mutate: save, isPending: false }),
}))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  save.mockReset()
})

test('cannot save an empty warehouse scope before the current scope loads', async () => {
  await act(async () => root.render(<WarehouseScopeDialog open onClose={() => {}} userId={42} userName="测试" />))
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === '保存')!
  expect(button.disabled).toBe(true)
})
