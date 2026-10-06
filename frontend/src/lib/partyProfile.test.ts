import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import { normalizePartyProfile, PARTY_PROFILE_LIMITS, PARTY_PHONE_PATTERN, PARTY_PHONE_MESSAGE } from './partyProfile'

const backend = createRequire(import.meta.url)('../../../backend/src/utils/partyProfile.js')
const empty = { name: '企业', contact: '', phone: '', address: '', remark: '' }
test('前后端资料规则同源契约：上限、电话符号、trim与Unicode边界一致', () => {
  expect(PARTY_PROFILE_LIMITS).toEqual(backend.PARTY_PROFILE_LIMITS)
  expect(PARTY_PHONE_PATTERN.source).toBe(backend.PARTY_PHONE_PATTERN.source)
  expect(PARTY_PHONE_MESSAGE).toBe(backend.PARTY_PHONE_MESSAGE)
  for (const kind of ['客户', '供应商'] as const) {
    for (const [field, limit] of Object.entries(PARTY_PROFILE_LIMITS)) {
      for (const value of ['  ', '𠮷'.repeat(limit), '𠮷'.repeat(limit + 1), 'e\u0301'.repeat(Math.ceil(limit / 2)), '字\ud800']) {
        const input = { ...empty, [field]: ` ${value} ` }
        let frontendError = ''; let backendError = ''
        try { normalizePartyProfile(input, kind) } catch (error) { frontendError = (error as Error).message }
        try { backend.normalizePartyProfile(input, kind) } catch (error) { backendError = (error as Error).message }
        expect(frontendError, `${kind}.${field}`).toBe(backendError)
      }
    }
    expect(normalizePartyProfile({ ...empty, name: ' 企业 ', phone: ' +86 (010) 1234-5678 ' }, kind)).toEqual(backend.normalizePartyProfile({ ...empty, name: ' 企业 ', phone: ' +86 (010) 1234-5678 ' }, kind))
  }
})
