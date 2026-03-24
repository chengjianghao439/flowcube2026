/**
 * PDA 流程引擎 — usePdaFlow
 *
 * 核心概念：
 *  - Flow：一组有序的 Step 定义
 *  - Step：有输入类型、处理函数、下一步规则
 *  - Engine：驱动 Step 执行，管理状态
 *
 * 设计原则：
 *  - 配置驱动，不写死在页面里
 *  - 每个 Step 纯函数化（输入 → 输出 → 下一步）
 *  - 流程状态持久化到 sessionStorage，意外退出可恢复
 *
 * 用法：
 *  const engine = usePdaFlow(PICKING_FLOW, { taskId })
 *  engine.scan(barcode)   // 推进当前步骤
 *  engine.stepId          // 当前步骤 ID
 *  engine.context         // 流程共享上下文
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { usePdaFeedback } from './usePdaFeedback'

// ── 条码类型 ──────────────────────────────────────────────────────────────────
export type BarcodeType = 'product' | 'container' | 'box' | 'bin' | 'any'

// ── 步骤扫码结果 ──────────────────────────────────────────────────────────────
export interface ScanResult<C = Record<string, unknown>> {
  ok:        boolean
  message:   string
  nextStep?: string        // undefined = 保持当前步骤
  context?:  Partial<C>   // 合并到流程上下文
}

// ── 步骤定义 ──────────────────────────────────────────────────────────────────
export interface FlowStep<C = Record<string, unknown>> {
  id:          string
  label:       string           // 用于 UI 展示「当前步骤」
  placeholder: string           // 扫码框 placeholder
  barcodeType: BarcodeType      // 期望的条码类型（用于前置校验）
  /** 核心处理函数：接收条码 + 上下文，返回结果 */
  handle: (barcode: string, context: C) => Promise<ScanResult<C>>
}

// ── 流程定义 ──────────────────────────────────────────────────────────────────
export interface FlowDef<C = Record<string, unknown>> {
  id:           string
  steps:        FlowStep<C>[]
  initialStep:  string
  /** 流程完成回调（最后一个 step nextStep='__done__' 时触发）*/
  onComplete?:  (context: C) => void
}

// ── 引擎 Hook ─────────────────────────────────────────────────────────────────
export function usePdaFlow<C extends Record<string, unknown>>(
  flow: FlowDef<C>,
  initialContext: C,
  storageKey?: string,    // 若提供，自动持久化到 sessionStorage
) {
  const { ok, err, warn, flash } = usePdaFeedback()
  const [stepId, setStepId]     = useState<string>(() => {
    if (storageKey) {
      try {
        const saved = sessionStorage.getItem(`pda_flow_${storageKey}`)
        if (saved) return JSON.parse(saved).stepId ?? flow.initialStep
      } catch { /* ignore */ }
    }
    return flow.initialStep
  })
  const [context, setContext]   = useState<C>(() => {
    if (storageKey) {
      try {
        const saved = sessionStorage.getItem(`pda_flow_${storageKey}`)
        if (saved) return { ...initialContext, ...JSON.parse(saved).context }
      } catch { /* ignore */ }
    }
    return initialContext
  })
  const [scanning, setScanning] = useState(false)
  const [done, setDone]         = useState(false)
  const onCompleteRef           = useRef(flow.onComplete)
  useEffect(() => { onCompleteRef.current = flow.onComplete }, [flow.onComplete])

  // 持久化
  useEffect(() => {
    if (!storageKey) return
    try {
      sessionStorage.setItem(`pda_flow_${storageKey}`, JSON.stringify({ stepId, context }))
    } catch { /* ignore */ }
  }, [stepId, context, storageKey])

  const currentStep = flow.steps.find(s => s.id === stepId) ?? flow.steps[0]

  // ── 推进步骤 ────────────────────────────────────────────────────────────
  const scan = useCallback(async (barcode: string) => {
    if (scanning || done) return
    const b = barcode.trim()
    if (!b) return
    setScanning(true)
    try {
      const result = await currentStep.handle(b, context)
      if (result.context) {
        setContext(prev => ({ ...prev, ...result.context }))
      }
      if (result.ok) {
        ok(result.message)
        if (result.nextStep === '__done__') {
          setDone(true)
          if (storageKey) sessionStorage.removeItem(`pda_flow_${storageKey}`)
          onCompleteRef.current?.(result.context ? { ...context, ...result.context } : context)
        } else if (result.nextStep) {
          setStepId(result.nextStep)
        }
      } else {
        err(result.message)
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e instanceof Error ? e.message : '操作失败，请重试')
      err(msg)
    } finally {
      setScanning(false)
    }
  }, [scanning, done, currentStep, context, ok, err, storageKey])

  // ── 跳转步骤（主管权限用）────────────────────────────────────────────────
  const goTo = useCallback((id: string) => {
    setStepId(id)
  }, [])

  // ── 重置流程 ─────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStepId(flow.initialStep)
    setContext(initialContext)
    setDone(false)
    if (storageKey) sessionStorage.removeItem(`pda_flow_${storageKey}`)
  }, [flow.initialStep, initialContext, storageKey])

  // ── 步骤进度（用于 UI 渲染步骤条）────────────────────────────────────────
  const stepIndex   = flow.steps.findIndex(s => s.id === stepId)
  const stepTotal   = flow.steps.length

  return {
    // 状态
    stepId, currentStep, context, scanning, done,
    stepIndex, stepTotal, flash,
    // 操作
    scan, goTo, reset,
    // 便捷
    warn,
  }
}
