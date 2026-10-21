/**
 * PdaScanner — 工业级 PDA 扫码输入组件
 *
 * 两种输入模式：
 *  1. 扫码模式（默认）：接收原生广播或全局 keydown，软键盘不弹出，扫码枪直接触发 onScan
 *  2. 手动模式：用户点击「手动输入」按钮后激活，
 *     此时弹出软键盘，输入后回车提交
 *
 * 键盘模拟识别特征：字符间隔 < 50ms + 末尾 Enter（或超时自动 flush）；广播直接给完整条码。
 *
 * 重要：扫码模式**永不聚焦输入框**，进页面/扫码结束都不弹软键盘；
 * 软键盘只在用户主动请求手输后才出现（2026-09-17 用户要求，不要再加 autoFocus 之类的入参）。
 */
import { useRef, useState, useCallback, useEffect } from 'react'
import { Loader2, Keyboard, ScanLine, PauseCircle } from 'lucide-react'
import { usePdaScanner } from '@/hooks/usePdaScanner'

export type PdaScanOutcome = 'accepted' | 'rejected' | 'ignored' | { kind: 'pending'; requestKey: string }
export interface PdaScanResolution { requestKey: string; outcome: 'accepted' | 'rejected' }

interface PdaScannerProps {
  /** 新接入页面须明确业务结果；旧 void 调用保持原来的收起行为。 */
  onScan: (barcode: string) => void | PdaScanOutcome | Promise<void | PdaScanOutcome>
  /** 只结束与本次待确认原键相同的手输，不能用解除禁用推断成功。 */
  resolution?: PdaScanResolution | null
  placeholder?: string
  disabled?: boolean
  /** 处理中才显示 spinner；等待核对/完成等禁用状态使用暂停说明。 */
  busy?: boolean
  disabledReason?: string
  /** false：仅扫码枪，隐藏手输入口（调拨等强制扫码场景） */
  allowManualEntry?: boolean
  /** 同一条码 1 秒内重复扫描时触发（可选，比如弹提示告诉用户"重复扫码"）；不传则静默丢弃 */
  onDuplicate?: (barcode: string) => void
  /** 仅偏离库位二次确认时允许短时间内的第二次同源实扫 */
  allowIntentionalRepeat?: boolean
}

