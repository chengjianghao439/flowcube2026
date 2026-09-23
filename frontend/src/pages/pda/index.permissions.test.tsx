// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PdaWorkbench from './index'

const state = vi.hoisted(() => ({
  user: { id: 9, username: 'worker', realName: '小李', roleId: 37, roleName: '仓库作业员', permissions: ['warehouse.task.pick'] },
}))

vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (value: { user: typeof state.user }) => unknown) => select(state) }))
vi.mock('@/hooks/usePdaTodoCounts', () => ({ usePdaTodoCounts: () => ({ data: {} }) }))
vi.mock('@/lib/pdaDeviceBinding', () => ({
  getDeviceCredential: () => ({ deviceCode: 'PDA-TEST' }),
  getDeviceSession: () => ({ token: 'test' }),
}))
vi.mock('@/lib/authSession', () => ({ performSessionLogout: vi.fn() }))
vi.mock('@/components/shared/SystemBrand', () => ({ default: () => <span>极序 Flow</span> }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('工作台只显示路由真正允许进入的作业，并展示当前岗位名称', async () => {
  await act(async () => root.render(<MemoryRouter><PdaWorkbench /></MemoryRouter>))
  expect(host.textContent).not.toContain('拣货任务')
  expect(host.textContent).toContain('仓库作业员')
  expect(host.textContent).not.toContain('拣货员')
})
