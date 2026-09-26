import { useCallback, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createRequestKey } from '@/lib/requestKey'
import { getOperationRequestStatusApi } from '@/api/operation-requests'
import { toast } from '@/lib/toast'
import { periodClosedError } from './backfillFlow'

/**
 * 「结果未确认」与「确定失败」必须分开——这是付款/核销/退款这几个入口最容易造成重复提交的一处。
 *
 * 判错的代价是不对称的：把「确定失败」误判成未确认，只是让用户多点一次查询；
 * 把「未确认」误判成确定失败并换掉请求键，就会让**服务器可能已经做成的那一笔**被当成新的一笔
 * 再做一次——重复付款、重复核销。所以下面只在能确定「这次没成功」时才动请求键。
 */
export function isUncertainError(e: unknown) {
  const code = (e as { code?: string | null } | null)?.code ?? null
  return code === 'REQUEST_TIMEOUT' || code === 'NETWORK_ERROR'
}

export type SubmitFailure = 'period-closed' | 'uncertain' | 'rejected'

/**
 * 「查到的回执」对应的下一步动作，是这段逻辑里唯一允许换请求键的判定点。抽成纯函数以便直接测。
 *
 * 只有 `failed` 能确定「这次没做成」：它是服务端**明确写下的失败行**（failOperationRequest），
 * 能写成这行就说明那次请求的事务已经结束（未结束的事务会挡住这次 UPDATE），所以换键重提不会重复。
 *
 * `not_found` **绝不能**当成「没做成」。幂等记录的 PENDING 行是在业务事务里插入的
 * （backend/src/utils/operationRequest.js 的 beginOperationRequest 用业务事务的连接），
 * 事务提交前**另一个连接读不到**——上次提交超时但服务端仍在处理时，查回执必然得到 not_found。
 * 此时换键重提就是把同一笔付款/核销再做一遍。保持原键则两种情况都安全：
 * 已成功→服务端回放上次结果；真没送到→同键就是第一次提交。
 */
export function receiptDecision(status: 'pending' | 'success' | 'failed' | 'not_found') {
  return status === 'success' || status === 'failed'
    ? { rotateKey: true, keepUncertain: false }
    : { rotateKey: false, keepUncertain: true }
}

/**
 * 幂等提交守卫：管住请求键的轮换时机，并提供「查询上次结果」。
 *
 * 请求键就是这笔操作在服务端的身份（operation_requests 的唯一键含 request_key）。三条规则：
 *   · 成功 → 轮换（这一笔已有确定结果，下一次是全新的一笔）；
 *   · 明确被拒（4xx 业务错误）→ 轮换（这次确定没做成，别让后续重试撞上这次的痕迹）；
 *   · 收到不到答复（超时/断网）与**期间已结账**→ **保留**。
 *     前者是因为服务器可能已经做成了，要用同一个键去查回执甚至让后端回放；
 *     后者是因为补录申请必须复用同一个键重发，换了键后端会记成两笔。
 *
 * 早先的实现是「弹窗打开就换键」，那样在响应超时后用户关窗重开再提交一次，后端认不出
 * 是同一次提交，同一笔付款会被登记两遍。
 */
export function useIdempotentSubmit({ action, prefix }: { action: string; prefix: string }) {
  const keyRef = useRef(createRequestKey(prefix))
  // state 管渲染（提示条），ref 供回调判定：补录弹窗的确认回调是旧渲染里存下的函数，读 state 会过期
  const [uncertain, setUncertain] = useState(false)
  const uncertainRef = useRef(false)
  const markUncertain = (v: boolean) => { uncertainRef.current = v; setUncertain(v) }

  /** 这次提交已有确定结果（做成或确定没做），下一次提交用新键 */
  const rotate = () => { keyRef.current = createRequestKey(prefix) }

  /** 在 mutation 的 onSuccess 里调用；返回的键才是这次操作留下的身份 */
  const settle = () => { markUncertain(false); rotate() }

  /** 在 mutation 的 onError 里调用，判定这次失败的性质并据此决定是否换键 */
  const classify = (e: unknown): SubmitFailure => {
    if (periodClosedError(e)) return 'period-closed'
    if (isUncertainError(e)) { markUncertain(true); return 'uncertain' }
    markUncertain(false)
    rotate()
    return 'rejected'
  }

  // 这次提交的是什么（金额/日期/单号），供未确认提示条说明「在确认哪一笔」；
  // 以及提交时用的 action——**查回执必须按那一次的 action 查**，不能按当前 UI 的：
  // 用户可能在「继续核销某张汇款单」提交超时后切去另一张（action 里的资源 id 就变了），
  // 用现在的 action 去查会得到「没找到」，于是被误判成「没成功」而放心重提交。
  // 都用 ref：它们只在 mutationFn / remember 里写入，渲染由 uncertain 触发。
  const lastLabelRef = useRef<string | null>(null)
  const lastActionRef = useRef(action)
  const remember = (label: string) => { lastLabelRef.current = label; lastActionRef.current = action }

  /**
   * 读「当下」是否处于未确认（不触发渲染）。给「打开弹窗要不要重置表单」这类 effect 用：
   * 那里必须读最新值，不能读 state 闭包，也不该把 uncertain 放进依赖（会让重置在提交后重跑一遍）。
   * 稳定引用，可安全放进依赖数组。
   */
  const isUncertain = useCallback(() => uncertainRef.current, [])

  const checkMut = useMutation({
    mutationFn: () => getOperationRequestStatusApi(keyRef.current, lastActionRef.current),
  })

  /**
   * 查上次提交的回执。这是「结果未确认」时唯一能确定成没成的办法——
   * 不看就重录，可能把同一笔做两遍。
   *
   * @param onDone 已确认那次提交**成功**时的收尾（刷新视图、提示、关窗）
   */
  const checkLastResult = (onDone: () => void) =>
    checkMut.mutate(undefined, {
      onSuccess: (r) => {
        if (r.status === 'success') { settle(); onDone(); return }
        const d = receiptDecision(r.status)
        if (d.rotateKey) {
          markUncertain(false)
          rotate()
          toast.success('已确认上次提交失败，可以放心重试')
          return
        }
        // pending / not_found：都保持「未确认」与原请求键（判定依据见 receiptDecision）。
        // not_found 的成因要说清楚，否则用户会以为「服务器没收到=可以随便重录」。
        markUncertain(true)
        if (r.status === 'pending') {
          toast.warning('上次提交仍在服务器处理中，请稍后再点「查询上次结果」')
          return
        }
        toast.warning('系统暂时查不到这次提交：可能仍在处理中，也可能没有送达。不要换内容重录——用同一份内容再提交一次即可（系统会识别为同一笔，不会重复记账）')
      },
      onError: () => toast.error('查询上次结果失败，请稍后再试。确认之前请不要关掉重开重新录入，以免重复提交'),
    })

  return { keyRef, uncertain, uncertainRef, isUncertain, classify, settle, checkMut, checkLastResult, remember, lastLabelRef }
}
