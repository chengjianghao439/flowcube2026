// Keep these master-data rules aligned with backend/src/utils/partyProfile.js.
// Shipping contacts and carrier payloads retain their separate contracts.
export const PARTY_PROFILE_LIMITS = { name: 100, contact: 50, phone: 30, address: 200, remark: 500 } as const
export const PARTY_PHONE_PATTERN = /^[0-9 +()-]*$/
export const PARTY_PHONE_MESSAGE = '电话仅支持数字、空格、+、(、)、-'

interface PartyProfile {
  name: string
  contact: string
  phone: string
  address: string
  remark: string
}

export function normalizePartyProfile(profile: PartyProfile, partyLabel: '客户' | '供应商'): PartyProfile {
  const normalized: PartyProfile = { name: '', contact: '', phone: '', address: '', remark: '' }
  const labels = { name: `${partyLabel}名称`, contact: '联系人', phone: '电话', address: '地址', remark: '备注' }
  for (const field of Object.keys(PARTY_PROFILE_LIMITS) as Array<keyof PartyProfile>) {
    const value = profile[field].trim()
    if (/[\uD800-\uDFFF]/u.test(value)) throw new Error(`${labels[field]}含无效字符，请重新输入`)
    if (Array.from(value).length > PARTY_PROFILE_LIMITS[field]) throw new Error(`${labels[field]}最多 ${PARTY_PROFILE_LIMITS[field]} 个字符`)
    if (field === 'name' && !value) throw new Error(`${labels[field]}不能为空`)
    if (field === 'phone' && !PARTY_PHONE_PATTERN.test(value)) throw new Error(PARTY_PHONE_MESSAGE)
    normalized[field] = value
  }
  return normalized
}
