const { z } = require('zod')
const AppError = require('./AppError')

// Party master data only. Shipping recipients, address books and carrier inputs
// keep their own contracts. Count Unicode code points, as utf8mb4 VARCHAR does.
const PARTY_PROFILE_LIMITS = Object.freeze({ name: 100, contact: 50, phone: 30, address: 200, remark: 500 })
const PARTY_PHONE_PATTERN = /^[0-9 +()-]*$/
const PARTY_PHONE_MESSAGE = '电话仅支持数字、空格、+、(、)、-'

function profileText(label, limit) {
  return z.string().trim()
    .refine(value => value.isWellFormed(), `${label}含无效字符，请重新输入`)
    .refine(value => Array.from(value).length <= limit, `${label}最多 ${limit} 个字符`)
}

function partyProfileSchema(partyLabel) {
  return z.object({
    name: profileText(`${partyLabel}名称`, PARTY_PROFILE_LIMITS.name).refine(value => value.length > 0, `${partyLabel}名称不能为空`),
    contact: profileText('联系人', PARTY_PROFILE_LIMITS.contact).optional(),
    phone: profileText('电话', PARTY_PROFILE_LIMITS.phone).refine(value => PARTY_PHONE_PATTERN.test(value), PARTY_PHONE_MESSAGE).optional(),
    address: profileText('地址', PARTY_PROFILE_LIMITS.address).optional(),
    remark: profileText('备注', PARTY_PROFILE_LIMITS.remark).optional(),
  })
}

// Financial documents may carry a historical identity verbatim. Change only
// the length unit; do not normalize or rewrite those values here.
function partyNameSchema(requiredMessage) {
  return z.string().min(1, requiredMessage)
    .refine(value => value.isWellFormed(), '往来方名称含无效字符，请重新输入')
    .refine(value => Array.from(value).length <= PARTY_PROFILE_LIMITS.name, '往来方名称最多 100 个字符')
}

function normalizePartyProfile(input, partyLabel) {
  const fields = { name: input.name }
  for (const field of ['contact', 'phone', 'address', 'remark']) fields[field] = input[field] ?? undefined
  const result = partyProfileSchema(partyLabel).safeParse(fields)
  if (!result.success) throw new AppError(result.error.issues[0].message, 400)
  return result.data
}

module.exports = { PARTY_PROFILE_LIMITS, PARTY_PHONE_PATTERN, PARTY_PHONE_MESSAGE, partyProfileSchema, partyNameSchema, normalizePartyProfile }
