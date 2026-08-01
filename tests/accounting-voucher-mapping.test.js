#!/usr/bin/env node
'use strict'

/**
 * 会计科目映射一致性测试（无需 DB）。
 *   node tests/accounting-voucher-mapping.test.js
 *
 * 会计正确性是「静默出错」类风险（文档 10 · §10/§11），故把三者的一致性做成自动化守护：
 *   1) voucherSource.ACCOUNT_MAPPING 引用的每个科目 code，都必须在预置科目 PRESET_ACCOUNTS 中存在
 *      —— 否则 Phase1 凭证引擎会挂在「找不到科目」上。
 *   2) 177_seed_acct_accounts.sql 落库的科目 code 集合，必须与 PRESET_ACCOUNTS 完全一致
 *      —— 防止 seed 与常量各改一处而悄悄漂移（历史上列注释/常量漂移是本仓反复踩的坑）。
 *   3) 每条事件映射至少各有一条借、一条贷（凭证借贷平衡的先决结构）。
 */

const path = require('path')
const fs = require('fs')
const assert = require('assert')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const {
  SOURCE_TYPE_VALUES,
  DIR,
  PRESET_ACCOUNTS,
  PRESET_CODES,
  ACCOUNT_MAPPING,
  referencedAccountCodes,
} = require(path.resolve(__dirname, '../backend/src/constants/voucherSource'))

const results = []
let failures = 0
function check(desc, fn) {
  try { fn(); results.push(`  ✓ ${desc}`) }
  catch (e) { failures += 1; results.push(`  ✗ ${desc}\n      ${e.message}`) }
}

// ── 1. 映射引用的科目都在预置科目中 ──────────────────────────────────────────
check('ACCOUNT_MAPPING 引用的每个科目 code 都存在于 PRESET_ACCOUNTS', () => {
  const missing = referencedAccountCodes().filter(c => !PRESET_CODES.has(c))
  assert.deepStrictEqual(missing, [], `映射引用了未预置的科目: ${missing.join(', ')}`)
})

// ── 2. seed 与常量的科目集合一致 ─────────────────────────────────────────────
check('177 seed 落库的科目 code 集合与 PRESET_ACCOUNTS 完全一致', () => {
  const seedPath = path.resolve(__dirname, '../backend/src/database/177_seed_acct_accounts.sql')
  const sql = fs.readFileSync(seedPath, 'utf8')
  // 科目 code 是纯数字字面量（4~6 位），科目名是中文——按此区分，提取 seed 中所有 code
  const seedCodes = new Set([...sql.matchAll(/'([0-9]{3,6})'/g)].map(m => m[1]))
  const presetCodes = new Set(PRESET_ACCOUNTS.map(a => a.code))
  const onlyInSeed   = [...seedCodes].filter(c => !presetCodes.has(c))
  const onlyInPreset = [...presetCodes].filter(c => !seedCodes.has(c))
  assert.deepStrictEqual(onlyInSeed, [],   `seed 有但常量无: ${onlyInSeed.join(', ')}`)
  assert.deepStrictEqual(onlyInPreset, [], `常量有但 seed 无: ${onlyInPreset.join(', ')}`)
})

check('每个预置科目名称在 seed 中出现（防改名漂移）', () => {
  const seedPath = path.resolve(__dirname, '../backend/src/database/177_seed_acct_accounts.sql')
  const sql = fs.readFileSync(seedPath, 'utf8')
  const missing = PRESET_ACCOUNTS.filter(a => !sql.includes(`'${a.name}'`)).map(a => `${a.code} ${a.name}`)
  assert.deepStrictEqual(missing, [], `seed 缺少科目名: ${missing.join('; ')}`)
})

// ── 3. 每条事件映射借贷结构完整 ──────────────────────────────────────────────
check('每条事件映射至少各有一条借、一条贷', () => {
  const bad = []
  for (const [type, rule] of Object.entries(ACCOUNT_MAPPING)) {
    const hasDebit  = rule.legs.some(l => l.dir === DIR.DEBIT)
    const hasCredit = rule.legs.some(l => l.dir === DIR.CREDIT)
    if (!hasDebit || !hasCredit) bad.push(type)
  }
  assert.deepStrictEqual(bad, [], `借贷结构不完整的事件: ${bad.join(', ')}`)
})

check('映射引用的科目均为可记账明细（进项/销项/主科目均为叶子）', () => {
  // 汇总科目 2221 应交税费本身不可挂分录；映射里不应直接引用它
  assert.ok(!referencedAccountCodes().includes('2221'), '映射不应直接引用汇总科目 2221 应交税费')
})

// ── 4. 枚举与预置基本自洽 ────────────────────────────────────────────────────
check('source_type 枚举值唯一', () => {
  assert.strictEqual(new Set(SOURCE_TYPE_VALUES).size, SOURCE_TYPE_VALUES.length)
})

check('PRESET_ACCOUNTS 的 code 唯一，parentCode 若有须存在', () => {
  const codes = PRESET_ACCOUNTS.map(a => a.code)
  assert.strictEqual(new Set(codes).size, codes.length, 'code 有重复')
  const bad = PRESET_ACCOUNTS.filter(a => a.parentCode && !PRESET_CODES.has(a.parentCode))
  assert.deepStrictEqual(bad.map(a => a.code), [], '存在指向不存在父科目的项')
})

// ── 汇总输出 ────────────────────────────────────────────────────────────────
console.log('\n会计科目映射一致性测试')
console.log(results.join('\n'))
console.log(failures === 0 ? `\n全部通过（${results.length} 项）` : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
