// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { desktopLocalPrintRequestHeaders, getLocalPrintEnvironmentKind } from './desktopLocalPrint'
import { setDesktopClientId } from './printQueue'

vi.mock('@/api/client', () => ({ payloadClient: { post: vi.fn() } }))
// 浏览器生产站点和本地预览同样使用 Electron target，构建标识不能证明桌面运行时。
vi.mock('@/lib/platform', async importOriginal => ({
  ...await importOriginal<typeof import('./platform')>(), IS_ELECTRON_DESKTOP: true,
}))

afterEach(() => { vi.unstubAllGlobals(); setDesktopClientId(null) })

test('Electron target 的普通浏览器显示浏览器提示，不声明本机打印客户端', () => {
  vi.stubGlobal('window', {})
  expect(getLocalPrintEnvironmentKind()).toBe('browser')
  expect(desktopLocalPrintRequestHeaders()).toEqual({})
})

test('桌面运行时缺少打印能力时明确显示未就绪', () => {
  vi.stubGlobal('window', { flowcubeDesktop: {} })
  expect(getLocalPrintEnvironmentKind()).toBe('electron_no_bridge')
  expect(desktopLocalPrintRequestHeaders()).toEqual({ 'X-Flowcube-Desktop-Local-Print': '1' })
})

test('可用的桌面打印能力保留本机派单标识', () => {
  vi.stubGlobal('window', { flowcubeDesktop: { printZpl: vi.fn() } })
  setDesktopClientId('desktop-print-1')
  expect(getLocalPrintEnvironmentKind()).toBe('ok')
  expect(desktopLocalPrintRequestHeaders()).toEqual({
    'X-Flowcube-Desktop-Local-Print': '1', 'X-Print-Client-Id': 'desktop-print-1',
  })
})
