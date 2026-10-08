// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

test.each([':fullscreen', ':modal', ':popover-open'])('%s 查询不递归进入宿主 matches', (selector) => {
  const element = document.createElement('button')
  const matches = vi.spyOn(Element.prototype, 'matches')

  expect(element.matches(selector)).toBe(false)
  // A state query must return directly, rather than re-entering jsdom until
  // stack exhaustion is caught as false. Count calls instead of timing CI.
  expect(matches).toHaveBeenCalledTimes(1)
})

test('普通选择器和开放详情仍按 DOM 状态匹配', () => {
  const details = document.createElement('details')
  details.innerHTML = '<summary>明细</summary><button disabled>保存</button>'
  details.open = true

  expect(details.matches('details:open')).toBe(true)
  expect(details.querySelector('button:disabled')?.textContent).toBe('保存')
  expect(details.querySelector('button:enabled')).toBeNull()
})
