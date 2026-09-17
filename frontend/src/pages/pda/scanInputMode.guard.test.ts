// 静态契约：PDA 默认「扫码模式」，软键盘只在用户点击后出现（2026-09-17 用户要求）。
//
// 背景：现场用工业 PDA 的扫描头直接扫条码；只要有输入框被自动聚焦（进页面 focus、
// 整页 onClick focus、autoFocus 属性），Android 就会弹出软键盘挡住作业区。
// 这个守卫遍历 PDA 页面与其专用组件，禁止再引入任何自动聚焦路径；
// 行为层回归见 `frontend/src/pages/pda/task.test.tsx`。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const pdaDir = dirname(fileURLToPath(import.meta.url))                  // src/pages/pda
const pdaComponentsDir = join(pdaDir, '..', '..', 'components', 'pda')  // src/components/pda

function sources(dir: string, suffix = '.tsx') {
  return readdirSync(dir)
    .filter(name => name.endsWith(suffix) && !name.includes('.test.'))
    .map(name => ({ name, code: readFileSync(join(dir, name), 'utf8') }))
}

test('PDA 页面不自动聚焦输入框：除登录页外不允许 autoFocus', () => {
  // 登录页是唯一例外：用户名框自动聚焦只为省一次点击，登录前没有扫码作业。
  const offenders = sources(pdaDir).filter(f => f.name !== 'login.tsx' && f.code.includes('autoFocus'))
  expect(offenders.map(f => f.name)).toEqual([])
})

test('PDA 页面与组件不允许主动 focus 输入框，只有手动输入按钮可以', () => {
  const pageOffenders = sources(pdaDir, '.ts').filter(f => f.code.includes('.focus('))
  expect(pageOffenders.map(f => f.name)).toEqual([])

  const componentOffenders = sources(pdaComponentsDir)
    .filter(f => f.name !== 'PdaScanner.tsx' && f.code.includes('.focus('))
  expect(componentOffenders.map(f => f.name)).toEqual([])
})

test('PdaScanner 只在点「手动输入」后聚焦，不提供自动聚焦入口', () => {
  const code = readFileSync(join(pdaComponentsDir, 'PdaScanner.tsx'), 'utf8')
  expect(code.match(/\.focus\(\)/g) ?? []).toHaveLength(1)
  expect(code).toMatch(/function enterManualMode\(\)\s*\{[\s\S]*?\.focus\(\)/)
  expect(code).not.toMatch(/autoFocus\??\s*:/)
})
