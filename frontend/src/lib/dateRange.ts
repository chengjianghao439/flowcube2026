function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateInput(value: Date): string {
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
  ].join('-')
}

export function getRelativeDateRange(days: number, end = new Date()): { startDate: string; endDate: string } {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 1
  const endDate = new Date(end)
  const startDate = new Date(end)
  startDate.setDate(startDate.getDate() - (safeDays - 1))
  return {
    startDate: formatDateInput(startDate),
    endDate: formatDateInput(endDate),
  }
}

export function getMonthDateRange(date = new Date()): { startDate: string; endDate: string } {
  const endDate = new Date(date)
  const startDate = new Date(date)
  startDate.setDate(1)
  return {
    startDate: formatDateInput(startDate),
    endDate: formatDateInput(endDate),
  }
}
