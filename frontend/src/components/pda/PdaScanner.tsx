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
}

export default function PdaScanner({
  onScan,
  placeholder = '等待扫码...',
  disabled = false,
  showTypeHint = true,
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
      <div className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-4 transition-all ${
        flash
          ? 'border-blue-400 bg-blue-950/30'
          : disabled
          ? 'border-gray-700 bg-gray-900/30'
          : manualMode
          ? 'border-amber-500 bg-amber-950/20'
          : 'border-gray-600 bg-gray-900/20'
      }`}>
        {/* 状态图标 */}
        <span className="text-2xl shrink-0">
          {disabled ? '⏳' : manualMode ? '⌨️' : flash ? '✅' : '📷'}
        </span>

        {/* 状态文字 */}
        <div className="flex-1 min-w-0">
          {manualMode ? (
            // 手动输入框（data-scanner-manual 标记，usePdaScanner 不拦截此 input 的事件）
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
              className="w-full bg-transparent text-base text-white placeholder-amber-600/60 outline-none"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
          ) : (
            <p className={`text-base truncate ${
              flash ? 'text-blue-300 font-semibold' : 'text-gray-400'
            }`}>
              {flash && lastCode ? `✓ ${lastCode}` : disabled ? '处理中…' : placeholder}
            </p>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="shrink-0 flex items-center gap-2">
          {manualMode ? (
            <>
              {manualValue.trim() && (
                <button
                  onClick={commitManual}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white active:scale-95"
                >确认</button>
              )}
              <button
                onClick={exitManualMode}
                className="rounded-xl bg-gray-700 px-3 py-2 text-sm text-gray-300 active:scale-95"
              >取消</button>
            </>
          ) : (
            <button
              onClick={enterManualMode}
              disabled={disabled}
              className="rounded-xl bg-gray-700 px-3 py-2 text-xs text-gray-300 active:scale-95 disabled:opacity-40 whitespace-nowrap"
            >手动输入</button>
          )}
        </div>
      </div>

      {/* 提示文字 */}
      {showTypeHint && !disabled && !manualMode && (
        <p className="text-center text-xs text-gray-600">对准条码扫描即可，无需点击</p>
      )}
    </div>
  )
}
