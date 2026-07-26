import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  MONTHLY_TERMS_OPTIONS,
  SETTLEMENT_TYPE,
  SETTLEMENT_TYPE_NAME,
  type SettlementType,
} from '@/generated/status'

/** 各结算方式的到期日口径，直接写在表单里，免得建档时还要去问财务 */
const HINT: Record<number, string> = {
  [SETTLEMENT_TYPE.CASH]:    '下单当天即到期，逾期会进通知提醒',
  [SETTLEMENT_TYPE.MONTHLY]: '从结算发生当天起算账期',
}

interface Props {
  settlementType: SettlementType
  paymentTermsDays: number
  onChange: (next: { settlementType: SettlementType; paymentTermsDays: number }) => void
  disabled?: boolean
  /** 只影响文案：供应商侧是应付，客户侧是应收 */
  side: 'payable' | 'receivable'
}

/**
 * 结算方式 + 账期天数。两者强耦合——**只有月结才有账期**，所以账期下拉仅在月结时出现，
 * 切走月结时自动把天数归零，与服务端 `normalizeTermsDays()` 的归一规则保持一致，
 * 避免存出「现结但账期 30 天」的矛盾数据。
 */
export function SettlementTypeField({ settlementType, paymentTermsDays, onChange, disabled, side }: Props) {
  const isMonthly = settlementType === SETTLEMENT_TYPE.MONTHLY
  const termsLabel = side === 'payable' ? '应付账期' : '应收账期'

  const handleTypeChange = (raw: string) => {
    const next = Number(raw) as SettlementType
    // 切到月结时给个默认 30 天；切走月结一律归零
    const days = next === SETTLEMENT_TYPE.MONTHLY
      ? (MONTHLY_TERMS_OPTIONS.includes(paymentTermsDays as 30 | 60 | 90) ? paymentTermsDays : 30)
      : 0
    onChange({ settlementType: next, paymentTermsDays: days })
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <Label>结算方式</Label>
        <Select value={String(settlementType)} onValueChange={handleTypeChange} disabled={disabled}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SETTLEMENT_TYPE_NAME).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-helper">{HINT[settlementType] ?? ''}</p>
      </div>

      {isMonthly && (
        <div className="space-y-1">
          <Label>{termsLabel}</Label>
          <Select
            value={String(paymentTermsDays || 30)}
            onValueChange={v => onChange({ settlementType, paymentTermsDays: Number(v) })}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHLY_TERMS_OPTIONS.map(d => (
                <SelectItem key={d} value={String(d)}>{d} 天</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-helper">至少每 {paymentTermsDays || 30} 天结算一次</p>
        </div>
      )}
    </div>
  )
}
