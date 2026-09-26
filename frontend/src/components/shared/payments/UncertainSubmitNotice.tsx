import { Button } from '@/components/ui/button'

/**
 * 「上次提交结果未确认」的提示条（付款/核销/退款三处入口共用，文案必须一致）。
 *
 * 什么时候出现：提交后没收到服务器答复（超时、断网），以及按请求键查回执得到 not_found
 * （PENDING 行在业务事务里，提交前另一个连接看不到，所以「查不到」也可能是「正在处理」）。
 * 这时服务器**可能已经做成了**，而用户看到的只是「提交失败」。若就此重新录入，同一笔付款会被登记两遍。
 * 唯一能确定的办法是按请求键查回执，所以在查清之前：
 *   · 请求键与已填内容都保留（见 useIdempotentSubmit）；
 *   · 提示用户不要关掉重开重新录入，**也不要改了内容再录**——同键重提服务端会沿用上次的内容，
 *     用户若已经把金额改成别的数，会以为改后的金额付了，实际执行的是上一次的内容。
 */
export function UncertainSubmitNotice({ visible, pending, onCheck, what }: {
  visible: boolean
  pending: boolean
  onCheck: () => void
  /** 在确认的是哪一笔（金额 / 单号），让用户不必靠记忆判断 */
  what?: string
}) {
  if (!visible) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        上次提交没有收到确定答复，服务端可能已经记账{what ? `（${what}）` : ''}。
        请先点「查询上次结果」；查清之前请勿关掉重开重新录入，也不要改动内容后再提交——
        同一次提交服务端会沿用上次的内容，重复提交不会重复记账，但改了金额再提交也不会按新金额记账。
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onCheck} disabled={pending}>
        {pending ? '查询中…' : '查询上次结果'}
      </Button>
    </div>
  )
}
