/**
 * 总账 / 试算平衡（文档 10 · Phase 2）
 * 科目余额表：期初/本期发生/期末，借贷两栏；底部合计 + 借贷平衡指示。点科目看明细账。
 * 前端不算会计（余额方向/平衡一律以接口为准）。
 */
import { useState } from 'react'
import { Scale, FileText } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import PageHeader from '@/components/shared/PageHeader'
import { SoftStatusLabel } from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'
import { useTrialBalance, useAccountLedger } from '@/hooks/useLedger'
import type { TrialBalanceRow } from '@/types/accounting'

const currentPeriod = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` }
const m = (n: number) => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = (v: number) => (v ? m(v) : '')

function LedgerDialog({ accountId, code, name, period, onClose }: { accountId: number | null; code?: string; name?: string; period: string; onClose: () => void }) {
  const { data, isLoading } = useAccountLedger(accountId, period)
  return (
    <Dialog open={!!accountId} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>明细账 · {code} {name} <span className="text-sm font-normal text-muted-foreground">（{period}）</span></DialogTitle></DialogHeader>
        {isLoading || !data ? <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div> : (
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">日期</th>
                  <th className="px-3 py-2 text-left font-medium">凭证号</th>
                  <th className="px-3 py-2 text-left font-medium">摘要</th>
                  <th className="px-3 py-2 text-right font-medium">借方</th>
                  <th className="px-3 py-2 text-right font-medium">贷方</th>
                  <th className="px-3 py-2 text-right font-medium">余额</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40 bg-muted/20">
                  <td className="px-3 py-2 text-muted-foreground" colSpan={5}>期初余额</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(data.openingBalance)}</td>
                </tr>
                {data.list.map((e, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="px-3 py-2 whitespace-nowrap">{String(e.voucherDate).slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono text-doc-code-muted">{e.voucherNo}</td>
                    <td className="px-3 py-2">{e.summary || '—'}{e.auxName ? <span className="text-muted-foreground"> · {e.auxName}</span> : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(e.debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{cell(e.credit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m(e.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/30 font-medium">
                  <td className="px-3 py-2" colSpan={5}>期末余额</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m(data.closingBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function LedgerPage() {
  const [period, setPeriod] = useState(currentPeriod())
  const { data, isLoading } = useTrialBalance(period)
  const [detail, setDetail] = useState<TrialBalanceRow | null>(null)
  const list = data?.list ?? []
  const t = data?.totals

  return (
    <div>
      <PageHeader title="总账 / 试算平衡" description="科目期初、本期发生、期末余额一览；借贷发生额与期末余额应各自平衡" />

      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">会计期间</span>
        <Input value={period} onChange={e => setPeriod(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="YYYYMM" className="h-9 w-36 font-mono" />
        {data && (
          <span className="ml-2 flex items-center gap-2">
            {data.balanced.period && data.balanced.closing
              ? <SoftStatusLabel label="试算平衡" tone="success" />
              : <SoftStatusLabel label="不平衡" tone="danger" />}
          </span>
        )}
      </div>

      <div className="card-base overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th rowSpan={2} className="px-3 py-2 text-left font-medium">科目</th>
              <th rowSpan={2} className="px-3 py-2 text-left font-medium">类别</th>
              <th colSpan={2} className="border-l border-border/60 px-3 py-1.5 text-center font-medium">期初余额</th>
              <th colSpan={2} className="border-l border-border/60 px-3 py-1.5 text-center font-medium">本期发生</th>
              <th colSpan={2} className="border-l border-border/60 px-3 py-1.5 text-center font-medium">期末余额</th>
            </tr>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th className="border-l border-border/60 px-3 py-1.5 text-right font-medium">借方</th>
              <th className="px-3 py-1.5 text-right font-medium">贷方</th>
              <th className="border-l border-border/60 px-3 py-1.5 text-right font-medium">借方</th>
              <th className="px-3 py-1.5 text-right font-medium">贷方</th>
              <th className="border-l border-border/60 px-3 py-1.5 text-right font-medium">借方</th>
              <th className="px-3 py-1.5 text-right font-medium">贷方</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="py-16 text-center text-sm text-muted-foreground"><Scale className="mx-auto mb-2 h-8 w-8 opacity-30" />该期间暂无发生额，先在「记账凭证」生成本期凭证</td></tr>
            ) : list.map(r => (
              <tr key={r.accountId} className={`group border-b border-border/40 hover:bg-primary/5 ${r.isLeaf ? '' : 'bg-muted/15'}`}>
                <td className="px-3 py-2">
                  <button className="flex items-center gap-1.5 text-left hover:text-primary" onClick={() => setDetail(r)} title="查看明细账">
                    <span className="font-mono text-doc-code-muted">{r.code}</span>
                    <span className={r.isLeaf ? '' : 'font-semibold'}>{r.name}</span>
                    <FileText className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                  </button>
                </td>
                <td className="px-3 py-2"><SoftStatusLabel label={r.categoryName.replace(/\(.*\)/, '')} tone="info" /></td>
                <td className="border-l border-border/40 px-3 py-2 text-right tabular-nums">{cell(r.openingDebit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cell(r.openingCredit)}</td>
                <td className="border-l border-border/40 px-3 py-2 text-right tabular-nums">{cell(r.periodDebit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cell(r.periodCredit)}</td>
                <td className="border-l border-border/40 px-3 py-2 text-right tabular-nums">{cell(r.closingDebit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cell(r.closingCredit)}</td>
              </tr>
            ))}
          </tbody>
          {t && list.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-medium">
                <td className="px-3 py-2" colSpan={2}>合计</td>
                <td className={cn('border-l border-border/40 px-3 py-2 text-right tabular-nums')}>{m(t.openingDebit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m(t.openingCredit)}</td>
                <td className={cn('border-l border-border/40 px-3 py-2 text-right tabular-nums', t.periodDebit !== t.periodCredit && 'text-destructive')}>{m(t.periodDebit)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', t.periodDebit !== t.periodCredit && 'text-destructive')}>{m(t.periodCredit)}</td>
                <td className={cn('border-l border-border/40 px-3 py-2 text-right tabular-nums', t.closingDebit !== t.closingCredit && 'text-destructive')}>{m(t.closingDebit)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', t.closingDebit !== t.closingCredit && 'text-destructive')}>{m(t.closingCredit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <LedgerDialog accountId={detail?.accountId ?? null} code={detail?.code} name={detail?.name} period={period} onClose={() => setDetail(null)} />
    </div>
  )
}
