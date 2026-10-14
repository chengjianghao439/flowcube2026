import type { CashMoneyProof } from '@/api/returns'
import { amount } from '@/lib/format'

/** Only the explicit service cash policy identifies newly rounded cash totals. */
export function returnNet(value: number, proof?: CashMoneyProof) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const cents = Math.abs(n * 100 - Math.round(n * 100)) < 1e-8
  if (proof?.moneyPrecision === 2 && proof.cashPolicy === 'cash-cents-v1' && cents) return amount(n)
  return `${n.toFixed(4)}${cents ? '' : '（待核）'}`
}

export const ordinaryNetLabel = (basis: 'estimated_net' | 'executed_net', status: number) =>
  basis === 'executed_net' ? '实际净冲减' : status === 4 ? '原预计净冲减（未入账）' : '预计净冲减'
