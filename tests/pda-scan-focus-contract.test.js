#!/usr/bin/env node
'use strict'

/**
 * PDA 聚焦契约（纯静态，无需 DB）。
 *
 * 规则（2026-09-19 用户明确判断依据）：**按「这个页面要不要输入」决定是否聚焦**——
 * 登录页需要输入，自动聚焦账号框是对的；**扫码作业页不需要输入，一律不得自动聚焦**
 * （软键盘会挡住扫码视野），只有用户点「手动输入」才渲染手输框并聚焦。
 *
 * 背景：该规则此前只写在 `PdaScanner.tsx` 的注释与 `docs/pda-scan-default-mode-2026-09-17.md` 里，
 * **没有任何测试守着它**（2026-09-19 全仓检索 `tests/` 无 autoFocus 断言）。注释拦不住
 * 「顺手加个 autoFocus 让体验统一」这类改动——而一旦加上，软键盘会盖住扫码区，
 * 现场表现为「扫码页一进去就弹出键盘」，却不会有任何测试变红。
 *
 * 本测试守住三件事：
 *   1. PDA 作业页与 `PdaScanner` 里不得出现 `autoFocus` 属性；
 *   2. `PdaScanner` 里每一处 `.focus()` 调用都必须带「手动输入」语义（附近出现 manual），
 *      即聚焦只能由用户点「手动输入」触发，不能在挂载/扫码结束时自动发生；
 *   3. 守卫自身先剔除整行注释——`PdaScanner` 头注释里就写着「不要再加 autoFocus」，
 *      不剔除会把那句说明当成违规（同类自我误报在 2026-09-18 已踩过一次）。
 *
 * 运行：node tests/pda-scan-focus-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PDA_DIR = path.join(ROOT, 'frontend/src/pages/pda')
const SCANNER = path.join(ROOT, 'frontend/src/components/pda/PdaScanner.tsx')

/**
 * **需要输入的页面**：允许自动聚焦。登录页是唯一一个——用户 2026-09-19 明确
 * 「登录需要输入，扫码不需要输入」；登录页的 `autoFocus` 正是这条规则的正面实现。
 * 其余 PDA 页面都是扫码/浏览类，一律不得自动聚焦。
 */
const INPUT_PAGES = new Set(['login.tsx'])

/**
 * 只剔除**整行注释**。按 `//` 全剔会把字面量后半行一起砍掉（2026-09-18 实测教训）。
 */
function stripLineComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

function pdaPageFiles() {
  if (!fs.existsSync(PDA_DIR)) return []
  return fs
    .readdirSync(PDA_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(PDA_DIR, f))
}

function main() {
  const problems = []

  assert.ok(fs.existsSync(SCANNER), `找不到 ${path.relative(ROOT, SCANNER)}`)

  // ── 1. 不得出现 autoFocus 属性（需要输入的页面除外）────────────────────────
  const targets = [SCANNER, ...pdaPageFiles()]
  let scanned = 0
  for (const file of targets) {
    const rel = path.relative(ROOT, file)
    if (INPUT_PAGES.has(path.basename(file))) continue // 登录页允许聚焦，见 INPUT_PAGES
    const src = stripLineComments(fs.readFileSync(file, 'utf8'))
    scanned++
    // JSX 属性或对象属性写法；`autoFocus` 仅作为标识符出现即视为违规
    const hit = src.match(/\bautoFocus\b/)
    if (hit) {
      const line = src.slice(0, hit.index).split('\n').length
      problems.push(
        `${rel} 出现 autoFocus（去注释后第 ${line} 行）：PDA 扫码页不得自动聚焦——` +
          '软键盘会挡住扫码视野，只有用户点「手动输入」才渲染手输框并聚焦',
      )
    }
  }

  // ── 2. PdaScanner 的每一处 focus() 必须自身带「手动输入」语义 ──────────────
  // 判据刻意收紧到**同一行**：早先按「前 30 行内出现 manual」判定时，向挂载 effect 里
  // 注入 `inputRef.current?.focus()` 不会被发现（附近恰好有 manualInputRef）——实测假阴性。
  const scannerSrc = stripLineComments(fs.readFileSync(SCANNER, 'utf8'))
  const scannerLines = scannerSrc.split('\n')
  let focusCalls = 0
  for (let i = 0; i < scannerLines.length; i++) {
    if (!/\.focus\(/.test(scannerLines[i])) continue
    focusCalls++
    if (!/manual/i.test(scannerLines[i])) {
      problems.push(
        `${path.relative(ROOT, SCANNER)}:${i + 1} 有一处 .focus() 不带「手动输入」语义：` +
          '聚焦只能由用户点「手动输入」触发（写成 manualInputRef.current?.focus()），' +
          '不得在挂载或扫码结束时自动聚焦',
      )
    }
  }
  assert.ok(focusCalls > 0, 'PdaScanner 里找不到任何 .focus()，扫描逻辑可能失效（手动输入分支应有一处）')

  assert.ok(scanned > 10, `只扫描到 ${scanned} 个 PDA 文件，扫描逻辑可能失效`)

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `pda-scan-focus-contract: 扫描 ${scanned} 个 PDA 文件、PdaScanner 中 ${focusCalls} 处 focus()、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] PDA 作业页无 autoFocus，聚焦仅由「手动输入」触发')
}

main()
