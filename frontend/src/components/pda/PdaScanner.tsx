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
import { useRef, useState, useCallback } from 'react'
import { Loader2, Keyboard, ScanLine, PauseCircle } from 'lucide-react'
import { usePdaScanner } from '@/hooks/usePdaScanner'

interface PdaScannerProps {
  onScan: (barcode: string) => void
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

  // ── 扫码完成回调（扫码枪 + 手动提交共用）────────────────────────────────
  const handleScan = useCallback((code: string) => {
    if (!code || disabled) return
    // 扫码完成后退出手动模式，等待下一次扫码
    setManualMode(false)
    setManualValue('')
    onScan(code)
  }, [disabled, onScan])

  // 手输框中的键盘事件由 hook 忽略；原生广播仍可完成扫码并退出手输模式。
  usePdaScanner({ onScan: handleScan, enabled: !disabled, onDuplicate, allowIntentionalRepeat })

  // ── 进入手动输入模式 ──────────────────────────────────────────────────────
  function enterManualMode() {
    setManualMode(true)
    setManualValue('')
    // 延迟 focus，确保 input 渲染完成后再聚焦（触发软键盘）
    setTimeout(() => manualInputRef.current?.focus(), 80)
  }

  // ── 退出手动输入模式 ──────────────────────────────────────────────────────
  function exitManualMode() {
    setManualMode(false)
    setManualValue('')
    manualInputRef.current?.blur()
  }

  // ── 手动提交 ──────────────────────────────────────────────────────────────
  function commitManual() {
    const code = manualValue.trim()
    if (!code) return
    handleScan(code)
  }

  return (
    <div>
      <div
        data-testid="pda-scan-area"
        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition-all motion-reduce:transition-none ${
        disabled
          ? 'border-border bg-muted'
          : manualMode
          ? 'border-warning/40 bg-warning/10'
          : 'border-border bg-card'
      }`}>
        <span className="shrink-0">
          {disabled
            ? busy ? <Loader2 className="h-5 w-5 motion-safe:animate-spin text-muted-foreground" /> : <PauseCircle className="h-5 w-5 text-muted-foreground" />
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
              onChange={e => setManualValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitManual() }
                if (e.key === 'Escape') exitManualMode()
              }}
              placeholder="输入条码后按回车"
              className="min-h-11 w-full rounded-sm bg-transparent text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
          ) : (
            <p role={disabled ? 'status' : undefined} className={`break-words text-sm leading-6 ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}>
              {disabled ? busy ? '正在处理扫码结果…' : disabledReason : placeholder}
            </p>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {manualMode ? (
            <>
              {manualValue.trim() && (
                <button
                  onClick={commitManual}
                  className="min-h-11 min-w-11 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground motion-safe:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >确认</button>
              )}
              <button
                onClick={exitManualMode}
                className="min-h-11 min-w-11 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground motion-safe:active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >取消</button>
            </>
          ) : allowManualEntry ? (
            <button
              onClick={enterManualMode}
              disabled={disabled}
              className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground motion-safe:active:scale-95 disabled:opacity-40 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >手动输入</button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
