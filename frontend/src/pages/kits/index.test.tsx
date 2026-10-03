// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import KitsPage from './index'
import { savedKit } from './kitFixtures.test-data'
import { useAuthStore } from '@/store/authStore'
import { PERMISSIONS } from '@/lib/permission-codes'
import { TabPathContext } from '@/components/layout/TabPathContext'
const fixtures = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), defaults: { baseURL: '/api' } }))
vi.mock('@/api/kits', () => ({ getKitsApi: fixtures.list, getKitApi: fixtures.detail, createKitApi: fixtures.create, updateKitApi: fixtures.update, deleteKitApi: fixtures.remove }))
vi.mock('@/api/client', () => ({ default: { defaults: fixtures.defaults } }))
// 商品选择器本身已有组件回归，本测试只替代其查询/弹窗以点击真实回填路径。
vi.mock('@/components/shared/ProductFinderModal', () => ({ default: ({ open, onConfirm, onClose }: { open: boolean; onConfirm: (p: unknown) => void; onClose: () => void }) => open ? <button onClick={() => { onConfirm({ id: 13, code: 'P13', name: '新组件', unit: '个', allowDecimalQty: false }); onClose() }}>选择真实商品</button> : null }))
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); vi.resetAllMocks(); fixtures.defaults.baseURL = '/api'
  fixtures.list.mockResolvedValue({ list: [structuredClone(savedKit)], pagination: { page: 1, pageSize: 20, total: 1 } })
  fixtures.detail.mockResolvedValue(structuredClone(savedKit))
  useAuthStore.setState({ token: 'unit-test-only', sessionGeneration: 10, user: { id: 5, username: 'fixture', realName: '测试', roleId: 5, roleName: '测试', permissions: [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.PRODUCT_CREATE, PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_DELETE] } })
})
async function mount(run: (host: HTMLElement) => Promise<void>, path = '/kits?keyword=套') {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/sale?keyword=销售']}><TabPathContext.Provider value={path}><KitsPage /></TabPathContext.Provider></MemoryRouter></QueryClientProvider>); await new Promise(r => setTimeout(r, 15)) })
    await act(async () => { await new Promise(r => setTimeout(r, 15)) }); await run(host)
  } finally {
    await act(async () => {
      root.unmount()
      // Radix schedules unmount autofocus with setTimeout(0). Finish it while
      // this jsdom realm still owns CustomEvent and the detached dialog.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    })
    qc.clear(); host.remove()
  }
}
const click = async (name: string) => { const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === name); expect(button, `应有按钮 ${name}`).toBeTruthy(); await act(async () => { button!.click(); await new Promise(r => setTimeout(r, 15)) }); await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
const change = async (label: string, value: string) => { const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; expect(input).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
test('资料列表只查当前页，自己的Tab查询；只读账号查看但不出现写入口', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.PRODUCT_VIEW] } })
  await mount(async host => {
    expect(host.textContent).toContain('成套配件'); expect(host.textContent).toContain('铰链套')
    expect(fixtures.list.mock.calls[0][0]).toEqual({ page: 1, pageSize: 20, keyword: '套' })
    expect(host.textContent).not.toContain('新增配件'); expect(host.textContent).not.toContain('删除')
    await click('查看'); expect(document.body.textContent).toContain('采样时间未单独保存')
    expect(document.body.textContent).toContain('0.000001')
    expect(document.body.textContent).not.toContain('保存修改')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="每套默认报价"]')?.matches(':disabled')).toBe(true)
  })
})
test('报价独立修改省略组成并展示服务端新版本/revision，原A价参考不变', async () => {
  const updated = structuredClone(savedKit); updated.revision = 4; updated.currentVersionId = 20; updated.version!.id = 20; updated.version!.versionNo = 3; updated.version!.referenceUnitPrice = 200
  fixtures.update.mockResolvedValue(updated)
  await mount(async () => {
    await click('维护'); await change('每套默认报价', '200'); await click('保存修改')
    expect(fixtures.update.mock.calls[0][1]).toEqual({ code: 'K7', name: '铰链套', isActive: true, referenceUnitPrice: 200, revision: 3 })
    expect(document.body.textContent).toContain('当前版本 3'); expect(document.body.textContent).toContain('资料修订 4')
    expect(document.body.textContent).toContain('0.000001')
  })
})
test('409保留输入且外部刷新不覆盖；未复制不能重载，复制后显式重载', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '资料已被其他操作更新' })
  const newer = structuredClone(savedKit); newer.name = '外部新名'; newer.revision = 4
  const clipboard = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  await mount(async () => {
    await click('维护'); await change('配件名称', '我的草稿'); await click('保存修改')
    fixtures.detail.mockResolvedValue(newer)
    expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')!.value).toBe('我的草稿')
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!.matches(':disabled')).toBe(true)
    await click('复制草稿内容'); expect(clipboard.mock.calls[0][0]).toContain('我的草稿')
    await click('重载最新资料')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')!.value).toBe('外部新名')
  })
})
test('未知提交冻结编辑，原键原内容重试不会生成第二份', async () => {
  fixtures.update.mockRejectedValueOnce(new Error('超时')).mockResolvedValueOnce(savedKit)
  await mount(async () => {
    await click('维护'); await change('配件名称', '待确认草稿'); await click('保存修改')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')!.matches(':disabled')).toBe(true)
    await click('按原请求重试'); expect(fixtures.update.mock.calls[1]).toEqual(fixtures.update.mock.calls[0])
  })
})
test('新增通过真实商品选择回填基本单位，显式模式必须全部填写', async () => {
  await mount(async () => {
    await click('新增配件'); await change('配件编码', 'KNEW'); await change('配件名称', '新套'); await change('每套默认报价', '20')
    await click('添加组件'); await click('选择真实商品')
    const radio = document.querySelector<HTMLInputElement>('input[value="explicit"]')!
    await act(async () => radio.click()); await click('创建配件')
    expect(fixtures.create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('全部组件')
    await change('新组件分摊比例', '1'); fixtures.create.mockResolvedValue(savedKit); await click('创建配件')
    expect(fixtures.create.mock.calls[0][0]).toEqual({ code: 'KNEW', name: '新套', isActive: true, referenceUnitPrice: 20, components: [{ productId: 13, baseQty: 1, amountWeight: 1 }] })
  })
})
test('删除提交原修订，超时同键重试，关闭按钮不丢原提交', async () => {
  fixtures.remove.mockRejectedValueOnce(new Error('超时')).mockResolvedValueOnce({ ...savedKit, deletedAt: '2026-10-02 09:00:00', revision: 4 })
  await mount(async () => {
    await click('删除'); await click('确认删除')
    expect(fixtures.remove.mock.calls[0][1]).toEqual({ revision: 3 })
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '取消')?.disabled).toBe(true)
    await click('按原请求重试')
    expect(fixtures.remove.mock.calls[1]).toEqual(fixtures.remove.mock.calls[0])
    expect(document.body.textContent).not.toContain('确认删除')
  })
})
test('只有对应创建权限可新增，缺修改/删除权限仍只读现有配件', async () => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, permissions: [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.PRODUCT_CREATE] } })
  await mount(async host => {
    expect(host.textContent).toContain('新增配件'); expect(host.textContent).toContain('查看'); expect(host.textContent).not.toContain('删除')
    await click('查看'); expect(document.body.textContent).not.toContain('保存修改')
  })
})
test('删除409复制后显式读取新修订，再次请求失败应展示本次原因', async () => {
  fixtures.remove.mockRejectedValueOnce({ status: 409, message: '原修订过期' }).mockRejectedValueOnce(new Error('超时'))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  await mount(async () => {
    await click('删除'); await click('确认删除'); await click('复制原资料')
    fixtures.detail.mockResolvedValue({ ...savedKit, revision: 4 })
    await click('重读待删资料'); await click('确认删除')
    expect(fixtures.remove.mock.calls[1][1]).toEqual({ revision: 4 })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('提交结果未确认')
  })
})
test('A服务器409后切B不能重载B同号资料；回A保留原草稿而非B报价', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '资料被更新' })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  try {
    await mount(async () => {
      await click('维护'); await change('配件名称', 'A草稿'); await click('保存修改'); await click('复制草稿内容')
      const calls = fixtures.detail.mock.calls.length
      fixtures.defaults.baseURL = '/server-b'
      fixtures.detail.mockResolvedValue({ ...savedKit, code: 'SERVER-B', name: '服务器B资料', version: { ...savedKit.version!, referenceUnitPrice: 333 } })
      await click('重载最新资料')
      expect(fixtures.detail).toHaveBeenCalledTimes(calls)
      expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')?.value).toBe('A草稿')
      fixtures.defaults.baseURL = '/api'; await change('配件名称', 'A继续修改'); await click('保存修改')
      expect(fixtures.update.mock.calls[1][1]).toMatchObject({ code: 'K7', name: 'A继续修改', referenceUnitPrice: 100, revision: 3 })
    })
  } finally { fixtures.defaults.baseURL = '/api' }
})
test('删除409切B不重读同号资料，迟到重读不能跨登录代次替换原revision', async () => {
  fixtures.remove.mockRejectedValue({ status: 409, message: '修订已过期' })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  try {
    await mount(async () => {
      await click('删除'); await click('确认删除'); await click('复制原资料')
      const calls = fixtures.detail.mock.calls.length
      fixtures.defaults.baseURL = '/server-b'; await click('重读待删资料')
      expect(fixtures.detail).toHaveBeenCalledTimes(calls)
      fixtures.defaults.baseURL = '/api'
      let finish!: (value: unknown) => void
      fixtures.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      await click('重读待删资料')
      useAuthStore.setState({ sessionGeneration: 11 })
      await act(async () => { finish({ ...savedKit, revision: 99 }); await new Promise(r => setTimeout(r, 10)) })
      expect(document.body.textContent).toContain('资料修订 3')
      expect(document.body.textContent).not.toContain('资料修订 99')
    })
  } finally { fixtures.defaults.baseURL = '/api' }
})
test('首次详情读取绑定列表原来源；读取期间切服务器，迟到结果不得初始化表单', async () => {
  let finish!: (value: unknown) => void
  fixtures.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  try {
    await mount(async () => {
      await click('维护'); fixtures.defaults.baseURL = '/server-b'
      await act(async () => { finish(savedKit); await new Promise(r => setTimeout(r, 15)) })
      await act(async () => { await new Promise(r => setTimeout(r, 10)) })
      expect(document.querySelector('input[aria-label="配件名称"]')).toBeNull()
      expect(document.body.textContent).toContain('资料读取失败')
    })
  } finally { fixtures.defaults.baseURL = '/api' }
})
test('A重载在途切B，迟到的A结果也不覆盖当前草稿；回A后可显式重新读取', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '资料被更新' })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  try {
    await mount(async () => {
      await click('维护'); await change('配件名称', 'A草稿'); await click('保存修改'); await click('复制草稿内容')
      let finish!: (value: unknown) => void
      fixtures.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      await click('重载最新资料'); expect(fixtures.detail.mock.calls.at(-1)?.[1]).toMatchObject({ baseURL: '/api', userId: 5, sessionGeneration: 10 })
      fixtures.defaults.baseURL = '/server-b'
      await act(async () => { finish({ ...savedKit, name: '迟到资料A', revision: 4 }); await new Promise(r => setTimeout(r, 15)) })
      expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')?.value).toBe('A草稿')
      fixtures.defaults.baseURL = '/api'; fixtures.detail.mockResolvedValue({ ...savedKit, name: '明确重读A', revision: 4 }); await click('重载最新资料')
      expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')?.value).toBe('明确重读A')
    })
  } finally { fixtures.defaults.baseURL = '/api' }
})
test('重载期间账号id变化即使代次未变也不能套用原返回资料', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '资料被更新' })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  await mount(async () => {
    await click('维护'); await change('配件名称', '本人草稿'); await click('保存修改'); await click('复制草稿内容')
    let finish!: (value: unknown) => void
    fixtures.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await click('重载最新资料')
    await act(async () => {
      useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 99 } })
      finish({ ...savedKit, name: '旧账号迟到资料', revision: 99 }); await new Promise(r => setTimeout(r, 15))
    })
    expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')?.value).toBe('本人草稿')
    expect(document.body.textContent).toContain('登录账号或会话已变化')
  })
})
test('复制A在途继续修改B，A迟到成功不能解锁重载或覆盖未备份B', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '修订冲突' })
  let finish!: () => void
  const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await mount(async () => {
    await click('维护'); await change('配件名称', '复制草稿A'); await click('保存修改'); await click('复制草稿内容')
    await change('配件名称', '未备份草稿B')
    await act(async () => { finish(); await new Promise(r => setTimeout(r, 10)) })
    const reload = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!
    expect(reload.matches(':disabled')).toBe(true)
    fixtures.detail.mockResolvedValue({ ...savedKit, name: '服务端最新', revision: 4 }); await click('重载最新资料')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="配件名称"]')?.value).toBe('未备份草稿B')
    expect(writeText.mock.calls[0][0]).toContain('复制草稿A')
    expect(writeText.mock.calls[0][0]).not.toContain('未备份草稿B')
  })
})
test('复制A迟到失败不能显示A的手工备份并冒充B已备份，当前B手工备份才可重载', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '修订冲突' })
  let fail!: (e: Error) => void
  const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject })).mockRejectedValueOnce(new Error('无剪贴板权限'))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await mount(async () => {
    await click('维护'); await change('配件名称', '复制草稿A'); await click('保存修改'); await click('复制草稿内容')
    await change('配件名称', '手工草稿B')
    await act(async () => { fail(new Error('拒绝复制')); await new Promise(r => setTimeout(r, 10)) })
    expect(document.querySelector('textarea[aria-label="完整草稿内容"]')).toBeNull()
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '已备份草稿')).toBeUndefined()
    await click('复制草稿内容')
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="完整草稿内容"]')?.value).toContain('手工草稿B')
    await click('已备份草稿')
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!.matches(':disabled')).toBe(false)
    await change('配件名称', '又改草稿C')
    expect(document.querySelector('textarea[aria-label="完整草稿内容"]')).toBeNull()
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!.matches(':disabled')).toBe(true)
  })
})
test('删除复制在途会话已变化，不能承认原复制解锁重载', async () => {
  fixtures.remove.mockRejectedValue({ status: 409, message: '删除修订冲突' })
  let finish!: () => void
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })) } })
  await mount(async () => {
    await click('删除'); await click('确认删除'); await click('复制原资料')
    await act(async () => { useAuthStore.setState({ sessionGeneration: 11 }); finish(); await new Promise(r => setTimeout(r, 10)) })
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重读待删资料')!.matches(':disabled')).toBe(true)
  })
})
test('组件数量沿标准整数/两位输入约束，大额报价用货币格式且保留四位精确tooltip', async () => {
  fixtures.list.mockResolvedValue({ list: [{ ...savedKit, version: { ...savedKit.version!, referenceUnitPrice: 1234567.1234 } }], pagination: { page: 1, pageSize: 20, total: 1 } })
  await mount(async host => {
    expect(host.textContent).toContain('¥1,234,567.12')
    expect(host.querySelector('[title="¥1234567.1234"]')).toBeTruthy()
    await click('维护')
    const integer = document.querySelector<HTMLInputElement>('input[aria-label="螺钉每套基本量"]')!
    const decimal = document.querySelector<HTMLInputElement>('input[aria-label="铰链每套基本量"]')!
    expect(integer.type).toBe('number'); expect(integer.step).toBe('1'); expect(decimal.step).toBe('0.01')
    await change('螺钉每套基本量', '1.5'); expect(integer.value).toBe('4')
    await change('铰链每套基本量', '0.001'); expect(decimal.value).toBe('0.01')
  })
})
test('草稿改B再恢复A也不能承认较早复制代次；新复制完成才解锁', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '修订冲突' })
  let finishOld!: () => void
  const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve })).mockResolvedValueOnce(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await mount(async () => {
    await click('维护'); await change('配件名称', 'A'); await click('保存修改'); await click('复制草稿内容')
    await change('配件名称', 'B'); await change('配件名称', 'A')
    await act(async () => { finishOld(); await new Promise(r => setTimeout(r, 10)) })
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!.matches(':disabled')).toBe(true)
    await click('复制草稿内容')
    expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!.matches(':disabled')).toBe(false)
  })
})
test('编辑复制在途切服务器，旧来源完成不得把草稿标为已备份', async () => {
  fixtures.update.mockRejectedValue({ status: 409, message: '修订冲突' })
  let finish!: () => void
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })) } })
  try {
    await mount(async () => {
      await click('维护'); await change('配件名称', 'A草稿'); await click('保存修改'); await click('复制草稿内容')
      fixtures.defaults.baseURL = '/server-b'
      await act(async () => { finish(); await new Promise(r => setTimeout(r, 10)) })
      expect(Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重载最新资料')!.matches(':disabled')).toBe(true)
    })
  } finally { fixtures.defaults.baseURL = '/api' }
})
test('dialog fixture finishes real Radix unmount autofocus before leaving its jsdom realm', async () => {
  const events: Event[] = []
  await mount(async () => {
    await click('维护')
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).toBeTruthy()
    dialog!.addEventListener('focusScope.autoFocusOnUnmount', event => events.push(event))
  })
  expect(events).toHaveLength(1)
  expect(events[0]).toBeInstanceOf(window.CustomEvent)
})
