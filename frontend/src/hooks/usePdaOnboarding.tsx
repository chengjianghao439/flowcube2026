/**
 * usePdaOnboarding — 新用户首次使用引导
 */
import { useState, useCallback } from 'react'

const STORAGE_KEY = 'pda_onboarded'

const STEPS = [
  {
    icon: '👋',
    title: '欢迎使用 极序 Flow',
    desc: '这是一套专为仓库设计的手持终端系统，帮助您快速完成拣货、收货、打包、出库作业。',
    hint: '跟着引导，5 分钟学会所有操作',
  },
  {
    icon: '📷',
    title: '如何扫码',
    desc: '用扫码枪对准产品条码，系统自动识别，无需点击任何按钮。如果没有扫码枪，点击「手动输入」用键盘输入条码。',
    hint: '扫码枪：对准条码扫描即可\n手动输入：点击输入框 → 输入 → 回车',
  },
  {
    icon: '🗂️',
    title: '任务驱动，按步操作',
    desc: '工作台会显示您的待处理任务。每个任务有明确的步骤提示，完成当前步骤后自动进入下一步。',
    hint: '不知道做什么？看顶部的步骤提示',
  },
  {
    icon: '⚠️',
    title: '扫错了怎么办',
    desc: '扫码出错时，系统会告诉您应该扫什么，不用担心。拣货操作支持撤销，点击「↩ 撤销」可以取消最后一次操作。',
    hint: '出错不要慌，按照提示操作即可',
  },
  {
    icon: '✅',
    title: '准备好了！',
    desc: '您已了解基本操作。如需切换仓库方案（小仓库/电商仓等），可在「作业入口」页右上角切换。',
    hint: '遇到问题随时联系主管',
  },
]

export function usePdaOnboarding() {
  const [visible, setVisible] = useState<boolean>(() => {
    try { return !localStorage.getItem(STORAGE_KEY) } catch { return false }
  })
  const [step, setStep] = useState(0)

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
      setVisible(false)
    }
  }, [step])

  const skip = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
    setVisible(false)
  }, [])

  const reset = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setStep(0)
    setVisible(true)
  }, [])

  function OnboardingGate() {
    if (!visible) return null
    const s = STEPS[step]
    const isLast = step === STEPS.length - 1
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm px-6">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
          <div className="flex justify-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-primary' : i < step ? 'w-3 bg-primary/40' : 'w-3 bg-muted'
              }`} />
            ))}
          </div>
          <div className="text-center">
            <p className="text-6xl mb-4">{s.icon}</p>
            <h2 className="text-xl font-bold text-foreground mb-3">{s.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
            {s.hint && (
              <div className="mt-4 rounded-xl bg-primary/10 border border-primary/20 px-4 py-3">
                {s.hint.split('\n').map((line, i) => (
                  <p key={i} className="text-xs font-mono text-primary text-left">{line}</p>
                ))}
              </div>
            )}
          </div>
          <div className="mt-6 space-y-2">
            <button
              onClick={next}
              className="w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-primary-foreground active:scale-95 transition-all"
            >
              {isLast ? '开始作业 →' : `下一步（${step + 1}/${STEPS.length}）`}
            </button>
            {!isLast && (
              <button onClick={skip} className="w-full py-2 text-sm text-muted-foreground active:opacity-60">
                跳过引导
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return { visible, OnboardingGate, reset }
}
