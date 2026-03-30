import { registerPlugin } from '@capacitor/core'

export type PdaNativeUpdateProgress = {
  status: 'starting' | 'downloading' | 'downloaded' | 'installing' | 'permission_required' | 'error'
  progress: number
  message: string
}

type PdaAppUpdatePlugin = {
  downloadAndInstall(options: { url: string; version: string }): Promise<void>
  addListener(
    eventName: 'updateProgress',
    listenerFunc: (payload: PdaNativeUpdateProgress) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

export const PdaAppUpdate = registerPlugin<PdaAppUpdatePlugin>('PdaAppUpdate')
