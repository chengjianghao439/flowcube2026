/**
 * PdaUpdateDialog — PDA App 升级提示弹窗
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { PdaVersionInfo } from '@/hooks/usePdaUpdate'
import { PdaAppUpdate } from '@/lib/pdaNativeUpdate'
import PdaDialog from './PdaDialog'

interface Props {
  version: PdaVersionInfo
  onDismiss: () => void
}

type Stage = 'ready' | 'checking' | 'permission' | 'authorized' | 'downloading' | 'opening-installer'
  | 'installer-opened' | 'installed' | 'already-current' | 'browser-downloaded' | 'error'
let updateSequence = 0

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function getInstalledBuild() {
  const build = Number((await App.getInfo()).build)
  if (!Number.isSafeInteger(build) || build < 1) throw new Error('无法读取设备安装版本，请重试')
  return build
}

export default function PdaUpdateDialog({ version, onDismiss }: Props) {
  const native = Capacitor.isNativePlatform()
  const [stage, renderStage] = useState<Stage>('ready')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<Stage>('ready')
  const operation = useRef<string | null>(null)
  const openingSettings = useRef(false)
  const progressListener = useRef<Promise<PluginListenerHandle> | null>(null)
  const setStage = useCallback((next: Stage) => {
    stageRef.current = next
    renderStage(next)
  }, [])

  useEffect(() => {
    if (!native) return
    let disposed = false
    let checkRevision = 0
    const listener = PdaAppUpdate.addListener('updateProgress', payload => {
      if (disposed || payload.operationId !== operation.current) return
      setProgress(Math.max(0, Math.min(100, Number(payload.progress) || 0)))
      switch (payload.status) {
        case 'downloaded':
          setStage('opening-installer')
          break
        case 'permission_required':
          operation.current = null
          setStage('permission')
          break
        case 'installing':
          operation.current = null
          setStage('installer-opened')
          break
        case 'error':
          operation.current = null
          setError(payload.message || '更新失败，请重试')
          setStage('error')
          break
      }
    })
    progressListener.current = listener
    const appListener = App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive || disposed) return
      const observedStage = stageRef.current
      const revision = ++checkRevision
      const isCurrent = () => !disposed && revision === checkRevision && stageRef.current === observedStage
      try {
        if (observedStage === 'permission' || observedStage === 'authorized') {
          const { allowed } = await PdaAppUpdate.getInstallPermission()
          if (isCurrent()) setStage(allowed ? 'authorized' : 'permission')
        }
        if (observedStage === 'installer-opened') {
          const installed = await getInstalledBuild()
          if (isCurrent() && installed >= version.versionCode) setStage('installed')
        }
      } catch { /* 下一次回到应用可继续核对。 */ }
    })
    void listener.catch(() => {})
    void appListener.catch(() => {})
    return () => {
      disposed = true
      operation.current = null
      progressListener.current = null
      void listener.then(handle => handle.remove()).catch(() => {})
      void appListener.then(handle => handle.remove()).catch(() => {})
    }
  }, [native, setStage, version.versionCode])

  async function openSettings() {
    if (openingSettings.current) return
    openingSettings.current = true
    setError(null)
    try {
      await PdaAppUpdate.openInstallSettings()
      const { allowed } = await PdaAppUpdate.getInstallPermission()
      if (allowed && stageRef.current === 'permission') setStage('authorized')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法打开安装授权设置')
    } finally {
      openingSettings.current = false
    }
  }

  async function handleUpdate() {
    if (operation.current) return
    const operationId = `${Date.now()}-${++updateSequence}`
    operation.current = operationId
    setProgress(0)
    setError(null)
    setStage('checking')
    try {
      if (native) {
        const installed = await getInstalledBuild()
        if (operation.current !== operationId) return
        if (installed >= version.versionCode) {
          operation.current = null
          setStage('already-current')
          return
        }
        const { allowed } = await PdaAppUpdate.getInstallPermission()
        if (operation.current !== operationId) return
        if (!allowed) {
          operation.current = null
          setStage('permission')
          return
        }
        if (!progressListener.current) throw new Error('无法连接设备更新服务，请重试')
        await progressListener.current
        if (operation.current !== operationId) return
        setStage('downloading')
        await PdaAppUpdate.downloadAndInstall({
          url: version.downloadUrl,
          version: version.version,
          versionCode: version.versionCode,
          sha256: version.sha256,
          operationId,
        })
        return
      }

      setStage('downloading')
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
      const blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.android.package-archive' })
      if (version.sha256) {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
        if (hex !== version.sha256.toLowerCase()) throw new Error('更新包已损坏，请重新下载')
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `JiXu-Flow-PDA-${version.version}.apk`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      operation.current = null
      setStage('browser-downloaded')
    } catch (reason) {
      if (operation.current !== operationId) return
      operation.current = null
      setError(reason instanceof Error ? reason.message : '更新失败，请重试')
      setStage('error')
    }
  }

  const dismiss = () => { if (!operation.current) onDismiss() }
  const busy = stage === 'checking' || stage === 'downloading' || stage === 'opening-installer'
  const terminal = stage === 'installed' || stage === 'already-current' || stage === 'browser-downloaded'
  const actionText = stage === 'ready' ? '立即更新'
    : stage === 'permission' ? '打开安装授权设置'
      : busy ? '更新准备中' : native ? '重试安装' : '重新下载'
  const messages: Partial<Record<Stage, string>> = {
    permission: '需要允许此应用安装更新包。请在系统设置中开启安装授权。',
    authorized: '安装授权已开启，可以重试安装。',
    checking: '正在检查设备版本和安装授权',
    'opening-installer': '下载完成，正在打开系统安装界面',
    'installer-opened': '已打开系统安装界面，请按系统提示完成安装。',
    installed: '版本已更新',
    'already-current': '当前设备已安装该版本或更新版本',
    'browser-downloaded': '下载完成，请在设备上确认安装',
  }

  return (
    <PdaDialog title={`发现新版本 v${version.version}`} description="安装状态以设备报告的版本为准" onDismiss={dismiss} footer={
      <div className="flex gap-3">
        {!terminal && (
          <button
            type="button"
            onClick={stage === 'permission' ? openSettings : handleUpdate}
            disabled={busy}
            className="flex-1 rounded-xl bg-primary py-3 font-bold text-primary-foreground motion-safe:active:scale-95 disabled:opacity-60"
          >
            {actionText}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="rounded-xl border border-border bg-background px-5 py-3 text-sm text-muted-foreground motion-safe:active:scale-95 disabled:opacity-60"
        >
          {terminal ? '关闭' : '稍后更新'}
        </button>
      </div>
    }>
      {version.releaseNote && (
        <div className="mb-4 rounded-2xl border border-border bg-muted/40 p-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">更新内容</p>
          <p className="text-sm text-foreground">{version.releaseNote}</p>
        </div>
      )}
      {version.size > 0 && (
        <p className="mb-4 text-xs text-muted-foreground">文件大小：{formatSize(version.size)}</p>
      )}
      {stage === 'downloading' && (
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>正在下载更新包</span><span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {messages[stage] && (
        <p role="status" className="rounded-2xl border border-border bg-muted/40 p-3 text-sm">{messages[stage]}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-ink">{error}</p>
      )}
    </PdaDialog>
  )
}
