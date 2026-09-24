// @vitest-environment jsdom
import { act, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Outlet, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { pdaRoutes } from './pdaRoutes'
import { secureStorage } from '@/lib/secureStorage'
import { getDeviceCredential } from '@/lib/pdaDeviceBinding'
import { useAuthStore } from '@/store/authStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.mock('@/layouts/PdaLayout', () => ({ default: () => <Outlet /> }))
vi.mock('@/pages/pda/bind', () => ({ default: () => <div>{getDeviceCredential()?.deviceCode ?? '缓存未初始化'}</div> }))

const hosts: HTMLDivElement[] = []
afterEach(() => { hosts.splice(0).forEach(h => h.remove()) })

it('ERP 路由直达 PDA 绑定页前先读取本机设备缓存', async () => {
  useAuthStore.setState({ isAuthenticated: true })
  await secureStorage.setItem('flowcube-pda-device', JSON.stringify({ deviceCode: 'TEST-PDA', deviceSecret: 'test-secret', boundAt: '2026-09-24' }))
  const host = document.createElement('div'); document.body.append(host); hosts.push(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/pda/bind']}><Suspense fallback={<div>加载中</div>}><Routes>{pdaRoutes()}</Routes></Suspense></MemoryRouter>)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(host.textContent).toContain('TEST-PDA')
  await act(async () => root.unmount())
  await secureStorage.removeItem('flowcube-pda-device')
})
