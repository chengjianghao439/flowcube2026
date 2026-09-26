import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

/** 与后端 finance-period.guard.js 的 REASON_MIN 一致：前端先放行、后端再拒会让人以为是故障 */
const REASON_MIN = 4

/**
 * 跨期补录的**业务入口**（2026-09-26 一致性审查 · 任务 7）。
 *
 * 出纳在付款/核销/退款时若把业务日期填成已结账的期间，后端会以 409 FINANCE_PERIOD_CLOSED 拦下——
 * 因为那个期间的凭证已经封了，凭证引擎会跳过它，钱动了账上却没有。处置不是「换个日期重填」
 * （业务日期是事实，不能改），而是走**先审批、后动账**：把这次请求提交成一张补录申请单，
 * 由另一个人批准后才真正记账。
 *
 * 所以这里只做一件事：告诉用户发生了什么、收一句申请原因，然后交回调用点去**用同一个请求键**
 * 重发原请求（带 backfillRequest）。请求键必须复用：后端按它认定「这是同一笔」，换了键会把
 * 同一笔付款记两遍。判定与弹窗状态见 backfillFlow.ts，各调用点自己持有键。
 */
export function BackfillRequestDialog({
  open, onClose, message, summary, pending, onConfirm,
}: {
  open: boolean
  onClose: () => void
  /** 后端原话（含被拦下的那个期间），直接展示——前端不复述规则、更不去解析期间字符串 */
  message: string
  /** 这笔业务是什么：单号 / 金额 / 日期，供申请人自己核对后签字 */
  summary: ReactNode
  pending: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  // 每次打开都清空：上一次的原因留在框里会被下一次误提交，审批人看到的就是别人写的话
  useEffect(() => { if (open) setReason('') }, [open])
  const invalid = reason.trim().length < REASON_MIN

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !pending) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>这笔业务落在已结账的期间</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1 text-sm">
          <p className="text-muted-foreground">
            这个会计期间已经结账，凭证已经封存，所以这笔业务<strong>不能当场记账</strong>。
            可以把它提交为一张跨期补录申请：<strong>申请不记账</strong>，由<strong>另一个人</strong>批准后
            才会真正记账，凭证落在补录当期（批准那天所在的期间）。
          </p>
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{message}</div>
          {summary && <div className="text-xs text-muted-foreground">{summary}</div>}
          <div className="space-y-1.5">
            <Label>申请原因 *</Label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="如：上月已结账后才发现这笔付款漏登，凭证与银行流水都已确认"
              maxLength={300}
              disabled={pending}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">审批人要靠这句话判断该不该补，请写清为什么现在才记（至少 {REASON_MIN} 个字）。</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>取消</Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={pending || invalid}>
            {pending ? '提交中…' : '提交补录申请'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
