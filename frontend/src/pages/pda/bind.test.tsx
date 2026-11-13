// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { getByLabelText, getByRole, queryByLabelText } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import PdaBindPage from './bind'
import { ensureDeviceSession } from '@/api/pda-session'

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
