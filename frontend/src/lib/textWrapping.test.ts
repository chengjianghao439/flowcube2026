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

test('ERP/PDA 渲染源码没有省略号或行数截断样式', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const failures: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) {
        for (const hit of truncationStyles(readFileSync(file, 'utf8'))) failures.push(`${path.relative(root, file)}: ${hit}`)
      } else if (file.endsWith('.css') && /text-overflow\s*:\s*ellipsis|-webkit-line-clamp\s*:\s*\d/.test(readFileSync(file, 'utf8'))) failures.push(file)
    }
  }
  walk(root)
  expect(failures).toEqual([])
})

test('反向验证：直接、条件、模板、子元素及内联截断都会失败，注释不误报', () => {
  for (const source of [
    '<p className="truncate" />', '<p className={ok ? "line-clamp-2" : ""}/>',
    '<p className={`text-xs truncate ${color}`}/>', '<p className="[&>span]:line-clamp-1"/>',
    '<p style={{textOverflow:"ellipsis"}}/>', '<p style={{WebkitLineClamp:2}}/>',
  ]) expect(truncationStyles(source).length).toBeGreaterThan(0)
  expect(truncationStyles('// className="truncate"\nconst truncated = true; <p className="whitespace-normal"/>')).toEqual([])
})
