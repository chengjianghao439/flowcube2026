import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { expect, test } from 'vitest'

// 检查语法树中的样式字面量，不把注释或接口的 truncated 数据标记当成文本截断。
function truncationStyles(source: string): string[] {
  const file = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  function visit(node: ts.Node) {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      /(?:^|\s|:)(?:truncate|text-ellipsis|line-clamp-\d+)(?=\s|$)/.test(node.text)) hits.push(node.text)
    if (ts.isPropertyAssignment(node) && ['textOverflow', 'WebkitLineClamp'].includes(node.name.getText(file).replace(/['"]/g, '')) &&
      /^(?:['"]ellipsis['"]|['"]?\d+['"]?)$/.test(node.initializer.getText(file))) hits.push(node.getText(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

function forbiddenCssTruncation(source: string): boolean {
  // 仅封闭的辅助备注预览可折叠；展开态、商品身份和详情仍必须完整。
  const permitted = /\.table-text-preview:not\(\[open\]\) \.table-text-value\s*\{\s*display:\s*-webkit-box;\s*-webkit-box-orient:\s*vertical;\s*-webkit-line-clamp:\s*2;\s*overflow:\s*hidden;\s*\}/g
  return /text-overflow\s*:\s*ellipsis|-webkit-line-clamp\s*:\s*\d/.test(source.replace(permitted, ''))
}

test('ERP/PDA 身份与详情完整，仅总览辅助文字及可展开备注允许折叠', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const failures: string[] = []
  let overviewRuleChecked = false
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) {
        const relative = path.relative(root, file)
        const hits = truncationStyles(readFileSync(file, 'utf8'))
        if (relative === 'components/pda/PdaOverviewText.tsx') {
          // 精确限定这一种辅助文字样式；不是整个 PDA 目录豁免。
          expect(hits).toEqual(['block min-w-0 truncate text-xs text-muted-foreground'])
          overviewRuleChecked = true
        } else {
          for (const hit of hits) failures.push(`${relative}: ${hit}`)
        }
      } else if (file.endsWith('.css') && forbiddenCssTruncation(readFileSync(file, 'utf8'))) failures.push(file)
    }
  }
  walk(root)
  expect(overviewRuleChecked).toBe(true)
  expect(failures).toEqual([])
})

test('备注折叠反向验证：展开态、其他文字和其他行数不得被豁免', () => {
  const permitted = '.table-text-preview:not([open]) .table-text-value { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }'
  expect(forbiddenCssTruncation(permitted)).toBe(false)
  for (const broken of [permitted.replace(':not([open])', ''), permitted.replace('table-text-value', 'product-name'), permitted.replace('clamp: 2', 'clamp: 1')]) expect(forbiddenCssTruncation(broken)).toBe(true)
})

test('反向验证：直接、条件、模板、子元素及内联截断都会失败，注释不误报', () => {
  for (const source of [
    '<p className="truncate" />', '<p className={ok ? "line-clamp-2" : ""}/>',
    '<p className={`text-xs truncate ${color}`}/>', '<p className="[&>span]:line-clamp-1"/>',
    '<p style={{textOverflow:"ellipsis"}}/>', '<p style={{WebkitLineClamp:2}}/>',
  ]) expect(truncationStyles(source).length).toBeGreaterThan(0)
  expect(truncationStyles('// className="truncate"\nconst truncated = true; <p className="whitespace-normal"/>')).toEqual([])
})
