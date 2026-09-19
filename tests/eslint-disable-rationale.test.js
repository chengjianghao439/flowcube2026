#!/usr/bin/env node
'use strict'

/**
 * eslint 禁用理由契约（纯静态，无需 DB）。
 *
 * 背景：`AGENTS.md` §3 早就写着「新增 eslint-disable 必须说明原因，不能为过门禁屏蔽问题」，
 * 但这条规则一直没有守卫，只能靠人眼看 diff。2026-09-18 审视全仓 20 处禁用时发现：
 *   · 16 处 `react-hooks/exhaustive-deps` 中，有 3 处（账单登记、发票录入、按产品取消占库）
 *     光秃秃一条 disable，看不出「为什么不带这个依赖」——而这三处的理由都很实在
 *     （`recent30d`/`reservedItems` 是每次渲染新建的对象/数组，入依赖会让用户填到一半被重置；
 *     `edit` 是 React Query 每次 refetch 都重建的引用）；
 *   · `errorHandler.js` 的 `no-unused-vars` 上方只有函数 JSDoc，没说明「Express 错误中间件
 *     必须保留 4 个参数」——删掉 next 就静默不再是错误处理器。
 * 理由不写下来，下一个人只能选择「照着抄」或「删掉试试」，两种都在制造回归。
 *
 * 本测试守住两件事：
 *   1. 任何 `eslint-disable-next-line` / `eslint-disable-line` 指令，其上方 15 行内必须
 *      有一条**说明性注释**（`//` 或块注释，且本身不是另一条 eslint 指令）；
 *   2. 整文件级别的 `/* eslint-disable *​/` 只允许出现在机器产物白名单里——
 *      业务文件整文件关 lint 会让规则在这一个文件里永久失效，必须显式登记理由。
 *      生成器里作为**字符串字面量**输出的那行（`scripts/generate-status-constants.js`）
 *      是被生成的内容、不是真的指令，按引号包裹排除。
 *
 * 运行：node tests/eslint-disable-rationale.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
/** 产品代码与工具脚本都要守；node_modules/构建产物/生成物不扫。 */
const SCAN_ROOTS = ['frontend/src', 'backend/src', 'desktop', 'scripts', 'tests']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'release', 'android', '.git', 'coverage'])

/** 理由注释的搜索窗口：项目既有写法是注释放在 `useEffect` 上方，最多 8 行。 */
const RATIONALE_WINDOW = 15

/** 本文件自身充满这些模式字面量，跳过以免自报。 */
const SELF = 'tests/eslint-disable-rationale.test.js'

/**
 * 整文件禁用白名单：`frontend/src/generated/status.ts` 由 `npm run generate:status`
 * 从后端常量生成，整文件关闭 lint 是生成器模板的一部分（生成器见 scripts/generate-status-constants.js）。
 */
const FILE_DISABLE_ALLOWED = new Set(['frontend/src/generated/status.ts'])

const INLINE_RE = /eslint-disable-(?:next-line|line)\b/
const FILE_DISABLE_RE = /\/\*\s*eslint-disable(?![-\w]*(?:next-line|line))/
/** 指令出现在字符串里（生成器的模板内容），不是真的指令。 */
const AS_STRING_RE = /['"`]\s*\/\*\s*eslint-disable/

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out)
    } else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** 该行是不是一条说明性注释（且不是另一条 eslint 指令）。 */
function isRationaleComment(line) {
  if (!/^\s*(\/\/|\/\*|\*)/.test(line)) return false
  return !/eslint-disable/.test(line)
}

function main() {
  const files = []
  for (const rel of SCAN_ROOTS) {
    const abs = path.join(ROOT, rel)
    if (fs.existsSync(abs)) walk(abs, files)
  }
  assert.ok(files.length > 300, `扫描到的源码文件太少（${files.length}）`)

  const problems = []
  const inlineSites = []
  const fileDisableSites = []

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    if (rel === SELF) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // ── 整文件禁用：只允许白名单 ──────────────────────────────────────────
      if (FILE_DISABLE_RE.test(line) && !AS_STRING_RE.test(line)) {
        fileDisableSites.push(`${rel}:${i + 1}`)
        if (!FILE_DISABLE_ALLOWED.has(rel)) {
          problems.push(
            `${rel}:${i + 1} 整文件关闭了 eslint——这会让规则在该文件里永久失效。` +
              `请改成对具体行、具体规则禁用，或把文件加入 FILE_DISABLE_ALLOWED 并写明理由`,
          )
        }
      }

      // ── 逐行禁用：上方窗口内必须有说明性注释 ──────────────────────────────
      if (!INLINE_RE.test(line)) continue
      inlineSites.push(`${rel}:${i + 1}`)
      const from = Math.max(0, i - RATIONALE_WINDOW)
      const hasRationale = lines.slice(from, i).some(isRationaleComment)
      if (!hasRationale) {
        const rule = (line.match(/eslint-disable-(?:next-line|line)\s+(\S+)/) || [])[1] || '(未指明规则)'
        problems.push(
          `${rel}:${i + 1} 禁用了 ${rule} 但没说原因——` +
            `请在指令上方补一行注释说明「为什么这里必须禁用、带着它会发生什么」`,
        )
      }
    }
  }

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `eslint-disable-rationale: 扫描 ${files.length} 个文件、` +
      `逐行禁用 ${inlineSites.length} 处、整文件禁用 ${fileDisableSites.length} 处` +
      `（白名单 ${FILE_DISABLE_ALLOWED.size} 个）、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] 每处 lint 禁用都带可读理由；整文件禁用仅限机器产物')
}

main()
