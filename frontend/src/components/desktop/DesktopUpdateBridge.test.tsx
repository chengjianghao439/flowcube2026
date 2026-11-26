// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DesktopUpdateBridge } from './DesktopUpdateBridge'
import { useDirtyGuardStore } from '@/store/dirtyGuardStore'

let root: Root
let host: HTMLDivElement
let notify: (payload: DesktopUpdateState) => void
const unsubscribe = vi.fn()
const check = vi.fn()
const cancel = vi.fn()
const restart = vi.fn()
const showMessageBox = vi.fn()
const update = { version: '2.0.0', current: '1.0.0', notes: '修复扫码上架\n改进更新校验' }

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  check.mockResolvedValue(undefined)
  cancel.mockResolvedValue(undefined)
  restart.mockResolvedValue(undefined)
  useDirtyGuardStore.setState({ dirtyTabs: {}, pendingConfirm: null })
  window.flowcubeDesktop = {
    isDesktop: true,
    triggerUpdateCheck: check,
    cancelUpdateDownload: cancel,
    restartToUpdate: restart,
    showMessageBox,
    subscribeUpdateState: cb => { notify = cb; return unsubscribe },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<StrictMode><DesktopUpdateBridge /></StrictMode>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete window.flowcubeDesktop
})

async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(el => el.textContent === label)
  expect(button).toBeTruthy()
  await act(async () => button!.click())
}

test('background download shows progress, can be cancelled and leaves a retry action', async () => {
  await act(async () => notify({ stage: 'downloading', ...update, received: 20, total: 100, percent: 20 }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).toContain('20%')
  await click('查看更新')
  expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('20')
  await click('取消下载')
  expect(cancel).toHaveBeenCalledTimes(1)
  await act(async () => notify({ stage: 'cancelled', ...update }))
  expect(document.body.textContent).toContain('已取消下载')
  await click('重新检查')
  expect(check).toHaveBeenCalledTimes(1)
  expect(restart).not.toHaveBeenCalled()
})

test('unknown download size stays indeterminate and installing removes the close control', async () => {
  await act(async () => notify({ stage: 'downloading', ...update }))
  await click('查看更新')
  const progress = document.querySelector('[role="progressbar"]')
  expect(progress).toBeTruthy()
  expect(progress?.hasAttribute('aria-valuenow')).toBe(false)
  await act(async () => notify({ stage: 'installing', ...update }))
  expect(document.querySelector('[role="dialog"] button.absolute')).toBeNull()
  expect(document.querySelector('.fc-dialog-footer button:disabled')).toBeTruthy()
})

test('ready update can be deferred and reopened, and installs only after an explicit restart', async () => {
  await act(async () => notify({ stage: 'ready', ...update }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).toContain('已下载，等待重启')
  await click('查看更新')
  expect(document.body.textContent).toContain('修复扫码上架')
  await click('稍后')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(restart).not.toHaveBeenCalled()
  await click('查看更新')
  await click('重启升级')
  expect(restart).toHaveBeenCalledExactlyOnceWith()
})

test('the ready reminder can be minimized, reopened, or used to restart directly', async () => {
  await act(async () => notify({ stage: 'ready', ...update }))
  const minimize = document.querySelector<HTMLButtonElement>('[aria-label="收起更新提醒"]')
  expect(minimize).toBeTruthy()
  await act(async () => minimize!.click())
  expect(document.querySelector('aside')).toBeNull()
  await click('桌面更新')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click('稍后')
  expect(restart).not.toHaveBeenCalled()
  await click('重启升级')
  expect(restart).toHaveBeenCalledExactlyOnceWith()
})

test('dashboard and retry use the same update panel and report the current version', async () => {
  await act(async () => window.dispatchEvent(new Event('flowcube-open-update')))
  expect(check).toHaveBeenCalledTimes(1)
  await act(async () => notify({ stage: 'error', message: '更新清单校验失败', showNotice: true }))
  expect(document.body.textContent).toContain('更新清单校验失败')
  await click('重新检查')
  expect(check).toHaveBeenCalledTimes(2)
  await act(async () => notify({ stage: 'current', current: '1.0.0' }))
  expect(document.body.textContent).toContain('当前已是最新版本')
})

test('restart respects dirty tabs, including cancellation of the native confirmation', async () => {
  useDirtyGuardStore.getState().setDirty('/erp/sale/new', true)
  showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 })
  await act(async () => notify({ stage: 'ready', ...update }))
  await click('查看更新')
  await click('重启升级')
  expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 1, cancelId: 1 }))
  expect(restart).not.toHaveBeenCalled()
  await click('重启升级')
  expect(restart).toHaveBeenCalledExactlyOnceWith()
})

test('StrictMode and final unmount both clean up the updater subscription', async () => {
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  expect(unsubscribe).toHaveBeenCalledTimes(2)
})
