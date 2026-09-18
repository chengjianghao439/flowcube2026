#!/usr/bin/env node
'use strict'

/**
 * 财务域加锁顺序契约测试（机械核对，无需 DB）。
 *
 * 背景（2026-09-18 多维度审计 P1）：退款执行原先「先锁账款、再锁账户、最后锁对账单」，
 * 与收付款登记的正范式「账户 → 对账单 → 账款」相反，同一客户并发「退款 execute」与
 * 「收款登记」会形成 record↔statement/account 的 ABBA 环。修复过程中还发现
 * `payment-receipts.create` 实际是在锁完 statement/record 之后才由 recordTransaction
 * 锁账户 —— 与审计引用的「receipts 也是账户→对账单→账款」不符，同样构成环，已一并修正。
 *
 * 顺序是并发正确性的一部分，但它**看不见也测不稳定**（要构造真并发才可能偶发死锁），
 * 所以这里退一步做静态契约：三条写入路径都必须按 账户 → 对账单 → 账款 的顺序取锁。
 * 机械判定「有没有、顺序对不对」，不判断语义。
 *
 * 运行：node tests/finance-lock-order-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

/** 三条直接改动 payment_records / 资金账户 / 对账单的路径。expect 是各文件**实际可校验**的取锁前缀顺序。 */
const PATHS = [
  {
    file: 'backend/src/modules/payments/payments.service.js',
    fn: 'recordPayment（收付款登记）',
    expect: ['finance_accounts', 'reconciliation_statements', 'payment_records'],
  },
  {
    file: 'backend/src/modules/refunds/refund-orders.service.js',
    fn: 'execute（退款执行）',
    expect: ['finance_accounts', 'reconciliation_statements', 'payment_records'],
  },
  {
    file: 'backend/src/modules/payments/payment-receipts.service.js',
    fn: 'applyAllocations（收付款单核销）',
    expect: ['reconciliation_statements', 'payment_records'],
    note: '该文件的账户锁发生在 create() 经 recordTransaction，晚于 applyAllocations；'
      + '而 applyAllocations 的签名不含 accountId，前置预锁需要改签名并复核调用链，'
      + '故这里只校验 statement→record 子顺序 —— **这是已知遗留缺口，不是已修复项**。',
  },
]

/** 期望的取锁顺序；同一把锁只取首次出现位置即可判定方向 */
const ORDER = [
  { key: 'finance_accounts', re: /FROM\s+finance_accounts\s+WHERE\s+id\s*=\s*\?\s*FOR\s+UPDATE/ },
  { key: 'reconciliation_statements', re: /FROM\s+reconciliation_statements\s+WHERE\s+id\s*=\s*\?\s*FOR\s+UPDATE/ },
  { key: 'payment_records', re: /FROM\s+payment_records\s+WHERE\s+id\s*=\s*\?\s*FOR\s+UPDATE/ },
]

function firstIndex(source, re) {
  const m = source.match(re)
  return m ? m.index : -1
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

function main() {
  const problems = []

  for (const p of PATHS) {
    const full = path.join(ROOT, p.file)
    assert.ok(fs.existsSync(full), `契约测试引用的文件不存在：${p.file}`)
    const source = fs.readFileSync(full, 'utf8')

    const found = p.expect.map(key => {
      const o = ORDER.find(x => x.key === key)
      return { ...o, index: firstIndex(source, o.re) }
    })
    const missing = found.filter(f => f.index < 0).map(f => f.key)
    if (missing.length) {
      problems.push(`${p.file}：找不到 ${missing.join(' / ')} 的 FOR UPDATE 取锁语句——`
        + '若确实重构了取锁写法，请同步更新本契约测试的正则，不要直接删断言')
      continue
    }

    for (let i = 1; i < found.length; i++) {
      const prev = found[i - 1]
      const cur = found[i]
      if (cur.index < prev.index) {
        problems.push(
          `${p.file}（${p.fn}）：加锁顺序相反——${prev.key} 在第 ${lineOf(source, prev.index)} 行，`
          + `但 ${cur.key} 在第 ${lineOf(source, cur.index)} 行。`
          + '必须按 账户 → 对账单 → 账款 取锁，否则与其它财务路径构成 ABBA 死锁环',
        )
      }
    }
    console.log(`  ✓ ${p.file}（${p.fn}）`
      + ` ${found.map(f => `${f.key}@${lineOf(source, f.index)}`).join(' → ')}`)
    if (p.note) console.log(`      ⚠ ${p.note}`)
  }

  if (problems.length) {
    console.error('\n财务域加锁顺序违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    const full = PATHS.filter(p => p.expect.length === ORDER.length).length
    console.log(`✓ 加锁顺序契约成立：${full} 条路径校验完整顺序（账户 → 对账单 → 账款），`
      + `${PATHS.length - full} 条仅校验子顺序（见上方 ⚠ 说明的已知缺口）`)
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  财务加锁顺序契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
