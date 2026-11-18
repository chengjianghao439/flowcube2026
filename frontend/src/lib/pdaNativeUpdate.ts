import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type PdaNativeUpdateProgress = {
  operationId: string
  status: 'starting' | 'downloading' | 'downloaded' | 'installing' | 'permission_required' | 'error'
  progress: number
  message: string
}

type PdaAppUpdatePlugin = {
  getInstallPermission(): Promise<{ allowed: boolean }>
  openInstallSettings(): Promise<void>
  downloadAndInstall(options: {
    url: string
    version: string
    versionCode: number
    sha256?: string
    operationId: string
  }): Promise<void>
  addListener(
    eventName: 'updateProgress',
    listenerFunc: (payload: PdaNativeUpdateProgress) => void,
  ): Promise<PluginListenerHandle>
}

export const PdaAppUpdate = registerPlugin<PdaAppUpdatePlugin>('PdaAppUpdate')
