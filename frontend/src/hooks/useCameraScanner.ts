/**
 * useCameraScanner — 原生相机二维码扫码（PDA 绑定页用）
 *
 * 背景：PDA 的红外/激光扫码枪只能扫一维条码（keydown 键盘模拟，见 PdaScanner），
 * 绑定二维码是 QR 码（二维），红外枪扫不了 → 绑定页必须有相机扫码入口。
 * 走 @capacitor-mlkit/barcode-scanning（Android ML Kit 原生解码，工业屏暗光/反光鲁棒）。
 *
 * 为什么用 startScan 而不是 scan()（2026-08-27 修复，根因见 CLAUDE.md 第 20 节）：
 * 8.1.0 的 scan() 路由到 GMS Code Scanner 的「一键式界面」——要求设备装有 Google
 * Play Services 并预装 GMS 扫码模块（isGoogleBarcodeScannerModuleAvailable 为假时
 * 直接 reject ERROR_GOOGLE_BARCODE_SCANNER_MODULE_NOT_AVAILABLE）；而本项目在
 * AndroidManifest 声明的是 ML Kit 本地模型 barcode_ui（unbundled，deps 也确为
 * unbundled 坐标），两者形态不对接，且工业 PDA 大多无 Play Services。
 * startScan 走插件自带的 CameraX 预览（ML Kit 本地解码，无 Play Services 依赖），
 * 但取景是「WebView 背景透明 → 原生视图透出」的机制：扫描期间必须把页面根背景
 * 置为透明（.barcode-scanner-active），否则原生画面被不透明背景盖住，用户看到的
 * 就是「点了按钮什么也没发生」。
 *
 * 用法：扫描期内调用方渲染引导浮层（见 bind.tsx 的 CameraOverlay）；一次成功扫码
 * 即调 onResult，扫描框保持打开（连续扫）直到调用方 close。非原生平台（浏览器
 * dev / Electron 桌面）恒不可用——PDA 页面在这些环境仍走扫码枪或手动输入，
 * 扫码按钮只在 APK 里显示。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning'

export function useCameraScanner() {
  const [scanning, setScanning] = useState(false)
  const [open, setOpen] = useState(false)
  const onResultRef = useRef<((raw: string) => void) | null>(null)

  // —— 扫描期间把页面根背景变透明，让插件塞进 WebView 底层的原生取景透出来 ——
  // 插件 hideWebViewBackground 只把 WebView 置透明；不透明的是页面 body/布局根。
  // 这里的作用域是全局根节点：PDA 入口根是 html>body 下的 pda-root 容器。
  useEffect(() => {
    document.body.classList.toggle('barcode-scanner-active', open)
    return () => document.body.classList.remove('barcode-scanner-active')
  }, [open])

  useEffect(() => {
    if (!open) return
    const handle = BarcodeScanner.addListener('barcodesScanned', ev => {
      const raw = ev?.barcodes?.[0]?.rawValue
      if (raw) onResultRef.current?.(raw)
    })
    void handle
    return () => {
      void handle.then(h => h.remove())
    }
  }, [open])

  const scan = useCallback(async (onResult: (raw: string) => void, onFail?: () => void) => {
    // 与 secureStorage/pdaRuntime 同判据：仅原生 APK 有 ML Kit，浏览器/桌面直接不可用
    if (!Capacitor.isNativePlatform()) return
    onResultRef.current = onResult
    setOpen(true)
    setScanning(true)
    try {
      const { supported } = await BarcodeScanner.isSupported()
      if (!supported) {
        onFail?.()
        setOpen(false)
        return
      }
      // 连续扫描（一次扫码成功即回调，扫描框保持打开直到调用方关闭）：
      // 一方面补扫其它码不用重开相机，另一方面不给「扫到即关」的竞态留窗口——
      // 回调发生在插件原生线程，此时 stop 会重插一段 previewView。
      await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] })
    } catch {
      onFail?.()
      setOpen(false)
    } finally {
      setScanning(false)
    }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    onResultRef.current = null
    void BarcodeScanner.stopScan().catch(() => {})
  }, [])

  return { scan, close, scanning, open }
}
