export function readStringParam(params: URLSearchParams, key: string, fallback = ''): string {
  return params.get(key)?.trim() ?? fallback
}

export function readPositiveIntParam(params: URLSearchParams, key: string, fallback = 1): number {
  const value = Number(params.get(key) || '')
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function readNullableIntParam(params: URLSearchParams, key: string): number | null {
  const value = Number(params.get(key) || '')
  return Number.isInteger(value) && value > 0 ? value : null
}

export function upsertSearchParams(
  current: URLSearchParams,
  updates: Record<string, string | number | null | undefined>,
) {
  const next = new URLSearchParams(current)
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '') next.delete(key)
    else next.set(key, String(value))
  }
  return next
}
