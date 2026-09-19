#!/usr/bin/env node
'use strict'

/**
 * AGENTS.md 注入守卫（纯静态，无需 DB）。
 *
 * 背景（2026-09-18 实测事故）：编码代理的「工作区指令注入」按候选名
 * `AGENTS.md` → `CLAUDE.md` 逐层收集，**总量受字节预算约束**；超预算时从
 * 「更宽」的一端省略、最后只保留或截断最具体的那一个。当时根目录同时存在
 * 166 KB 的 `CLAUDE.md` 与 211 KB 的 `AGENTS.md`，新会话注入的是**过时的旧正文**，
 * `AGENTS.md` 显示 `omitted`——也就是说，仓库里最权威的现行说明根本没进模型上下文，
 * 而全链路没有任何一处会报错。
 *
 * 处置（同日）：旧 `CLAUDE.md` 归档为 `docs/claude-md-archive-2026-09-04.md`（非候选名），
 * `AGENTS.md` 抽掉 §11–§18 日记后由 211 KB 降到约 107 KB。
 *
 * 本测试守住那次处置的**四个可机械验证的结论**，防止它们随日常改动悄悄失效：
 *   1. 目录链上不得再出现 `CLAUDE.md` 候选文件（根目录最严禁，一行指针也不行）；
 *   2. `AGENTS.md` 必须存在、非空、含关键章节，且体积不超注入预算（超默认预算只告警）；
 *      更进一步：**防呆清单与全部红线关键词必须落在默认预算 64 KiB 以内**——
 *      约束写在预算之外时不进上下文，等于没写；
 *   3. `AGENTS.md` 里 `docs/*.md` 引用必须真实存在，归档文件也不能丢——
 *      代理按这些指引去读证据，路径失效等于把「已完成」变成「查无此事」；
 *   4. 正文里 `npm run X` 引用的脚本必须还在 `package.json` 里（同上，失效指引）。
 *
 * 运行：node tests/agents-md-injection-guard.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const AGENTS_MD = path.join(ROOT, 'AGENTS.md')
const ARCHIVE = 'docs/agents-md-archive-2026-09-18.md'

/**
 * 注入预算（字节）。两个都是 dsh `agent-instructions` 的 `maxBytes` 实配值：
 *  - 默认 `standard` 预设：65536（64 KiB）——超出即截断**尾部**，只告警不失败，
 *    因为这是部署侧配置而非仓库缺陷；
 *  - 本机 `standard-fullctx` 副本：131072（128 KiB）——仓库必须守住的上限，
 *    超过它连本机注入都会失真，故作为硬门禁。
 */
const DEFAULT_BUDGET_BYTES = 65536
const HARD_BUDGET_BYTES = 131072

/**
 * 被禁的候选文件名。注入候选是 `AGENTS.md` → `CLAUDE.md`（精确匹配、区分大小写），
 * `AGENTS.md` 是我们要的那份，`CLAUDE.md` 一旦重现就会与它竞争注入预算。
 */
const BANNED_CANDIDATE = 'CLAUDE.md'

/** `AGENTS.md` 必须保留的关键章节（丢了就是现行约束被误删）。 */
const REQUIRED_SECTIONS = [
  '## 0. 第一时间同步文档',
  '## 0.1 防呆清单',
  '## 6. 库存、事务与幂等',
  '## 7. 核心业务语义',
]

/** 必须在正文出现的红线关键词：章节标题可能被改写，红线本身不能被搬走。 */
const REQUIRED_RED_LINES = [
  'inventory_containers.remaining_qty',
  'syncStockFromContainers',
  'lockStockDimension',
  'X-Request-Key',
  '北京时间',
]

/**
 * 必须落在**默认预算 64 KiB 以内**的关键内容。只「存在」不够——默认预设只注入
 * 前 64 KiB，排在后面的约束根本进不了模型上下文，等于没写，而且不会有任何报错。
 *
 * 2026-09-18 实测：防呆清单原先排在文件最末尾（`### 11.1`），占 10.6 KB，
 * 而文件 118 KB——默认预算下它 **100% 被截断**，可它恰恰是「改动涉及这些文件时
 * 逐条对照」的操作清单。同日已前移到 §0 之后（`## 0.1`，起点约 4.2 KB），
 * 由本组断言钉住位置。反向验证：把它挪回文件末尾即失败。
 */
const MUST_BE_WITHIN_DEFAULT_BUDGET = ['## 0.1 防呆清单', ...REQUIRED_RED_LINES]

/** 允许缺失的引用（需要理由；当前为空，登记必须是真例外）。 */
const ALLOWED_MISSING_DOC_REFS = new Set([])

/** 找到包含 `.git` 的工作区指令注入链顶端（含该层）。 */
function instructionChain() {
  const chain = []
  let dir = ROOT
  for (;;) {
    chain.push(dir)
    if (fs.existsSync(path.join(dir, '.git'))) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return chain
}

/**
 * 超过默认预算时，算出截断点落在哪一节——被截掉的是**尾部**，
 * 所以这里直接报告「最后一个完整保留的章节」，便于判断损失面。
 */
function truncationReport(text) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= DEFAULT_BUDGET_BYTES) return null
  const head = buf.subarray(0, DEFAULT_BUDGET_BYTES).toString('utf8')
  const lines = head.split('\n')
  let lastSection = '(无)'
  for (const line of lines) {
    if (/^##\s/.test(line)) lastSection = line.trim()
  }
  return {
    bytes: buf.length,
    lastSection,
    lostKB: ((buf.length - DEFAULT_BUDGET_BYTES) / 1024).toFixed(1),
  }
}

