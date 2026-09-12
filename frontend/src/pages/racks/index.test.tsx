// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import RacksPage from './index'
import type { Rack } from '@/types/racks'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({ ...await importOriginal<typeof import('@tanstack/react-query')>(), useQuery: () => ({ data: [] }), useMutation: () => ({}) }))
vi.mock('@/api/racks', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/racks')>(), updateRackApi: mocks.update }))
vi.mock('./RackQueryDialog', () => ({ default: () => null }))
vi.mock('@/components/shared/TableActionsMenu', () => ({ default: ({ items }: { items: { label: string; onClick: () => void }[] }) => <>{items.map(item => <button key={item.label} onClick={item.onClick}>{item.label}</button>)}</> }))
const rack: Rack = { id: 7, warehouseId: 1, warehouseName: '测试仓库', barcode: 'H000007', code: 'A01', zone: 'A', name: '原名称', maxLevels: 5, maxPositions: 10, status: 1, remark: '原备注', createdAt: '' }
vi.mock('@/components/shared/BaseCrudPage', () => ({
  default: (props: { onOpen: (row: Rack) => void; renderForm: (row: Rack) => ReactNode; submitForm: (row: Rack) => Promise<unknown>; renderActions: (row: Rack, helpers: { openEdit: (row: Rack) => void; openDelete: () => void }) => ReactNode }) => <>
    <button onClick={() => props.onOpen(rack)}>打开表单</button>
    {props.renderActions(rack, { openEdit: props.onOpen, openDelete: () => {} })}
    {props.renderForm(rack)}
    <button id="save" onClick={() => void props.submitForm(rack)}>保存</button>
  </>,
}))
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.update.mockReset().mockResolvedValue({})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<RacksPage />))
  await act(async () => host.querySelector('button')!.click())
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

test('编辑货架清空可选文本时显式提交空串，以清除服务端旧值', async () => {
  for (const key of ['zone', 'name', 'remark']) {
    const input = host.querySelector<HTMLInputElement>(`#rack-${key}`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await act(async () => host.querySelector<HTMLButtonElement>('#save')!.click())
  expect(mocks.update).toHaveBeenCalledWith(7, { zone: '', name: '', remark: '', code: 'A01', maxLevels: 5, maxPositions: 10, status: 1 })
})

test('货架列表提供可到达的编辑操作并回填当前行', async () => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '编辑')
  expect(button, '货架行操作必须提供编辑入口').toBeDefined()
  const name = host.querySelector<HTMLInputElement>('#rack-name')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '未保存草稿')
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(name.value).toBe('未保存草稿')
  await act(async () => button!.click())
  expect(host.querySelector<HTMLInputElement>('#rack-code')!.value).toBe('A01')
  expect(host.querySelector<HTMLInputElement>('#rack-name')!.value).toBe('原名称')
})
