// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DesktopUpdateBridge } from './DesktopUpdateBridge'
const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast }))
let root: Root
let host: HTMLDivElement
let notify: (payload: { version: string; current: string; notes: string; downloadUrl: string }) => void
const unsubscribe = vi.fn()
const start = vi.fn()
const ignore = vi.fn()
const update = { version: '2.0.0', current: '1.0.0', notes: '修复扫码上架\n改进更新安全校验', downloadUrl: 'https://updates.example.test/update.exe' }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  start.mockResolvedValue(undefined)
  ignore.mockResolvedValue(undefined)
  window.flowcubeDesktop = { isDesktop: true, startUpdateDownload: start, ignoreUpdateVersion: ignore,
    subscribeUpdateAvailable: cb => { notify = cb; return unsubscribe },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<StrictMode><DesktopUpdateBridge /></StrictMode>) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.flowcubeDesktop })
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(el => el.textContent === text)
  expect(button).toBeTruthy()
  await act(async () => button!.click())
}

test('global subscription shows release notes and sends version plus URL for immediate update', async () => {
  await act(async () => notify(update))
  expect(document.body.textContent).toContain('发现新版本')
  expect(document.body.textContent).toContain('修复扫码上架')
  await click('立即更新')
  expect(start).toHaveBeenCalledWith({ version: '2.0.0', downloadUrl: update.downloadUrl })
})
test('later closes prompt and a subsequent manual notification can reopen it', async () => {
  await act(async () => notify(update))
  await click('稍后提醒')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => notify(update))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})
test('ignore delegates persistence to the main process', async () => {
  await act(async () => notify(update))
  await click('忽略此版本')
  expect(ignore).toHaveBeenCalledWith('2.0.0')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
test('download failure is visible and keeps the prompt available for retry', async () => {
  start.mockRejectedValueOnce(new Error('更新清单校验失败'))
  await act(async () => notify(update))
  await click('立即更新')
  expect(toast.error).toHaveBeenCalledWith('更新清单校验失败')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})
test('StrictMode and final unmount both clean up their subscription', async () => {
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  expect(unsubscribe).toHaveBeenCalledTimes(2)
})
