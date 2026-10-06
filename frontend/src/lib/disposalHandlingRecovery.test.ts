// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest'
import { HANDLING_STORAGE, readHandlingRecords, saveHandlingRecord, readHandlingSourceId, handlingQty, confirmHandlingRecord, removeHandlingRecord, type HandlingRecord } from './disposalHandlingRecovery'
import { buildWorkspaceTabRegistrationFromPath } from '@/router/workspaceRouteMeta'
const record = (): HandlingRecord => ({ version: 1, userId: 9, baseURL: '/a', method: 'post', createdAt: Date.now(), phase: 'pending', kind: 'source', draftIdentity: 'intent', intentUuid: '11111111-1111-4111-8111-111111111111', operationUuid: '22222222-2222-4222-8222-222222222222', requestKey: 'fixed', path: '/disposals/handling-sources', action: 'disposal.handling.source.create', body: { intentUuid: '11111111-1111-4111-8111-111111111111', operationUuid: '22222222-2222-4222-8222-222222222222', productId: 3, warehouseId: 8, unit: '个', handlingType: 1, quantity: 2 } })
beforeEach(() => localStorage.clear()); afterEach(() => localStorage.clear())
test('完整业务体持久读回，输入变更不改原请求；不保存登录凭据', () => { const r = record(); saveHandlingRecord(r); r.body.quantity = 99; expect(readHandlingRecords()[0].body.quantity).toBe(2); expect(localStorage.getItem(HANDLING_STORAGE)).not.toContain('token') })
test('损坏历史不得当空列表', () => { localStorage.setItem(HANDLING_STORAGE, 'bad'); expect(() => readHandlingRecords()).toThrow() })
test('身份和原path不一致拒绝；不替损坏记录猜成功', () => { localStorage.setItem(HANDLING_STORAGE, JSON.stringify([{ ...record(), path: '/sale' }])); expect(() => readHandlingRecords()).toThrow() })
test('普通、重复、处理来源工作区身份独立，空与重复参数保raw并拒绝', () => { const paths = ['/sale/new', '/sale/new?sourceId=11', '/sale/new?handlingSourceId=11', '/sale/new?handlingSourceId=12']; expect(new Set(paths.map(p => buildWorkspaceTabRegistrationFromPath(p).key)).size).toBe(4); expect(readHandlingSourceId(paths[2])).toBe(11); for (const value of ['', '1e2', '9007199254740992', '11&handlingSourceId=11']) { const p = buildWorkspaceTabRegistrationFromPath(`/sale/new?handlingSourceId=${value}`).path; expect(p).toContain('handlingSourceId='); expect(readHandlingSourceId(p)).toBe('invalid') } })
test('容量满保留全部unknown，不驱逐或覆盖任何原body', () => { const all = Array.from({length:30}, (_,i) => ({ ...record(), draftIdentity:'draft'+i, requestKey:'key'+i, operationUuid:`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}`, body: { ...record().body, operationUuid:`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}` } })); localStorage.setItem(HANDLING_STORAGE, JSON.stringify(all)); expect(() => saveHandlingRecord({...record(), draftIdentity:'next'})).toThrow(); expect(readHandlingRecords()).toEqual(all) })
test('conversion完整记录无intent；不能伪造单一intent绕身份', () => { const r = { ...record(), kind: 'conversion' as const, legacyId:11, intentUuid:undefined, path:'/disposals/11/sign-conversion', action:'disposal.handling.legacy.convert.11', body:{operationUuid:record().operationUuid,snapshotFingerprint:'a'.repeat(64),reason:'整单核对'} }; saveHandlingRecord(r); expect(readHandlingRecords()[0].intentUuid).toBeUndefined(); localStorage.setItem(HANDLING_STORAGE,JSON.stringify([{...r,intentUuid:record().intentUuid}])); expect(() => readHandlingRecords()).toThrow() })

test('严格有效两位与requestKey100；微小第三位/不完整资源拒绝持久', () => {
  expect(handlingQty(1.001)).toBe(false)
  expect(handlingQty(1.000000001)).toBe(false)
  expect(handlingQty(1.01)).toBe(true)
  expect(() => saveHandlingRecord({ ...record(), requestKey: 'x'.repeat(101) })).toThrow()
  expect(() => saveHandlingRecord({ ...record(), body: { ...record().body, quantity: 1.001 } })).toThrow()
})
test('confirmed与清理核完整原body，不以同UUID清别人的变更记录', () => {
  const r = record(), ack = { id: 11, intentUuid: r.intentUuid!, productId: 3, warehouseId: 8, unit: '个', handlingType: 1 as const, quantity: 2, revision: 1 }
  saveHandlingRecord(r)
  const changed = { ...r, body: { ...r.body, quantity: 3 } }
  expect(() => confirmHandlingRecord(changed, { ...ack, quantity: 3 })).toThrow()
  confirmHandlingRecord(r, ack)
  expect(() => removeHandlingRecord({ ...r, body: { ...r.body, quantity: 3 } })).toThrow()
  expect(readHandlingRecords()[0].phase).toBe('confirmed')
  removeHandlingRecord(r)
  expect(readHandlingRecords()).toEqual([])
})

import { resolveRoutePermission } from '@/router/routeDefinitions'
import { PERMISSIONS } from './permission-codes'
test('来源报废草稿保原CREATE路由门；只有本人核对页auth-only', () => { expect(resolveRoutePermission('/disposals/new')).toBe(PERMISSIONS.INVENTORY_DISPOSAL_CREATE); expect(resolveRoutePermission('/disposals/recovery')).toBeUndefined() })
