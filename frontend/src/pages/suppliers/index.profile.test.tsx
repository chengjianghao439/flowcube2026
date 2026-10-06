// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import SuppliersPage from './index'
import type { Supplier } from '@/types/suppliers'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), invalidate: vi.fn() }))
interface FormProps {
  renderForm: (editing: Supplier | null, open: boolean) => ReactNode
  onOpen: (editing: Supplier | null) => void
  submitForm: (editing: Supplier | null) => Promise<unknown>
}
let pageProps: FormProps
vi.mock('@/components/shared/BaseCrudPage', () => ({ default: (props: FormProps) => { pageProps = props; return <>{props.renderForm(null, true)}</> } }))
vi.mock('@/hooks/usePartyLedger', () => ({ usePartyLedger: () => ({ canView: false }) }))
vi.mock('@tanstack/react-query', async importOriginal => ({ ...await importOriginal<typeof import('@tanstack/react-query')>(), useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))
vi.mock('@/api/suppliers', () => ({ getSuppliersApi: vi.fn(), createSupplierApi: mocks.create, updateSupplierApi: mocks.update, deleteSupplierApi: vi.fn() }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const supplier: Supplier = { id: 9, code: 'SUP9', name: '测试供应商', contact: null, phone: null, email: null, address: null, remark: null, settlementType: 2, settlementTypeName: '月结', paymentTermsDays: 60, leadTimeDays: 7, isActive: false, createdAt: '' }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.create.mockReset().mockResolvedValue({}); mocks.update.mockReset().mockResolvedValue({})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<SuppliersPage />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

test('供应商表单Unicode边界和座机完整保留，结算/提前期/启用状态不变', async () => {
  const profile = { name: '𠮷'.repeat(100), contact: '𠮷'.repeat(50), phone: '+86 (010) 1234-5678', address: '𠮷'.repeat(200), remark: '𠮷'.repeat(500) }
  await act(async () => pageProps.onOpen({ ...supplier, ...Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, ` ${v} `])) }))
  for (const [field, limit] of Object.entries({ name: 100, contact: 50, phone: 30, address: 200, remark: 500 })) {
    const input = document.querySelector<HTMLInputElement>(`#supplier-${field}`)!
    expect(input.hasAttribute('maxlength')).toBe(false)
    expect(input.parentElement!.textContent).toContain(`${Array.from(profile[field as keyof typeof profile]).length}/${limit}`)
  }
  await act(async () => { await pageProps.submitForm(supplier) })
  expect(mocks.update).toHaveBeenCalledWith(9, expect.objectContaining({ ...profile, settlementType: 2, paymentTermsDays: 60, leadTimeDays: 7, isActive: false }))
})

test.each([
  ['name', '名'.repeat(101), '供应商名称最多 100 个字符'],
  ['name', '   ', '供应商名称不能为空'],
  ['contact', '人'.repeat(51), '联系人最多 50 个字符'],
  ['phone', '1'.repeat(31), '电话最多 30 个字符'],
  ['phone', '123转4', '电话仅支持数字、空格、+、(、)、-'],
  ['address', '址'.repeat(201), '地址最多 200 个字符'],
  ['remark', '注'.repeat(501), '备注最多 500 个字符'],
])('供应商%s非法时不给API、不截断输入', async (field, value, message) => {
  await act(async () => pageProps.onOpen({ ...supplier, [field]: value }))
  let error: unknown
  await act(async () => { try { await pageProps.submitForm(supplier) } catch (e) { error = e } })
  expect(error).toMatchObject({ response: { data: { message } } })
  expect(mocks.update).not.toHaveBeenCalled()
  expect(document.querySelector<HTMLInputElement>(`#supplier-${field}`)!.value).toBe(value)
})
