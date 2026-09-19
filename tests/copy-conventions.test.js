#!/usr/bin/env node
'use strict'

/**
 * 界面文案口径契约（纯静态，无需 DB）。
 *
 * 背景（2026-09-19 全量文案审计）：本仓库对「界面用词」有过多次决议，但**散落在提案、
 * release notes 与记忆里，没写进现行约定文档、也没有守卫**，于是执行力度严重不均——
 * 「序列号」按 `docs/proposals/13-条码与序列号融合.md` 清理干净了（全仓只剩 1 处注释），
 * 「容器」却仍在 PDA、报表、官网大摇大摆出现；`lib/displayFormatters.ts` 里甚至同一个
 * `CONTAINER_LOCK_CONFLICT`，ERP 版写「容器已被其它任务占用」、PDA 版已改成
 * 「这个货已被其它任务占用」——同一文件自相矛盾。
 *
 * 文档会被忽略、会腐烂，机械断言不会。本守卫把口径钉成契约：
 *   1. 面向用户的文案不得出现实现词（容器/波次/主链/缓存/落库/回执/拉取…）；
 *   2. 加载态动词统一为「加载」，「正在读取」不再使用；
 *   3. 中文之间不得混半角标点（`,;!?`）；
 *   4. 官网 `pages/landing` 与候选 `pages/landing-preview` 的关键文案必须双份一致
 *      （两者内容同源、仅 import 路径不同，改一处漏另一处是已经发生过的真实事故）；
 *   5. 金额一律走 `lib/format` 的 `money()`/`amount()`，不得手写 `¥` + `toFixed(2)`。
 *
 * 第 5 条是 2026-09-19 金额收敛的守卫：`¥{x.toFixed(2)}` 没有千分位，`¥1234567.89` 在列表里
 * 读不出位数；空值还会显示成 `¥0.00`，让「没有数据」看起来像「金额为零」。打印管线原先
 * 被列为例外，但它同样要给人看（客户拿到的销售单、供应商拿到的采购单），已一并收敛；
 * 全仓现在只剩「x.xx万」卡片一处刻意例外（见 MONEY_ALLOW，失效即失败）。
 *
 * 只扫**用户可见文案**：去掉注释后的字符串字面量与 JSX 文本。变量名、注释、测试文件
 * 不在范围内——「容器」作为标识符（containerId）是允许的，禁止的是它出现在用户读到的句子里。
 *
 * 运行：node tests/copy-conventions.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'frontend/src')

/**
 * 面向用户文案的禁用词 → 应该怎么改。
 *
 * 判断标准：这个词是**实现/内部概念**，业务用户读到它要么看不懂，要么被误导。
 * 不收录业内在用、且已写进 `docs/frontend-pda-conventions.md` 的作业词
 * （占库、复核、批次、塑料盒、箱贴、上架、拣货 等一律放行）。
 */
const BANNED_IN_UI_COPY = new Map([
  ['容器', '界面一律说「库存条码」或「塑料盒」（内部术语不外露）'],
  ['波次', '拣货批量单统一叫「批次」'],
  ['主链', '后端链路词，用户只关心「进度」'],
  ['缓存漂移', '改说「账面差异」'],
  ['缓存', '实现词；库存语境说「账面数量」，别让用户去改缓存'],
  ['落库', '说「入库/保存」，不说数据落库'],
  ['科目地基', '内部文档用语，改用「会计科目」'],
  ['回执', '说「结果/记录」，不说提交回执'],
  ['正在读取', '加载态动词统一用「加载」'],
  ['API_BASE_URL', '变量名不得上界面'],
  ['sha256', '技术词；对用户说「更新包已损坏」'],
  ['avg_cost', '数据库字段名不得上界面'],
  ['事实源', '架构词；对用户说「以…为准」'],
  ['会话', '身份概念；对用户说「登录 / 退出登录」'],
  ['快照', '实现词；对用户说「生成时的依据 / 数据」'],
  ['服务端', '对用户说「系统」'],
])

/**
 * 豁免：必须逐条登记并写明理由，且**失效的豁免会让守卫失败**（避免清单僵化）。
 * 键为 `相对路径:禁用词`。
 */
const ALLOWLIST = new Map([
  // 官网「版本更新」是历史发布记录，如实保留当时的措辞，不按今天的口径回改
  ['frontend/src/pages/landing/updates.ts:服务端', '历史版本更新记录，如实保留当时措辞'],
])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'generated' || e.name === 'node_modules') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/** 剥离注释后再扫描：注释里引述旧写法（如"以前叫容器"）不是违规。等长空白替换，行号保持准确。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
}

const CJK = /[\u4e00-\u9fff]/

/** 抽取用户可见文案：字符串字面量 + JSX 文本节点。 */
function uiCopySpans(source) {
  const spans = []
  const strRe = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g
  let m
  while ((m = strRe.exec(source)) !== null) {
    if (CJK.test(m[2])) spans.push({ text: m[2], index: m.index })
  }
  const jsxRe = />([^<>{}]*[\u4e00-\u9fff][^<>{}]*)</g
  while ((m = jsxRe.exec(source)) !== null) spans.push({ text: m[1], index: m.index })
  return spans
}

