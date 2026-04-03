function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDisplayDateTime(value: unknown, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
  ].join('-') + `：${pad(date.getMinutes())}`
}

export function formatDisplayDate(value: unknown, fallback = '—'): string {
  const date = toDate(value)
  if (!date) return fallback
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-')
}
