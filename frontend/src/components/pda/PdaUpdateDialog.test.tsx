// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { getByRole, queryByRole } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PdaVersionInfo } from '@/hooks/usePdaUpdate'
import PdaUpdateDialog from './PdaUpdateDialog'

const bridge = vi.hoisted(() => ({
  getInfo: vi.fn(),
  onState: vi.fn(),
  getInstallPermission: vi.fn(),
  openInstallSettings: vi.fn(),
  downloadAndInstall: vi.fn(),
  onProgress: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/app', () => ({ App: { getInfo: bridge.getInfo, addListener: bridge.onState } }))
vi.mock('@/lib/pdaNativeUpdate', () => ({
  PdaAppUpdate: {
    getInstallPermission: bridge.getInstallPermission,
    openInstallSettings: bridge.openInstallSettings,
    downloadAndInstall: bridge.downloadAndInstall,
    addListener: bridge.onProgress,
  },
}))

const version: PdaVersionInfo = {
  version: '0.14.4', versionCode: 164, releaseNote: '', size: 100,
  publishedAt: '', downloadUrl: 'https://pda.fixture.invalid/app.apk', sha256: 'b'.repeat(64),
}
const statusByName = (name: string) => getByRole(document.body, 'button', { name })
const reset = () => vi.fn(async () => {})
let root: Root
let host: HTMLDivElement
let user: ReturnType<typeof userEvent.setup>
let installed: number
let allowed: boolean
let progress: ((event: { status: string; progress: number; message: string; operationId: string }) => void) | undefined
let appState: ((event: { isActive: boolean }) => void) | undefined

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  installed = 163
  allowed = true
  progress = undefined
  appState = undefined
  bridge.getInfo.mockImplementation(async () => ({ build: String(installed) }))
  bridge.getInstallPermission.mockImplementation(async () => ({ allowed }))
  bridge.openInstallSettings.mockResolvedValue(undefined)
  bridge.downloadAndInstall.mockResolvedValue(undefined)
  bridge.onProgress.mockImplementation(async (_event, listener) => { progress = listener; return { remove: reset() } })
  bridge.onState.mockImplementation(async (_event, listener) => { appState = listener; return { remove: reset() } })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  user = userEvent.setup()
  await act(async () => root.render(<PdaUpdateDialog version={version} onDismiss={() => {}} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const press = async (name: string) => act(async () => user.click(statusByName(name)))
const resume = async () => act(async () => {
  appState?.({ isActive: false })
  appState?.({ isActive: true })
})
async function emit(status: string, progressPercent = 100, message = '', operationId = bridge.downloadAndInstall.mock.calls.at(-1)?.[0].operationId) {
  await act(async () => progress?.({ status, progress: progressPercent, message, operationId }))
}

test('首次缺少授权只提供设置；返回仍拒绝保持原状态，授权后才可重试', async () => {
  allowed = false
  await press('立即更新')
  expect(document.body.textContent).toContain('需要允许此应用安装更新包')
  expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  await press('打开安装授权设置')
  await resume()
  expect(bridge.openInstallSettings).toHaveBeenCalledOnce()
  expect(statusByName('打开安装授权设置')).not.toBeNull()
  expect(bridge.downloadAndInstall).not.toHaveBeenCalled()

  allowed = true
  await resume()
  expect(document.body.textContent).toContain('安装授权已开启')
  expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  await press('重试安装')
  expect(bridge.downloadAndInstall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    versionCode: 164, version: version.version, sha256: version.sha256,
  }))
})

test('下载 100% 只表示下载完成，直到系统界面开启及原生安装版号分别确认', async () => {
  await press('立即更新')
  await emit('downloading')
  expect(document.body.textContent).not.toContain('已打开系统安装界面')
  await emit('downloaded')
  expect(document.body.textContent).toContain('正在打开系统安装界面')
  expect(document.body.textContent).not.toContain('版本已更新')
  await emit('installing')
  expect(document.body.textContent).toContain('已打开系统安装界面')
  await resume()
  expect(document.body.textContent).not.toContain('版本已更新')
  expect(statusByName('重试安装')).not.toBeNull()

  installed = 164
  await resume()
  expect(document.body.textContent).toContain('版本已更新')
  expect(queryByRole(document.body, 'button', { name: '重试安装' })).toBeNull()
})

test.each([164, 165])('当前实装版号 %s 已达候选版号，不允许继续下载', async current => {
  installed = current
  await press('立即更新')
  expect(document.body.textContent).toContain('当前设备已安装该版本或更新版本')
  expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
})

test('原生校验拒绝同版或旧包时显示原因并可重试', async () => {
  await press('立即更新')
  await emit('error', 100, '更新包版本不高于当前版本')
  expect(getByRole(document.body, 'alert').textContent).toBe('更新包版本不高于当前版本')
  expect(document.body.textContent).not.toContain('已打开系统安装界面')
  expect(statusByName('重试安装')).not.toBeNull()
})

test('正在重试时旧操作的下载和安装事件不改变本次界面', async () => {
  await press('立即更新')
  const first = bridge.downloadAndInstall.mock.calls[0][0].operationId
  await emit('error', 0, '下载中断')
  await press('重试安装')
  const second = bridge.downloadAndInstall.mock.calls[1][0].operationId
  expect(second).not.toBe(first)
  await emit('installing', 100, '', first)
  expect(document.body.textContent).not.toContain('已打开系统安装界面')
  await emit('installing', 100, '', second)
  expect(document.body.textContent).toContain('已打开系统安装界面')
})
