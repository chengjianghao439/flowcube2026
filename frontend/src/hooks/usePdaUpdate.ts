/**
 * usePdaUpdate — PDA App 自动升级 Hook
 *
 * 逻辑：
 *  1. App 启动后 3 秒静默检查版本（不影响扫码操作）
 *  2. 对比本地已安装原生版本与服务器版本
 *  3. 有新版本时返回版本信息，由 UI 层决定是否弹出提示
 */
import { useState, useEffect } from 'react'
import axios from 'axios'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { getResolvedPdaApiOrigin, resolvePdaServerUrl } from '@/lib/pdaRuntime'
import { toast } from '@/lib/toast'

export interface PdaVersionInfo {
  version: string
  versionCode: number
  releaseNote: string
  downloadUrl: string
  size: number
  publishedAt: string
  available?: boolean
}

const LOCAL_VERSION_KEY = 'pda_installed_version'

async function readInstalledVersionCode(): Promise<number> {
  if (!Capacitor.isNativePlatform()) {
    return parseInt(localStorage.getItem(LOCAL_VERSION_KEY) || '0', 10) || 0
  }
  try {
    const info = await App.getInfo()
    const build = Number(info.build)
    if (Number.isFinite(build) && build > 0) return build
  } catch {
    // ignore and fallback to storage
  }
  return parseInt(localStorage.getItem(LOCAL_VERSION_KEY) || '0', 10) || 0
}

function getVersionApiUrl(): string {
  if (Capacitor.isNativePlatform()) {
    const origin = getResolvedPdaApiOrigin()
    if (origin) return `${origin}/api/pda/version`
  }
  return resolvePdaServerUrl('/api/pda/version')
}

export function usePdaUpdate() {
  const [newVersion, setNewVersion] = useState<PdaVersionInfo | null>(null)
  const [checking, setChecking]     = useState(false)

  useEffect(() => {
    // 延迟 3 秒检查，避免影响启动速度
    void readInstalledVersionCode().then((code) => {
      if (code > 0) localStorage.setItem(LOCAL_VERSION_KEY, String(code))
    })
    const timer = setTimeout(() => { void checkUpdate() }, 3000)
    return () => clearTimeout(timer)
  }, [])

  async function checkUpdate(options?: { manual?: boolean }) {
    const manual = options?.manual === true
    try {
      setChecking(true)
      const versionApi = getVersionApiUrl()
      const res = await axios.get(versionApi, { timeout: 8000 })
      const info: PdaVersionInfo | null = res.data?.data
      if (!info || info.available === false || !info.downloadUrl) {
        if (manual) toast.success('当前没有可下载的 PDA 更新包')
        return
      }

      const localCode = await readInstalledVersionCode()
      if (localCode > 0) localStorage.setItem(LOCAL_VERSION_KEY, String(localCode))
      if (info.versionCode > localCode) {
        setNewVersion({
          ...info,
          downloadUrl: resolvePdaServerUrl(info.downloadUrl),
        })
      } else if (manual) {
        toast.success('当前已是最新版本')
      }
    } catch (e) {
      if (manual) {
        toast.error(e instanceof Error ? e.message : '检查更新失败')
      }
    } finally {
      setChecking(false)
    }
  }

  function dismiss() { setNewVersion(null) }

  return { newVersion, checking, checkUpdate, dismiss }
}
