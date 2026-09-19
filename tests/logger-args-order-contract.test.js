#!/usr/bin/env node
'use strict'

/**
 * logger 参数顺序契约（纯静态，无需 DB）。
 *
 * `backend/src/utils/logger.js` 的签名是 `info(msg, meta = {}, module_ = '')` /
 * `warn(msg, meta = {}, module_ = '')`——**消息在前、模块名在后**。
 *
 * 2026-09-18 审计发现会计模块有 **15 处**按旧签名写成了
 * `logger.info('accounting', \`生成结转凭证…\`, { userId })`：于是 `msg` 位置变成字面量
 * `'accounting'`，真正的业务消息被塞进 `meta`、模块名位置收到一个对象。后果不是报错，
 * 而是这些日志**再也读不出来**——线上排查时看到的是一串错位的 `[object Object]`，
 * 而它们恰好是结账/反结账、手工凭证、发票增删改这类最需要追溯的动作。
 * 全仓只有会计模块这样写，说明是早期按旧签名写的代码在 logger 改签名后没跟着改。
 *
 * 本测试守住：`logger.info` / `logger.warn` 的**第二个参数必须是对象**（`meta`），
 * 不能是字符串字面量——一旦有人再按 `(module, msg, meta)` 的顺序写，CI 直接失败。
 * `logger.error` 签名是 `(msg, err, meta, module_)`，第二个参数本就是 Error，故不参与检查。
 *
 * 运行：node tests/logger-args-order-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'backend/src')

/** 只检查这两个：签名同为 (msg, meta, module_)。 */
const CHECKED = ['info', 'warn']

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out)
    } else if (e.name.endsWith('.js')) {
      out.push(p)
    }
  }
  return out
}

/**
 * 从 `(` 处解析出顶层逗号分隔的参数列表。
 * 需要处理引号（含模板字符串）与 `()[]{}`，否则 `round2(debit)`、`{ a: f(x) }` 会被切错。
 */
function parseArgs(src, openIdx) {
  const args = []
  let cur = ''
  let depth = 0
  let quote = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      cur += ch
      if (ch === '\\') { cur += src[i + 1] ?? ''; i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; cur += ch; continue }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) { args.push(cur); break }
      cur += ch
      continue
    }
    if (ch === ',' && depth === 1) { args.push(cur); cur = ''; continue }
    cur += ch
  }
  return args.map((s) => s.trim()).filter((s) => s !== '')
}

/** 参数是不是字符串字面量（meta 位置出现它一定是顺序写反了）。 */
const isStringLiteral = (arg) => /^['"`]/.test(arg)

function main() {
  assert.ok(fs.existsSync(SRC), '找不到 backend/src')
  const files = walk(SRC)
  assert.ok(files.length > 100, `扫描到的后端文件太少（${files.length}）`)

  const problems = []
  let scanned = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    const src = fs.readFileSync(file, 'utf8')
    for (const level of CHECKED) {
      const needle = `logger.${level}(`
      let at = src.indexOf(needle)
      while (at !== -1) {
        const open = at + needle.length - 1
        const args = parseArgs(src, open)
        scanned++
        // 只传 msg 是合法的（meta 默认 {}，例如 inbound-tasks.query.js 的超时标记日志），
        // 所以只在「确实传了第二个参数、但它不是对象」时报错——那才是顺序写反。
        if (args.length >= 2 && isStringLiteral(args[1])) {
          const line = src.slice(0, at).split('\n').length
          problems.push(
            `${rel}:${line} logger.${level} 的第二个参数是字符串（${args[1].slice(0, 40)}）——` +
              "签名是 (msg, meta, module_)：meta 必须是对象，模块名放最后一个参数，如 " +
              `logger.${level}('消息', { ... }, 'accounting')`,
          )
        }
        at = src.indexOf(needle, at + needle.length)
      }
    }
  }

  assert.ok(scanned > 50, `只解析到 ${scanned} 处 logger 调用，扫描逻辑可能失效`)

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(`logger-args-order-contract: 扫描 ${files.length} 个文件、${scanned} 处 logger(info|warn) 调用、失败 ${problems.length}`)
  if (problems.length) process.exit(1)
  console.log('  [OK] logger 调用一律为 (msg, meta, module_) 顺序')
}

main()
