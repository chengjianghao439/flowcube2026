#!/usr/bin/env node
'use strict'

/**
 * 库存域加锁顺序契约测试（机械核对，无需 DB）。
 *
 * 背景（2026-09-18 多维度审计 [27]）：本仓全局约定是「先 lockStockDimension(商品,仓库) 锁住
 * inventory_stock 的单行，再锁单个 inventory_containers 行」。`confirmContainerReturn`
 * （PDA 改单归还确认）原先直接 FOR UPDATE 容器，顺序与上架/出库/盘点/拆分/调拨相反，
 * 与同 (商品,仓库) 的并加上架构成 ABBA 环（上架持维度锁等容器，归还持容器等维度锁）。
 *
 * 顺序是并发正确性的一部分，但它**看不见也测不稳定**（要构造真并发才可能偶发死锁），
 * 所以这里同 `finance-lock-order-contract.test.js` 退一步做静态契约：机械判定
 * 「有没有调 lockStockDimension、是不是在锁容器之前」，不判断语义。
 *
 * 运行：node tests/inventory-lock-order-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

/** 每个路径都必须在**同一个函数体内**先取维度锁，再锁容器行。 */
const PATHS = [
  {
    file: 'backend/src/modules/warehouse-tasks/warehouse-tasks.adjust.js',
    fn: 'confirmContainerReturn（PDA 改单归还确认）',
  },
  {
    file: 'backend/src/engine/containerEngine.js',
    fn: 'splitContainer（同仓容器拆分）',
  },
]

/** 维度锁：对 inventory_stock 单行 FOR UPDATE（容器锁的前置） */
const DIMENSION_LOCK = /lockStockDimension\s*\(/
/**
 * 容器行锁的位置：**按语句归属**找第一条锁 inventory_containers 的 FOR UPDATE。
 * 不能简单写 /FROM inventory_containers[\s\S]{0,400}?FOR UPDATE/ —— 那会把前面那句
 * 「非锁定读」的 FROM 也算成锁点（它会一路匹配到后面那句 FOR UPDATE），
 * 于是"先维度后容器"反而被判成顺序相反。判定口径：某个 FOR UPDATE 之前、
 * 上一个 FOR UPDATE 之后的那段语句里出现了 inventory_containers，才算锁容器。
 */
function firstContainerLockIndex(body) {
  const re = /FOR\s+UPDATE/g
  let prev = 0
  let m
  while ((m = re.exec(body))) {
    const segment = body.slice(prev, m.index)
    const at = segment.lastIndexOf('inventory_containers')
    if (at >= 0) return prev + at
    prev = re.lastIndex
  }
  return -1
}

/** 去掉注释再做机械匹配——注释里写着 `lockStockDimension(...)` 的说明文案
 *  会把「只留注释、删掉调用」的回归伪装成通过（本测试第一版就是这样误报的）。 */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++ }
    } else if (c === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < source.length) { out += '  '; i += 2 }
    } else {
      out += c
      i++
    }
  }
  return out
}

/** 取出顶层函数的函数体：从 `async function name(` 到下一个顶格的 `}` */
function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`)
  assert.ok(start >= 0, `找不到 ${name} 函数——若已重命名，请同步更新本契约测试，不要直接删断言`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, `无法确定 ${name} 的函数体边界`)
  return { body: source.slice(start, end), offset: start }
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
    const { body, offset } = functionBody(stripComments(source), p.fn.slice(0, p.fn.indexOf('（')))

    const dimMatch = body.match(DIMENSION_LOCK)
    const containerLockIndex = firstContainerLockIndex(body)

    if (containerLockIndex < 0) {
      problems.push(`${p.file}（${p.fn}）：函数体内找不到 inventory_containers 的 FOR UPDATE 取锁语句——`
        + '若确实重构了取锁写法，请同步更新本契约测试的正则，不要直接删断言')
      continue
    }
    if (!dimMatch) {
      problems.push(`${p.file}（${p.fn}）：直接锁容器却**没有**先取 lockStockDimension(商品,仓库) 维度锁。`
        + '必须按「维度 → 容器」取锁，否则与同 (商品,仓库) 的并加上架/盘点构成 ABBA 死锁环')
      continue
    }
    if (dimMatch.index > containerLockIndex) {
      problems.push(`${p.file}（${p.fn}）：加锁顺序相反——lockStockDimension 在第 `
        + `${lineOf(source, offset + dimMatch.index)} 行，容器 FOR UPDATE 在第 `
        + `${lineOf(source, offset + containerLockIndex)} 行。必须先锁维度再锁容器`)
      continue
    }
    console.log(`  ✓ ${p.file}（${p.fn}）`
      + ` lockStockDimension@${lineOf(source, offset + dimMatch.index)}`
      + ` → container FOR UPDATE@${lineOf(source, offset + containerLockIndex)}`)
  }

  if (problems.length) {
    console.error('\n库存域加锁顺序违规：')
    for (const p of problems) console.error('  ✗ ' + p)
  } else {
    console.log(`✓ 加锁顺序契约成立：${PATHS.length} 条路径均为「先 lockStockDimension(商品,仓库)，再锁容器」`)
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  库存加锁顺序契约: ${problems.length === 0 ? 'PASS' : problems.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(problems.length ? 1 : 0)
}

main()
