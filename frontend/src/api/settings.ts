import { payloadClient as client } from './client'
import { resolveApiFetchUrl } from '@/lib/apiOrigin'
import type { AxiosRequestConfig } from 'axios'

export interface SettingItem { key_name: string; value: string | null; label: string; type: string; remark: string | null }
export interface SettingsData { list: SettingItem[]; map: Record<string, { value: string | null; label: string; type: string }> }

export const getSettingsApi = () => client.get<SettingsData>('/settings')
export const updateSettingsApi = (data: Record<string, string>) => client.put<null>('/settings', data)
export const getRolesApi = () => client.get<{ id: number; code: string; name: string; remark: string }[]>('/roles')

// ─── 品牌 Logo ────────────────────────────────────────────────────────────
// 后端返回相对路径 /api/settings/logo/image?v=<时间戳>。resolveApiFetchUrl 会自带
// baseURL（含 /api 前缀）拼接，所以这里先剥掉 /api 再传入；
// 结果是当前环境可加载的绝对 URL：浏览器同源（走 Vite 代理）、PDA WebView /
// Electron file:// 指向真实 API 服务器。未上传时 url 为空串，组件回退默认图标+文字。
export interface BrandLogoInfo { url: string; updatedAt: string | null }

export async function getLogoApi(config?: AxiosRequestConfig): Promise<BrandLogoInfo> {
  const info = await client.get<BrandLogoInfo>('/settings/logo', config)
  // 后端返回带 /api 前缀的完整相对路径；resolveApiFetchUrl 内部会自带 baseURL（含 /api），
  // 因此先剥掉 /api 前缀（剩余 /settings/logo/image?v=... 与本仓库 downloadExport 的传法一致）
  const rel = info.url ? info.url.replace(/^\/api/, '') : ''
  return { ...info, url: info.url ? resolveApiFetchUrl(rel) : '' }
}

export const uploadLogoApi = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  // FormData 由浏览器自动生成 multipart boundary；手动 Content-Type 会被 axios 覆盖成无 boundary 的 json 头。
  return client.post<BrandLogoInfo>('/settings/logo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  })
}
