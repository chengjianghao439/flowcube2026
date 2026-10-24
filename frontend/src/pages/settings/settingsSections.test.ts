import { expect, test } from 'vitest'
import type { SettingItem } from '@/api/settings'
import { groupSettings } from './settingsSections'

const setting = (key_name: string, value: string | null, type = 'text'): SettingItem => ({ key_name, value, type, label: key_name, remark: null })

test('presentation groups retain every editable server setting, including unknown keys and original values', () => {
  const items = [setting('company_name', '样板企业'), setting('sale_order_prefix', 'XS'), setting('future_rule', null), setting('default_warehouse', '21')]
  const groups = groupSettings(items)
  const result = groups.flatMap(group => group.items)
  expect(result).toHaveLength(items.length)
  for (const item of items) expect(result.find(row => row.key_name === item.key_name)).toBe(item)
  expect(groups.find(group => group.id === 'company')?.items).toContain(items[0])
  expect(groups.find(group => group.id === 'numbering')?.items).toContain(items[1])
})

test('logo and timestamp settings stay out of the ordinary settings form and empty groups are omitted', () => {
  expect(groupSettings([setting('company_logo', 'private-image', 'image'), setting('company_logo_updated_at', 'now', 'timestamp')])).toEqual([])
  expect(groupSettings([setting('future_rule', '0')])).toEqual([{ id: 'business', title: '业务参数', items: [setting('future_rule', '0')] }])
})
