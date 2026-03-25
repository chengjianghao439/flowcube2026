import { useAuthStore } from '@/store/authStore'
import { resolveApiFetchUrl } from '@/lib/apiOrigin'

/**
 * 触发后端 xlsx 文件下载
 * 利用 fetch + Blob 方式，带上 JWT token
 */
export async function downloadExport(path: string, params?: Record<string, string>) {
  const token = useAuthStore.getState().token
  const query = params ? '?' + new URLSearchParams(params).toString() : ''
  const fetchUrl = resolveApiFetchUrl(path, query)
  let res: Response
  try {
    res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error('无法连接服务器，请检查网络与服务器地址')
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.message || '导出失败')
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename\*=UTF-8''(.+)/)
  const filename = match ? decodeURIComponent(match[1]) : 'export.xlsx'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
