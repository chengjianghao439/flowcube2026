/**
 * usePdaScanner — 工业 PDA 扫码枪输入 Hook
 *
 * Android 套壳：扫码枪一般为「键盘模式」，按键事件进入 document，本 Hook 即可接收，无需额外原生插件。
 *
 * 稳定性优化：
 *  - onScan 通过 ref 调用，避免 useEffect 依赖变化导致反复注册/销毁事件监听
 *  - 高频扫码（每秒多次）不丢码，不重复注册
 */
import { useEffect, useRef } from 'react'

const SCAN_INTERVAL_MS = 50  // 扫码枪相邻字符最大间隔（毫秒）
const MIN_SCAN_LENGTH  = 3   // 最短有效条码长度

interface Options {
  onScan: (barcode: string) => void
  /** 是否激活监听（false 时暂停，用于处理中禁止重复扫码）*/
  enabled?: boolean
}

export function usePdaScanner({ onScan, enabled = true }: Options) {
  const bufferRef   = useRef<string>('')
  const lastTimeRef = useRef<number>(0)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ── 关键：用 ref 存 onScan，避免事件监听因回调引用变化而反复注册/销毁
  const onScanRef   = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan }, [onScan])

  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  useEffect(() => {
    function flush() {
      const code = bufferRef.current.trim()
      bufferRef.current = ''
      if (code.length >= MIN_SCAN_LENGTH) {
        onScanRef.current(code)
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!enabledRef.current) return
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return

      const target = e.target as HTMLElement
      const isManualInput = (
        (target.tagName === 'INPUT' && (target as HTMLInputElement).dataset.scannerManual === 'true') ||
        target.tagName === 'TEXTAREA'
      )
      if (isManualInput) return

      const now = Date.now()
      const gap = now - lastTimeRef.current
      lastTimeRef.current = now

      if (gap > SCAN_INTERVAL_MS && bufferRef.current.length > 0 && e.key !== 'Enter') {
        bufferRef.current = ''
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (timerRef.current) clearTimeout(timerRef.current)
        flush()
        return
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(flush, 200)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // 只在 mount/unmount 注册一次，不依赖 enabled/onScan（均通过 ref 读取）
  }, [])
}
