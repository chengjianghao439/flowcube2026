// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import LocationsPage from './index'
import type { Location } from '@/types/locations'

const mocks = vi.hoisted(() => ({ editing: null as Location | null }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({ ...await importOriginal<typeof import('@tanstack/react-query')>(), useQuery: () => ({ data: [] }), useMutation: () => ({}) }))
vi.mock('@/components/shared/BaseCrudPage', () => ({
  default: (props: { onOpen: (row: Location | null) => void; renderForm: (row: Location | null) => ReactNode; canSubmit: () => boolean }) => <>
    <button onClick={() => props.onOpen(mocks.editing)}>打开表单</button>
    {props.renderForm(mocks.editing)}
    <button id="save" disabled={!props.canSubmit()}>保存</button>
  </>,
}))
vi.mock('./LocationQueryDialog', () => ({ default: () => null }))
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.editing = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function open() {
  await act(async () => root.render(<LocationsPage />))
  await act(async () => host.querySelector('button')!.click())
}
async function edit(key: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#location-${key}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const code = () => host.querySelector<HTMLInputElement>('#location-code')!.value
const fixture = { id: 1, warehouseId: 1, code: 'A01-02-0304', zone: 'A', aisle: '1', rack: '2', level: '3', position: '4', capacity: 0, status: 1 } as Location

test('新建库位清空任一编码分段时移除过期的自动编码', async () => {
  await open()
  for (const [key, value] of Object.entries({ zone: 'QA', aisle: '1', rack: '2', level: '3', position: '4' })) await edit(key, value)
  expect(code()).toBe('QA01-02-0304')
  await edit('position', '')
  expect(code()).toBe('')
  await edit('position', '5')
  expect(code()).toBe('QA01-02-0305')
})

test('完整分段的存量库位清空分段后不能保存过期编码', async () => {
  mocks.editing = fixture
  await open()
  expect(host.querySelector<HTMLButtonElement>('#save')!.disabled).toBe(false)
  await edit('zone', '')
  expect(code()).toBe('')
  expect(host.querySelector<HTMLButtonElement>('#save')!.disabled).toBe(true)
})

test('历史手写编码分段不全时保持原编码，补齐分段后正常生成', async () => {
  mocks.editing = { ...fixture, code: 'LEGACY-01', zone: '', aisle: '', rack: '', level: '', position: '' }
  await open()
  await edit('zone', 'A')
  expect(code()).toBe('LEGACY-01')
  for (const [key, value] of Object.entries({ aisle: '1', rack: '2', level: '3', position: '4' })) await edit(key, value)
  expect(code()).toBe('A01-02-0304')
})
