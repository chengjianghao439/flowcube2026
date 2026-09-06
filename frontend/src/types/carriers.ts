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
  { value: 'deppon', label: '德邦开放平台' },
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
  shippingProduct?: string | null
  shippingDeliveryType?: string | null
  waybillEnabled:  boolean
  createdAt: string
}

export interface CarrierOption {
  id:   number
  code: string
  name: string
  platformCode?: string | null
  shippingProduct?: string | null
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
  shippingProduct?: string
  shippingDeliveryType?: string
  waybillEnabled?:  boolean
}

export interface UpdateCarrierParams extends CreateCarrierParams {
  isActive: boolean
}

/** 仅本地接入准备状态；不代表官方在线授权查询结果。 */
export interface CarrierAccountBinding {
  carrierId: number
  carrierName: string
  platformCode: 'sf' | 'deppon'
  monthlyAccount: string
  shippingProduct: string
  shippingDeliveryType: string
  enabled: boolean
  active: boolean
  revision: string
  connectionReady: boolean
  mode: 'sandbox' | 'production'
  accountVerified: boolean
  products: { code: string; label: string }[]
  productReady: boolean
  canEnable: boolean
}
export interface SaveCarrierAccountBinding {
  platformCode: 'sf' | 'deppon'
  monthlyAccount: string
  shippingProduct: string
  shippingDeliveryType: string
  enabled: boolean
  revision: string
}

export interface PauseCarrierAccountBinding { action: 'pause' | 'unbind'; revision: string }
export interface NewCarrierAccount { name: string; platformCode: 'sf' | 'deppon'; monthlyAccount: string }
