// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { getByLabelText, getByRole, queryByLabelText } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import PdaBindPage from './bind'
import { ensureDeviceSession } from '@/api/pda-session'
import { clearDeviceBinding, initDeviceBinding, saveDeviceCredential, saveDeviceSession } from '@/lib/pdaDeviceBinding'

vi.mock('@/api/pda-session', () => ({ ensureDeviceSession: vi.fn() }))

test('分别打开二维码内容和设备码密钥录入，误填二维码不会发起绑定', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<MemoryRouter><PdaBindPage /></MemoryRouter>))
    await act(async () => { await user.click(getByRole(host, 'button', { name: '输入二维码内容' })) })
    const qr = getByRole(host, 'textbox', { name: '输入二维码内容' })
    await act(async () => { await user.type(qr, 'SYNTHETIC-INVALID-QR{Enter}') })
    expect(host.textContent).toContain('这不是设备绑定二维码')
    expect(ensureDeviceSession).not.toHaveBeenCalled()
    expect(queryByLabelText(host, '设备密钥')).toBeNull()

    await act(async () => { await user.click(getByRole(host, 'button', { name: '输入设备码与密钥' })) })
    expect(getByLabelText(host, '设备码')).toBeInstanceOf(HTMLInputElement)
    expect(getByLabelText(host, '设备密钥')).toHaveProperty('type', 'password')
    expect(getByRole(host, 'button', { name: '确认绑定' })).toHaveProperty('disabled', true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('换绑取票未完成时显示已保存的新设备信息，不继续显示旧设备票据', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await initDeviceBinding()
  await clearDeviceBinding()
  await saveDeviceCredential('原设备夹具', 'old-key-fixture')
  await saveDeviceSession({ token: 'old-ticket-fixture', warehouseId: 1, expiresAt: null, scopes: [] })
  vi.mocked(ensureDeviceSession).mockResolvedValueOnce(null)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const user = userEvent.setup()
  try {
    await act(async () => root.render(<MemoryRouter><PdaBindPage /></MemoryRouter>))
    await act(async () => user.click(getByRole(host, 'button', { name: '输入设备码与密钥' })))
    await act(async () => {
      await user.type(getByLabelText(host, '设备码'), '新设备夹具')
      await user.type(getByLabelText(host, '设备密钥'), 'new-key-fixture')
      await user.click(getByRole(host, 'button', { name: '确认绑定' }))
    })
    expect(host.textContent).toContain('本机已保存设备信息')
    expect(host.textContent).toContain('新设备夹具')
    expect(host.textContent).not.toContain('原设备夹具')
    expect(host.textContent).toContain('连不上服务器，无需重新扫码')
  } finally {
    await act(async () => root.unmount())
    await clearDeviceBinding()
    host.remove()
  }
})
