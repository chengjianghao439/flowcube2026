import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'
import api from './client'
import { getPartyLedger, type PartyLedgerResult } from './party-ledger'

vi.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ sessionGeneration: 1, token: 'test' }) } }))
vi.mock('@/store/companyStore', () => ({ useCompanyStore: { getState: () => ({ companyId: 1 }) } }))
vi.mock('@/lib/platform', () => ({ IS_CAPACITOR_PDA: false }))
vi.mock('@/lib/authSession', () => ({ performSessionLogout: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/config/api', () => ({ hasUserConfiguredApiOrigin: () => true }))
vi.mock('@/lib/pdaDeviceBinding', () => ({ getDeviceSession: () => null }))
vi.mock('./pda-session', () => ({ ensureDeviceSession: vi.fn(), renewDeviceSession: vi.fn() }))

const originalAdapter = api.defaults.adapter
afterEach(() => { api.defaults.adapter = originalAdapter })

// 与后端真实响应相同：快照是数字事件 ID，0 表示没有事件；HTTP 包装仍经真实 payloadClient 解包。
function ledgerPage(type: 1 | 2, page = 1): PartyLedgerResult {
  return {
    party: { id: 14, code: 'fixture', name: '测试单位' }, type,
    snapshotId: 42, snapshotCount: 2, historyStartedAt: '2026-10-01', historyIncomplete: false, unassignedCount: 0,
    summary: { openingBalance: 250.1234, increase: 30, decrease: 10, closingBalance: 270.1234 },
    list: [{ id: page, occurredAt: '2026-10-03', businessDate: null, eventType: 'receipt', eventName: '收付款', documentNo: 'fixture',
      orderId: null, recordId: null, receiptId: page, increase: 0, decrease: 5, balanceAfter: 270.1234 }],
    pagination: { page, pageSize: 1, total: 2 },
  }
}
function installResponses(batch: (page: number) => unknown) {
  const requests: InternalAxiosRequestConfig[] = []
  api.defaults.adapter = async config => {
    requests.push(config)
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: batch(Number(config.params.page)) } }
  }
  return requests
}

for (const type of [1, 2] as const) {
  test(`${type === 1 ? '供应商' : '客户'}数字快照取齐，续页沿用数字游标/计数/筛选，最终 DTO 保留数字与金额`, async () => {
    const requests = installResponses(page => ledgerPage(type, page))
    const params = { type, partyId: 14, startDate: '2026-10-01', endDate: '2026-10-03' }
    const signal = new AbortController().signal
    const result = await getPartyLedger(params, signal)
    expect(result).toMatchObject({ ...ledgerPage(type), list: [ledgerPage(type).list[0], ledgerPage(type, 2).list[0]], pagination: { page: 1, pageSize: 2, total: 2 } })
    expect(result.snapshotId).toBe(42)
    expect(requests.map(request => request.params)).toEqual([
      { ...params, page: 1, pageSize: 200, snapshotId: undefined, snapshotCount: undefined },
      { ...params, page: 2, pageSize: 1, snapshotId: 42, snapshotCount: 2 },
    ])
    expect(requests.every(request => request.signal === signal && request._authSessionGeneration === 1)).toBe(true)
  })
  test(`${type === 1 ? '供应商' : '客户'}无事件的数字 0 快照合法，空往来保留原汇总`, async () => {
    const batch = { ...ledgerPage(type), snapshotId: 0, snapshotCount: 0, list: [], pagination: { page: 1, pageSize: 200, total: 0 } }
    const requests = installResponses(() => batch)
    expect(await getPartyLedger({ type, partyId: 14 })).toMatchObject({ ...batch, pagination: { page: 1, pageSize: 0, total: 0 } })
    expect(requests).toHaveLength(1)
  })
}

for (const [label, patch] of [
  ['快照游标', { snapshotId: 43 }], ['快照计数', { snapshotCount: 3 }],
  ['记录总数', { pagination: { page: 2, pageSize: 1, total: 3 } }],
  ['页码', { pagination: { page: 3, pageSize: 1, total: 2 } }],
  ['批量大小', { pagination: { page: 2, pageSize: 2, total: 2 } }],
  ['缺少续页行', { list: [] }], ['重复事件', { list: ledgerPage(1).list }],
] as const) {
  test(`往来续页${label}异常不返回残缺成功列表`, async () => {
    installResponses(page => ({ ...ledgerPage(1, page), ...(page === 2 ? patch : {}) }))
    await expect(getPartyLedger({ type: 1, partyId: 14 })).rejects.toThrow(/已变化|不完整|重复/)
  })
}
for (const [label, patch] of [
  ['负游标', { snapshotId: -1 }], ['小数游标', { snapshotId: 1.5 }], ['越界游标', { snapshotId: Number.MAX_SAFE_INTEGER + 1 }],
  ['字符串游标', { snapshotId: '42' }], ['缺少游标', { snapshotId: undefined }],
  ['负计数', { snapshotCount: -1 }], ['缺少计数', { snapshotCount: undefined }],
  ['小数计数', { snapshotCount: 1.5 }], ['字符串计数', { snapshotCount: '2' }],
  ['缺少列表', { list: undefined }], ['缺少分页', { pagination: undefined }],
] as const) {
  test(`往来响应${label}明确拒绝，不通过快照转换掩盖无效数据`, async () => {
    installResponses(() => ({ ...ledgerPage(1), ...patch }))
    await expect(getPartyLedger({ type: 1, partyId: 14 })).rejects.toThrow(/不完整/)
  })
}