function main() {
  const problems = []

  // ── 1. 目录链上不得存在 CLAUDE.md 候选文件 ────────────────────────────────
  const chain = instructionChain()
  for (const dir of chain) {
    const p = path.join(dir, BANNED_CANDIDATE)
    if (!fs.existsSync(p)) continue
    const size = fs.statSync(p).size
    problems.push(
      `目录链上存在被禁候选 ${path.relative(ROOT, p) || p}（${size} 字节）：` +
        '它会与 AGENTS.md 竞争注入预算并可能把现行正文挤掉，必须归档到 docs/ 下并改用非候选文件名',
    )
  }

  // ── 2. AGENTS.md 存在、非空、含关键章节与红线 ─────────────────────────────
  assert.ok(fs.existsSync(AGENTS_MD), 'AGENTS.md 不存在')
  const text = fs.readFileSync(AGENTS_MD, 'utf8')
  const bytes = Buffer.byteLength(text, 'utf8')
  assert.ok(bytes > 20000, `AGENTS.md 体积异常（${bytes} 字节），可能被误清空`)

  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(section)) problems.push(`AGENTS.md 缺少关键章节：${section}`)
  }
  for (const red of REQUIRED_RED_LINES) {
    if (!text.includes(red)) problems.push(`AGENTS.md 缺少红线关键词：${red}`)
  }

  // ── 3. 体积门禁 ──────────────────────────────────────────────────────────
  if (bytes > HARD_BUDGET_BYTES) {
    problems.push(
      `AGENTS.md 已达 ${bytes} 字节，超过注入硬预算 ${HARD_BUDGET_BYTES}（128 KiB）：` +
        '注入会被截断，尾部章节（含 §11.1 防呆清单）进不了模型上下文。' +
        '请把过程记录/日记抽到 docs/ 或拆分章节，不要提高预算绕过',
    )
  }

  // ── 4. docs 引用必须存在，归档不能丢 ──────────────────────────────────────
  assert.ok(
    fs.existsSync(path.join(ROOT, ARCHIVE)),
    `归档文件 ${ARCHIVE} 丢失：§11 索引与历史「见第 X 节」引用全部失效`,
  )
  const refs = new Set()
  for (const m of text.matchAll(/(?:^|[\s`(])(docs\/[A-Za-z0-9._/-]+\.md)/g)) {
    refs.add(m[1])
  }
  assert.ok(refs.size > 40, `只解析到 ${refs.size} 个 docs 引用，扫描逻辑可能失效`)
  const missing = [...refs].filter(
    (r) => !ALLOWED_MISSING_DOC_REFS.has(r) && !fs.existsSync(path.join(ROOT, r)),
  )
  for (const m of missing) problems.push(`AGENTS.md 引用的文档不存在：${m}`)

  // ── 5. `npm run X` 引用的脚本必须存在 ─────────────────────────────────────
  // 文档指向已改名/删除的脚本，和指向不存在的文档一样是失效指引：代理会照抄
  // 一个跑不通的命令，且失败信息不指向这里。AGENTS.md 当前引用约 50 个脚本。
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const scripts = new Set(Object.keys(pkg.scripts || {}))
  const runRefs = new Set()
  for (const m of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) runRefs.add(m[1])
  assert.ok(runRefs.size > 30, `只解析到 ${runRefs.size} 个 npm 脚本引用，扫描逻辑可能失效`)
  for (const r of runRefs) {
    if (!scripts.has(r)) problems.push(`AGENTS.md 引用了不存在的 npm 脚本：npm run ${r}`)
  }

  // ── 6. 关键内容必须真的注入得进去（写在预算之外 = 没写） ─────────────────
  const head = Buffer.from(text, 'utf8').subarray(0, DEFAULT_BUDGET_BYTES).toString('utf8')
  for (const item of MUST_BE_WITHIN_DEFAULT_BUDGET) {
    if (head.includes(item)) continue
    const at = text.indexOf(item)
    if (at < 0) {
      problems.push(`AGENTS.md 缺少必须可见的内容：${item}`)
      continue
    }
    const pos = Buffer.byteLength(text.slice(0, at), 'utf8')
    problems.push(
      `「${item}」在文件第 ${pos} 字节处，落在默认注入预算 ${DEFAULT_BUDGET_BYTES} 之外：` +
        '默认预设只注入前 64 KiB，排在后面的约束进不了上下文、等于没写。请前移到文件前部',
    )
  }

  // ── 7. 默认预算预警（不失败，属部署侧配置） ───────────────────────────────
  const trunc = truncationReport(text)
  if (trunc) {
    console.log(
      `  [WARN] AGENTS.md ${trunc.bytes} 字节 > 默认注入预算 ${DEFAULT_BUDGET_BYTES}；` +
        `在默认预设下尾部约 ${trunc.lostKB} KB 会被截断，最后一个完整章节是 ${trunc.lastSection}。` +
        '本机 standard-fullctx（131072）可完整注入；换机器请同步该配置。',
    )
  }

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `agents-md-injection-guard: 目录链 ${chain.length} 层、docs 引用 ${refs.size} 个、` +
      `npm 脚本引用 ${runRefs.size} 个、AGENTS.md ${bytes} 字节（硬限 ${HARD_BUDGET_BYTES}）、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] AGENTS.md 注入守卫通过')
}

main()
