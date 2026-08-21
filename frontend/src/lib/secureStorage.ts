/**
 * SecureStorage — 设备凭据加密存储（2026-08-21 权衡修复）
 *
 * 原生（APK）：Android Keystore AES-GCM 加密存 SharedPreferences，明文不落盘。
 * 非原生（浏览器 dev）：无 Keystore，回退内存态（不持久化）——现场 PDA 是真机
 * APK 走原生路径；浏览器只是调试用。
 */
import { Capacitor } from '@capacitor/core'
import { registerPlugin } from '@capacitor/core'

type SecureStoragePlugin = {
  setItem(options: { key: string; value: string }): Promise<void>
  getItem(options: { key: string }): Promise<{ value: string | null }>
  removeItem(options: { key: string }): Promise<void>
  clear(): Promise<void>
}

const NativeSecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage')

// 非原生回退：内存 Map（不持久化；浏览器调试场景每次启动需重新绑定）
const memoryStore = new Map<string, string>()

export const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeSecureStorage.setItem({ key, value })
    } else {
      memoryStore.set(key, value)
    }
  },
  async getItem(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const r = await NativeSecureStorage.getItem({ key })
      return r.value
    }
    return memoryStore.get(key) ?? null
  },
  async removeItem(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeSecureStorage.removeItem({ key })
    } else {
      memoryStore.delete(key)
    }
  },
  async clear(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeSecureStorage.clear()
    } else {
      memoryStore.clear()
    }
  },
}
