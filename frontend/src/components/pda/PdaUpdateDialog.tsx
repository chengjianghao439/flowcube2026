/**
 * PdaUpdateDialog — PDA App 升级提示弹窗
 */
import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PdaVersionInfo } from '@/hooks/usePdaUpdate'
import { PdaAppUpdate, type PdaNativeUpdateProgress } from '@/lib/pdaNativeUpdate'
import { toast } from '@/lib/toast'

interface Props {
  version: PdaVersionInfo
  onDismiss: () => void
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function PdaUpdateDialog({ version, onDismiss }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress]       = useState(0)
  const [error, setError]             = useState<string | null>(null)
  const [nativeStatus, setNativeStatus] = useState('')
  const nativeListenerRef = useRef<null | { remove: () => Promise<void> }>(null)

  useEffect(() => {
    return () => {
      if (nativeListenerRef.current) {
        void nativeListenerRef.current.remove()
        nativeListenerRef.current = null
      }
    }
  }, [])

  async function handleUpdate() {
    setDownloading(true)
    setError(null)
    setProgress(0)
    setNativeStatus('')
    try {
      if (Capacitor.isNativePlatform()) {
        if (nativeListenerRef.current) {
          await nativeListenerRef.current.remove()
          nativeListenerRef.current = null
        }
        nativeListenerRef.current = await PdaAppUpdate.addListener(
          'updateProgress',
          (payload: PdaNativeUpdateProgress) => {
            setNativeStatus(payload.message || '')
            setProgress(Math.max(0, Math.min(100, Number(payload.progress) || 0)))
            if (payload.status === 'permission_required') {
              setError(payload.message || '请先允许安装未知来源应用')
              setDownloading(false)
            }
            if (payload.status === 'installing') {
              setDownloading(false)
              toast.success(payload.message || '已打开安装界面，请完成安装')
            }
            if (payload.status === 'error') {
              setError(payload.message || '下载失败，请重试')
              setDownloading(false)
            }
          },
        )
        await PdaAppUpdate.downloadAndInstall({
          url: version.downloadUrl,
          version: version.version,
        })
        return
      }

      const response = await fetch(version.downloadUrl)
      if (!response.ok) throw new Error('下载失败')
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('无法读取下载流')
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (contentLength > 0) setProgress(Math.round(received / contentLength * 100))
      }
      const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' })
      const url  = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `FlowCubePDA-${version.version}.apk`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setProgress(100)
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载失败，请重试')
    } finally {
      if (!Capacitor.isNativePlatform()) setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <span className="text-3xl">🚀</span>
          <div>
            <h2 className="text-lg font-bold text-white">发现新版本 v{version.version}</h2>
            <p className="text-sm text-slate-400">当前版本可升级</p>
          </div>
        </div>
        {version.releaseNote && (
          <div className="mb-4 rounded-xl border border-slate-700 bg-slate-900/50 p-3">
            <p className="text-xs font-semibold text-slate-400 mb-1">更新内容</p>
            <p className="text-sm text-slate-300">{version.releaseNote}</p>
          </div>
        )}
        {version.size > 0 && (
          <p className="mb-4 text-xs text-slate-500">文件大小：{formatSize(version.size)}</p>
        )}
        {downloading && progress < 100 && (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>{nativeStatus || '正在下载...'}</span><span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-700">
              <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {progress === 100 && (
          <div className="mb-4 rounded-xl border border-green-700/40 bg-green-950/30 p-3 text-center">
            <p className="text-sm text-green-400">
              {Capacitor.isNativePlatform() ? '✅ 已打开安装界面，请按系统提示完成安装' : '✅ 下载完成，请确认安装'}
            </p>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl border border-red-700/40 bg-red-950/30 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        <div className="flex gap-3">
          {progress < 100 && (
            <button
              onClick={handleUpdate}
              disabled={downloading}
              className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white active:scale-95 disabled:opacity-60"
            >
              {downloading ? (Capacitor.isNativePlatform() ? `${nativeStatus || '下载中'} ${progress}%` : `下载中 ${progress}%`) : '立即更新'}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="rounded-xl bg-slate-700 px-5 py-3 text-sm text-slate-300 active:scale-95"
          >
            {progress === 100 ? '关闭' : '稍后更新'}
          </button>
        </div>
      </div>
    </div>
  )
}
