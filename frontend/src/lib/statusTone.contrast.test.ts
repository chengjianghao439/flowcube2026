import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { STATUS_TONE_CLASS } from './statusTone'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function tokens(selector: string) {
  const block = css.slice(css.indexOf(selector)).split('}')[0]
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)].map(m => [m[1], hsl(Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100)]))
}
function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map(n => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  })
}
function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) => rgb.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (x + .05) / (y + .05)
}
for (const theme of [':root', '.dark']) {
  const palette = tokens(theme)
  test(`${theme} 次要文字在页面、表单及工具栏达到 4.5:1`, () => {
    for (const surface of ['background', 'card', 'muted']) expect(contrast(palette['muted-foreground'], palette[surface]), surface).toBeGreaterThanOrEqual(4.5)
  })
  test(`${theme} 主按钮文字在实际悬停背景达到 4.5:1`, () => {
    for (const surface of ['background', 'card']) {
      const hover = palette.primary.map((c, i) => .9 * c + .1 * palette[surface][i])
      expect(contrast(palette['primary-foreground'], hover), surface).toBeGreaterThanOrEqual(4.5)
    }
  })
  test(`${theme} success 文字在PDA嵌套信息提示背景达到 4.5:1`, () => {
    const adjacent = theme === ':root' ? [215, 231, 228].map(c => c / 255) : palette.card
    expect(contrast(palette['success-ink'], adjacent)).toBeGreaterThanOrEqual(4.5)
  })
  for (const [tone, classes] of Object.entries(STATUS_TONE_CLASS)) {
    test(`${theme} ${tone} 状态文字在两类实色底上达到 4.5:1`, () => {
      const fg = classes.match(/\btext-([\w-]+)/)![1]
      const [, bg, opacity] = classes.match(/\bbg-([\w-]+)(?:\/(\d+))?/)!
      const alpha = opacity ? Number(opacity) / 100 : 1
      for (const surface of ['background', 'card']) {
        const mixed = palette[bg].map((c, i) => alpha * c + (1 - alpha) * palette[surface][i])
        expect(contrast(palette[fg], mixed), `${tone}/${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
}
