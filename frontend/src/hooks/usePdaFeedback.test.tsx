// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { usePdaFeedback } from './usePdaFeedback'
import PdaFlash from '@/components/pda/PdaFlash'

test('错误保持可读并宣告，明确清除后消失', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  const host = document.createElement('div'), root = createRoot(host)
  function Harness() {
    const { flash, err, clear } = usePdaFeedback({ sound: false, vibrate: false })
    return <><button onClick={() => err('读取中断，请核对原结果')}>错误</button><button onClick={clear}>清除</button><PdaFlash flash={flash} /></>
  }
  try {
    await act(async () => { root.render(<Harness />) })
    await act(async () => { host.querySelectorAll('button')[0].click(); vi.advanceTimersByTime(10000) })
    expect(host.textContent).toContain('读取中断，请核对原结果')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取中断')
    await act(async () => { host.querySelectorAll('button')[1].click() })
    expect(host.textContent).not.toContain('读取中断')
  } finally { await act(async () => { root.unmount() }); vi.useRealTimers() }
})
