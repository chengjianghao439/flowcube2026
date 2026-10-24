import type { SettingItem } from '@/api/settings'

export interface SettingsSection {
  id: 'company' | 'numbering' | 'business'
  title: string
  items: SettingItem[]
}

/** Presentation only: preserve server-owned keys, values, labels and item identity. */
export function groupSettings(items: SettingItem[]): SettingsSection[] {
  const sections: SettingsSection[] = [
    { id: 'company', title: '企业信息', items: [] },
    { id: 'numbering', title: '单据编号', items: [] },
    { id: 'business', title: '业务参数', items: [] },
  ]
  for (const item of items) {
    if (item.type === 'image' || item.type === 'timestamp') continue
    const section = item.key_name.startsWith('company_')
      ? sections[0]
      : /(?:prefix|suffix|numbering)/i.test(item.key_name) ? sections[1] : sections[2]
    section.items.push(item)
  }
  return sections.filter(section => section.items.length > 0)
}
