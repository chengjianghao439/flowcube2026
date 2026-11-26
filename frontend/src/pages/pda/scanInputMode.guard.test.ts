// 静态契约：PDA 默认「扫码模式」，软键盘只在用户点击后出现（2026-09-17 用户要求）。
//
// 背景：现场用工业 PDA 的扫描头直接扫条码；只要有输入框被自动聚焦（进页面 focus、
// 整页 onClick focus、autoFocus 属性），Android 就会弹出软键盘挡住作业区。
// 这个守卫遍历 PDA 页面与其专用组件，禁止再引入任何自动聚焦路径；
// 行为层回归见 `frontend/src/pages/pda/task.test.tsx`。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

const pdaDir = dirname(fileURLToPath(import.meta.url))                  // src/pages/pda
const pdaComponentsDir = join(pdaDir, '..', '..', 'components', 'pda')  // src/components/pda

function sources(dir: string): { name: string; hasFocus: boolean; autoFocus: boolean }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) return sources(file)
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return []
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    let hasFocus = false, autoFocus = false
    function inspect(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'autoFocus') autoFocus = true
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'focus') hasFocus = true
      ts.forEachChild(node, inspect)
    }
    inspect(tree)
    return [{ name: file, hasFocus, autoFocus }]
  })
}

test('PDA 页面不自动聚焦输入框：除登录页外不允许 autoFocus', () => {
  const offenders = sources(pdaDir).filter(f => f.name !== join(pdaDir, 'login.tsx') && f.autoFocus)
  expect(offenders.map(f => f.name)).toEqual([])
})

test('PDA 页面与组件不允许主动 focus 输入框，只有手动输入按钮可以', () => {
  const scanner = join(pdaComponentsDir, 'PdaScanner.tsx')
  const offenders = [...sources(pdaDir), ...sources(pdaComponentsDir)].filter(f => f.name !== scanner && f.hasFocus)
  expect(offenders.map(f => f.name)).toEqual([])
})

test('PdaScanner 只在点「手动输入」后聚焦，不提供自动聚焦入口', () => {
  const code = readFileSync(join(pdaComponentsDir, 'PdaScanner.tsx'), 'utf8')
  expect(code.match(/\.focus\(\)/g) ?? []).toHaveLength(1)
  // 手输失败可以恢复当前手输的焦点；挂载/硬件扫码仍由真实行为用例守住不弹键盘。
  expect(code).toMatch(/manualInputRef\.current\.focus\(\)/)
  expect(code).toMatch(/function enterManualMode\(\)\s*\{[\s\S]*?focusManualInput\(\)/)
  expect(code).not.toMatch(/autoFocus\??\s*:/)
})
