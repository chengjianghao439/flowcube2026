/**
 * useCameraScanner — 原生相机二维码扫码（PDA 绑定页用）
 *
 * 背景：PDA 的红外/激光扫码枪只能扫一维条码（keydown 键盘模拟，见 PdaScanner），
 * 绑定二维码是 QR 码（二维），红外枪扫不了 → 绑定页必须有相机扫码入口。
 * 走 @capacitor-mlkit/barcode-scanning（Android ML Kit 原生解码，工业屏暗光/反光鲁棒）。
 *
 * 用法：一次性扫一个 QR 码（scan()，插件自带相机取景界面），返回 rawValue（扫码枪
 * 同一套 handleScan 流程往下走）。非原生平台（浏览器 dev / Electron 桌面）恒返回
 * null——PDA 页面在这些环境仍走扫码枪或手动输入，扫码按钮只在 APK 里显示。
 */

import { useCallback, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning'

export function useCameraScanner() {
  const [scanning, setScanning] = useState(false)

  const scan = useCallback(async (): Promise<string | null> => {
    // 与 secureStorage/pdaRuntime 同判据：仅原生 APK 有 ML Kit，浏览器/桌面直接不可用
    if (!Capacitor.isNativePlatform()) return null
    setScanning(true)
    try {
      const { supported } = await BarcodeScanner.isSupported()
      if (!supported) return null
      const res = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode], autoZoom: true })
      return res?.barcodes?.[0]?.rawValue ?? null
    } catch {
      return null
    } finally {
      setScanning(false)
    }
  }, [])

  return { scan, scanning }
}
