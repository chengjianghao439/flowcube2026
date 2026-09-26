import { expect, test } from 'vitest'
import { formatBackendCode, formatErrorMessage, formatPrintStatus } from './displayFormatters'

test('作废的「条码状态」与「因作废终结的任务结果」文案不得互相冒充', () => {
  // 业务状态：条码已作废，且明确不能再补打
  expect(formatPrintStatus('voided')).toContain('条码已作废')
  expect(formatPrintStatus('voided')).toContain('不能再补打')
  // 任务结果：**从未出纸**——不得复用「打印失败，可尝试补打」，否则会引导用户去点已被拒绝的补打
  expect(formatPrintStatus('voided_job')).toContain('未出纸')
  expect(formatPrintStatus('voided_job')).not.toContain('可尝试补打')
  // 原有语义保持不变
  expect(formatPrintStatus('success')).toBe('已打印')
  expect(formatPrintStatus('failed')).toContain('打印失败')
})
test('label render errors retain actionable layout guidance after API error formatting', () => {
  const message = '条码超出纸张边界，请调整位置或尺寸'
  expect(formatBackendCode('LABEL_RENDER_INVALID', formatErrorMessage(message))).toBe(message)
})
