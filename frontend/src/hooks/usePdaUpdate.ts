/**
 * usePdaUpdate — PDA App 自动升级 Hook
 *
 * 逻辑：
 *  1. App 启动后 3 秒静默检查版本（不影响扫码操作）
 *  2. 对比本地版本（存储在 localStorage）与服务器版本
 *  3. 有新版本时返回版本信息，由 UI 层决定是否弹出提示
 */
import { useState, useEffect } from 'react'
import axios from 'axios'

export interface PdaVersionInfo {
  version: string
  versionCode: number
  releaseNote: string
  downloadUrl: string
  size: number
  publishedAt: string
}

const LOCAL_VERSION_KEY = 'pda_installed_version'
// 当前 APK 打包时写入的版本号（每次发布时手动更新）
export const CURRENT_VERSION_CODE = 2

export function usePdaUpdate() {
  const [newVersion, setNewVersion] = useState<PdaVersionInfo | null>(null)
  const [checking, setChecking]     = useState(false)

  useEffect(() => {
    // 保存当前已安装版本到 localStorage
    localStorage.setItem(LOCAL_VERSION_KEY, String(CURRENT_VERSION_CODE))

    // 延迟 3 秒检查，避免影响启动速度
    const timer = setTimeout(checkUpdate, 3000)
    return () => clearTimeout(timer)
  }, [])

  async function checkUpdate() {
    try {
      setChecking(true)
      const res = await axios.get('/api/pda/version', { timeout: 8000 })
      const info: PdaVersionInfo | null = res.data?.data
      if (!info) return

      const localCode = parseInt(localStorage.getItem(LOCAL_VERSION_KEY) || '0', 10)
      if (info.versionCode > localCode) {
        setNewVersion(info)
      }
    } catch {
      // 静默失败，不影响使用
    } finally {
      setChecking(false)
    }
  }

  function dismiss() { setNewVersion(null) }

  return { newVersion, checking, checkUpdate, dismiss }
}
