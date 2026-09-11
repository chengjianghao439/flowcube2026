import { expect, test } from 'vitest'
import { formatBackendCode, formatErrorMessage } from './displayFormatters'
test('label render errors retain actionable layout guidance after API error formatting', () => {
  const message = '条码超出纸张边界，请调整位置或尺寸'
  expect(formatBackendCode('LABEL_RENDER_INVALID', formatErrorMessage(message))).toBe(message)
})
