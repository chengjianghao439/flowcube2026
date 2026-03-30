/**
 * PdaScanner — 工业级 PDA 扫码输入组件
 *
 * 两种输入模式：
 *  1. 扫码模式（默认）：全局监听 keydown，软键盘不弹出，扫码枪直接触发 onScan
 *  2. 手动模式：用户点击「手动输入」按钮后激活，此时弹出软键盘，输入后回车提交
 *
 * 扫码枪识别特征：字符间隔 < 50ms + 末尾 Enter（或超时自动 flush）
 */
import { useRef, useState, useCallback } from 'react'
import { usePdaScanner } from '@/hooks/usePdaScanner'
import { parseBarcode } from '@/utils/pda/barcode'

interface PdaScannerProps {
  onScan: (barcode: string) => void
  placeholder?: string
  disabled?: boolean
  showTypeHint?: boolean
  autoFocus?: boolean
  /** false：仅扫码枪，隐藏「手动输入」（上架等强制扫码场景） */
  allowManualEntry?: boolean
}

export default function PdaScanner({
  onScan,
  placeholder = '等待扫码...',
  disabled = false,
  showTypeHint = true,
  allowManualEntry = true,
}: PdaScannerProps) {
  const manualInputRef = useRef<HTMLInputElement>(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  // ── 扫码完成回调（扫码枪 + 手动提交共用）────────────────────────────────
  const handleScan = useCallback((code: string) => {
    if (!code || disabled) return
    if (showTypeHint) {
      const parsed = parseBarcode(code)
      setLastCode(parsed.label ?? code)
      setFlash(true)
      setTimeout(() => setFlash(false), 800)
    }
    // 扫码完成后退出手动模式，等待下一次扫码
    setManualMode(false)
    setManualValue('')
    onScan(code)
  }, [disabled, showTypeHint, onScan])

  // ── 全局扫码枪监听（手动模式时暂停，避免冲突）───────────────────────────
  usePdaScanner({ onScan: handleScan, enabled: !disabled && !manualMode })

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
    <div className="space-y-2">

      {/* ── 扫码状态显示区 ── */}
      <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 shadow-sm transition-all ${
        flash
          ? 'border-emerald-300 bg-emerald-50'
          : disabled
          ? 'border-slate-200 bg-slate-100'
          : manualMode
          ? 'border-amber-300 bg-amber-50'
          : 'border-border bg-card'
      }`}>
        <div className="flex items-start gap-3">
          <span className="shrink-0 rounded-2xl bg-background px-3 py-2 text-2xl shadow-sm">
            {disabled ? '⏳' : manualMode ? '⌨️' : flash ? '✅' : '📷'}
          </span>

          <div className="min-w-0 flex-1">
            {manualMode ? (
              <input
                ref={manualInputRef}
                data-scanner-manual="true"
                value={manualValue}
                onChange={e => setManualValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitManual() }
                  if (e.key === 'Escape') exitManualMode()
                }}
                placeholder="输入条码后按回车"
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-3 text-base text-foreground outline-none placeholder:text-amber-700/50 focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              />
            ) : (
              <>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {disabled ? 'Processing' : manualMode ? 'Manual' : 'Scanner Ready'}
                </p>
                <p className={`mt-1 break-words text-sm leading-6 ${
                  flash ? 'font-semibold text-emerald-700' : disabled ? 'text-slate-500' : 'text-foreground'
                }`}>
                  {flash && lastCode ? `已识别：${lastCode}` : disabled ? '正在处理扫码结果…' : placeholder}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showTypeHint && !disabled && !manualMode && (
            <span className="inline-flex max-w-full items-center rounded-full bg-muted px-3 py-1 text-xs leading-5 text-muted-foreground">
              {allowManualEntry ? '对准条码直接扫描，无需点击输入框' : '请使用扫码枪扫描容器条码，不支持手动填写'}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {manualMode ? (
              <>
                {manualValue.trim() && (
                  <button
                    onClick={commitManual}
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground active:scale-95"
                  >确认</button>
                )}
                <button
                  onClick={exitManualMode}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground active:scale-95"
                >取消</button>
              </>
            ) : allowManualEntry ? (
              <button
                onClick={enterManualMode}
                disabled={disabled}
                className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground active:scale-95 disabled:opacity-40 whitespace-nowrap"
              >手动输入</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
