'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const guard = path.join(__dirname, 'copy-conventions.test.js')
const requireGuard = createRequire(guard)

// 对真实守卫注入源码夹具，避免只测解析函数却漏掉主扫描流程的接线。
function runGuard(relativePath, fixture) {
  let status
  const output = []
  const target = path.join(root, relativePath)
  vm.runInNewContext(fs.readFileSync(guard, 'utf8'), {
    __dirname,
    require(name) {
      if (name === 'node:fs') return { ...fs, readFileSync(file, encoding) {
        const source = fs.readFileSync(file, encoding)
        return file === target ? source + '\n' + fixture : source
      } }
      return requireGuard(name)
    },
    console: { log: () => {}, error: message => output.push(message) },
    process: { exit: code => { status = code } },
  })
  const fixtureLine = fs.readFileSync(target, 'utf8').split('\n').length + 1
  return { status, output: output.join('\n'), marker: `${relativePath}:${fixtureLine}` }
}

test('URL后同一行的用户文案仍被扫描', () => {
  const result = runGuard('frontend/src/lib/format.ts', "const probe = 'https://example.test'; toast.error('容器不存在')")
  assert.equal(result.status, 1)
  assert.ok(result.output.includes(`${result.marker} 用户文案出现「容器」`), result.output)
})

for (const [name, fixture] of [
  ['单引号', "new AppError('容器不存在', 400)"],
  ['双引号', 'new AppError("容器不存在", 400)'],
  ['模板', 'new AppError(`容器 ${id} 不存在`, 400)'],
]) {
  test(`AppError${name}消息进入真实文案守卫`, () => {
    const result = runGuard('backend/src/modules/products/products.service.js', fixture)
    assert.equal(result.status, 1)
    assert.ok(result.output.includes(`${result.marker} 错误消息出现「容器」`), result.output)
  })
}

test('字符串中的注释符保持原值，真正的注释不算用户文案', () => {
  const { stripComments, uiCopySpans, appErrorSpans } = require('../scripts/lib/copy-conventions-parser')
  const source = [
    '// 容器不存在',
    '/* new AppError("容器不存在", 400) */',
    'const urlProbe = "https://example.test/正常"',
    'const blockProbe = "/*正常文本*/"',
    'const templateProbe = `https://example.test/${id}/正常`',
    'const regexProbe = /https?:\\/\\//; // 容器不存在',
  ].join('\n')
  const stripped = stripComments(source, 'fixture.js')
  assert.equal(stripped.length, source.length)
  assert.equal(stripped.split('\n').length, source.split('\n').length)
  assert.ok(stripped.includes('https://example.test/正常'))
  assert.ok(stripped.includes('/*正常文本*/'))
  assert.ok(stripped.includes('https://example.test/${id}/正常'))
  assert.ok(!stripped.includes('容器不存在'))
  assert.deepEqual(appErrorSpans(source), [])
  assert.ok(uiCopySpans(source, 'fixture.js').every(span => !span.text.includes('容器')))
})

test('JSX表达式后正文与属性均进入扫描，注释忽略且位置保持', () => {
  const { stripComments, uiCopySpans } = require('../scripts/lib/copy-conventions-parser')
  const source = '<div title="正常文本">{id}容器流水{/* 波次注释 */}</div>'
  const stripped = stripComments(source, 'fixture.tsx')
  const spans = uiCopySpans(stripped, 'fixture.tsx')
  assert.ok(spans.some(span => span.text === '正常文本'))
  assert.ok(spans.some(span => span.text === '容器流水' && span.index === source.indexOf('容器流水')))
  assert.ok(spans.every(span => !span.text.includes('波次注释')))
})
