// @vitest-environment jsdom
import { AxiosError } from 'axios'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import apiClient from '@/api/client'
import { AppToast } from '@/components/shared/AppToast'
import Page from './inventory-query'

let host: HTMLDivElement
let root: Root
const originalAdapter = apiClient.defaults.adapter

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  apiClient.defaults.adapter = async config => {
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
      config,
      data: { success: false, message: '扫码查询失败：条码无效' },
      status: 400,
      statusText: 'Bad Request',
      headers: {},
    })
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><Page /><AppToast /></MemoryRouter>)
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  apiClient.defaults.adapter = originalAdapter
})

test('库存查询失败只显示页面反馈，不叠加右侧全局 toast', async () => {
  const manualButton = [...host.querySelectorAll('button')].find(button => button.textContent === '手动输入')!
  await act(async () => { manualButton.click() })
  const input = host.querySelector<HTMLInputElement>('[data-scanner-manual="true"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'I000123')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 10))
  })
  expect(host.textContent).toContain('扫码查询失败：条码无效')
  expect(document.querySelectorAll('.fc-toast')).toHaveLength(0)
})
