import { CapacitorConfig } from '@capacitor/cli'

// ── WebView 壳模式配置 ──────────────────────────────────────────────────────
// App 启动后直接加载服务器页面，绕过 Android 5 本地 WebView 兼容性问题
// 修改 SERVER_URL 为实际服务器 IP（开发：Vite dev server；生产：nginx 地址）
const SERVER_URL = process.env.PDA_SERVER_URL || 'http://192.168.8.109:5173'

const config: CapacitorConfig = {
  appId: 'com.flowcube.pda',
  appName: 'FlowCube PDA',
  webDir: 'dist',

  // 加载服务器上的 /pda 页面（Live 模式）
  server: {
    url: `${SERVER_URL}/pda`,
    cleartext: true,  // 允许明文 HTTP（局域网内网）
  },

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
