import { describe, expect, it } from 'vitest'
import { clampAllocationQty, isAllocationQtyValid } from './saleAllocation'

describe('sales allocation quantities', () => {
  it('accepts positive decimal quantities up to the available limit', () => {
    expect(isAllocationQtyValid(1.25, 2)).toBe(true)
    expect(isAllocationQtyValid(2.01, 2)).toBe(false)
    expect(isAllocationQtyValid(0, 2)).toBe(false)
  })

  it('normalizes computed decimal remainder', () => {
    expect(clampAllocationQty(0.3 - 0.1, 0.3)).toBe(0.2)
    expect(isAllocationQtyValid(0.00001, 1)).toBe(false)
  })

  it('clamps shortcut quantities to the current limit', () => {
    expect(clampAllocationQty(5, 3.5)).toBe(3.5)
    expect(clampAllocationQty(-1, 3.5)).toBe(0)
  })
})
