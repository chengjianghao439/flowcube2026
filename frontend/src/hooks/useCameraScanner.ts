/**
 * useCameraScanner — 原生相机二维码扫码（PDA 绑定页用）
 *
 * 背景：PDA 的红外/激光扫码枪只能扫一维条码（keydown 键盘模拟，见 PdaScanner），
 * 绑定二维码是 QR 码（二维），红外枪扫不了 → 绑定页必须有相机扫码入口。
 * 走 @capacitor-mlkit/barcode-scanning（Android ML Kit 原生解码，工业屏暗光/反光鲁棒）。
 *
 * 为什么用 startScan 而不是 scan()（2026-08-27 修复，根因见 docs/claude-md-archive-2026-09-04.md 第 20 节）：
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

interface ScanSession {
  cancelled: boolean
  starting: boolean
  startIssued: boolean
  listener?: { remove: () => Promise<void> }
  onResult: (raw: string) => void
  cleanup: Promise<void>[]
}

// 插件相机是进程单例，跨 hook 卸载/重挂也必须等待旧原生操作结束。
let nativeOwner: ScanSession | null = null

function removeListener(session: ScanSession) {
  const listener = session.listener
  session.listener = undefined
  if (listener) session.cleanup.push(listener.remove().catch(() => { /* 原生资源清理失败不产生未处理拒绝。 */ }))
}

async function stopNativeScan() {
  try { await BarcodeScanner.stopScan() } catch { /* 页面关闭仍需完成其余资源清理。 */ }
}

export function useCameraScanner() {
  const [scanning, setScanning] = useState(false)
  const [open, setOpen] = useState(false)
  const sessionRef = useRef<ScanSession | null>(null)
  const mountedRef = useRef(true)

  const releaseSession = useCallback(async (session: ScanSession) => {
    await Promise.all(session.cleanup)
    if (nativeOwner === session) nativeOwner = null
    if (sessionRef.current === session) sessionRef.current = null
  }, [])

  const cancelSession = useCallback(() => {
    const session = sessionRef.current
    if (!session || session.cancelled) return
    session.cancelled = true
    removeListener(session)
    if (session.startIssued) session.cleanup.push(stopNativeScan())
    // 启动中的代次由 finally 补做 stop 后等待全部清理；不能只等最后一次 stop。
    if (!session.starting) void releaseSession(session)
  }, [releaseSession])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; cancelSession() }
  }, [cancelSession])

  useEffect(() => {
    document.body.classList.toggle('barcode-scanner-active', open)
    return () => document.body.classList.remove('barcode-scanner-active')
  }, [open])

  const scan = useCallback(async (onResult: (raw: string) => void, onFail?: () => void) => {
    if (!Capacitor.isNativePlatform() || !mountedRef.current || sessionRef.current || nativeOwner) return
    const session: ScanSession = { cancelled: false, starting: true, startIssued: false, onResult, cleanup: [] }
    sessionRef.current = session
    nativeOwner = session
    setOpen(true)
    setScanning(true)
    try {
      session.listener = await BarcodeScanner.addListener('barcodesScanned', ev => {
        if (session.cancelled || !mountedRef.current) return
        const raw = ev?.barcodes?.[0]?.rawValue
        if (raw) session.onResult(raw)
      })
      if (session.cancelled) return
      const { supported } = await BarcodeScanner.isSupported()
      if (session.cancelled) return
      if (!supported) {
        cancelSession()
        onFail?.()
        return
      }
      session.startIssued = true
      await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] })
    } catch {
      if (!session.cancelled && mountedRef.current) {
        cancelSession()
        onFail?.()
      }
    } finally {
      if (session.cancelled) {
        removeListener(session)
        // close/unmount 可能先于原生 startScan 完成，完成后再次停止。
        if (session.startIssued) session.cleanup.push(stopNativeScan())
        await releaseSession(session)
      }
      session.starting = false
      if (mountedRef.current) {
        setScanning(false)
        if (session.cancelled) setOpen(false)
      }
    }
  }, [cancelSession, releaseSession])

  const close = useCallback(() => {
    cancelSession()
    setOpen(false)
    setScanning(false)
  }, [cancelSession])

  return { scan, close, scanning, open }
}
