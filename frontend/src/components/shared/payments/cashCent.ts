/** Payment amounts are integer cents. Prices/costs and intermediate products use their own precision. */
function exactCents(value: string | number): bigint | null {
  const text = String(value).trim().replace(/^([+-]?)\./, '$10.')
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (!match) return null
  const fraction = match[3] || '', exponent = Number(match[4] || 0)
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100 || match[2].length + fraction.length > 100) return null
  const digits = BigInt(match[2] + fraction), shift = 2 + exponent - fraction.length
  const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n
  if (digits % divisor) return null
  const units = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / divisor
  return match[1] === '-' ? -units : units
}
export function cashCents(value: string | number): bigint | null {
  if (value === '') return 0n
  const units = exactCents(value), number = Number(value)
  // The existing JSON API accepts numbers: do not silently lose a cent during conversion.
  return units != null && Number.isFinite(number) && exactCents(number) === units ? units : null
}
export function cashText(units: bigint): string {
  const absolute = units < 0n ? -units : units
  return `${units < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
