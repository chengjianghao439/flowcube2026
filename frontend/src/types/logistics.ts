import type { StatusTone } from '@/lib/statusTone'

/** 运单状态：1待取号 2取号中 3已取号 4取号失败 5已作废 */
export type WaybillStatus = 1 | 2 | 3 | 4 | 5

export interface LogisticsWaybill {
  id:               number
  waybillNo:        string
  saleOrderId:      number
  saleOrderNo:      string | null
  warehouseTaskId:  number | null
  warehouseId:      number | null
  warehouseName:    string | null
  packageId:        number | null
  packageBarcode:   string | null
  carrierId:        number | null
  carrierName:      string | null
  platformCode:     string | null
  platformCarrier:  string | null
  trackingNo:       string | null
  status:           WaybillStatus
  statusLabel:      string
  statusTone:       StatusTone
  freightType:      number | null
  freightTypeLabel: string | null
  estFreight:       number | null
  receiverName:     string | null
  receiverPhone:    string | null
  receiverAddress:  string | null
  printDataRef:     string | null
  trackStatus:      number
  errorMessage:     string | null
  retryCount:       number
  lastTriedAt:      string | null
  customerName:     string | null
  createdAt:        string
  updatedAt:        string
}

export interface TrackEvent {
  id:          number
  eventTime:   string | null
  statusCode:  string | null
  description: string | null
  location:    string | null
  createdAt:   string
}

export interface FreightBill {
  id:            number
  carrierId:     number
  carrierName:   string | null
  waybillId:     number | null
  trackingNo:    string | null
  billPeriod:    string | null
  actualFreight: number
  weight:        number | null
  freightType:   number | null
  settlementId:  number | null
  reconciled:    boolean
  source:        string | null
  createdAt:     string
}

export interface FreightSettlement {
  id:              number
  settlementNo:    string
  carrierId:       number
  carrierName:     string | null
  billPeriod:      string
  totalFreight:    number
  billCount:       number
  status:          number
  statusLabel:     string
  statusTone:      StatusTone
  paymentRecordId: number | null
  createdAt:       string
  updatedAt:       string
}