export default function PdaScanner({
  onScan,
  resolution,
  placeholder = '等待扫码…',
  disabled = false,
  busy = false,
  disabledReason = '扫码已暂停，请先处理当前提示',
  allowManualEntry = true,
  onDuplicate,
  allowIntentionalRepeat = false,
}: PdaScannerProps) {
  const manualInputRef = useRef<HTMLInputElement>(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [processing, setProcessing] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const current = useRef({ disabled, resolution })
  current.current = { disabled, resolution }
  const mounted = useRef(true)
  const flight = useRef(false)
  const manualEpoch = useRef(0)
  const manualOpen = useRef(false)
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ requestKey: string; epoch: number; manual: boolean } | null>(null)
  const paused = disabled || processing || pendingKey !== null

  useEffect(() => {
    const epochRef = manualEpoch
    mounted.current = true
    return () => {
      mounted.current = false
      epochRef.current++
      if (focusTimer.current) clearTimeout(focusTimer.current)
    }
  }, [])

  const closeManual = useCallback(() => {
    manualEpoch.current++
    manualOpen.current = false
    setManualMode(false)
    setManualValue('')
    setFocusRequest(0)
    manualInputRef.current?.blur()
  }, [])

  const focusManualInput = useCallback((selectAll = false) => {
    if (!mounted.current || !manualOpen.current || current.current.disabled || flight.current || pending.current) return false
    if (!manualInputRef.current?.isConnected) return false
    manualInputRef.current.focus()
    if (selectAll) manualInputRef.current.select()
    return true
  }, [])

  const resolveManual = useCallback((result?: PdaScanResolution | null) => {
    const original = pending.current
    if (!result || !original || result.requestKey !== original.requestKey || original.epoch !== manualEpoch.current) return
    pending.current = null
    setPendingKey(null)
    if (result.outcome === 'accepted') closeManual()
    else if (original.manual) setFocusRequest(n => n + 1)
  }, [closeManual])

  useEffect(() => { resolveManual(resolution) }, [resolution, resolveManual])
  useEffect(() => {
    if (focusRequest && !processing && !pendingKey && focusManualInput(true)) setFocusRequest(0)
  }, [disabled, focusRequest, processing, pendingKey, focusManualInput])

  // 同一业务入口；同步闸门覆盖React重渲染前的连续Enter和广播。
  const handleScan = useCallback(async (code: string, source: 'manual' | 'hardware') => {
    if (!code || current.current.disabled || flight.current || pending.current) return
    flight.current = true
    const epoch = manualEpoch.current
    if (focusTimer.current) clearTimeout(focusTimer.current)
    setProcessing(true)
    let result: void | PdaScanOutcome
    try { result = await onScan(code) }
    catch { result = 'rejected' } // 页面负责可见业务原因；拒绝不能被吞成成功或未处理Promise。
    finally { flight.current = false; if (mounted.current) setProcessing(false) }
    if (!mounted.current || epoch !== manualEpoch.current || result === 'ignored') return
    if (typeof result === 'object' && result.kind === 'pending') {
      pending.current = { requestKey: result.requestKey, epoch, manual: source === 'manual' }
      setPendingKey(result.requestKey)
      manualInputRef.current?.blur()
      resolveManual(current.current.resolution)
    } else if (result === 'rejected') {
      // 只有员工主动打开并提交的手输失败才重新聚焦；硬件失败不弹软键盘。
      if (source === 'manual') setFocusRequest(n => n + 1)
    } else closeManual()
  }, [onScan, closeManual, resolveManual])

  // 手输框中的键盘事件由 hook 忽略；原生广播仍可完成扫码并退出手输模式。
  usePdaScanner({ onScan: code => { void handleScan(code, 'hardware') }, enabled: !paused, onDuplicate, allowIntentionalRepeat })

  // ── 进入手动输入模式 ──────────────────────────────────────────────────────
  function enterManualMode() {
    if (paused) return
    const epoch = ++manualEpoch.current
    manualOpen.current = true
    setManualMode(true)
    setManualValue('')
    setFocusRequest(0)
    // 延迟 focus，确保 input 渲染完成后再聚焦（触发软键盘）
    focusTimer.current = setTimeout(() => { if (epoch === manualEpoch.current) focusManualInput() }, 80)
  }

  // ── 退出手动输入模式 ──────────────────────────────────────────────────────
  function exitManualMode() {
    if (flight.current || pending.current) return
    if (focusTimer.current) clearTimeout(focusTimer.current)
    closeManual()
  }

  // ── 手动提交 ──────────────────────────────────────────────────────────────
  function commitManual() {
    const code = manualValue.trim()
    if (!code) return
    void handleScan(code, 'manual')
  }

  return (
    <div>
      <div
        data-testid="pda-scan-area"
        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition-all motion-reduce:transition-none ${
        paused
          ? 'border-border bg-muted'
          : manualMode
          ? 'border-warning/40 bg-warning/10'
          : 'border-border bg-card'
      }`}>
        <span className="shrink-0">
          {paused
            ? busy || processing ? <Loader2 className="h-5 w-5 motion-safe:animate-spin text-muted-foreground" /> : <PauseCircle className="h-5 w-5 text-muted-foreground" />
            : manualMode
              ? <Keyboard className="h-5 w-5 text-warning-ink" />
              : <ScanLine className="h-5 w-5 text-muted-foreground" />}
        </span>

        <div className="min-w-0 flex-1">
          {manualMode ? (
            <input
              ref={manualInputRef}
              data-scanner-manual="true"
              aria-label={`手动输入：${placeholder}`}
              value={manualValue}
              readOnly={paused}
              aria-busy={processing || busy}
              onChange={e => { if (!paused) setManualValue(e.target.value) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitManual() }
                if (e.key === 'Escape') exitManualMode()
              }}
              placeholder="输入条码后按回车"
              className="min-h-11 w-full rounded-sm bg-transparent text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
          ) : (
            <p role={paused ? 'status' : undefined} className={`break-words text-sm leading-6 ${paused ? 'text-muted-foreground' : 'text-foreground'}`}>
              {paused ? busy || processing ? '正在处理扫码结果…' : disabledReason : placeholder}
            </p>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {manualMode ? (
            <>
              {manualValue.trim() && (
                <button
                  onClick={commitManual}
                  disabled={paused}
                  className="min-h-11 min-w-11 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground motion-safe:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >确认</button>
              )}
              <button
                onClick={exitManualMode}
                disabled={paused}
                className="min-h-11 min-w-11 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground motion-safe:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >取消</button>
            </>
          ) : allowManualEntry ? (
            <button
              onClick={enterManualMode}
              disabled={paused}
              className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground motion-safe:active:scale-95 disabled:opacity-40 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >手动输入</button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
