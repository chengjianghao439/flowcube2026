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

/** 电子面单对接平台（文档 06）。none=仅线下，mock=本地演示，其余为真实平台。
 *  展示历史配置时用这份**全量**清单，避免老数据的平台标签被过滤成「未设置」。 */
export const WAYBILL_PLATFORM_ALL: { value: string; label: string }[] = [
  { value: 'kdniao',  label: '快递鸟' },
  { value: 'deppon', label: '德邦开放平台' },
  { value: 'sf',      label: '顺丰丰桥' },
  { value: 'mock',    label: '本地演示(mock)（仅开发环境）' },
]

/** 下拉可选平台：生产构建不提供 mock（2026-09-18 审计 P2）。
 *  mock 适配器无凭据即可签出假单号并推进运单状态；后端 `carriers.service.js` 的
 *  `CARRIER_MOCK_NOT_ALLOWED` 是硬闸门，这里只是别让运维在正常下拉里误选。 */
export const WAYBILL_PLATFORM_OPTIONS = WAYBILL_PLATFORM_ALL.filter(
  (o) => o.value !== 'mock' || !import.meta.env.PROD,
)

/** 直接对接（顺丰/德邦）的账号资料与取号开关**只能**在「快递账号绑定」页维护：
 *  那条路径有 revision CAS、暂停前置、待处理运单与 canEnable 闸门，后端 `carriers.service.js`
 *  对这两个平台的账号字段直接返回 400 `CARRIER_ACCOUNT_FIELDS_MOVED`（2026-09-18 审计 [9]）。
 *  承运商管理页只做只读展示 + 跳转。 */
export const DIRECT_CARRIER_PLATFORMS = ['sf', 'deppon']
export const isDirectCarrierPlatform = (platform?: string | null): boolean =>
  !!platform && DIRECT_CARRIER_PLATFORMS.includes(platform)

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
