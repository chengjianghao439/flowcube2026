/**
 * usePdaScanner — 工业 PDA 扫码枪输入 Hook
 *
 * Android PDA：厂商广播由 PdaScanBridge 原生插件转发；键盘事件保留给浏览器预览和其他设备。
 * 两路输入共用去重窗口，不依赖任何输入框焦点。
 *
 * 稳定性优化：
 *  - onScan 通过 ref 调用，避免 useEffect 依赖变化导致反复注册/销毁事件监听
 *  - 高频扫码（每秒多次）不丢码，不重复注册
 */
import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { PdaScanBridge } from '@/lib/pdaScanBridge'

const SCAN_INTERVAL_MS = 50  // 扫码枪相邻字符最大间隔（毫秒）
const MIN_SCAN_LENGTH  = 3   // 最短有效条码长度
const DUPLICATE_WINDOW_MS = 1000  // 同一条码在这段时间内的重复上报会被丢弃
const INTENTIONAL_REPEAT_MIN_MS = 300 // 偏离库位确认时，挡住硬件抖动但接受明确的第二次实扫

interface Options {
  onScan: (barcode: string) => void
  /** 是否激活监听（false 时暂停，用于处理中禁止重复扫码）*/
  enabled?: boolean
  /** 命中防重复窗口时触发（可选，用于页面自定义提示）；不传则静默丢弃 */
  onDuplicate?: (barcode: string) => void
  allowIntentionalRepeat?: boolean
}

export function usePdaScanner({ onScan, enabled = true, onDuplicate, allowIntentionalRepeat = false }: Options) {
  const bufferRef   = useRef<string>('')
  const lastTimeRef = useRef<number>(0)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 防重复扫码：扫码枪硬件常见"回车键抖动/重复上报"，同一条码短时间内只处理一次；
  // 这个保护原本只有 task.tsx 自己实现，现在下沉到这里，所有走 usePdaScanner/PdaScanner 的
  // 页面（check.tsx、pack.tsx 等）默认就有，不用每个页面各自记一份 lastScanRef。
  const lastScanRef = useRef<{ barcode: string; time: number; source: 'keyboard' | 'native' } | null>(null)
  // ── 关键：用 ref 存 onScan，避免事件监听因回调引用变化而反复注册/销毁
  const onScanRef   = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan }, [onScan])
  const onDuplicateRef = useRef(onDuplicate)
  useEffect(() => { onDuplicateRef.current = onDuplicate }, [onDuplicate])

  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  const allowIntentionalRepeatRef = useRef(allowIntentionalRepeat)
  useEffect(() => { allowIntentionalRepeatRef.current = allowIntentionalRepeat }, [allowIntentionalRepeat])

  useEffect(() => {
    function acceptCode(raw: string, source: 'keyboard' | 'native') {
      const code = raw.trim()
      if (code.length < MIN_SCAN_LENGTH) return

      const now = Date.now()
      if (lastScanRef.current?.barcode === code && now - lastScanRef.current.time < DUPLICATE_WINDOW_MS) {
        // 同一次硬件扫描可能同时走广播和键盘，跨来源重复不提示用户。
        if (lastScanRef.current.source !== source) return
        if (!allowIntentionalRepeatRef.current || now - lastScanRef.current.time < INTENTIONAL_REPEAT_MIN_MS) {
          onDuplicateRef.current?.(code)
          return
        }
      }
      lastScanRef.current = { barcode: code, time: now, source }
      onScanRef.current(code)
    }

    function flush() {
      const code = bufferRef.current
      bufferRef.current = ''
      acceptCode(code, 'keyboard')
    }

    let nativeListener: { remove: () => Promise<void> } | null = null
    let disposed = false
    if (Capacitor.isNativePlatform()) {
      void PdaScanBridge.addListener('scan', ({ barcode }) => {
        if (!enabledRef.current || typeof barcode !== 'string') return
        // 双输出设备可能先发键盘字符、后发广播；丢弃未结束的键盘缓冲。
        bufferRef.current = ''
        if (timerRef.current) clearTimeout(timerRef.current)
        acceptCode(barcode, 'native')
      }).then((listener) => {
        if (disposed) void listener.remove()
        else nativeListener = listener
      }).catch(() => {
        // 非厂商设备或桥接不可用时，保留原有键盘扫码路径。
      })
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
      disposed = true
      if (nativeListener) void nativeListener.remove()
      document.removeEventListener('keydown', handleKeyDown)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // 只在 mount/unmount 注册一次，不依赖 enabled/onScan（均通过 ref 读取）
  }, [])
}
