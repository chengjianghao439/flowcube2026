import { useState, type ReactNode } from 'react'
import { ApiClientError } from '@/api/client'

/**
 * 跨期补录的**前端接线**（2026-09-26 一致性审查 · 任务 7），三个业务入口共用。
 *
 * 出纳在登记付款、收款核销、执行退款时把业务日期填在已结账期间，后端会以
 * 409 FINANCE_PERIOD_CLOSED 拦下：那个期间的凭证已经封存，钱动了会计账上却没有。
 * 处置不是「换个日期重填」（业务日期是事实），而是提交成一张补录申请单，由**另一个人**
 * 批准后才真正记账。这里只放判定与弹窗状态，弹窗本体见 BackfillRequestDialog。
 */

/** 取出「期间已结账」这个错误本身（要拿它的 message 展示后端原话），其它错误返回 null */
export function periodClosedError(e: unknown): ApiClientError | null {
  return e instanceof ApiClientError && e.code === 'FINANCE_PERIOD_CLOSED' ? e : null
}

/**
 * 响应体是「补录申请单」还是业务结果。
 *
 * 两种情况后端都返回成功状态（记账完成 200/201、已提交申请 202），而 `payloadRequest`
 * 只把 `data` 交给调用方、**不给 HTTP 状态**，所以只能按返回体特征区分：申请单有
 * `applicationNo`（finance-period.guard.recordBackfillApplication 的返回），业务结果没有。
 * 判错的后果是把「已提交待审批」当成「钱已付」，用户以为账已经记了。
 */
export function isBackfillApplication(v: unknown): v is { id: number; applicationNo: string } {
  return !!v && typeof v === 'object' && typeof (v as { applicationNo?: unknown }).applicationNo === 'string'
}

/**
 * 各业务入口共用的「申请补录」弹窗状态。
 *
 * `ask` 记下要展示的信息与「用同一请求键带原因重发」的回调；回调由用户在弹窗里点确认时触发，
 * 不在请求失败的 onError 里直接重发——那是在 mutation 生命周期内再次触发自己。
 * 请求键由各调用点持有，本 hook 不碰：换了键后端就会把同一笔业务记两遍。
 */
export function useBackfillPrompt() {
  const [prompt, setPrompt] = useState<{
    message: string
    summary: ReactNode
    onConfirm: (reason: string) => void
  } | null>(null)
  return {
    prompt,
    ask: (message: string, summary: ReactNode, onConfirm: (reason: string) => void) =>
      setPrompt({ message, summary, onConfirm }),
    close: () => setPrompt(null),
  }
}
