// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import PlasticBoxesPage from './index'
import type { PlasticBox } from '@/hooks/usePlasticBoxes'
import type { FinderResult } from '@/types/finder'
const mocks = vi.hoisted(() => ({ failed: false, retry: vi.fn() }))
vi.mock('@/hooks/usePlasticBoxes', async (original) => ({ ...await original<typeof import('@/hooks/usePlasticBoxes')>(), usePlasticBoxMovements: () => ({ data: mocks.failed ? undefined : [], isLoading: false, isError: mocks.failed, error: mocks.failed ? new Error('模拟流水断网') : null, refetch: mocks.retry }) }))
vi.mock('@/components/finder', () => ({ FinderTrigger: ({ value, onClick }: { value: string; onClick: () => void }) => <button onClick={onClick}>{value || '选择商品'}</button>, ProductFinder: ({ open, onConfirm }: { open: boolean; onConfirm: (p: FinderResult) => void }) => open ? <button onClick={() => onConfirm({ id: 7, name: '选中商品', code: 'P7' })}>确认商品</button> : null }))
vi.mock('@/components/shared/WarehouseSelect', () => ({ WarehouseSelect: ({ value, onChange }: { value: number | null; onChange: (id: number, name: string) => void }) => <button onClick={() => onChange(3, '选中仓库')}>{value ? '选中仓库' : '选择仓库'}</button> }))
vi.mock('@/components/shared/BaseCrudPage', () => ({ default: (p: { onOpen?: () => void; renderForm: () => ReactNode; canSubmit?: () => boolean; renderActions: (b: PlasticBox, h: object) => ReactNode }) => <><button onClick={() => p.onOpen?.()}>新建</button>{p.renderForm()}<button id="create" disabled={p.canSubmit ? !p.canSubmit() : false}>创建</button>{p.renderActions({ id: 1, barcode: 'B1', remainingQty: 0 } as PlasticBox, {})}</> }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mocks.failed = false; mocks.retry.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<PlasticBoxesPage />)) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function click(label: string) { const b = [...document.querySelectorAll('button')].find(b => b.textContent === label); expect(b,label).toBeTruthy(); await act(async () => b!.click()) }
test('新建必须选择商品和仓库，重新新建清空上次选择', async () => {
  await click('新建')
  expect(host.querySelector<HTMLButtonElement>('#create')!.disabled).toBe(true)
  await click('选择商品'); await click('确认商品'); await click('选择仓库')
  expect(host.querySelector<HTMLButtonElement>('#create')!.disabled).toBe(false)
  await click('新建')
  expect(host.textContent).not.toContain('选中商品'); expect(host.textContent).not.toContain('选中仓库')
  expect(host.querySelector<HTMLButtonElement>('#create')!.disabled).toBe(true)
})
test('流水请求失败显示错误与重试，不显示暂无流水', async () => {
  mocks.failed = true; await click('详情')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('塑料盒流水加载失败')
  expect(dialog.textContent).not.toContain('暂无流水')
  await click('重试'); expect(mocks.retry).toHaveBeenCalledOnce()
})
