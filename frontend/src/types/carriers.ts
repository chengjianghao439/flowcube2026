export type CarrierType = 'delivery' | 'express' | 'freight' | 'logistics'

export const CARRIER_TYPE_LABELS: Record<CarrierType, string> = {
  delivery:  '送货',
  express:   '快递',
  freight:   '快运',
  logistics: '物流',
}

export const CARRIER_TYPE_OPTIONS: { value: CarrierType; label: string }[] = [
  { value: 'delivery',  label: '送货' },
  { value: 'express',   label: '快递' },
  { value: 'freight',   label: '快运' },
  { value: 'logistics', label: '物流' },
]

/** 电子面单对接平台（文档 06）。none=仅线下，mock=本地演示，其余为真实平台。 */
export const WAYBILL_PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: 'kdniao',  label: '快递鸟' },
  { value: 'cainiao', label: '菜鸟' },
  { value: 'sf',      label: '顺丰丰桥' },
  { value: 'mock',    label: '本地演示(mock)' },
]

export interface Carrier {
  id:        number
  code:      string
  name:      string
  type:      CarrierType
  contact:   string | null
  phone:     string | null
  remark:    string | null
  isActive:  boolean
  // 电子面单平台对接（文档 06）。密钥不在此、也从不返回，只有非敏感对接项。
  platformCode:    string | null
  platformCarrier: string | null
  monthlyAccount:  string | null
  netSiteCode:     string | null
  credentialRef:   string | null
  waybillEnabled:  boolean
  createdAt: string
}

export interface CarrierOption {
  id:   number
  code: string
  name: string
}

export interface CreateCarrierParams {
  name:     string
  type:     CarrierType
  contact?: string
  phone?:   string
  remark?:  string
  platformCode?:    string
  platformCarrier?: string
  monthlyAccount?:  string
  netSiteCode?:     string
  credentialRef?:   string
  waybillEnabled?:  boolean
}

export interface UpdateCarrierParams extends CreateCarrierParams {
  isActive: boolean
}
