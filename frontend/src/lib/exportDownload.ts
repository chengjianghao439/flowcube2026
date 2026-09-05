import apiClient from '@/api/client'

/**
 * 触发后端 xlsx 文件下载
 * 复用认证续期、运行时地址、账套和超时；仅下载响应使用 Blob。
 */
export async function downloadExport(path: string, params?: Record<string, string>) {
  const res = await apiClient.get<Blob>(path, { params, responseType: 'blob', skipGlobalError: true })
  const blob = res.data
  const disposition = String(res.headers['content-disposition'] || '')
  const match = disposition.match(/filename\*=UTF-8''(.+)/)
  const filename = match ? decodeURIComponent(match[1]) : 'export.xlsx'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
