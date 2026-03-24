/**
 * usePdaFeedback — PDA 操作多维反馈 Hook
 *
 * 提供三种反馈维度（均可独立使用）：
 *  1. 触感震动（Vibration API，Android 支持）
 *  2. 声音提示（Web Audio API 合成音，无需音频文件）
 *  3. 视觉 Flash（返回状态供 UI 渲染）
 *
 * 用法：
 *  const { flash, ok, err, warn } = usePdaFeedback()
 *  ok('扫描成功')    → 绿色 flash + 短震 + 提示音
 *  err('条码无效')   → 红色 flash + 长震 + 错误音
 *  warn('已拣完')    → 黄色 flash + 双震
 */
import { useState, useCallback, useRef } from 'react'

export interface FlashState {
  type: 'ok' | 'err' | 'warn'
  msg:  string
}

// ── Web Audio 音效合成 ────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  return audioCtx
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.3) {
  try {
    const ctx  = getAudioCtx()
    const osc  = ctx.createOscillator()
    const vol  = ctx.createGain()
    osc.connect(vol)
    vol.connect(ctx.destination)
    osc.type      = type
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    vol.gain.setValueAtTime(gain, ctx.currentTime)
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch { /* 忽略不支持的环境 */ }
}

function soundOk()   { playTone(880, 0.08, 'sine',   0.25) }                        // 高频短音
function soundErr()  { playTone(220, 0.25, 'sawtooth', 0.3) }                       // 低频长音
function soundWarn() { playTone(550, 0.12, 'triangle', 0.2) }                       // 中频提示

// ── 震动 ──────────────────────────────────────────────────────────────────────
function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern) } catch { /* 忽略 */ }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePdaFeedback(options: {
  sound?:   boolean
  vibrate?: boolean
} = {}) {
  const { sound = true, vibrate: useVibrate = true } = options
  const [flash, setFlash]   = useState<FlashState | null>(null)
  const timerRef            = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show(type: FlashState['type'], msg: string, ms: number) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash({ type, msg })
    timerRef.current = setTimeout(() => setFlash(null), ms)
  }

  const ok = useCallback((msg: string, ms = 1500) => {
    show('ok', msg, ms)
    if (sound)      soundOk()
    if (useVibrate) vibrate(60)           // 单次短震
  }, [sound, useVibrate])

  const err = useCallback((msg: string, ms = 2500) => {
    show('err', msg, ms)
    if (sound)      soundErr()
    if (useVibrate) vibrate([100, 50, 100]) // 双震
  }, [sound, useVibrate])

  const warn = useCallback((msg: string, ms = 2000) => {
    show('warn', msg, ms)
    if (sound)      soundWarn()
    if (useVibrate) vibrate([60, 40, 60])   // 轻双震
  }, [sound, useVibrate])

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFlash(null)
  }, [])

  return { flash, ok, err, warn, clear }
}
