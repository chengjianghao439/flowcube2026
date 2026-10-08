// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import PdaHeader from './PdaHeader'

test('数量进度保留合法小数，百分比仍为整数', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<PdaHeader title="扫码拣货" progress={{ current: 1.25, total: 2.5 }} />) })
    expect(host.textContent).toContain('1.25/2.5 (50%)')
    expect(host.querySelector('h1')?.textContent).toBe('扫码拣货')
  } finally { await act(async () => { root.unmount() }) }
})
