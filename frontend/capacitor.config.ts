import { CapacitorConfig } from '@capacitor/cli'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * PDA_LIVE_SERVER=1：WebView 加载局域网 Vite（热更新开发）
 * 默认（独立 APK）：不配置 server，使用 webDir(dist) 内置资源 + localStorage 配置 API 根地址
 */
function resolvePdaServerUrl(): string {
  const fromEnv = process.env.PDA_SERVER_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')

  const candidates = [
    join(process.cwd(), '.pda-server-url'),
    join(process.cwd(), 'frontend', '.pda-server-url'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('#'))
    if (line) return line.replace(/\/$/, '')
  }

  return 'http://10.0.2.2:5173'
}

const useLiveServer = process.env.PDA_LIVE_SERVER === '1'
const SERVER_URL = resolvePdaServerUrl()

const config: CapacitorConfig = {
  appId: 'com.flowcube.pda',
  appName: 'FlowCube PDA',
  webDir: 'dist',

  ...(useLiveServer
    ? {
        server: {
          url: `${SERVER_URL}/pda`,
          cleartext: true,
        },
      }
    : {}),

  android: {
    allowMixedContent: true,
    captureInput: true,
    initialFocus: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0f172a',
      androidSplashResourceName: 'splash',
      showSpinner: true,
      spinnerColor: '#3b82f6',
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0f172a',
    },
  },
}

export default config
