import { payloadClient as client } from './client'

export interface SettingItem { key_name: string; value: string | null; label: string; type: string; remark: string | null }
export interface SettingsData { list: SettingItem[]; map: Record<string, { value: string | null; label: string; type: string }> }

export const getSettingsApi = () => client.get<SettingsData>('/settings')
export const updateSettingsApi = (data: Record<string, string>) => client.put<null>('/settings', data)
export const getRolesApi = () => client.get<{ id: number; code: string; name: string; remark: string }[]>('/roles')