/** 中文之间夹半角标点（排除数字千分位、小数等）。 */
const HALF_WIDTH_BETWEEN_CJK = /[\u4e00-\u9fff][,;!?][\u4e00-\u9fff]/

const LANDING_PAIRS = ['index.tsx', 'BusinessStory.tsx']

/**
 * 允许手写 `¥` + `toFixed(2)` 的文件（逐条登记，命中数归零即守卫失败）。
 * 仪表盘库存价值卡片以「万」为单位（`¥1.23万`），数值本来就只有两三位，加千分位没有意义。
 */
const MONEY_ALLOW = new Map([
  ['frontend/src/components/dashboard/widgets/KpiWidgets.tsx', '以「万」为单位的卡片数值，位数本来很短'],
])

function main() {
  const files = walk(SRC)
  assert.ok(files.length > 100, `前端源码文件数异常（${files.length}），目录结构可能变了`)

  const problems = []
  const usedAllow = new Set()
  const usedMoneyAllow = new Set()

  for (const f of files) {
    const rel = `frontend/src/${path.relative(SRC, f)}`
    const source = stripComments(fs.readFileSync(f, 'utf8'))

    for (const span of uiCopySpans(source)) {
      for (const [word, why] of BANNED_IN_UI_COPY) {
        if (!span.text.includes(word)) continue
        const key = `${rel}:${word}`
        if (ALLOWLIST.has(key)) { usedAllow.add(key); continue }
        problems.push(`${rel}:${lineOf(source, span.index)} 用户文案出现「${word}」——${why}\n        原文：${span.text.trim().slice(0, 90)}`)
      }
      if (HALF_WIDTH_BETWEEN_CJK.test(span.text)) {
        problems.push(`${rel}:${lineOf(source, span.index)} 中文之间用了半角标点——改为全角「，；！？」\n        原文：${span.text.trim().slice(0, 90)}`)
      }
    }
  }

  // 官网正式页与候选页：关键文案必须双份一致（同源复制，改一处必须两处同改）
  for (const name of LANDING_PAIRS) {
    const a = path.join(SRC, 'pages/landing', name)
    const b = path.join(SRC, 'pages/landing-preview', name)
    if (!fs.existsSync(a) || !fs.existsSync(b)) continue
    const copyOf = (file) => new Set(
      uiCopySpans(stripComments(fs.readFileSync(file, 'utf8')))
        .map((s) => s.text.trim())
        .filter((t) => t.length >= 4 && CJK.test(t)),
    )
    const setA = copyOf(a)
    const setB = copyOf(b)
    const onlyA = [...setA].filter((t) => !setB.has(t))
    for (const t of onlyA) {
      problems.push(`官网双份不一致：pages/landing/${name} 有「${t.slice(0, 60)}」而 pages/landing-preview/${name} 没有——改文案必须两处同改`)
    }
  }

  // 金额格式化：手写 `¥` + toFixed(2) 会丢掉千分位，空值还会被写成 ¥0.00
  for (const f of files) {
    const rel = `frontend/src/${path.relative(SRC, f)}`
    const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('¥') || !/toFixed\(2\)/.test(line)) return
      if (MONEY_ALLOW.has(rel)) { usedMoneyAllow.add(rel); return }
      problems.push(`${rel}:${i + 1} 手写金额格式化（¥ + toFixed(2)）——改用 lib/format 的 money()（带 ¥）或 amount()（会计凭证）\n        原文：${line.trim().slice(0, 90)}`)
    })
  }

  const staleAllow = [...ALLOWLIST.keys()].filter((k) => !usedAllow.has(k))
  assert.deepEqual(staleAllow, [],
    `这些豁免已不再命中（代码已改或已删除），必须从清单里删掉：${staleAllow.join(', ')}`)

  const staleMoneyAllow = [...MONEY_ALLOW.keys()].filter((k) => !usedMoneyAllow.has(k))
  assert.deepEqual(staleMoneyAllow, [],
    `这些金额格式化豁免已不再命中（写法已改或文件已删），必须从 MONEY_ALLOW 删掉：${staleMoneyAllow.join(', ')}`)

  console.log(`扫描源码 ${files.length} 个（frontend/src 全量，去注释后只看用户可见文案）`)
  console.log(`禁用词 ${BANNED_IN_UI_COPY.size} 个、豁免 ${ALLOWLIST.size} 条、金额格式化豁免 ${MONEY_ALLOW.size} 条`)

  if (problems.length) {
    console.error('\n界面文案口径违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log('✓ 未发现实现词泄漏、半角标点、官网双份不一致或手写金额格式化')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  界面文案口径: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
