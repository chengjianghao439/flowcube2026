import { expect, test } from 'vitest'
import { parseInboundFreightAmount } from './inboundFreight'
test('运费同DECIMAL(14,2)上界，空null/0保留，原三位/负数/超界拒绝', () => {
  expect(parseInboundFreightAmount('999999999999.99')).toBe(999999999999.99)
  expect(parseInboundFreightAmount('')).toBeNull(); expect(parseInboundFreightAmount('0')).toBe(0)
  for (const raw of ['1000000000000', '1000000000000.00', '1.001', '-1']) expect(() => parseInboundFreightAmount(raw)).toThrow()
})
