import { payloadClient as client } from './client'

export type PdaDeviceStatus = 'active' | 'disabled' | 'retired'

export interface PdaDevice {
  id: number
  deviceCode: string
  deviceName: string | null
  warehouseId: number | null
  warehouseName: string | null
  status: PdaDeviceStatus
  lastSeenAt: string | null
  /** 当前有效（未吊销未过期）的会话数，可粗略当作「这台机器在不在线」 */
  activeSessions: number
  createdAt: string
  updatedAt: string
}

/** 新建与重置密钥的响应里才有 deviceSecret，且仅此一次——之后任何接口都取不回来 */
export interface PdaDeviceWithSecret extends PdaDevice {
  deviceSecret: string
  revokedSessions?: number
}

export interface PdaDeviceListResult {
  list: PdaDevice[]
  pagination: { page: number; pageSize: number; total: number }
}

export const listPdaDevicesApi = (params: {
  page?: number
  pageSize?: number
  keyword?: string
  status?: PdaDeviceStatus | ''
  warehouseId?: number | null
}) => client.get<PdaDeviceListResult>('/pda-devices', { params })

export const createPdaDeviceApi = (data: { deviceName: string; warehouseId: number | null }) =>
  client.post<PdaDeviceWithSecret>('/pda-devices', data)

export const updatePdaDeviceApi = (id: number, data: { deviceName?: string; warehouseId?: number | null }) =>
  client.put<PdaDevice>(`/pda-devices/${id}`, data)

export const setPdaDeviceStatusApi = (id: number, status: PdaDeviceStatus) =>
  client.put<PdaDevice & { revokedSessions: number }>(`/pda-devices/${id}/status`, { status })

export const resetPdaDeviceSecretApi = (id: number) =>
  client.post<PdaDeviceWithSecret>(`/pda-devices/${id}/reset-secret`)

/**
 * PDA 扫码绑定用的二维码内容。
 * 只带设备码与密钥，不带服务器地址——PDA 在绑定前已经连着服务器了，
 * 把地址塞进二维码反而会在多环境（测试/生产）之间造成误绑。
 */
export function buildBindingPayload(device: { deviceCode: string; deviceSecret: string }) {
  return JSON.stringify({ t: 'flowcube-pda-bind', code: device.deviceCode, secret: device.deviceSecret })
}
