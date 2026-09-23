import { registerPlugin } from '@capacitor/core'

type ScanEvent = { barcode: string }

type PdaScanBridgePlugin = {
  addListener(eventName: 'scan', listener: (event: ScanEvent) => void): Promise<{ remove: () => Promise<void> }>
  getStatus(): Promise<{ enabled: boolean; available: boolean }>
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>
}

export const PdaScanBridge = registerPlugin<PdaScanBridgePlugin>('PdaScanBridge')
