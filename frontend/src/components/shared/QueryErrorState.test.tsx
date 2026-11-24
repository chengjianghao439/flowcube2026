// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getByRole } from '@testing-library/dom'
import { expect, test, vi } from 'vitest'
import { QueryErrorState } from './QueryErrorState'

test('读取失败返回文本响应时保留错误提示及重试入口', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const retry = vi.fn()
  const error = Object.assign(new Error('服务暂不可用'), { response: { data: 'upstream unavailable' } })
  try {
    await act(async () => root.render(<QueryErrorState error={error} onRetry={retry} />))
    expect(host.textContent).toContain('加载失败')
    await act(async () => getByRole(host, 'button', { name: '重试' }).click())
    expect(retry).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
