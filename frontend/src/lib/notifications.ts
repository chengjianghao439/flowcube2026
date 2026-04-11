export type NotificationCategory = 'finance' | 'inventory' | 'operations' | 'system'

export interface NotificationEntry {
  type: string
  icon: string
  text: string
  path: string
  category?: NotificationCategory
  priority?: number
  dedupeKey?: string
}

export function normalizeNotifications(items: NotificationEntry[]) {
  const seen = new Set<string>()
  const normalized: NotificationEntry[] = []

  for (const item of items) {
    const dedupeKey = item.dedupeKey || `${item.category || 'general'}:${item.text}:${item.path}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push({ ...item, dedupeKey })
  }

  return normalized.sort((a, b) => {
    const priorityDelta = (a.priority ?? 100) - (b.priority ?? 100)
    if (priorityDelta !== 0) return priorityDelta
    return (a.text || '').localeCompare(b.text || '', 'zh-Hans-CN')
  })
}

export function getReminderNotifications(items: NotificationEntry[]) {
  return normalizeNotifications(items).filter(item => item.category === 'finance' || item.category === 'system')
}

export function getNotificationCategoryLabel(category?: NotificationCategory) {
  switch (category) {
    case 'finance':
      return '财务'
    case 'inventory':
      return '库存'
    case 'operations':
      return '作业'
    case 'system':
      return '系统'
    default:
      return '提醒'
  }
}
