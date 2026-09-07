import { CapacitorConfig } from '@capacitor/cli'

/** PDA 仅使用内置 webDir(dist) 资源。 */
const config: CapacitorConfig = {
  appId: 'com.flowcube.pda',
  appName: '极序 Flow',
  webDir: 'dist',

  android: {
    allowMixedContent: true,
    captureInput: true,
    initialFocus: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
      showSpinner: true,
      spinnerColor: '#0b339a',
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0f172a',
    },
  },
}

export default config
