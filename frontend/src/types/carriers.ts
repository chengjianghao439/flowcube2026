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

export interface Carrier {
  id:        number
  code:      string
  name:      string
  type:      CarrierType
  contact:   string | null
  phone:     string | null
  remark:    string | null
  isActive:  boolean
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
}

export interface UpdateCarrierParams extends CreateCarrierParams {
  isActive: boolean
}
