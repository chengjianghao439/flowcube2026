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
  return `${[
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-')} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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

/** 本地时区今天的 YYYY-MM-DD（2026-08-21：查询弹窗默认时间统一用这个） */
export function todayYmd(): string {
  const now = new Date()
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-')
}
